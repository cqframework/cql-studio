// Author: Preston Lee

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RUNNER_TOKEN, loadEnv } from '../src/config/env.js';
import { exitCodeForFatal, OpenCodeExitCode, OpenCodeFatalError } from '../src/fatal.js';

test('loadEnv applies development defaults', () => {
  const env = loadEnv({});
  assert.equal(env.nodeEnv, 'development');
  assert.equal(env.runnerPort, 4097);
  assert.equal(env.internalPort, 4096);
  assert.equal(env.runnerToken, DEFAULT_RUNNER_TOKEN);
  assert.equal(env.workspaceRoot, '/workspaces');
  assert.equal(env.rewriteLocalhost, true);
  assert.equal(env.logLevel, 'info');
});

test('loadEnv rejects the development token outside development with EX_CONFIG', () => {
  assert.throws(
    () => loadEnv({
      CQL_STUDIO_OPENCODE_NODE_ENV: 'production',
      CQL_STUDIO_OPENCODE_RUNNER_TOKEN: DEFAULT_RUNNER_TOKEN,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenCodeFatalError);
      assert.equal(error.exitCode, OpenCodeExitCode.CONFIG);
      assert.match(error.message, /CQL_STUDIO_OPENCODE_RUNNER_TOKEN must be a non-default secret/);
      return true;
    }
  );
});

test('loadEnv rejects short production tokens', () => {
  assert.throws(
    () => loadEnv({
      CQL_STUDIO_OPENCODE_NODE_ENV: 'production',
      CQL_STUDIO_OPENCODE_RUNNER_TOKEN: 'too-short-for-production-use',
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenCodeFatalError);
      assert.equal(error.exitCode, OpenCodeExitCode.CONFIG);
      assert.match(error.message, /at least 32 bytes/);
      return true;
    }
  );
});

test('loadEnv accepts a strong production token', () => {
  const token = 'a'.repeat(32);
  const env = loadEnv({
    CQL_STUDIO_OPENCODE_NODE_ENV: 'production',
    CQL_STUDIO_OPENCODE_RUNNER_TOKEN: token,
  });
  assert.equal(env.runnerToken, token);
  assert.equal(env.nodeEnv, 'production');
});

test('loadEnv rejects invalid ports, booleans, and log levels with EX_CONFIG', () => {
  for (const source of [
    { CQL_STUDIO_OPENCODE_RUNNER_PORT: '0' },
    { CQL_STUDIO_OPENCODE_INTERNAL_PORT: '70000' },
    { CQL_STUDIO_OPENCODE_RUNNER_REWRITE_LOCALHOST: 'yes' },
    { CQL_STUDIO_OPENCODE_LOG_LEVEL: 'verbose' },
    { CQL_STUDIO_OPENCODE_SESSION_IDLE_MS: '-1' },
  ]) {
    assert.throws(
      () => loadEnv(source),
      (error: unknown) => {
        assert.ok(error instanceof OpenCodeFatalError);
        assert.equal(error.exitCode, OpenCodeExitCode.CONFIG);
        return true;
      }
    );
  }
});

test('loadEnv rejects identical runner and internal ports', () => {
  assert.throws(
    () => loadEnv({
      CQL_STUDIO_OPENCODE_RUNNER_PORT: '4097',
      CQL_STUDIO_OPENCODE_INTERNAL_PORT: '4097',
    }),
    (error: unknown) => {
      assert.ok(error instanceof OpenCodeFatalError);
      assert.equal(error.exitCode, OpenCodeExitCode.CONFIG);
      assert.match(error.message, /must differ/);
      return true;
    }
  );
});

test('exitCodeForFatal maps typed and unknown errors', () => {
  assert.equal(
    exitCodeForFatal(new OpenCodeFatalError('port busy', OpenCodeExitCode.OSERR)),
    OpenCodeExitCode.OSERR
  );
  assert.equal(exitCodeForFatal(new Error('boom')), OpenCodeExitCode.GENERAL);
  assert.equal(exitCodeForFatal('boom'), OpenCodeExitCode.GENERAL);
});
