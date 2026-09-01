import { Injectable, inject } from '@angular/core';
import {
  CreateOpenCodeSessionRequest,
  OpenCodeApiErrorBody,
  OpenCodeCommand,
  OpenCodeEventEnvelope,
  OpenCodeEvent,
  OpenCodeEditorContext,
  OpenCodeFileDiff,
  OpenCodeFileReference,
  OpenCodeSession,
  OpenCodeSessionState,
  OpenCodeValidation,
  OpenCodeProviderConfig,
  OpenCodeAttachment,
} from '../models/opencode.model';
import { SettingsService } from './settings.service';
import type { AiProviderType } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class OpenCodeService {
  private readonly settingsService = inject(SettingsService);

  isAvailable(): boolean {
    const settings = this.settingsService.settings();
    const provider = this.settingsService.getEffectiveAiProvider();
    const providerReady = provider === 'ollama'
      ? Boolean(this.settingsService.getEffectiveOllamaBaseUrl() && this.settingsService.getEffectiveOllamaModel())
      : provider === 'openai'
        ? Boolean(this.settingsService.getEffectiveOpenAiModel())
        : Boolean(this.settingsService.getEffectiveCompatibleProviderBaseUrl() && this.settingsService.getEffectiveCompatibleProviderModel());
    return Boolean(
      settings.enableAiAssistant &&
      this.settingsService.getEffectiveServerBaseUrl() &&
      providerReady
    );
  }

  health(): Promise<{ healthy: boolean; sessions: number; serverUrl?: string }> {
    return this.request('/health');
  }

  createSession(input: CreateOpenCodeSessionRequest): Promise<OpenCodeSession> {
    return this.request('/sessions', { method: 'POST', body: JSON.stringify(input) });
  }

  listProviderModels(input: { type: AiProviderType; baseUrl?: string; apiKey?: string }): Promise<string[]> {
    return this.request('/providers/models', { method: 'POST', body: JSON.stringify(input) });
  }

  switchModel(sessionId: string, provider: OpenCodeProviderConfig, model: string): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      body: JSON.stringify({ provider, model }),
    }).then(() => undefined);
  }

  listSessions(): Promise<OpenCodeSession[]> {
    return this.request('/sessions');
  }

  getState(sessionId: string): Promise<OpenCodeSessionState> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/state`);
  }

  prompt(
    sessionId: string,
    message: string,
    agent: 'plan' | 'build',
    references: string[] = [],
    reasoning = false,
    editorContext?: OpenCodeEditorContext,
    attachments: string[] = []
  ): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ message, agent, references, reasoning, editorContext, attachments }),
    }).then(() => undefined);
  }

  uploadAttachment(sessionId: string, file: File): Promise<OpenCodeAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read attachment'));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const comma = result.indexOf(',');
        const data = comma >= 0 ? result.slice(comma + 1) : result;
        this.request(`/sessions/${encodeURIComponent(sessionId)}/attachments`, {
          method: 'POST',
          body: JSON.stringify({ name: file.name, mimeType: file.type || undefined, data }),
        }).then((attachment) => resolve(attachment as OpenCodeAttachment)).catch(reject);
      };
      reader.readAsDataURL(file);
    });
  }

  removeAttachment(sessionId: string, attachmentId: string): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    }).then(() => undefined);
  }

  syncActiveFile(sessionId: string, content: string, documentRevision: number): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/active-file`, {
      method: 'PUT',
      body: JSON.stringify({ content, documentRevision }),
    }).then(() => undefined);
  }

  async predictCql(prefix: string, suffix: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(`${this.settingsService.getEffectiveServerBaseUrl().replace(/\/+$/, '')}/api/ollama/generate`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-ollama-base-url': this.settingsService.getEffectiveOllamaBaseUrl(),
        ...(this.settingsService.getEffectiveOllamaApiKey()
          ? { 'x-ollama-api-key': this.settingsService.getEffectiveOllamaApiKey() }
          : {}),
      },
      body: JSON.stringify({
        model: this.settingsService.getEffectiveOllamaModel(),
        stream: false,
        prompt: [
          'Continue the CQL at <CURSOR>. Return only the exact text to insert: no markdown, explanation, or repetition.',
          'Keep the completion short (usually one expression fragment or line) and valid CQL.',
          `<PREFIX>${prefix}</PREFIX><CURSOR><SUFFIX>${suffix}</SUFFIX>`,
        ].join('\n'),
        options: { temperature: 0.1, num_predict: 128 },
      }),
    });
    if (!response.ok) throw new Error(`CQL prediction failed with HTTP ${response.status}`);
    const payload = await response.json() as { response?: unknown };
    return typeof payload.response === 'string' ? payload.response : '';
  }

  abort(sessionId: string): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' })
      .then(() => undefined);
  }

  getDiff(sessionId: string): Promise<OpenCodeFileDiff[]> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/diff`);
  }

  getCommands(sessionId: string): Promise<OpenCodeCommand[]> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/commands`);
  }

  findFiles(sessionId: string, query: string): Promise<OpenCodeFileReference[]> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/files?q=${encodeURIComponent(query)}&limit=30`);
  }

  executeCommand(sessionId: string, command: string, args: string, reasoning = false): Promise<void> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/commands/${encodeURIComponent(command.replace(/^\//, ''))}`,
      { method: 'POST', body: JSON.stringify({ arguments: args, reasoning }) }
    ).then(() => undefined);
  }

  validate(sessionId: string): Promise<OpenCodeValidation> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/validate`, { method: 'POST' });
  }

  respondToPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: 'POST', body: JSON.stringify({ response }) }
    ).then(() => undefined);
  }

  answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}`,
      { method: 'POST', body: JSON.stringify({ answers }) }
    ).then(() => undefined);
  }

  rejectQuestion(sessionId: string, requestId: string): Promise<void> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}`,
      { method: 'DELETE' }
    ).then(() => undefined);
  }

  endSession(sessionId: string): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      .then(() => undefined);
  }

  events(
    sessionId: string,
    onEvent: (event: OpenCodeEventEnvelope) => void,
    onError: () => void,
    onOpen?: () => void,
    afterId = 0
  ): EventSource {
    const stream = new EventSource(
      `${this.baseUrl()}/sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(afterId)}`,
      { withCredentials: true }
    );
    stream.onmessage = event => {
      try {
        onEvent(JSON.parse(event.data) as OpenCodeEventEnvelope);
      } catch (error) {
        console.warn('Ignoring malformed OpenCode event', error);
      }
    };
    stream.onerror = onError;
    if (onOpen) stream.onopen = onOpen;
    return stream;
  }

  private baseUrl(): string {
    return `${this.settingsService.getEffectiveServerBaseUrl().replace(/\/+$/, '')}/api/opencode`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('content-type', 'application/json');
    const response = await fetch(`${this.baseUrl()}${path}`, {
      cache: 'no-store',
      ...init,
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as (Partial<OpenCodeApiErrorBody> & { error?: string }) | null;
      throw new OpenCodeApiError({
        code: payload?.code || 'OPENCODE_REQUEST_FAILED',
        message: payload?.message || payload?.error || `OpenCode request failed with HTTP ${response.status}`,
        retryable: payload?.retryable ?? response.status >= 500,
        details: payload?.details,
      }, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

export class OpenCodeApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(body: OpenCodeApiErrorBody, readonly status: number) {
    super(body.message);
    this.name = 'OpenCodeApiError';
    this.code = body.code;
    this.retryable = body.retryable;
    this.details = body.details;
  }
}
