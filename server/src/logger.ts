// Author: Preston Lee

import pino, { type Logger } from 'pino';
import type { ServerEnv } from './config/env.js';

export type { Logger };

/** Shared app logger. Call createLogger() during startup before use. */
export let logger: Logger = pino({ level: 'silent' });

export function createLogger(env: Pick<ServerEnv, 'logLevel' | 'nodeEnv'>): Logger {
  logger = pino({
    level: env.logLevel,
    ...(env.nodeEnv === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true },
          },
        }
      : {}),
  });
  return logger;
}
