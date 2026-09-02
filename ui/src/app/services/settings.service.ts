// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { Endpoint } from 'fhir/r4';
import type { UserSettingsDto, UserSettingsPatch } from '@cql-studio/core';
import { BUILT_IN_ENVIRONMENT_ID, CqlEnvironment, EndpointHttpContext, EndpointRole } from '../models/environment.model';
import { Settings, ThemeType } from '../models/settings.model';
import { ExamplePaths } from '../constants/example-paths.constants';
import { DeployConfigKeys, readDeployConfig, readDeployConfigUrl } from './deploy-config.lib';
import { buildFhirEndpoint, normalizeEndpointConfiguration } from './endpoint-config.lib';
import { EnvironmentService, LegacyEnvironmentFields } from './environment.service';
import { UserSettingsApiService } from './user-settings-api.service';

interface LegacySettingsRecord extends Partial<Settings> {
  settingsVersion?: number;
  serverBaseUrl?: string;
  activeEnvironmentId?: string;
  activeEnvironmentSource?: string;
  activeWorkspaceEnvironment?: unknown;
  fhirBaseUrl?: string;
  terminologyBaseUrl?: string;
  terminologyBasicAuthUsername?: string;
  terminologyBasicAuthPassword?: string;
  themePreferred?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  public static SETTINGS_KEY: string = 'cql_tests_ui_settings';
  public static FORCE_RESET_KEY: string = 'cql_tests_ui_settings_force_reset';

  private readonly environmentService = inject(EnvironmentService);
  private readonly userSettingsApi = inject(UserSettingsApiService);

  public settings = signal<Settings>(new Settings());
  public theme_effective = signal<ThemeType>(ThemeType.LIGHT);
  public readonly hydrated = signal(false);

  constructor() {
    this.environmentService.syncPersonalEnvironments([]);
    this.setEffectiveTheme();
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', ({ matches }) => {
        if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
          this.theme_effective.set(matches ? ThemeType.DARK : ThemeType.LIGHT);
        }
      });
  }

  setEffectiveTheme() {
    if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        this.theme_effective.set(ThemeType.DARK);
      } else {
        this.theme_effective.set(ThemeType.LIGHT);
      }
    } else {
      this.theme_effective.set(this.settings().theme_preferred);
    }
  }

  /**
   * One-time localStorage → server migration (if blob present), then hydrate from API.
   * Always deletes the local settings blob when present, regardless of API success.
   */
  async bootstrapFromServer(): Promise<void> {
    const raw = localStorage.getItem(SettingsService.SETTINGS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LegacySettingsRecord;
        const { settings } = this.normalizeParsedSettings(parsed);
        const dto = this.toUserSettingsDto(settings);
        const personalEnvs = this.personalEnvironmentsForPersist(settings.environments);
        await this.userSettingsApi.putSettings(dto).catch(() => undefined);
        await this.userSettingsApi.replaceEnvironments(personalEnvs).catch(() => undefined);
      } catch {
        // ignore corrupt local blob
      } finally {
        localStorage.removeItem(SettingsService.SETTINGS_KEY);
        localStorage.removeItem(SettingsService.FORCE_RESET_KEY);
      }
    }

    await this.reloadFromServer();
  }

  async reloadFromServer(): Promise<void> {
    const [dto, envs] = await Promise.all([
      this.userSettingsApi.getSettings(),
      this.userSettingsApi.listEnvironments(),
    ]);
    const settings = this.fromUserSettingsDto(dto);
    settings.environments = envs.map((e) => this.cloneEnvironment(e));
    this.settings.set(settings);
    this.environmentService.syncPersonalEnvironments(settings.environments);
    this.setEffectiveTheme();
    this.hydrated.set(true);
  }

  /** Persist scalar settings currently in memory to the server. */
  async saveSettings(): Promise<void> {
    const dto = this.toUserSettingsDto(this.settings());
    const saved = await this.userSettingsApi.putSettings(dto);
    this.settings.update((current) => ({
      ...current,
      ...this.fromUserSettingsDto(saved),
      environments: current.environments,
    }));
    this.setEffectiveTheme();
  }

  /** Persist personal environments currently known to EnvironmentService. */
  async savePersonalEnvironments(): Promise<void> {
    const personal = this.personalEnvironmentsForPersist(
      this.environmentService.getEnvironmentsSnapshot()
    );
    const saved = await this.userSettingsApi.replaceEnvironments(personal);
    const mapped = saved.map((e) => this.cloneEnvironment(e));
    this.settings.update((current) => ({ ...current, environments: mapped }));
    this.environmentService.syncPersonalEnvironments(mapped);
  }

  async persistEnvironment(env: CqlEnvironment): Promise<CqlEnvironment> {
    if (env.builtIn) {
      return env;
    }
    const normalized = this.cloneEnvironment({ ...env, builtIn: false });
    const existing = this.settings().environments.find((e) => e.id === env.id);
    const saved = existing
      ? await this.userSettingsApi.updateEnvironment(env.id, normalized)
      : await this.userSettingsApi.createEnvironment(normalized);
    const mapped = this.cloneEnvironment(saved);
    this.settings.update((current) => {
      const others = current.environments.filter((e) => e.id !== mapped.id && e.name !== mapped.name);
      return { ...current, environments: [...others, mapped] };
    });
    this.environmentService.syncPersonalEnvironments(this.settings().environments);
    return mapped;
  }

  async deletePersonalEnvironment(id: string): Promise<void> {
    if (id === BUILT_IN_ENVIRONMENT_ID) {
      return;
    }
    await this.userSettingsApi.deleteEnvironment(id);
    this.settings.update((current) => ({
      ...current,
      environments: current.environments.filter((e) => e.id !== id),
    }));
    this.environmentService.syncPersonalEnvironments(this.settings().environments);
  }

  getEffectiveEvaluationServerUrl(): string {
    return this.environmentService.getEffectiveAddressForRole('evaluation');
  }

  getEffectiveDataEndpointAddress(): string {
    return this.environmentService.getEffectiveAddressForRole('data');
  }

  getEffectiveTerminologyEndpointAddress(): string {
    return this.environmentService.getEffectiveAddressForRole('terminology');
  }

  getEffectiveContentEndpointAddress(): string {
    return this.environmentService.getEffectiveAddressForRole('content');
  }

  getEndpointHttpContext(role: EndpointRole, baseHeaders?: Record<string, string>): EndpointHttpContext {
    return this.environmentService.getEndpointHttpContext(role, baseHeaders);
  }

  getEffectiveDataEndpoint(name?: string): Endpoint | null {
    const config = this.environmentService.getEndpointConfiguration('data');
    return buildFhirEndpoint(
      { ...config, address: this.getEffectiveDataEndpointAddress() },
      { name }
    );
  }

  getEffectiveTerminologyEndpoint(name?: string): Endpoint | null {
    const config = this.environmentService.getEndpointConfiguration('terminology');
    return buildFhirEndpoint(
      { ...config, address: this.getEffectiveTerminologyEndpointAddress() },
      { name }
    );
  }

  getEffectiveContentEndpoint(name?: string): Endpoint | null {
    const config = this.environmentService.getEndpointConfiguration('content');
    return buildFhirEndpoint(
      { ...config, address: this.getEffectiveContentEndpointAddress() },
      { name }
    );
  }

  getActiveEnvironment(): CqlEnvironment {
    return this.environmentService.activeEnvironment();
  }

  getDefaultRunnerApiBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.RUNNER_BASE_URL);
  }

  getDefaultRunnerFhirBaseUrl(): string {
    return readDeployConfigUrl(DeployConfigKeys.RUNNER_FHIR_BASE_URL);
  }

  getDefaultTestResultsIndexUrl(): string {
    return readDeployConfig(DeployConfigKeys.DEFAULT_TEST_RESULTS_INDEX_URL, ExamplePaths.INDEX_JSON);
  }

  getDefaultOllamaBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.OLLAMA_BASE_URL);
  }

  getDefaultOllamaModel(): string {
    return readDeployConfig(DeployConfigKeys.OLLAMA_MODEL);
  }

  getDefaultServerBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.SERVER_BASE_URL);
  }

  getDefaultSearxngBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.SEARXNG_BASE_URL);
  }

  getDefaultFhirPackageRegistryBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.FHIR_PACKAGE_REGISTRY_BASE_URL);
  }

  getEffectiveFhirPackageRegistryBaseUrl(): string {
    const settingValue = this.settings().fhirPackageRegistryBaseUrl;
    const base = settingValue?.trim() ? settingValue.trim() : this.getDefaultFhirPackageRegistryBaseUrl();
    return base.replace(/\/+$/, '');
  }

  getEffectiveSearxngBaseUrl(): string {
    const settingValue = this.settings().searxngBaseUrl;
    const url = settingValue?.trim() ? settingValue : this.getDefaultSearxngBaseUrl();
    return url ? url.replace(/\/+$/, '') : '';
  }

  getEffectiveRunnerApiBaseUrl(): string {
    const settingValue = this.settings().runnerApiBaseUrl;
    return settingValue?.trim() ? settingValue : this.getDefaultRunnerApiBaseUrl();
  }

  getEffectiveRunnerFhirBaseUrl(): string {
    const settingValue = this.settings().runnerFhirBaseUrl;
    if (settingValue?.trim()) {
      return settingValue.trim().replace(/\/+$/, '');
    }
    const envDefault = this.getDefaultRunnerFhirBaseUrl();
    if (envDefault) {
      return envDefault;
    }
    return this.getEffectiveDataEndpointAddress();
  }

  getEffectiveTestResultsIndexUrl(): string {
    const settingValue = this.settings().defaultTestResultsIndexUrl;
    return settingValue?.trim() ? settingValue : this.getDefaultTestResultsIndexUrl();
  }

  getEffectiveOllamaBaseUrl(): string {
    const settingValue = this.settings().ollamaBaseUrl;
    const baseUrl = settingValue?.trim() ? settingValue : this.getDefaultOllamaBaseUrl();
    return baseUrl.replace(/\/+$/, '');
  }

  getEffectiveOllamaModel(): string {
    const settingValue = this.settings().ollamaModel;
    return settingValue?.trim() ? settingValue : this.getDefaultOllamaModel();
  }

  /** Deploy config only — no per-user override. */
  getEffectiveServerBaseUrl(): string {
    return this.getDefaultServerBaseUrl().replace(/\/+$/, '');
  }

  getDefaultVsacFhirBaseUrl(): string {
    return readDeployConfig(DeployConfigKeys.VSAC_FHIR_BASE_URL);
  }

  getEffectiveVsacFhirBaseUrl(): string {
    const custom = this.settings().vsacFhirBaseUrl?.trim();
    const base = custom || this.getDefaultVsacFhirBaseUrl();
    return base.replace(/\/+$/, '');
  }

  getDefaultVsacApiUsername(): string {
    return readDeployConfig(DeployConfigKeys.VSAC_BASIC_AUTH_USERNAME);
  }

  getDefaultVsacApiPassword(): string {
    return readDeployConfig(DeployConfigKeys.VSAC_BASIC_AUTH_PASSWORD);
  }

  getEffectiveVsacApiUsername(): string {
    const u = this.settings().vsacApiUsername?.trim();
    return u || this.getDefaultVsacApiUsername();
  }

  getEffectiveVsacApiPassword(): string {
    const p = this.settings().vsacApiPassword?.trim();
    return p || this.getDefaultVsacApiPassword();
  }

  vsacHasApiCredentials(): boolean {
    return this.getEffectiveVsacApiPassword().length > 0;
  }

  updateSettings(updates: Partial<Settings>): void {
    this.patchSettings(updates);
    void this.persistSettingsPatch(updates);
  }

  /** Immutable in-memory update without persisting (Save still required for most fields). */
  patchSettings(updates: Partial<Settings>): void {
    this.settings.update(current => ({ ...current, ...updates }));
  }

  private async persistSettingsPatch(updates: Partial<Settings>): Promise<void> {
    const patch = this.toUserSettingsDto({ ...this.settings(), ...updates });
    // Only send keys that were actually updated (map UI names → API DTO names).
    const body: UserSettingsPatch = {};
    if (updates.experimental !== undefined) body.experimental = patch.experimental;
    if (updates.developer !== undefined) body.developer = patch.developer;
    if (updates.theme_preferred !== undefined) body.themePreferred = patch.themePreferred;
    if (updates.validateSchema !== undefined) body.validateSchema = patch.validateSchema;
    if (updates.runnerApiBaseUrl !== undefined) body.runnerApiBaseUrl = patch.runnerApiBaseUrl;
    if (updates.runnerFhirBaseUrl !== undefined) body.runnerFhirBaseUrl = patch.runnerFhirBaseUrl;
    if (updates.defaultTestResultsIndexUrl !== undefined) {
      body.defaultTestResultsIndexUrl = patch.defaultTestResultsIndexUrl;
    }
    if (updates.fhirPackageRegistryBaseUrl !== undefined) {
      body.fhirPackageRegistryBaseUrl = patch.fhirPackageRegistryBaseUrl;
    }
    if (updates.vsacFhirBaseUrl !== undefined) body.vsacFhirBaseUrl = patch.vsacFhirBaseUrl;
    if (updates.vsacApiUsername !== undefined) body.vsacApiUsername = patch.vsacApiUsername;
    if (updates.vsacApiPassword !== undefined) body.vsacApiPassword = patch.vsacApiPassword;
    if (updates.ollamaBaseUrl !== undefined) body.ollamaBaseUrl = patch.ollamaBaseUrl;
    if (updates.ollamaModel !== undefined) body.ollamaModel = patch.ollamaModel;
    if (updates.searxngBaseUrl !== undefined) body.searxngBaseUrl = patch.searxngBaseUrl;
    if (updates.enableAiAssistant !== undefined) body.enableAiAssistant = patch.enableAiAssistant;
    if (updates.useMCPTools !== undefined) body.useMCPTools = patch.useMCPTools;
    if (updates.allowAiWriteOperations !== undefined) {
      body.allowAiWriteOperations = patch.allowAiWriteOperations;
    }
    if (updates.autoApplyCodeEdits !== undefined) body.autoApplyCodeEdits = patch.autoApplyCodeEdits;
    if (updates.requireDiffPreview !== undefined) body.requireDiffPreview = patch.requireDiffPreview;
    if (updates.planActSeparateModels !== undefined) {
      body.planActSeparateModels = patch.planActSeparateModels;
    }
    if (Object.keys(body).length === 0) {
      return;
    }
    const saved = await this.userSettingsApi.patchSettings(body);
    this.settings.update((current) => ({
      ...current,
      ...this.fromUserSettingsDto(saved),
      environments: current.environments,
    }));
    this.setEffectiveTheme();
  }

  static readonly EXPORT_FILENAME = 'settings.cql-studio.json';

  exportSettingsJson(): string {
    const personal = this.personalEnvironmentsForPersist(
      this.environmentService.getEnvironmentsSnapshot()
    );
    const payload = {
      ...this.toUserSettingsDto(this.settings()),
      environments: personal,
    };
    return JSON.stringify(payload, null, 2);
  }

  async importSettingsJson(json: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(json) as LegacySettingsRecord;
      const { settings } = this.normalizeParsedSettings(parsed);
      await this.userSettingsApi.putSettings(this.toUserSettingsDto(settings));
      await this.userSettingsApi.replaceEnvironments(
        this.personalEnvironmentsForPersist(settings.environments)
      );
      await this.reloadFromServer();
      return true;
    } catch {
      return false;
    }
  }

  toUserSettingsDto(settings: Settings): UserSettingsDto {
    return {
      experimental: !!settings.experimental,
      developer: !!settings.developer,
      themePreferred: settings.theme_preferred || ThemeType.AUTOMATIC,
      validateSchema: !!settings.validateSchema,
      runnerApiBaseUrl: settings.runnerApiBaseUrl ?? '',
      runnerFhirBaseUrl: settings.runnerFhirBaseUrl ?? '',
      defaultTestResultsIndexUrl: settings.defaultTestResultsIndexUrl ?? '',
      fhirPackageRegistryBaseUrl: settings.fhirPackageRegistryBaseUrl ?? '',
      vsacFhirBaseUrl: settings.vsacFhirBaseUrl ?? '',
      vsacApiUsername: settings.vsacApiUsername ?? '',
      vsacApiPassword: settings.vsacApiPassword ?? '',
      ollamaBaseUrl: settings.ollamaBaseUrl ?? '',
      ollamaModel: settings.ollamaModel ?? '',
      searxngBaseUrl: settings.searxngBaseUrl ?? '',
      enableAiAssistant: !!settings.enableAiAssistant,
      useMCPTools: !!settings.useMCPTools,
      allowAiWriteOperations: !!settings.allowAiWriteOperations,
      autoApplyCodeEdits: !!settings.autoApplyCodeEdits,
      requireDiffPreview: !!settings.requireDiffPreview,
      planActSeparateModels: !!settings.planActSeparateModels,
    };
  }

  private fromUserSettingsDto(dto: UserSettingsDto): Settings {
    const settings = new Settings();
    settings.experimental = dto.experimental;
    settings.developer = dto.developer;
    settings.theme_preferred = this.parseTheme(dto.themePreferred);
    settings.validateSchema = dto.validateSchema;
    settings.runnerApiBaseUrl = dto.runnerApiBaseUrl;
    settings.runnerFhirBaseUrl = dto.runnerFhirBaseUrl;
    settings.defaultTestResultsIndexUrl = dto.defaultTestResultsIndexUrl;
    settings.fhirPackageRegistryBaseUrl = dto.fhirPackageRegistryBaseUrl;
    settings.vsacFhirBaseUrl = dto.vsacFhirBaseUrl;
    settings.vsacApiUsername = dto.vsacApiUsername;
    settings.vsacApiPassword = dto.vsacApiPassword;
    settings.ollamaBaseUrl = dto.ollamaBaseUrl;
    settings.ollamaModel = dto.ollamaModel;
    settings.searxngBaseUrl = dto.searxngBaseUrl;
    settings.enableAiAssistant = dto.enableAiAssistant;
    settings.useMCPTools = dto.useMCPTools;
    settings.allowAiWriteOperations = dto.allowAiWriteOperations;
    settings.autoApplyCodeEdits = dto.autoApplyCodeEdits;
    settings.requireDiffPreview = dto.requireDiffPreview;
    settings.planActSeparateModels = dto.planActSeparateModels;
    return settings;
  }

  private parseTheme(value: string | undefined): ThemeType {
    if (value === ThemeType.LIGHT || value === ThemeType.DARK || value === ThemeType.AUTOMATIC) {
      return value;
    }
    return ThemeType.AUTOMATIC;
  }

  private personalEnvironmentsForPersist(environments: CqlEnvironment[]): CqlEnvironment[] {
    return (environments ?? [])
      .filter((env) => !env.builtIn && env.id !== BUILT_IN_ENVIRONMENT_ID)
      .map((env) => this.cloneEnvironment({ ...env, builtIn: false }));
  }

  private cloneEnvironment(env: CqlEnvironment): CqlEnvironment {
    return {
      id: env.id,
      name: env.name,
      builtIn: env.builtIn,
      evaluationServer: normalizeEndpointConfiguration(env.evaluationServer ?? { address: '' }),
      dataEndpoint: normalizeEndpointConfiguration(env.dataEndpoint ?? { address: '' }),
      terminologyEndpoint: normalizeEndpointConfiguration(env.terminologyEndpoint ?? { address: '' }),
      contentEndpoint: normalizeEndpointConfiguration(env.contentEndpoint ?? { address: '' }),
    };
  }

  private createDefaultSettings(): Settings {
    return new Settings();
  }

  private normalizeParsedSettings(parsed: LegacySettingsRecord): { settings: Settings; migrated: boolean } {
    const defaults = this.createDefaultSettings();
    const knownKeys = Object.keys(defaults) as (keyof Settings)[];
    const filtered: Partial<Settings> = {};
    for (const key of knownKeys) {
      if (parsed[key] !== undefined) {
        (filtered as Record<string, unknown>)[key] = parsed[key];
      }
    }
    if (parsed.themePreferred && !parsed.theme_preferred) {
      filtered.theme_preferred = this.parseTheme(parsed.themePreferred);
    }

    let merged = { ...defaults, ...filtered } as Settings;
    let migrated = false;

    if (!parsed.environments?.length) {
      const legacy: LegacyEnvironmentFields = {
        fhirBaseUrl: parsed.fhirBaseUrl,
        terminologyBaseUrl: parsed.terminologyBaseUrl,
        terminologyBasicAuthUsername: parsed.terminologyBasicAuthUsername,
        terminologyBasicAuthPassword: parsed.terminologyBasicAuthPassword
      };
      // Legacy only had built-in; no personal envs to migrate
      void legacy;
      merged.environments = [];
      migrated = true;
    } else {
      merged.environments = this.personalEnvironmentsForPersist(parsed.environments);
    }

    return { settings: merged, migrated };
  }
}
