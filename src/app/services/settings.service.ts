// Author: Preston Lee

import { Injectable, signal } from '@angular/core';
import { Settings, ThemeType } from '../models/settings.model';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  public static SETTINGS_KEY: string = "cql_tests_ui_settings";
  public static FORCE_RESET_KEY: string = "cql_tests_ui_settings_force_reset";

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
            console.log("Changed to dark mode!")
          } else {
            this.theme_effective.set(ThemeType.LIGHT);
            this.saveSettings();
            console.log("Changed to light mode!")
          }
        }
      })
  }

  setEffectiveTheme() {
    if (this.settings().theme_preferred == ThemeType.AUTOMATIC) {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        this.theme_effective.set(ThemeType.DARK);
        console.log("Theme automatically set to dark mode!")
      } else {
        this.theme_effective.set(ThemeType.LIGHT);
        console.log("Theme automatically set to light mode!")
      }
    } else {
      this.theme_effective.set(this.settings().theme_preferred);
      console.log("Theme forced to", this.settings().theme_preferred, "mode!")
    }
  }

  reload() {
    this.force_reset.set((localStorage.getItem(SettingsService.FORCE_RESET_KEY) == 'true' ? true : false));
    if (this.force_reset()) {
      this.forceResetToDefaults();
    }
    let tmp = localStorage.getItem(SettingsService.SETTINGS_KEY);
    if (tmp) {
      try {
        const parsedSettings = JSON.parse(tmp);
        let shouldSave = false;
        if (parsedSettings.experimental == null) {
          parsedSettings.experimental = false;
          shouldSave = true;
        }
        if (parsedSettings.developer == null) {
          parsedSettings.developer = false;
          shouldSave = true;
        }
        if (parsedSettings.theme_preferred == null) {
          parsedSettings.theme_preferred = Settings.DEFAULT_THEME;
          shouldSave = true;
        }
        if (parsedSettings.validateSchema == null) {
          parsedSettings.validateSchema = false;
          shouldSave = true;
        }
        if (parsedSettings.enableElmTranslation == null) {
          parsedSettings.enableElmTranslation = false;
          shouldSave = true;
        }
        if (parsedSettings.runnerApiBaseUrl == null) {
          parsedSettings.runnerApiBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.fhirBaseUrl == null) {
          parsedSettings.fhirBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.runnerFhirBaseUrl == null) {
          parsedSettings.runnerFhirBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.terminologyBaseUrl == null) {
          parsedSettings.terminologyBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.terminologyBasicAuthUsername == null) {
          parsedSettings.terminologyBasicAuthUsername = '';
          shouldSave = true;
        }
        if (parsedSettings.terminologyBasicAuthPassword == null) {
          parsedSettings.terminologyBasicAuthPassword = '';
          shouldSave = true;
        }
        if (parsedSettings.translationBaseUrl == null) {
          parsedSettings.translationBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.defaultTestResultsIndexUrl == null) {
          parsedSettings.defaultTestResultsIndexUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.ollamaBaseUrl == null) {
          parsedSettings.ollamaBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.ollamaModel == null) {
          parsedSettings.ollamaModel = '';
          shouldSave = true;
        }
        if (parsedSettings.mcpBaseUrl == null) {
          parsedSettings.mcpBaseUrl = '';
          shouldSave = true;
        }
        if (parsedSettings.enableAiAssistant == null) {
          parsedSettings.enableAiAssistant = false;
          shouldSave = true;
        }
        if (parsedSettings.useMCPTools == null) {
          parsedSettings.useMCPTools = false;
          shouldSave = true;
        }
        if (shouldSave) {
          this.saveSettings();
          console.log("Settings have been updated to include default field values.");
        } else {
          console.log("Settings have been loaded from local browser storage on this device without modification.");
        }
        this.settings.set(parsedSettings);
        console.log("Current settings:", this.settings());

      } catch (e) {
        console.log("Settings could not be parsed and are likely not valid JSON. They will be ignored.");
        console.log(e);
      }
    } else {
      this.settings.set(new Settings());
      this.saveSettings();
    }
    this.setEffectiveTheme();
  }

  forceResetToDefaults() {
    localStorage.clear();
    this.settings.set(new Settings());
    this.force_reset.set(false);
    this.saveSettings();
    this.setEffectiveTheme();
    this.reload();
    console.log("All application settings have been restored to their defaults.");
  }

  saveSettings() {
    localStorage.setItem(SettingsService.SETTINGS_KEY, JSON.stringify(this.settings()));
    console.log("Your settings have been saved to local browser storage on this device. They will not be sync'd to any other system, even if your browser supports such features.");
  }

  getDefaultRunnerApiBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_RUNNER_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:3000';
  }

  getDefaultFhirBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_FHIR_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:8080/fhir';
  }

  getDefaultRunnerFhirBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_RUNNER_FHIR_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:8080/fhir';
  }

  getDefaultTerminologyBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_TERMINOLOGY_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:8080/fhir';
  }

  getDefaultTerminologyBasicAuthUsername(): string {
    const envValue = (window as any)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_USERNAME'];
    return envValue && envValue.trim() !== '' ? envValue : '';
  }

  getDefaultTerminologyBasicAuthPassword(): string {
    const envValue = (window as any)['CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_PASSWORD'];
    return envValue && envValue.trim() !== '' ? envValue : '';
  }

  getDefaultTranslationBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_TRANSLATION_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:3001';
  }

  getDefaultTestResultsIndexUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_DEFAULT_TEST_RESULTS_INDEX_URL'];
    return envValue && envValue.trim() !== '' ? envValue : '/examples/index.json';
  }

  getDefaultOllamaBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_OLLAMA_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:11434';
  }

  getDefaultOllamaModel(): string {
    const envValue = (window as any)['CQL_STUDIO_OLLAMA_MODEL'];
    return envValue && envValue.trim() !== '' ? envValue : 'deepseek-coder:6.7b';
  }

  getDefaultMCPBaseUrl(): string {
    const envValue = (window as any)['CQL_STUDIO_MCP_BASE_URL'];
    return envValue && envValue.trim() !== '' ? envValue : 'http://localhost:3002';
  }

  getEffectiveRunnerApiBaseUrl(): string {
    const settingValue = this.settings().runnerApiBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultRunnerApiBaseUrl();
  }

  getEffectiveFhirBaseUrl(): string {
    const settingValue = this.settings().fhirBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultFhirBaseUrl();
  }

  getEffectiveRunnerFhirBaseUrl(): string {
    const settingValue = this.settings().runnerFhirBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultRunnerFhirBaseUrl();
  }

  getEffectiveTerminologyBaseUrl(): string {
    const settingValue = this.settings().terminologyBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultTerminologyBaseUrl();
  }

  getEffectiveTerminologyBasicAuthUsername(): string {
    const settingValue = this.settings().terminologyBasicAuthUsername;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultTerminologyBasicAuthUsername();
  }

  getEffectiveTerminologyBasicAuthPassword(): string {
    const settingValue = this.settings().terminologyBasicAuthPassword;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultTerminologyBasicAuthPassword();
  }

  getEffectiveTranslationBaseUrl(): string {
    const settingValue = this.settings().translationBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultTranslationBaseUrl();
  }

  getEffectiveTestResultsIndexUrl(): string {
    const settingValue = this.settings().defaultTestResultsIndexUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultTestResultsIndexUrl();
  }

  getEffectiveOllamaBaseUrl(): string {
    const settingValue = this.settings().ollamaBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultOllamaBaseUrl();
  }

  getEffectiveOllamaModel(): string {
    const settingValue = this.settings().ollamaModel;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultOllamaModel();
  }

  getEffectiveMCPBaseUrl(): string {
    const settingValue = this.settings().mcpBaseUrl;
    return settingValue && settingValue.trim() !== '' ? settingValue : this.getDefaultMCPBaseUrl();
  }

  updateSettings(updates: Partial<Settings>): void {
    this.settings.update(current => ({ ...current, ...updates }));
    this.saveSettings();
  }
}
