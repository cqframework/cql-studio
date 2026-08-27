// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { Endpoint } from 'fhir/r4';
import { BUILT_IN_ENVIRONMENT_ID, CqlEnvironment, EndpointHttpContext, EndpointRole } from '../models/environment.model';
import { AiProviderType, Settings, ThemeType } from '../models/settings.model';
import { ExamplePaths } from '../constants/example-paths.constants';
import { buildFhirEndpoint } from './endpoint-config.lib';
import { EnvironmentService, LegacyEnvironmentFields } from './environment.service';

interface LegacySettingsRecord extends Partial<Settings> {
  fhirBaseUrl?: string;
  terminologyBaseUrl?: string;
  terminologyBasicAuthUsername?: string;
  terminologyBasicAuthPassword?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  public static SETTINGS_KEY: string = 'cql_tests_ui_settings';
  public static FORCE_RESET_KEY: string = 'cql_tests_ui_settings_force_reset';

  private static readonly VSAC_FHIR_PRODUCTION_DEFAULT = 'https://cts.nlm.nih.gov/fhir';

  private readonly environmentService = inject(EnvironmentService);

  public settings = signal<Settings>(new Settings());
  public force_reset = signal<boolean>(false);
  public theme_effective = signal<ThemeType>(ThemeType.LIGHT);

  constructor() {
    this.reload();
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', ({ matches }) => {
        if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
          if (matches) {
            this.theme_effective.set(ThemeType.DARK);
            this.saveSettings();
          } else {
            this.theme_effective.set(ThemeType.LIGHT);
            this.saveSettings();
          }
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

  reload() {
    this.force_reset.set(localStorage.getItem(SettingsService.FORCE_RESET_KEY) === 'true');
    if (this.force_reset()) {
      this.forceResetToDefaults();
      return;
    }
    const tmp = localStorage.getItem(SettingsService.SETTINGS_KEY);
    if (tmp) {
      try {
        const parsed = JSON.parse(tmp) as LegacySettingsRecord;
        const { settings, migrated } = this.normalizeParsedSettings(parsed);
        this.settings.set(settings);
        this.syncEnvironmentFromSettings(settings);
        if (migrated) {
          this.saveSettings();
        }
      } catch {
        const defaults = this.createDefaultSettings();
        this.settings.set(defaults);
        this.syncEnvironmentFromSettings(defaults);
        this.saveSettings();
      }
    } else {
      const defaults = this.createDefaultSettings();
      this.settings.set(defaults);
      this.syncEnvironmentFromSettings(defaults);
      this.saveSettings();
    }
    this.setEffectiveTheme();
  }

  forceResetToDefaults() {
    localStorage.clear();
    const defaults = this.createDefaultSettings();
    this.settings.set(defaults);
    this.force_reset.set(false);
    this.syncEnvironmentFromSettings(defaults);
    this.saveSettings();
    this.setEffectiveTheme();
  }

  saveSettings() {
    this.persistEnvironmentToSettings();
    localStorage.setItem(SettingsService.SETTINGS_KEY, JSON.stringify(this.settings()));
  }

  persistEnvironmentToSettings(): void {
    this.settings.update(current => ({
      ...current,
      settingsVersion: 3,
      environments: this.environmentService.getEnvironmentsSnapshot(),
      activeEnvironmentId: this.environmentService.getActiveEnvironmentIdSnapshot(),
      activeEnvironmentSource: this.environmentService.getActiveEnvironmentSourceSnapshot(),
      activeWorkspaceEnvironment: this.environmentService.getActiveWorkspaceEnvironmentSnapshot(),
    }));
  }

  syncEnvironmentFromSettings(settings: Settings): void {
    this.environmentService.syncFromSettings(
      settings.environments ?? [],
      settings.activeEnvironmentId ?? BUILT_IN_ENVIRONMENT_ID,
      settings.activeEnvironmentSource === 'workspace' ? 'workspace' : 'personal',
      settings.activeWorkspaceEnvironment ?? null
    );
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
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_RUNNER_BASE_URL'];
    return envValue?.trim() ? envValue : 'http://localhost:3000';
  }

  getDefaultFhirBaseUrl(): string {
    const evalUrl = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_EVALUATION_SERVER_URL'];
    if (evalUrl?.trim()) {
      return evalUrl.trim().replace(/\/+$/, '');
    }
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_FHIR_BASE_URL'];
    return envValue?.trim() ? envValue : 'http://localhost:8080/fhir';
  }

  getDefaultRunnerFhirBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_RUNNER_FHIR_BASE_URL'];
    return envValue?.trim() ? envValue : 'http://localhost:8080/fhir';
  }

  getDefaultTerminologyBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASE_URL'];
    return envValue?.trim() ? envValue : '';
  }

  getDefaultTerminologyBasicAuthUsername(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_USERNAME'];
    return envValue?.trim() ?? '';
  }

  getDefaultTerminologyBasicAuthPassword(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_PASSWORD'];
    return envValue ?? '';
  }

  getDefaultTestResultsIndexUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_DEFAULT_TEST_RESULTS_INDEX_URL'];
    return envValue?.trim() ? envValue : ExamplePaths.INDEX_JSON;
  }

  getDefaultOllamaBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_OLLAMA_BASE_URL'];
    return envValue?.trim() ? envValue : 'http://localhost:11434';
  }

  getDefaultOllamaModel(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_OLLAMA_MODEL'];
    return envValue?.trim() ? envValue : 'qwen3.6:35b-mlx';
  }

  getDefaultServerBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_SERVER_BASE_URL'];
    return envValue?.trim() ? envValue : 'http://localhost:3003';
  }

  getDefaultSearxngBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_SEARXNG_BASE_URL'];
    return envValue?.trim() ?? '';
  }

  getDefaultFhirPackageRegistryBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_FHIR_PACKAGE_REGISTRY_BASE_URL'];
    return envValue?.trim() ? envValue : 'https://packages.fhir.org';
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

  getEffectiveAiProvider(): AiProviderType {
    const provider = this.settings().aiProvider;
    return provider === 'openai' || provider === 'openai-compatible' ? provider : 'ollama';
  }

  getEffectiveOllamaApiKey(): string { return this.settings().ollamaApiKey?.trim() ?? ''; }

  getDefaultOpenAiModel(): string { return 'gpt-4o-mini'; }
  getEffectiveOpenAiModel(): string {
    return this.settings().openaiModel?.trim() || this.getDefaultOpenAiModel();
  }
  getEffectiveOpenAiApiKey(): string { return this.settings().openaiApiKey?.trim() ?? ''; }
  getEffectiveCompatibleProviderName(): string {
    return this.settings().compatibleProviderName?.trim() || 'My AI Provider';
  }
  getEffectiveCompatibleProviderBaseUrl(): string {
    return (this.settings().compatibleProviderBaseUrl?.trim() || '').replace(/\/+$/, '');
  }
  getEffectiveCompatibleProviderModel(): string {
    return this.settings().compatibleProviderModel?.trim() || 'default';
  }
  getEffectiveCompatibleProviderApiKey(): string { return this.settings().compatibleProviderApiKey?.trim() ?? ''; }

  getEffectiveServerBaseUrl(): string {
    const settingValue = this.settings().serverBaseUrl;
    return settingValue?.trim() ? settingValue : this.getDefaultServerBaseUrl();
  }

  getDefaultVsacFhirBaseUrl(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_VSAC_FHIR_BASE_URL'];
    if (envValue?.trim()) {
      return envValue.trim();
    }
    return SettingsService.VSAC_FHIR_PRODUCTION_DEFAULT;
  }

  getEffectiveVsacFhirBaseUrl(): string {
    const custom = this.settings().vsacFhirBaseUrl?.trim();
    const base = custom || this.getDefaultVsacFhirBaseUrl();
    return base.replace(/\/+$/, '');
  }

  getDefaultVsacApiUsername(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_VSAC_BASIC_AUTH_USERNAME'];
    return envValue?.trim() ? envValue : 'apikey';
  }

  getDefaultVsacApiPassword(): string {
    const envValue = (window as unknown as Record<string, string | undefined>)['CQL_STUDIO_VSAC_BASIC_AUTH_PASSWORD'];
    return envValue?.trim() ?? '';
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
    this.saveSettings();
  }

  /** Immutable in-memory update without persisting (Save still required). */
  patchSettings(updates: Partial<Settings>): void {
    this.settings.update(current => ({ ...current, ...updates }));
    if (updates.environments || updates.activeEnvironmentId) {
      this.syncEnvironmentFromSettings(this.settings());
    }
  }

  static readonly EXPORT_FILENAME = 'settings.cql-studio.json';

  exportSettingsJson(): string {
    this.persistEnvironmentToSettings();
    return JSON.stringify(this.settings(), null, 2);
  }

  importSettingsJson(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as LegacySettingsRecord;
      const { settings: merged } = this.normalizeParsedSettings(parsed);
      this.settings.set(merged);
      this.syncEnvironmentFromSettings(merged);
      this.saveSettings();
      this.setEffectiveTheme();
      return true;
    } catch {
      return false;
    }
  }

  private createDefaultSettings(): Settings {
    const settings = new Settings();
    const migrated = this.environmentService.migrateLegacySettings({});
    settings.settingsVersion = 3;
    settings.environments = migrated.environments;
    settings.activeEnvironmentId = migrated.activeEnvironmentId;
    settings.activeEnvironmentSource = 'personal';
    settings.activeWorkspaceEnvironment = null;
    return settings;
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

    let merged = { ...defaults, ...filtered } as Settings;
    let migrated = false;

    if (!parsed.settingsVersion || parsed.settingsVersion < 2 || !parsed.environments?.length) {
      const legacy: LegacyEnvironmentFields = {
        fhirBaseUrl: parsed.fhirBaseUrl,
        terminologyBaseUrl: parsed.terminologyBaseUrl,
        terminologyBasicAuthUsername: parsed.terminologyBasicAuthUsername,
        terminologyBasicAuthPassword: parsed.terminologyBasicAuthPassword
      };
      const migratedEnv = this.environmentService.migrateLegacySettings(legacy);
      merged = {
        ...merged,
        settingsVersion: 3,
        environments: migratedEnv.environments,
        activeEnvironmentId: this.environmentService.resolveActiveEnvironmentIdForImport(
          parsed.activeEnvironmentId ?? migratedEnv.activeEnvironmentId,
          migratedEnv.environments
        )
      };
      migrated = true;
    } else {
      const resolvedId = this.environmentService.resolveActiveEnvironmentIdForImport(
        merged.activeEnvironmentId,
        merged.environments
      );
      if (resolvedId !== merged.activeEnvironmentId) {
        migrated = true;
      }
      merged.activeEnvironmentId = resolvedId;
    }

    if (merged.activeEnvironmentSource !== 'workspace') {
      merged.activeEnvironmentSource = 'personal';
      merged.activeWorkspaceEnvironment = null;
    } else if (
      !merged.activeWorkspaceEnvironment?.workspaceId ||
      !merged.activeWorkspaceEnvironment?.environmentId
    ) {
      merged.activeEnvironmentSource = 'personal';
      merged.activeWorkspaceEnvironment = null;
      migrated = true;
    }

    return { settings: merged, migrated };
  }
}
