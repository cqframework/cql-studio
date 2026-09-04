// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { OpenCodeSession } from '../models/opencode.model';
import { EnvironmentService } from './environment.service';
import { OpenCodeEnvironmentBindingService } from './opencode-environment-binding.service';

const session = (id: string): OpenCodeSession => ({
  id,
  openCodeSessionId: `sdk-${id}`,
  title: 'Example',
  status: 'idle',
  activeLibraryId: 'Example',
  activeFile: 'Example.cql',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  model: 'ollama/example',
  reasoningEnabled: false,
});

describe('OpenCodeEnvironmentBindingService', () => {
  let environments: EnvironmentService;
  let bindings: OpenCodeEnvironmentBindingService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    environments = TestBed.inject(EnvironmentService);
    bindings = TestBed.inject(OpenCodeEnvironmentBindingService);
    const seeded = environments.seedBuiltInEnvironment();
    environments.syncFromSettings([seeded], seeded.id);
  });

  it('binds a session to the active personal environment and restores it', () => {
    const bound = bindings.bind(session('personal-session'));

    expect(bound.environmentBinding?.key).toBe('personal:default');
    expect(bindings.isCurrent(bound)).toBe(true);
    expect(bindings.restore(session('personal-session')).environmentBinding).toEqual(
      bound.environmentBinding
    );
  });

  it('becomes stale when the environment configuration changes', () => {
    const bound = bindings.bind(session('changed-session'));
    environments.updateEnvironment({
      ...environments.activeEnvironment(),
      dataEndpoint: { address: 'http://different.example/fhir' },
    });

    expect(bindings.isCurrent(bound)).toBe(false);
  });

  it('captures workspace and shared environment identity', () => {
    environments.setWorkspaceCatalog([
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Quality Team',
        environments: [
          {
            id: 'shared-1',
            workspaceId: 'workspace-1',
            name: 'Shared HAPI',
            config: {
              evaluationServer: { address: 'http://shared.example/fhir' },
              dataEndpoint: { address: 'http://shared.example/fhir' },
              terminologyEndpoint: { address: '' },
              contentEndpoint: { address: '' },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ]);
    environments.setActiveWorkspaceEnvironment('workspace-1', 'shared-1');

    const bound = bindings.bind(session('workspace-session'));

    expect(bound.environmentBinding).toMatchObject({
      key: 'workspace:workspace-1:shared-1',
      source: 'workspace',
      workspaceId: 'workspace-1',
      environmentId: 'shared-1',
      label: 'Quality Team / Shared HAPI',
    });
    expect(bindings.isCurrent(bound)).toBe(true);

    environments.setActiveEnvironment('default');
    expect(bindings.isCurrent(bound)).toBe(false);
  });

  it('does not fingerprint endpoint credential values', () => {
    environments.updateEnvironment({
      ...environments.activeEnvironment(),
      dataEndpoint: {
        address: 'https://user:first@example.org/fhir?token=first',
        basicAuthUsername: 'user',
        basicAuthPassword: 'first',
        headers: ['Authorization: Bearer first', 'X-Tenant: first'],
      },
    });
    const bound = bindings.bind(session('credential-session'));

    environments.updateEnvironment({
      ...environments.activeEnvironment(),
      dataEndpoint: {
        address: 'https://user:second@example.org/fhir?token=second',
        basicAuthUsername: 'different-user',
        basicAuthPassword: 'second',
        headers: ['Authorization: Bearer second', 'X-Tenant: second'],
      },
    });

    expect(bindings.isCurrent(bound)).toBe(true);
    expect(sessionStorage.getItem('cql_studio_opencode_environment_bindings')).not.toContain('second');

    environments.updateEnvironment({
      ...environments.activeEnvironment(),
      dataEndpoint: { address: 'https://example.org/other-fhir' },
    });
    expect(bindings.isCurrent(bound)).toBe(false);
  });

  it('removes bindings for sessions the server no longer reports', () => {
    const retained = bindings.bind(session('retained-session'));
    bindings.bind(session('expired-session'));

    bindings.retain(['retained-session']);

    expect(bindings.restore(session('retained-session')).environmentBinding).toEqual(
      retained.environmentBinding
    );
    expect(bindings.restore(session('expired-session')).environmentBinding).toBeUndefined();
  });
});
