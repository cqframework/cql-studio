// Author: Preston Lee

import { Injectable, signal } from '@angular/core';
import { AiProviderType } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class AiCredentialsService {
  readonly ollamaApiKey = signal('');
  readonly openAiApiKey = signal('');
  readonly compatibleProviderApiKey = signal('');

  get(provider: AiProviderType): string {
    if (provider === 'openai') {
      return this.openAiApiKey().trim();
    }
    if (provider === 'openai-compatible') {
      return this.compatibleProviderApiKey().trim();
    }
    return this.ollamaApiKey().trim();
  }

  set(provider: AiProviderType, apiKey: string): void {
    if (provider === 'openai') {
      this.openAiApiKey.set(apiKey);
    } else if (provider === 'openai-compatible') {
      this.compatibleProviderApiKey.set(apiKey);
    } else {
      this.ollamaApiKey.set(apiKey);
    }
  }

  clear(): void {
    this.ollamaApiKey.set('');
    this.openAiApiKey.set('');
    this.compatibleProviderApiKey.set('');
  }
}
