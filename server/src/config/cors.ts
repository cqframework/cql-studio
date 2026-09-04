// Author: Preston Lee

import type { CorsOptions } from 'cors';
import type { ServerEnv } from './env.js';

/**
 * OpenCode uses credentialed fetches and EventSource so the same browser API
 * works with and without SSO. A wildcard origin is invalid for those requests,
 * even when the development server does not currently issue a session cookie.
 */
export function createCorsOptions(env: Pick<ServerEnv, 'corsOrigin'>): CorsOptions {
  return {
    origin: env.corsOrigin,
    credentials: true,
    optionsSuccessStatus: 200,
  };
}
