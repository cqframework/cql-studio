// Author: Preston Lee

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { DeployConfigKeys, readDeployConfig, readDeployConfigUrl } from './deploy-config.lib';

describe('deploy-config.lib', () => {
  const originalWindow = { ...window } as Record<string, string | undefined>;

  beforeEach(() => {
    for (const key of Object.keys(window)) {
      if (key.startsWith('CQL_STUDIO_')) {
        delete (window as Record<string, string | undefined>)[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(window)) {
      if (key.startsWith('CQL_STUDIO_')) {
        delete (window as Record<string, string | undefined>)[key];
      }
    }
    for (const [key, value] of Object.entries(originalWindow)) {
      if (key.startsWith('CQL_STUDIO_') && value !== undefined) {
        (window as Record<string, string | undefined>)[key] = value;
      }
    }
  });

  it('readDeployConfig returns trimmed deploy value when set', () => {
    (window as Record<string, string | undefined>)[DeployConfigKeys.RUNNER_BASE_URL] = '  http://runner  ';
    expect(readDeployConfig(DeployConfigKeys.RUNNER_BASE_URL)).toBe('http://runner');
    expect(readDeployConfig(DeployConfigKeys.RUNNER_BASE_URL, 'override')).toBe('http://runner');
  });

  it('readDeployConfig falls back to explicit override or central default', () => {
    expect(readDeployConfig('CQL_STUDIO_MISSING', 'fallback')).toBe('fallback');
    expect(readDeployConfig(DeployConfigKeys.SERVER_BASE_URL)).toBe('http://localhost:3003');
    expect(readDeployConfig(DeployConfigKeys.RUNNER_BASE_URL)).toBe('http://localhost:8091');
  });

  it('readDeployConfigUrl strips trailing slashes', () => {
    (window as Record<string, string | undefined>)[DeployConfigKeys.SERVER_BASE_URL] = 'http://host:3003///';
    expect(readDeployConfigUrl(DeployConfigKeys.SERVER_BASE_URL)).toBe('http://host:3003');
  });
});
