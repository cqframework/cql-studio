// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiCredentialsService } from './ai-credentials.service';
import { EnvironmentService } from './environment.service';
import { SettingsService } from './settings.service';

describe('AI provider credentials', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('migrates legacy keys into memory and removes them from persisted settings', () => {
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

    expect(credentials.get('ollama')).toBe('ollama-secret');
    expect(credentials.get('openai')).toBe('openai-secret');
    expect(credentials.get('openai-compatible')).toBe('compatible-secret');

    const persisted = localStorage.getItem(SettingsService.SETTINGS_KEY) ?? '';
    expect(persisted).not.toContain('ollama-secret');
    expect(persisted).not.toContain('openai-secret');
    expect(persisted).not.toContain('compatible-secret');
    expect(settings.exportSettingsJson()).not.toContain('ApiKey');
  });

  it('accepts legacy keys during import without persisting them', () => {
    const settings = TestBed.inject(SettingsService);
    const credentials = TestBed.inject(AiCredentialsService);

    expect(settings.importSettingsJson(JSON.stringify({
      openaiApiKey: 'imported-openai-secret',
      compatibleProviderApiKey: 'imported-compatible-secret',
    }))).toBe(true);

    expect(credentials.get('openai')).toBe('imported-openai-secret');
    expect(credentials.get('openai-compatible')).toBe('imported-compatible-secret');
    expect(localStorage.getItem(SettingsService.SETTINGS_KEY)).not.toContain('imported-');
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
