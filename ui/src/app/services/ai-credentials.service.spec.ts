// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import type { UserSettingsDto } from '@cql-studio/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCredentialsService } from './ai-credentials.service';
import { EnvironmentService } from './environment.service';
import { SettingsService } from './settings.service';
import { UserSettingsApiService } from './user-settings-api.service';

const defaultSettings = (): UserSettingsDto => ({
  experimental: false,
  developer: false,
  themePreferred: 'automatic',
  validateSchema: false,
  runnerApiBaseUrl: '',
  runnerFhirBaseUrl: '',
  defaultTestResultsIndexUrl: '',
  fhirPackageRegistryBaseUrl: '',
  vsacFhirBaseUrl: '',
  vsacApiUsername: '',
  vsacApiPassword: '',
  aiProvider: 'ollama',
  ollamaBaseUrl: '',
  ollamaModel: '',
  openaiModel: '',
  compatibleProviderName: '',
  compatibleProviderBaseUrl: '',
  compatibleProviderModel: '',
  searxngBaseUrl: '',
  enableAiAssistant: false,
  autoApplyCodeEdits: false,
  enableAiCodePrediction: false,
});

describe('AI provider credentials', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    let savedSettings = defaultSettings();
    TestBed.configureTestingModule({
      providers: [{
        provide: UserSettingsApiService,
        useValue: {
          getSettings: vi.fn(async () => savedSettings),
          putSettings: vi.fn(async (settings: UserSettingsDto) => {
            savedSettings = settings;
            return settings;
          }),
          listEnvironments: vi.fn(async () => []),
          replaceEnvironments: vi.fn(async () => []),
        },
      }],
    });
  });

  it('migrates legacy keys into memory and removes them from persisted settings', async () => {
    const environment = TestBed.inject(EnvironmentService).seedBuiltInEnvironment();
    localStorage.setItem(SettingsService.SETTINGS_KEY, JSON.stringify({
      settingsVersion: 2,
      environments: [environment],
      activeEnvironmentId: environment.id,
      ollamaApiKey: 'ollama-secret',
      openaiApiKey: 'openai-secret',
      compatibleProviderApiKey: 'compatible-secret',
    }));

    const settings = TestBed.inject(SettingsService);
    const credentials = TestBed.inject(AiCredentialsService);
    await settings.bootstrapFromServer();

    expect(credentials.get('ollama')).toBe('ollama-secret');
    expect(credentials.get('openai')).toBe('openai-secret');
    expect(credentials.get('openai-compatible')).toBe('compatible-secret');

    const persisted = localStorage.getItem(SettingsService.SETTINGS_KEY) ?? '';
    expect(persisted).not.toContain('ollama-secret');
    expect(persisted).not.toContain('openai-secret');
    expect(persisted).not.toContain('compatible-secret');
    expect(settings.exportSettingsJson()).not.toContain('ApiKey');
  });

  it('accepts legacy keys during import without persisting them', async () => {
    const settings = TestBed.inject(SettingsService);
    const credentials = TestBed.inject(AiCredentialsService);

    expect(await settings.importSettingsJson(JSON.stringify({
      openaiApiKey: 'imported-openai-secret',
      compatibleProviderApiKey: 'imported-compatible-secret',
    }))).toBe(true);

    expect(credentials.get('openai')).toBe('imported-openai-secret');
    expect(credentials.get('openai-compatible')).toBe('imported-compatible-secret');
    expect(localStorage.getItem(SettingsService.SETTINGS_KEY) ?? '').not.toContain('imported-');
  });

  it('requires an explicit model for an OpenAI-compatible provider', () => {
    const settings = TestBed.inject(SettingsService);
    settings.patchSettings({
      aiProvider: 'openai-compatible',
      compatibleProviderBaseUrl: 'https://provider.example/v1',
      compatibleProviderModel: '',
    });

    expect(settings.getEffectiveCompatibleProviderModel()).toBe('');
  });
});
