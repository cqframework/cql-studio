// Author: Preston Lee

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerEnv } from '../config/env.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function resolvePrismaCli(serverRoot: string): string {
  try {
    const prismaPkg = require.resolve('prisma/package.json');
    return path.join(path.dirname(prismaPkg), 'build', 'index.js');
  } catch {
    return path.join(serverRoot, 'node_modules', 'prisma', 'build', 'index.js');
  }
}

/**
 * Applies pending Prisma migrations (forward-only) before the HTTP server accepts traffic.
 */
export async function applyPendingMigrations(env: ServerEnv): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error('CQL_STUDIO_SERVER_DATABASE_URL is required to apply migrations');
  }

  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const prismaCli = resolvePrismaCli(serverRoot);

  logger.info('Checking for pending PostgreSQL schema migrations…');
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy'],
      {
        cwd: serverRoot,
        env: {
          ...process.env,
          CQL_STUDIO_SERVER_DATABASE_URL: env.databaseUrl,
        },
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    if (stdout?.trim()) {
      logger.info(stdout.trim());
    }
    if (stderr?.trim()) {
      logger.warn(stderr.trim());
    }
    logger.info('Schema is up to date.');
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    const detail = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n');
    throw new Error(`Failed to apply Prisma migrations:\n${detail}`);
  }
}
