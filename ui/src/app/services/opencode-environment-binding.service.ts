// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import {
  OpenCodeEnvironmentBinding,
  OpenCodeSession,
} from '../models/opencode.model';
import { CqlEnvironment, EndpointConfiguration } from '../models/environment.model';
import { EnvironmentService } from './environment.service';

const STORAGE_KEY = 'cql_studio_opencode_environment_bindings';

@Injectable({ providedIn: 'root' })
export class OpenCodeEnvironmentBindingService {
  private readonly environmentService = inject(EnvironmentService);
  private readonly inMemoryBindings = new Map<string, OpenCodeEnvironmentBinding>();

  captureCurrent(): OpenCodeEnvironmentBinding {
    const environment = this.environmentService.activeEnvironment();
    const source = this.environmentService.activeEnvironmentSource();
    if (source === 'workspace') {
      const ref = this.environmentService.activeWorkspaceEnvironment();
      const catalogEntry = ref
        ? this.environmentService.workspaceCatalog().find(entry => entry.workspaceId === ref.workspaceId)
        : undefined;
      const sharedEnvironment = ref
        ? catalogEntry?.environments.find(item => item.id === ref.environmentId)
        : undefined;
      const environmentId = ref?.environmentId ?? environment.id;
      const workspaceId = ref?.workspaceId;
      return {
        key: workspaceId ? `workspace:${workspaceId}:${environmentId}` : 'workspace:missing',
        source,
        environmentId,
        ...(workspaceId ? { workspaceId } : {}),
        label: catalogEntry
          ? `${catalogEntry.workspaceName} / ${sharedEnvironment?.name ?? environment.name}`
          : environment.name,
        configurationFingerprint: this.fingerprint(environment),
      };
    }

    const environmentId = this.environmentService.activeEnvironmentId();
    return {
      key: `personal:${environmentId}`,
      source,
      environmentId,
      label: environment.name,
      configurationFingerprint: this.fingerprint(environment),
    };
  }

  bind(session: OpenCodeSession): OpenCodeSession {
    const environmentBinding = this.captureCurrent();
    this.inMemoryBindings.set(session.id, environmentBinding);
    const bindings = this.readBindings();
    bindings[session.id] = environmentBinding;
    this.writeBindings(bindings);
    return { ...session, environmentBinding };
  }

  restore(session: OpenCodeSession): OpenCodeSession {
    if (session.environmentBinding) {
      return session;
    }
    const environmentBinding = this.bindingFor(session.id);
    return environmentBinding ? { ...session, environmentBinding } : session;
  }

  isCurrent(session: OpenCodeSession | null): boolean {
    return this.isBindingCurrent(session?.environmentBinding);
  }

  bindingFor(sessionId: string): OpenCodeEnvironmentBinding | undefined {
    const inMemory = this.inMemoryBindings.get(sessionId);
    if (inMemory) {
      return inMemory;
    }
    const stored = this.readBindings()[sessionId];
    if (stored) {
      this.inMemoryBindings.set(sessionId, stored);
    }
    return stored;
  }

  isBindingCurrent(binding: OpenCodeEnvironmentBinding | undefined): boolean {
    if (!binding) {
      return false;
    }
    const current = this.captureCurrent();
    return binding.key === current.key
      && binding.configurationFingerprint === current.configurationFingerprint;
  }

  forget(sessionId: string): void {
    this.inMemoryBindings.delete(sessionId);
    const bindings = this.readBindings();
    if (!(sessionId in bindings)) {
      return;
    }
    delete bindings[sessionId];
    this.writeBindings(bindings);
  }

  retain(sessionIds: string[]): void {
    const retained = new Set(sessionIds);
    for (const sessionId of this.inMemoryBindings.keys()) {
      if (!retained.has(sessionId)) {
        this.inMemoryBindings.delete(sessionId);
      }
    }
    const bindings = this.readBindings();
    const next = Object.fromEntries(
      Object.entries(bindings).filter(([sessionId]) => retained.has(sessionId))
    );
    this.writeBindings(next);
  }

  private fingerprint(environment: CqlEnvironment): string {
    const value = JSON.stringify({
      id: environment.id,
      name: environment.name,
      builtIn: Boolean(environment.builtIn),
      evaluationServer: this.safeEndpointIdentity(environment.evaluationServer),
      dataEndpoint: this.safeEndpointIdentity(environment.dataEndpoint),
      terminologyEndpoint: this.safeEndpointIdentity(environment.terminologyEndpoint),
      contentEndpoint: this.safeEndpointIdentity(environment.contentEndpoint),
    });
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private safeEndpointIdentity(endpoint: EndpointConfiguration): object {
    return {
      address: this.safeAddress(endpoint.address),
      hasBasicAuth: Boolean(endpoint.basicAuthUsername || endpoint.basicAuthPassword),
      headerNames: [...new Set((endpoint.headers ?? []).map(header => {
        const separator = header.indexOf(':');
        return separator > 0 ? header.slice(0, separator).trim().toLowerCase() : 'custom';
      }))].sort(),
    };
  }

  private safeAddress(address: string): string {
    const trimmed = address.trim();
    try {
      const url = new URL(trimmed);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      return trimmed.split(/[?#]/, 1)[0].replace(/\/\/[^/@]+@/, '//');
    }
  }

  private readBindings(): Record<string, OpenCodeEnvironmentBinding> {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return {};
      }
      const parsed = JSON.parse(stored) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, OpenCodeEnvironmentBinding] =>
          this.isBinding(entry[1])
        )
      );
    } catch {
      return {};
    }
  }

  private isBinding(value: unknown): value is OpenCodeEnvironmentBinding {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const binding = value as Partial<OpenCodeEnvironmentBinding>;
    return typeof binding.key === 'string'
      && (binding.source === 'personal' || binding.source === 'workspace')
      && typeof binding.environmentId === 'string'
      && typeof binding.label === 'string'
      && typeof binding.configurationFingerprint === 'string'
      && (binding.workspaceId === undefined || typeof binding.workspaceId === 'string');
  }

  private writeBindings(bindings: Record<string, OpenCodeEnvironmentBinding>): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch {
      // Session binding remains attached to the in-memory session object.
    }
  }
}
