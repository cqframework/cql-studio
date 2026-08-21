import { Injectable, inject } from '@angular/core';
import {
  CreateOpenCodeSessionRequest,
  OpenCodeApiErrorBody,
  OpenCodeCommand,
  OpenCodeEventEnvelope,
  OpenCodeEvent,
  OpenCodeFileDiff,
  OpenCodeFileReference,
  OpenCodeSession,
  OpenCodeSessionState,
  OpenCodeValidation,
} from '../models/opencode.model';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class OpenCodeService {
  private readonly settingsService = inject(SettingsService);

  isAvailable(): boolean {
    const settings = this.settingsService.settings();
    return Boolean(
      settings.enableAiAssistant &&
      this.settingsService.getEffectiveServerBaseUrl() &&
      this.settingsService.getEffectiveOllamaBaseUrl() &&
      this.settingsService.getEffectiveOllamaModel()
    );
  }

  health(): Promise<{ healthy: boolean; sessions: number; serverUrl?: string }> {
    return this.request('/health');
  }

  createSession(input: CreateOpenCodeSessionRequest): Promise<OpenCodeSession> {
    return this.request('/sessions', { method: 'POST', body: JSON.stringify(input) });
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
    reasoning = false
  ): Promise<void> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ message, agent, references, reasoning }),
    }).then(() => undefined);
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
