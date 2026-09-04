// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
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
  OpenCodeEnvironmentBinding,
  OpenCodeIdeDiagnostics,
  OpenCodeHealthStatus,
  OpenCodeWorkspaceSyncRequest,
} from '../models/opencode.model';
import { SettingsService } from './settings.service';
import type { AiProviderType } from '../models/settings.model';
import { AuthService } from './auth.service';
import { OpenCodeEnvironmentBindingService } from './opencode-environment-binding.service';

@Injectable({ providedIn: 'root' })
export class OpenCodeService {
  private readonly settingsService = inject(SettingsService);
  private readonly authService = inject(AuthService);
  private readonly environmentBinding = inject(OpenCodeEnvironmentBindingService);

  /** Increments when owned sessions are bulk-deleted so open IDE views can drop stale state. */
  readonly sessionsEpoch = signal(0);

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

  async health(): Promise<OpenCodeHealthStatus> {
    try {
      const payload = await this.request<OpenCodeHealthStatus>('/health');
      return {
        healthy: payload.healthy !== false,
        sessions: payload.sessions ?? 0,
        serverUrl: payload.serverUrl,
        code: payload.code,
        message: payload.message,
      };
    } catch (error) {
      if (!(error instanceof OpenCodeApiError)) {
        return {
          healthy: false,
          sessions: 0,
          code: 'OPENCODE_GATEWAY_UNREACHABLE',
          message: error instanceof Error ? error.message : 'Unable to reach CQL Studio Server for OpenCode',
          retryable: true,
        };
      }
      if (error.status === 401) {
        return {
          healthy: false,
          sessions: 0,
          code: 'OPENCODE_UNAUTHORIZED',
          message: 'Sign in to use OpenCode.',
          retryable: true,
        };
      }
      if (error.status === 404) {
        return {
          healthy: false,
          sessions: 0,
          code: 'OPENCODE_DISABLED',
          message: 'OpenCode is not enabled on CQL Studio Server.',
          retryable: false,
        };
      }
      return {
        healthy: false,
        sessions: 0,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      };
    }
  }

  async createSession(input: CreateOpenCodeSessionRequest): Promise<OpenCodeSession> {
    const session = await this.request<OpenCodeSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return this.environmentBinding.bind(session);
  }

  async resumeSession(sessionId: string, input: CreateOpenCodeSessionRequest): Promise<OpenCodeSession> {
    const session = await this.request<OpenCodeSession>(
      `/sessions/${encodeURIComponent(sessionId)}/resume`,
      { method: 'POST', body: JSON.stringify(input) }
    );
    return this.environmentBinding.bind(session);
  }

  listProviderModels(input: { type: AiProviderType; baseUrl?: string; apiKey?: string }): Promise<string[]> {
    return this.request('/providers/models', { method: 'POST', body: JSON.stringify(input) });
  }

  switchModel(sessionId: string, provider: OpenCodeProviderConfig, model: string): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      body: JSON.stringify({ provider, model }),
    }).then(() => undefined);
  }

  async listSessions(workspaceId?: string): Promise<OpenCodeSession[]> {
    const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const sessions = await this.request<OpenCodeSession[]>(`/sessions${query}`);
    const restored = sessions.map(session => this.environmentBinding.restore(session));
    // A Workspace-filtered list is only a subset and must not discard bindings
    // for the user's sessions in other Workspaces or personal environments.
    if (!workspaceId) this.environmentBinding.retain(restored.map(session => session.id));
    return restored;
  }

  async getState(sessionId: string): Promise<OpenCodeSessionState> {
    const state = await this.request<OpenCodeSessionState>(
      `/sessions/${encodeURIComponent(sessionId)}/state`
    );
    return { ...state, session: this.environmentBinding.restore(state.session) };
  }

  prompt(
    sessionId: string,
    message: string,
    agent: 'plan' | 'build',
    references: string[] = [],
    reasoning = false,
    editorContext?: OpenCodeEditorContext,
    attachments: string[] = [],
    ideDiagnostics?: OpenCodeIdeDiagnostics
  ): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ message, agent, references, reasoning, editorContext, attachments, ideDiagnostics }),
    }).then(() => undefined);
  }

  uploadAttachment(sessionId: string, file: File): Promise<OpenCodeAttachment> {
    this.assertSessionEnvironment(sessionId);
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
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
    }).then(() => undefined);
  }

  syncActiveFile(sessionId: string, content: string, documentRevision: number, libraryId?: string): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/active-file`, {
      method: 'PUT',
      body: JSON.stringify({ content, documentRevision, libraryId }),
    }).then(() => undefined);
  }

  syncWorkspace(sessionId: string, input: OpenCodeWorkspaceSyncRequest): Promise<OpenCodeSession> {
    this.assertSessionEnvironment(sessionId);
    return this.request<OpenCodeSession>(`/sessions/${encodeURIComponent(sessionId)}/workspace`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then(session => this.environmentBinding.restore(session));
  }

  ackIdeAction(
    sessionId: string,
    actionId: string,
    body: { ok: boolean; libraryId?: string; name?: string; file?: string; error?: string }
  ): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/ide-actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(() => undefined);
  }

  async predictCql(prefix: string, suffix: string, signal: AbortSignal): Promise<string> {
    const response = await fetch(`${this.authService.apiBase()}/api/ollama/generate`, {
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
    this.assertSessionEnvironment(sessionId);
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/commands/${encodeURIComponent(command.replace(/^\//, ''))}`,
      { method: 'POST', body: JSON.stringify({ arguments: args, reasoning }) }
    ).then(() => undefined);
  }

  validate(sessionId: string): Promise<OpenCodeValidation> {
    this.assertSessionEnvironment(sessionId);
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/validate`, { method: 'POST' });
  }

  respondToPermission(
    sessionId: string,
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: 'POST', body: JSON.stringify({ response }) }
    ).then(() => undefined);
  }

  answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}`,
      { method: 'POST', body: JSON.stringify({ answers }) }
    ).then(() => undefined);
  }

  rejectQuestion(sessionId: string, requestId: string): Promise<void> {
    this.assertSessionEnvironment(sessionId);
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(requestId)}`,
      { method: 'DELETE' }
    ).then(() => undefined);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST' });
  }

  async deleteAllSessions(): Promise<{ deleted: number }> {
    const result = await this.request<{ deleted: number }>('/sessions', { method: 'DELETE' });
    const deleted = typeof result?.deleted === 'number' && Number.isFinite(result.deleted)
      ? Math.max(0, Math.trunc(result.deleted))
      : 0;
    this.environmentBinding.retain([]);
    this.sessionsEpoch.update(value => value + 1);
    return { deleted };
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
    return `${this.authService.apiBase()}/api/opencode`;
  }

  isSessionEnvironmentCurrent(session: OpenCodeSession | null): boolean {
    return this.environmentBinding.isCurrent(session);
  }

  currentEnvironmentBinding(): OpenCodeEnvironmentBinding {
    return this.environmentBinding.captureCurrent();
  }

  private assertSessionEnvironment(sessionId: string): void {
    const binding = this.environmentBinding.bindingFor(sessionId);
    if (this.environmentBinding.isBindingCurrent(binding)) {
      return;
    }
    const current = this.environmentBinding.captureCurrent();
    const original = binding?.label ?? 'an unknown environment';
    throw new OpenCodeApiError({
      code: 'OPENCODE_ENVIRONMENT_CHANGED',
      message: `This OpenCode session is bound to ${original}. The active environment is now ${current.label}. Start a new session before continuing.`,
      retryable: false,
    }, 409);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('content-type', 'application/json');
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        cache: 'no-store',
        ...init,
        headers,
        credentials: 'include',
      });
    } catch (error) {
      throw new OpenCodeApiError({
        code: 'OPENCODE_GATEWAY_UNREACHABLE',
        message: error instanceof Error && error.message
          ? `Unable to reach CQL Studio Server for OpenCode: ${error.message}`
          : 'Unable to reach CQL Studio Server for OpenCode',
        retryable: true,
      }, 503);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as (Partial<OpenCodeApiErrorBody> & { error?: string }) | null;
      const runnerDown = response.status === 503 || response.status === 504;
      throw new OpenCodeApiError({
        code: payload?.code || (runnerDown ? 'RUNNER_UNAVAILABLE' : 'OPENCODE_REQUEST_FAILED'),
        message: payload?.message || payload?.error || (
          runnerDown ? 'The OpenCode runner is unavailable' : `OpenCode request failed with HTTP ${response.status}`
        ),
        retryable: payload?.retryable ?? response.status >= 500,
        details: payload?.details,
      }, response.status);
    }
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch {
      throw new OpenCodeApiError({
        code: 'OPENCODE_REQUEST_FAILED',
        message: 'OpenCode returned an unreadable response',
        retryable: true,
      }, 502);
    }
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

  get isRunnerOutage(): boolean {
    return this.code === 'RUNNER_UNAVAILABLE'
      || this.code === 'RUNNER_TIMEOUT'
      || this.code === 'RUNNER_ERROR'
      || this.code === 'EMPTY_EVENT_STREAM'
      || this.code === 'OPENCODE_GATEWAY_UNREACHABLE';
  }
}
