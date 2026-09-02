// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { EnvironmentService } from './environment.service';
import { BUILT_IN_ENVIRONMENT_ID } from '../models/environment.model';

describe('Settings environment migration (via EnvironmentService)', () => {
  it('maps legacy flat URLs into built-in environment endpoints', () => {
    const environmentService = new EnvironmentService();
    const migrated = environmentService.migrateLegacySettings({
      fhirBaseUrl: 'http://legacy-eval/fhir',
      terminologyBaseUrl: 'http://legacy-term/fhir',
      terminologyBasicAuthUsername: 'term-user',
      terminologyBasicAuthPassword: 'term-pass'
    });

    expect(migrated.activeEnvironmentId).toBe(BUILT_IN_ENVIRONMENT_ID);
    expect(migrated.environments).toHaveLength(1);
    const env = migrated.environments[0];
    expect(env.evaluationServer.address).toBe('http://legacy-eval/fhir');
    expect(env.dataEndpoint.address).toBe('');
    expect(env.terminologyEndpoint.address).toBe('http://legacy-term/fhir');
    expect(env.terminologyEndpoint.basicAuthUsername).toBe('');
    expect(env.terminologyEndpoint.basicAuthPassword).toBe('');
    expect(env.terminologyEndpoint.headers).toContain(`Authorization: Basic ${btoa('term-user:term-pass')}`);
    expect(env.contentEndpoint.address).toBe('');
  });

  it('resolves unknown imported activeEnvironmentId to built-in default', () => {
    const environmentService = new EnvironmentService();
    const envs = environmentService.migrateLegacySettings({}).environments;
    const resolved = environmentService.resolveActiveEnvironmentIdForImport('missing-id', envs);
    expect(resolved).toBe(BUILT_IN_ENVIRONMENT_ID);
  });
});
