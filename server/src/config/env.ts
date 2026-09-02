// Author: Preston Lee

export const PINO_LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type PinoLogLevel = (typeof PINO_LOG_LEVELS)[number];

export interface ServerEnv {
  port: number;
  nodeEnv: string;
  logLevel: PinoLogLevel;
  corsOrigin: string;
  /** Public origin of the CQL Studio UI (no trailing slash). Used for post-login redirects. */
  uiBaseUrl: string;
  ssoConfigured: boolean;
  ssoIssuerUrl: string;
  ssoClientId: string;
  ssoClientSecret: string;
  /** Previous OIDC client secrets accepted during rotation (token exchange fallback). */
  ssoClientSecretPrevious: string[];
  ssoRedirectUrl: string;
  ssoScopes: string;
  /** Primary secret used to sign new cookies. */
  sessionSecret: string;
  /** Verification order: [current, ...previous]. */
  sessionSecrets: string[];
  databaseUrl: string;
}

function requiredWhenSso(name: string, value: string | undefined, ssoOn: boolean): string {
  const trimmed = value?.trim() ?? '';
  if (ssoOn && !trimmed) {
    throw new Error(`${name} is required when CQL_STUDIO_SERVER_SSO_ISSUER_URL is set`);
  }
  return trimmed;
}

function parseSecretList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const secret = part.trim();
    if (!secret || seen.has(secret)) {
      continue;
    }
    seen.add(secret);
    out.push(secret);
  }
  return out;
}

function parseLogLevel(raw: string | undefined): PinoLogLevel {
  const level = (raw?.trim() || 'info').toLowerCase();
  if (!(PINO_LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(
      `CQL_STUDIO_SERVER_LOG_LEVEL must be one of: ${PINO_LOG_LEVELS.join(', ')} (got "${raw}")`
    );
  }
  return level as PinoLogLevel;
}

export function loadEnv(): ServerEnv {
  const ssoIssuerUrl = process.env.CQL_STUDIO_SERVER_SSO_ISSUER_URL?.trim() ?? '';
  const ssoConfigured = ssoIssuerUrl.length > 0;

  const databaseUrl = process.env.CQL_STUDIO_SERVER_DATABASE_URL?.trim() ?? '';
  if (ssoConfigured && !databaseUrl) {
    throw new Error(
      'SSO is configured but CQL_STUDIO_SERVER_DATABASE_URL is not set. Refusing to start.'
    );
  }

  const sessionSecret = requiredWhenSso(
    'CQL_STUDIO_SERVER_SESSION_SECRET',
    process.env.CQL_STUDIO_SERVER_SESSION_SECRET,
    ssoConfigured
  );
  const previousSessionSecrets = parseSecretList(
    process.env.CQL_STUDIO_SERVER_SESSION_SECRET_PREVIOUS
  ).filter((s) => s !== sessionSecret);

  const ssoClientSecret = requiredWhenSso(
    'CQL_STUDIO_SERVER_SSO_CLIENT_SECRET',
    process.env.CQL_STUDIO_SERVER_SSO_CLIENT_SECRET,
    ssoConfigured
  );
  const ssoClientSecretPrevious = parseSecretList(
    process.env.CQL_STUDIO_SERVER_SSO_CLIENT_SECRET_PREVIOUS
  ).filter((s) => s !== ssoClientSecret);

  const corsOrigin = process.env.CQL_STUDIO_SERVER_CORS_ORIGIN?.trim() || 'http://localhost:4200';
  const uiBaseUrlRaw = requiredWhenSso(
    'CQL_STUDIO_SERVER_UI_BASE_URL',
    process.env.CQL_STUDIO_SERVER_UI_BASE_URL,
    ssoConfigured
  );
  const uiBaseUrl = (uiBaseUrlRaw || corsOrigin).replace(/\/+$/, '');

  const nodeEnv = process.env.CQL_STUDIO_SERVER_NODE_ENV || 'development';
  if (ssoConfigured && ssoIssuerUrl.startsWith('http://') && nodeEnv !== 'development') {
    throw new Error(
      'HTTP SSO issuer URLs are only allowed when CQL_STUDIO_SERVER_NODE_ENV=development'
    );
  }

  return {
    port: Number.parseInt(process.env.CQL_STUDIO_SERVER_PORT || '3003', 10),
    nodeEnv,
    logLevel: parseLogLevel(process.env.CQL_STUDIO_SERVER_LOG_LEVEL),
    corsOrigin,
    uiBaseUrl,
    ssoConfigured,
    ssoIssuerUrl,
    ssoClientId: requiredWhenSso(
      'CQL_STUDIO_SERVER_SSO_CLIENT_ID',
      process.env.CQL_STUDIO_SERVER_SSO_CLIENT_ID,
      ssoConfigured
    ),
    ssoClientSecret,
    ssoClientSecretPrevious,
    ssoRedirectUrl: requiredWhenSso(
      'CQL_STUDIO_SERVER_SSO_REDIRECT_URL',
      process.env.CQL_STUDIO_SERVER_SSO_REDIRECT_URL,
      ssoConfigured
    ),
    ssoScopes: process.env.CQL_STUDIO_SERVER_SSO_SCOPES?.trim() || 'openid profile email',
    sessionSecret,
    sessionSecrets: sessionSecret ? [sessionSecret, ...previousSessionSecrets] : [],
    databaseUrl,
  };
}
