// Author: Preston Lee

import { Injectable, computed, signal } from '@angular/core';
import {
  BUILT_IN_ENVIRONMENT_ID,
  CqlEnvironment,
  EndpointConfiguration,
  EndpointHttpContext,
  EndpointRole,
  workspaceEnvironmentSyntheticId
} from '../models/environment.model';
import {
  ActiveEnvironmentSource,
  ActiveWorkspaceEnvironmentRef
} from '../models/settings.model';
import { SharedEnvironmentConfig, SharedEnvironmentDto } from '../models/team.model';
import {
  buildHttpHeaders,
  emptyEndpointConfiguration,
  getEffectiveAddress,
  normalizeEndpointAddress,
  normalizeEndpointConfiguration
} from './endpoint-config.lib';

export interface LegacyEnvironmentFields {
  fhirBaseUrl?: string;
  terminologyBaseUrl?: string;
  terminologyBasicAuthUsername?: string;
  terminologyBasicAuthPassword?: string;
}

export interface WorkspaceEnvironmentCatalogEntry {
  workspaceId: string;
  workspaceName: string;
  environments: SharedEnvironmentDto[];
}

/** Personal publish/copy target: `personal:{environmentId}`. Workspace targets use {@link workspaceEnvironmentSyntheticId}. */
export function personalPublishTargetKey(environmentId: string): string {
  return `personal:${environmentId}`;
}

export function isPersonalPublishTargetKey(key: string): boolean {
  return key.startsWith('personal:');
}

export interface ExportPublishTargetOption {
  key: string;
  name: string;
  group: 'personal' | 'workspace';
  workspaceId?: string;
  workspaceName?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {
  private readonly _environments = signal<CqlEnvironment[]>([]);
  private readonly _activeEnvironmentId = signal<string>(BUILT_IN_ENVIRONMENT_ID);
  private readonly _activeEnvironmentSource = signal<ActiveEnvironmentSource>('personal');
  private readonly _activeWorkspaceEnvironment = signal<ActiveWorkspaceEnvironmentRef | null>(null);
  private readonly _workspaceCatalog = signal<WorkspaceEnvironmentCatalogEntry[]>([]);

  readonly environments = this._environments.asReadonly();
  readonly activeEnvironmentId = this._activeEnvironmentId.asReadonly();
  readonly activeEnvironmentSource = this._activeEnvironmentSource.asReadonly();
  readonly activeWorkspaceEnvironment = this._activeWorkspaceEnvironment.asReadonly();
  readonly workspaceCatalog = this._workspaceCatalog.asReadonly();

  readonly workspaceCatalogWithEnvironments = computed(() =>
    this._workspaceCatalog().filter(entry => entry.environments.length > 0)
  );

  readonly activeEnvironment = computed(() => {
    if (this._activeEnvironmentSource() === 'workspace') {
      const ref = this._activeWorkspaceEnvironment();
      const mapped = ref ? this.mapWorkspaceEnvironment(ref.workspaceId, ref.environmentId) : null;
      if (mapped) {
        return mapped;
      }
    }
    const id = this._activeEnvironmentId();
    return this._environments().find(env => env.id === id) ?? this._environments()[0] ?? this.seedBuiltInEnvironment();
  });

  readonly isPersonalEnvironmentActive = computed(() => this._activeEnvironmentSource() === 'personal');

  syncFromSettings(
    environments: CqlEnvironment[],
    activeEnvironmentId: string,
    activeEnvironmentSource: ActiveEnvironmentSource = 'personal',
    activeWorkspaceEnvironment: ActiveWorkspaceEnvironmentRef | null = null
  ): void {
    const normalized = this.normalizeEnvironments(environments);
    this._environments.set(normalized);
    this._activeEnvironmentId.set(this.resolveActiveEnvironmentId(activeEnvironmentId, normalized));
    if (activeEnvironmentSource === 'workspace' && activeWorkspaceEnvironment) {
      this._activeEnvironmentSource.set('workspace');
      this._activeWorkspaceEnvironment.set(activeWorkspaceEnvironment);
    } else {
      this._activeEnvironmentSource.set('personal');
      this._activeWorkspaceEnvironment.set(null);
    }
  }

  getEnvironmentsSnapshot(): CqlEnvironment[] {
    return this._environments().map(env => this.cloneEnvironment(env));
  }

  getActiveEnvironmentIdSnapshot(): string {
    return this._activeEnvironmentId();
  }

  getActiveEnvironmentSourceSnapshot(): ActiveEnvironmentSource {
    return this._activeEnvironmentSource();
  }

  getActiveWorkspaceEnvironmentSnapshot(): ActiveWorkspaceEnvironmentRef | null {
    const ref = this._activeWorkspaceEnvironment();
    return ref ? { ...ref } : null;
  }

  resolveActiveEnvironmentIdForImport(id: string | undefined, environments: CqlEnvironment[]): string {
    return this.resolveActiveEnvironmentId(id ?? '', environments);
  }

  setWorkspaceCatalog(entries: WorkspaceEnvironmentCatalogEntry[]): boolean {
    this._workspaceCatalog.set(entries.map(entry => ({
      workspaceId: entry.workspaceId,
      workspaceName: entry.workspaceName,
      environments: entry.environments.map(env => ({ ...env, config: this.normalizeSharedConfig(env.config) })),
    })));
    return this.ensureActiveWorkspaceStillValid();
  }

  clearWorkspaceCatalog(): boolean {
    this._workspaceCatalog.set([]);
    return this.ensureActiveWorkspaceStillValid();
  }

  replaceWorkspaceEnvironments(workspaceId: string, environments: SharedEnvironmentDto[], workspaceName?: string): boolean {
    this._workspaceCatalog.update(entries => {
      const normalized = environments.map(env => ({
        ...env,
        config: this.normalizeSharedConfig(env.config),
      }));
      const idx = entries.findIndex(entry => entry.workspaceId === workspaceId);
      if (idx >= 0) {
        return entries.map((entry, i) =>
          i === idx
            ? {
                ...entry,
                workspaceName: workspaceName ?? entry.workspaceName,
                environments: normalized,
              }
            : entry
        );
      }
      return [
        ...entries,
        {
          workspaceId,
          workspaceName: workspaceName ?? 'Workspace',
          environments: normalized,
        },
      ];
    });
    return this.ensureActiveWorkspaceStillValid();
  }

  /** Fall back to personal if a workspace selection cannot be resolved from the catalog. */
  ensureActiveWorkspaceStillValid(): boolean {
    if (this._activeEnvironmentSource() !== 'workspace') {
      return false;
    }
    const ref = this._activeWorkspaceEnvironment();
    if (!ref || !this.mapWorkspaceEnvironment(ref.workspaceId, ref.environmentId)) {
      this.fallBackToPersonal();
      return true;
    }
    return false;
  }

  setActiveEnvironment(id: string): CqlEnvironment | null {
    const env = this._environments().find(e => e.id === id);
    if (!env) {
      return null;
    }
    this._activeEnvironmentId.set(id);
    this._activeEnvironmentSource.set('personal');
    this._activeWorkspaceEnvironment.set(null);
    return env;
  }

  setActiveWorkspaceEnvironment(workspaceId: string, environmentId: string): CqlEnvironment | null {
    const mapped = this.mapWorkspaceEnvironment(workspaceId, environmentId);
    if (!mapped) {
      return null;
    }
    this._activeEnvironmentSource.set('workspace');
    this._activeWorkspaceEnvironment.set({ workspaceId, environmentId });
    return mapped;
  }

  isPersonalEnvironmentSelected(id: string): boolean {
    return this._activeEnvironmentSource() === 'personal' && this._activeEnvironmentId() === id;
  }

  isWorkspaceEnvironmentSelected(workspaceId: string, environmentId: string): boolean {
    const ref = this._activeWorkspaceEnvironment();
    return (
      this._activeEnvironmentSource() === 'workspace' &&
      !!ref &&
      ref.workspaceId === workspaceId &&
      ref.environmentId === environmentId
    );
  }

  updateEnvironment(updated: CqlEnvironment): void {
    this._environments.update(envs =>
      envs.map(env => (env.id === updated.id ? this.cloneEnvironment(updated) : env))
    );
  }

  duplicateEnvironment(id: string): CqlEnvironment | null {
    const source = this._environments().find(env => env.id === id);
    if (!source) {
      return null;
    }
    const copy = this.cloneEnvironment(source);
    copy.id = crypto.randomUUID();
    copy.name = `${source.name} (copy)`;
    copy.builtIn = false;
    this._environments.update(envs => [...envs, copy]);
    return copy;
  }

  deleteEnvironment(id: string): boolean {
    const target = this._environments().find(env => env.id === id);
    if (!target || target.builtIn || this._environments().length <= 1) {
      return false;
    }
    this._environments.update(envs => envs.filter(env => env.id !== id));
    if (this._activeEnvironmentId() === id && this._activeEnvironmentSource() === 'personal') {
      this._activeEnvironmentId.set(BUILT_IN_ENVIRONMENT_ID);
    }
    return true;
  }

  resetBuiltInEnvironment(): CqlEnvironment {
    const seeded = this.seedBuiltInEnvironment();
    this._environments.update(envs =>
      envs.map(env => (env.builtIn ? seeded : env))
    );
    return seeded;
  }

  migrateLegacySettings(legacy: LegacyEnvironmentFields): { environments: CqlEnvironment[]; activeEnvironmentId: string } {
    const builtIn = this.buildBuiltInFromLegacy(legacy);
    return { environments: [builtIn], activeEnvironmentId: builtIn.id };
  }

  seedBuiltInEnvironment(): CqlEnvironment {
    return this.buildBuiltInFromLegacy({});
  }

  getEndpointConfiguration(role: EndpointRole): EndpointConfiguration {
    return this.getEndpointConfigurationForEnvironment(this.activeEnvironment(), role);
  }

  getEndpointConfigurationForEnvironment(env: CqlEnvironment, role: EndpointRole): EndpointConfiguration {
    switch (role) {
      case 'evaluation':
        return env.evaluationServer;
      case 'data':
        return env.dataEndpoint;
      case 'terminology':
        return env.terminologyEndpoint;
      case 'content':
        return env.contentEndpoint;
    }
  }

  getEffectiveAddressForRole(role: EndpointRole): string {
    return this.getEffectiveAddressForRoleOnEnvironment(this.activeEnvironment(), role);
  }

  getEffectiveAddressForRoleOnEnvironment(env: CqlEnvironment, role: EndpointRole): string {
    const evaluationAddress = this.getDeployDefaultEvaluationServerUrl();
    switch (role) {
      case 'evaluation':
        return getEffectiveAddress(env.evaluationServer, evaluationAddress);
      case 'data':
        return getEffectiveAddress(
          env.dataEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
      case 'terminology':
        return getEffectiveAddress(
          env.terminologyEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
      case 'content':
        return getEffectiveAddress(
          env.contentEndpoint,
          getEffectiveAddress(env.evaluationServer, evaluationAddress)
        );
    }
  }

  getEndpointHttpContext(role: EndpointRole, baseHeaders?: Record<string, string>): EndpointHttpContext {
    return this.getEndpointHttpContextForEnvironment(this.activeEnvironment(), role, baseHeaders);
  }

  getEndpointHttpContextForEnvironment(
    env: CqlEnvironment,
    role: EndpointRole,
    baseHeaders?: Record<string, string>
  ): EndpointHttpContext {
    const config = this.getEndpointConfigurationForEnvironment(env, role);
    const address = this.getEffectiveAddressForRoleOnEnvironment(env, role);
    const headers = buildHttpHeaders({ ...config, address }, baseHeaders);
    const headerRecord: Record<string, string> = {};
    headers.keys().forEach(key => {
      const value = headers.get(key);
      if (value != null) {
        headerRecord[key] = value;
      }
    });
    return { address, headers: headerRecord };
  }

  /** Flat list of personal + workspace profiles for export copy/publish target pickers. */
  listExportPublishTargetOptions(): ExportPublishTargetOption[] {
    const options: ExportPublishTargetOption[] = [];
    for (const env of this._environments()) {
      options.push({
        key: personalPublishTargetKey(env.id),
        name: env.name,
        group: 'personal'
      });
    }
    for (const section of this.workspaceCatalogWithEnvironments()) {
      for (const shared of section.environments) {
        options.push({
          key: workspaceEnvironmentSyntheticId(section.workspaceId, shared.id),
          name: shared.name,
          group: 'workspace',
          workspaceId: section.workspaceId,
          workspaceName: section.workspaceName
        });
      }
    }
    return options;
  }

  resolveEnvironmentByPublishKey(key: string): CqlEnvironment | null {
    const trimmed = key?.trim() ?? '';
    if (!trimmed) {
      return null;
    }
    if (isPersonalPublishTargetKey(trimmed)) {
      const id = trimmed.slice('personal:'.length);
      const env = this._environments().find(e => e.id === id);
      return env ? this.cloneEnvironment(env) : null;
    }
    if (trimmed.startsWith('ws:')) {
      const rest = trimmed.slice('ws:'.length);
      const sep = rest.indexOf(':');
      if (sep <= 0 || sep === rest.length - 1) {
        return null;
      }
      const workspaceId = rest.slice(0, sep);
      const environmentId = rest.slice(sep + 1);
      const mapped = this.mapWorkspaceEnvironment(workspaceId, environmentId);
      return mapped ? this.cloneEnvironment(mapped) : null;
    }
    return null;
  }

  /** True when `key` refers to the currently active personal or workspace environment. */
  isPublishTargetKeyActive(key: string): boolean {
    const trimmed = key?.trim() ?? '';
    if (!trimmed) {
      return false;
    }
    if (isPersonalPublishTargetKey(trimmed)) {
      const id = trimmed.slice('personal:'.length);
      return this.isPersonalEnvironmentSelected(id);
    }
    if (trimmed.startsWith('ws:')) {
      const rest = trimmed.slice('ws:'.length);
      const sep = rest.indexOf(':');
      if (sep <= 0 || sep === rest.length - 1) {
        return false;
      }
      return this.isWorkspaceEnvironmentSelected(rest.slice(0, sep), rest.slice(sep + 1));
    }
    return false;
  }

  scrubbedConfigFromEnvironment(env: CqlEnvironment): SharedEnvironmentConfig {
    return {
      evaluationServer: this.scrubEndpoint(env.evaluationServer),
      dataEndpoint: this.scrubEndpoint(env.dataEndpoint),
      terminologyEndpoint: this.scrubEndpoint(env.terminologyEndpoint),
      contentEndpoint: this.scrubEndpoint(env.contentEndpoint),
    };
  }

  emptySharedConfig(): SharedEnvironmentConfig {
    return {
      evaluationServer: emptyEndpointConfiguration(),
      dataEndpoint: emptyEndpointConfiguration(),
      terminologyEndpoint: emptyEndpointConfiguration(),
      contentEndpoint: emptyEndpointConfiguration(),
    };
  }

  private scrubEndpoint(endpoint: EndpointConfiguration): EndpointConfiguration {
    return {
      address: endpoint.address ?? '',
      headers: [...(endpoint.headers ?? [])],
    };
  }

  private mapWorkspaceEnvironment(workspaceId: string, environmentId: string): CqlEnvironment | null {
    const entry = this._workspaceCatalog().find(item => item.workspaceId === workspaceId);
    const shared = entry?.environments.find(env => env.id === environmentId);
    if (!shared) {
      return null;
    }
    const config = this.normalizeSharedConfig(shared.config);
    return {
      id: workspaceEnvironmentSyntheticId(workspaceId, environmentId),
      name: `${shared.name} (${entry!.workspaceName})`,
      builtIn: false,
      evaluationServer: normalizeEndpointConfiguration(config.evaluationServer),
      dataEndpoint: normalizeEndpointConfiguration(config.dataEndpoint),
      terminologyEndpoint: normalizeEndpointConfiguration(config.terminologyEndpoint),
      contentEndpoint: normalizeEndpointConfiguration(config.contentEndpoint),
    };
  }

  private normalizeSharedConfig(config: SharedEnvironmentConfig | unknown): SharedEnvironmentConfig {
    const raw = (config && typeof config === 'object' ? config : {}) as Partial<SharedEnvironmentConfig>;
    return {
      evaluationServer: normalizeEndpointConfiguration(raw.evaluationServer ?? emptyEndpointConfiguration()),
      dataEndpoint: normalizeEndpointConfiguration(raw.dataEndpoint ?? emptyEndpointConfiguration()),
      terminologyEndpoint: normalizeEndpointConfiguration(raw.terminologyEndpoint ?? emptyEndpointConfiguration()),
      contentEndpoint: normalizeEndpointConfiguration(raw.contentEndpoint ?? emptyEndpointConfiguration()),
    };
  }

  private fallBackToPersonal(): void {
    this._activeEnvironmentSource.set('personal');
    this._activeWorkspaceEnvironment.set(null);
    this._activeEnvironmentId.set(
      this.resolveActiveEnvironmentId(this._activeEnvironmentId(), this._environments())
    );
  }

  private buildBuiltInFromLegacy(legacy: LegacyEnvironmentFields): CqlEnvironment {
    const evaluationDefault = this.getDeployDefaultEvaluationServerUrl();
    const terminologyDefault = this.getDeployDefaultTerminologyUrl();
    const contentDefault = this.getDeployDefaultContentUrl();
    const dataDefault = this.getDeployDefaultDataUrl();

    return {
      id: BUILT_IN_ENVIRONMENT_ID,
      name: 'Default Environment',
      builtIn: true,
      evaluationServer: normalizeEndpointConfiguration({
        address: legacy.fhirBaseUrl?.trim() || evaluationDefault
      }),
      dataEndpoint: normalizeEndpointConfiguration({
        address: dataDefault
      }),
      terminologyEndpoint: normalizeEndpointConfiguration({
        address: legacy.terminologyBaseUrl?.trim() || terminologyDefault,
        basicAuthUsername:
          legacy.terminologyBasicAuthUsername?.trim() || this.getDeployDefaultTerminologyAuthUsername(),
        basicAuthPassword: legacy.terminologyBasicAuthPassword ?? this.getDeployDefaultTerminologyAuthPassword()
      }),
      contentEndpoint: normalizeEndpointConfiguration({
        address: contentDefault
      })
    };
  }

  private normalizeEnvironments(environments: CqlEnvironment[]): CqlEnvironment[] {
    if (!environments?.length) {
      return [this.seedBuiltInEnvironment()];
    }
    return environments.map(env => this.cloneEnvironment(env));
  }

  private resolveActiveEnvironmentId(id: string, environments: CqlEnvironment[]): string {
    if (id && environments.some(env => env.id === id)) {
      return id;
    }
    const builtIn = environments.find(env => env.builtIn);
    return builtIn?.id ?? environments[0]?.id ?? BUILT_IN_ENVIRONMENT_ID;
  }

  private cloneEnvironment(env: CqlEnvironment): CqlEnvironment {
    return {
      id: env.id,
      name: env.name,
      builtIn: env.builtIn,
      evaluationServer: normalizeEndpointConfiguration(env.evaluationServer ?? emptyEndpointConfiguration()),
      dataEndpoint: normalizeEndpointConfiguration(env.dataEndpoint ?? emptyEndpointConfiguration()),
      terminologyEndpoint: normalizeEndpointConfiguration(env.terminologyEndpoint ?? emptyEndpointConfiguration()),
      contentEndpoint: normalizeEndpointConfiguration(env.contentEndpoint ?? emptyEndpointConfiguration())
    };
  }

  private getDeployDefaultEvaluationServerUrl(): string {
    const evalUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_EVALUATION_SERVER_URL'];
    if (evalUrl?.trim()) {
      return normalizeEndpointAddress(evalUrl);
    }
    const fhirUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_FHIR_BASE_URL'];
    return fhirUrl?.trim() ? normalizeEndpointAddress(fhirUrl) : 'http://localhost:8080/fhir';
  }

  private getDeployDefaultDataUrl(): string {
    const dataUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_DATA_ENDPOINT_URL'];
    return dataUrl?.trim() ? normalizeEndpointAddress(dataUrl) : '';
  }

  private getDeployDefaultContentUrl(): string {
    const contentUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_CONTENT_ENDPOINT_URL'];
    return contentUrl?.trim() ? normalizeEndpointAddress(contentUrl) : '';
  }

  private getDeployDefaultTerminologyUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASE_URL'];
    return envValue?.trim() ? normalizeEndpointAddress(envValue) : '';
  }

  private getDeployDefaultTerminologyAuthUsername(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_USERNAME'];
    return envValue?.trim() ?? '';
  }

  private getDeployDefaultTerminologyAuthPassword(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_PASSWORD'];
    return envValue ?? '';
  }
}
