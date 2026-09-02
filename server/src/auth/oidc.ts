// Author: Preston Lee

import * as client from 'openid-client';
import type { Configuration } from 'openid-client';
import type { ServerEnv } from '../config/env.js';
import { logger } from '../logger.js';

const configBySecret = new Map<string, Configuration>();

function discoveryOptionsForIssuer(
  issuerUrl: string
): client.DiscoveryRequestOptions | undefined {
  if (!issuerUrl.startsWith('http://')) {
    return undefined;
  }
  // Must pass the library's allowInsecureRequests reference — performDiscovery checks
  // execute.includes(allowInsecureRequests) by identity, not merely calling it on the config.
  // HTTP issuers are rejected at startup outside development (see loadEnv).
  return { execute: [client.allowInsecureRequests] };
}

function wrapOidcDiscoveryError(err: unknown, issuerUrl: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
  const detail = cause || message;
  const unreachable =
    message === 'fetch failed' ||
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|connect/i.test(detail);
  if (unreachable) {
    const dockerHint =
      issuerUrl.includes('localhost') || issuerUrl.includes('127.0.0.1')
        ? ' If cql-studio-server runs inside Docker, localhost is the container — use host.docker.internal (Docker Desktop) or the compose service name authentik-server on a shared network instead.'
        : '';
    return new Error(
      `Cannot reach SSO issuer at ${issuerUrl}. Start the development IdP stack (docker compose -f docker-compose.development.yml up -d) or fix the issuer URL for this runtime.${dockerHint} (${detail})`
    );
  }
  return err instanceof Error ? err : new Error(message);
}

export async function getOidcConfig(
  env: ServerEnv,
  clientSecret: string = env.ssoClientSecret
): Promise<Configuration> {
  const cached = configBySecret.get(clientSecret);
  if (cached) {
    return cached;
  }
  let config: Configuration;
  try {
    config = await client.discovery(
      new URL(env.ssoIssuerUrl),
      env.ssoClientId,
      clientSecret,
      undefined,
      discoveryOptionsForIssuer(env.ssoIssuerUrl)
    );
  } catch (err) {
    throw wrapOidcDiscoveryError(err, env.ssoIssuerUrl);
  }
  configBySecret.set(clientSecret, config);
  return config;
}

/**
 * Authorization code → tokens, trying the current client secret first, then
 * previous secrets during an OIDC client-secret rotation window.
 */
export async function authorizationCodeGrantWithSecretRotation(
  env: ServerEnv,
  callbackUrl: URL,
  checks: {
    pkceCodeVerifier: string;
    expectedState: string;
    expectedNonce: string;
  }
) {
  const secrets = [env.ssoClientSecret, ...env.ssoClientSecretPrevious];
  let lastError: unknown;
  for (let i = 0; i < secrets.length; i++) {
    try {
      const config = await getOidcConfig(env, secrets[i]);
      return await client.authorizationCodeGrant(config, callbackUrl, checks);
    } catch (err) {
      lastError = err;
      if (i === secrets.length - 1 || !isLikelyClientAuthError(err)) {
        throw err;
      }
      logger.warn(
        'Token exchange failed with current/previous client secret; trying next secret during rotation'
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Token exchange failed');
}

function isLikelyClientAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid_client') ||
    lower.includes('unauthorized_client') ||
    lower.includes('client authentication') ||
    lower.includes('401')
  );
}

export function clearOidcConfigCache(): void {
  configBySecret.clear();
}

export { client as oidcClient };
