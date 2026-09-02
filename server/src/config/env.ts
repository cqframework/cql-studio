// Author: Preston Lee

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  opencodeEnabled: boolean;
  opencodeRunnerUrl: string;
  opencodeRunnerToken: string;
  opencodeToolBridgeUrl: string;
  opencodeSessionIdleMs: number;
  opencodeCleanupIntervalMs: number;
  opencodeMaxSessionsPerUser: number;
  opencodeMaxSessionsGlobal: number;
  cqlAssetsDirectory?: string;
  cqlAssetsUrl: string;
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

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function nonNegativeInteger(name: string, raw: string | undefined, fallback: number): number {
  const value = raw == null || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
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

  const port = Number.parseInt(process.env.CQL_STUDIO_SERVER_PORT || '3003', 10);
  const opencodeEnabled = parseBoolean(
    'CQL_STUDIO_SERVER_OPENCODE_ENABLED',
    process.env.CQL_STUDIO_SERVER_OPENCODE_ENABLED,
    nodeEnv === 'development'
  );
  const allowUnauthenticatedOpenCode = parseBoolean(
    'CQL_STUDIO_SERVER_OPENCODE_ALLOW_UNAUTHENTICATED',
    process.env.CQL_STUDIO_SERVER_OPENCODE_ALLOW_UNAUTHENTICATED,
    nodeEnv === 'development'
  );
  if (opencodeEnabled && nodeEnv !== 'development' && !ssoConfigured && !allowUnauthenticatedOpenCode) {
    throw new Error(
      'OpenCode requires SSO in production unless CQL_STUDIO_SERVER_OPENCODE_ALLOW_UNAUTHENTICATED=true'
    );
  }

  const defaultRunnerToken = 'cql-studio-opencode-development-only';
  const opencodeRunnerToken =
    process.env.CQL_STUDIO_SERVER_OPENCODE_RUNNER_TOKEN?.trim() || defaultRunnerToken;
  if (
    opencodeEnabled &&
    nodeEnv !== 'development' &&
    (opencodeRunnerToken === defaultRunnerToken || Buffer.byteLength(opencodeRunnerToken) < 32)
  ) {
    throw new Error(
      'CQL_STUDIO_SERVER_OPENCODE_RUNNER_TOKEN must be a non-default secret of at least 32 bytes in production'
    );
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const monorepoAssets = path.resolve(moduleDirectory, '../../../ui/public/cql');
  const configuredAssetsDirectory =
    process.env.CQL_STUDIO_SERVER_CQL_ASSETS_DIRECTORY?.trim();
  const cqlAssetsDirectory =
    configuredAssetsDirectory || (existsSync(monorepoAssets) ? monorepoAssets : undefined);

  return {
    port,
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
    opencodeEnabled,
    opencodeRunnerUrl:
      process.env.CQL_STUDIO_SERVER_OPENCODE_RUNNER_URL?.trim().replace(/\/+$/, '') ||
      'http://localhost:4097',
    opencodeRunnerToken,
    opencodeToolBridgeUrl:
      process.env.CQL_STUDIO_SERVER_OPENCODE_TOOL_BRIDGE_URL?.trim().replace(/\/+$/, '') ||
      `http://host.docker.internal:${port}/api/opencode/tool-bridge`,
    opencodeSessionIdleMs: nonNegativeInteger(
      'CQL_STUDIO_SERVER_OPENCODE_SESSION_IDLE_MS',
      process.env.CQL_STUDIO_SERVER_OPENCODE_SESSION_IDLE_MS,
      60 * 60 * 1000
    ),
    opencodeCleanupIntervalMs: nonNegativeInteger(
      'CQL_STUDIO_SERVER_OPENCODE_CLEANUP_INTERVAL_MS',
      process.env.CQL_STUDIO_SERVER_OPENCODE_CLEANUP_INTERVAL_MS,
      60_000
    ),
    opencodeMaxSessionsPerUser: nonNegativeInteger(
      'CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_PER_USER',
      process.env.CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_PER_USER,
      0
    ),
    opencodeMaxSessionsGlobal: nonNegativeInteger(
      'CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_GLOBAL',
      process.env.CQL_STUDIO_SERVER_OPENCODE_MAX_SESSIONS_GLOBAL,
      0
    ),
    cqlAssetsDirectory,
    cqlAssetsUrl:
      process.env.CQL_STUDIO_SERVER_CQL_ASSETS_URL?.trim().replace(/\/+$/, '') ||
      `${uiBaseUrl}/cql`,
  };
}
