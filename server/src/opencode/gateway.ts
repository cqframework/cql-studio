// Author: Preston Lee

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { ServerEnv } from '../config/env.js';
import { requireAuth } from '../auth/session.js';
import type {
  CreateOpenCodeSessionRequest,
  OpenCodeErrorBody,
  OpenCodeSessionDto,
  OpenCodeSessionStateDto,
  OpenCodeWorkspaceOrigin,
} from '@cql-studio/core';
import { OpenCodeError } from './errors.js';
import { openCodeLogger } from './logger.js';
import { OpenCodeToolExecutor, type OpenCodeToolContext } from './tools.js';
import { getPrisma } from '../db/prisma.js';
import { resolveEffectiveWorkspaceRole } from '../workspace/access.js';

interface GatewaySession extends OpenCodeToolContext {
  id: string;
  owner: string;
  createdAt: number;
  lastActivityAt: number;
  capability: string;
  workspaceOrigin?: OpenCodeWorkspaceOrigin;
  dto?: OpenCodeSessionDto;
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => void fn(req, res, next).catch(next);
}

export function createOpenCodeGateway(env: ServerEnv): Router {
  const router = Router();
  const sessions = new Map<string, GatewaySession>();
  const capabilities = new Map<string, GatewaySession>();
  const toolExecutor = new OpenCodeToolExecutor({
    cqlAssetsDirectory: env.cqlAssetsDirectory,
    cqlAssetsUrl: env.cqlAssetsUrl,
  });

  const requireCapability = (req: Request): GatewaySession => {
    const authorization = req.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const session = capabilities.get(token);
    if (!session) throw new OpenCodeError('INVALID_TOOL_CAPABILITY', 'Invalid OpenCode tool capability', 401, false);
    session.lastActivityAt = Date.now();
    return session;
  };

  // These routes authenticate with a random per-session capability. They are called
  // only by the runner's stdio MCP subprocess, never by the browser.
  router.get('/tool-bridge/tools', asyncHandler(async (req, res) => {
    requireCapability(req);
    res.json(await toolExecutor.definitions());
  }));

  router.post('/tool-bridge/execute', asyncHandler(async (req, res) => {
    const session = requireCapability(req);
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!name) throw new OpenCodeError('INVALID_TOOL_REQUEST', 'Tool name is required', 400, false);
    const started = Date.now();
    try {
      const result = await toolExecutor.execute(name, req.body?.arguments, session);
      openCodeLogger.info({ operation: 'tool.execute', sessionId: session.id, tool: name, durationMs: Date.now() - started, status: 'ok' }, 'OpenCode tool completed');
      res.json(result);
    } catch (error) {
      openCodeLogger.warn({ operation: 'tool.execute', sessionId: session.id, tool: name, durationMs: Date.now() - started, status: 'error' }, 'OpenCode tool failed');
      throw error;
    }
  }));

  if (env.ssoConfigured) router.use(requireAuth(env));

  router.post('/providers/models', asyncHandler(async (req, res) => {
    const type = req.body?.type;
    if (type !== 'ollama' && type !== 'openai' && type !== 'openai-compatible') {
      throw new OpenCodeError('INVALID_PROVIDER', 'A supported provider type is required', 400, false);
    }
    const rawBaseUrl = type === 'openai' ? 'https://api.openai.com/v1' : req.body?.baseUrl;
    if (typeof rawBaseUrl !== 'string' || !rawBaseUrl.trim()) {
      throw new OpenCodeError('INVALID_PROVIDER', 'A provider base URL is required', 400, false);
    }
    let baseUrl: URL;
    try {
      baseUrl = new URL(rawBaseUrl);
      if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') throw new Error('protocol');
      baseUrl.username = '';
      baseUrl.password = '';
    } catch {
      throw new OpenCodeError('INVALID_PROVIDER', 'Provider base URL must be an http or https URL', 400, false);
    }
    const normalized = baseUrl.toString().replace(/\/+$/, '');
    const target = type === 'ollama'
      ? `${normalized}/api/tags`
      : `${normalized.endsWith('/v1') ? normalized : `${normalized}/v1`}/models`;
    const headers = new Headers({ Accept: 'application/json' });
    if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) {
      headers.set('authorization', `Bearer ${req.body.apiKey.trim()}`);
    }
    let response: globalThis.Response;
    try {
      response = await fetch(target, { headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new OpenCodeError('PROVIDER_UNAVAILABLE', 'Unable to reach the provider model endpoint', 502, true);
    }
    if (!response.ok) {
      throw new OpenCodeError('PROVIDER_MODELS_FAILED', `Provider returned HTTP ${response.status}`, response.status, response.status >= 500);
    }
    const payload = await response.json() as { models?: Array<{ name?: unknown; id?: unknown }>; data?: Array<{ id?: unknown; name?: unknown }> };
    const models = type === 'ollama'
      ? (payload.models ?? []).map(item => item.name)
      : (payload.data ?? payload.models ?? []).map(item => item.id ?? item.name);
    res.json([...new Set(models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0))].sort());
  }));

  const ownerFor = (req: Request): string => req.user?.id ?? 'local-development';

  const authorizeWorkspaceOrigin = async (
    req: Request,
    origin: OpenCodeWorkspaceOrigin | undefined,
    activeLibraryId: string
  ): Promise<OpenCodeWorkspaceOrigin | undefined> => {
    if (!origin) return undefined;
    if (!env.ssoConfigured) return origin;
    if (!req.user) {
      throw new OpenCodeError('WORKSPACE_ACCESS_DENIED', 'Workspace authentication is required', 401, false);
    }
    const role = await resolveEffectiveWorkspaceRole(req.user, origin.workspaceId);
    if (!role) {
      throw new OpenCodeError('WORKSPACE_ACCESS_DENIED', 'Workspace access is required for this Library', 403, false);
    }
    const reference = await getPrisma().workspaceResourceReference.findUnique({
      where: { id: origin.resourceReferenceId },
      include: { workspace: { select: { name: true } } },
    });
    if (
      !reference ||
      reference.workspaceId !== origin.workspaceId ||
      reference.resourceType !== 'Library'
    ) {
      throw new OpenCodeError('WORKSPACE_LIBRARY_NOT_FOUND', 'Workspace Library reference was not found', 404, false);
    }
    if (reference.resourceId !== activeLibraryId) {
      throw new OpenCodeError('WORKSPACE_LIBRARY_MISMATCH', 'Workspace Library reference does not match the active Library', 409, false);
    }
    return {
      workspaceId: reference.workspaceId,
      workspaceName: reference.workspace.name,
      resourceReferenceId: reference.id,
      role,
    };
  };

  const withWorkspaceOrigin = (
    dto: OpenCodeSessionDto,
    session: GatewaySession
  ): OpenCodeSessionDto => ({
    ...dto,
    ...(session.workspaceOrigin ? { workspaceOrigin: session.workspaceOrigin } : {}),
  });

  const requireOwnedSession = (req: Request): GatewaySession => {
    const session = sessions.get(req.params.id);
    if (!session || session.owner !== ownerFor(req)) {
      throw new OpenCodeError('SESSION_NOT_FOUND', 'OpenCode session not found', 404, false);
    }
    session.lastActivityAt = Date.now();
    return session;
  };

  const forget = (id: string): void => {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session) capabilities.delete(session.capability);
  };

  const runnerFetch = async (path: string, init: RequestInit = {}): Promise<globalThis.Response> => {
    const headers = new Headers(init.headers);
    headers.set('x-opencode-runner-token', env.opencodeRunnerToken);
    if (init.body) headers.set('content-type', 'application/json');
    let response: globalThis.Response;
    try {
      response = await fetch(`${env.opencodeRunnerUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new OpenCodeError(
        timedOut ? 'RUNNER_TIMEOUT' : 'RUNNER_UNAVAILABLE',
        timedOut ? 'The OpenCode runner timed out' : 'The OpenCode runner is unavailable',
        timedOut ? 504 : 503,
        true
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as Partial<OpenCodeErrorBody> | null;
      throw new OpenCodeError(
        payload?.code || 'RUNNER_ERROR',
        payload?.message || `OpenCode runner returned HTTP ${response.status}`,
        response.status,
        payload?.retryable ?? response.status >= 500,
        payload?.details
      );
    }
    return response;
  };

  router.get('/health', asyncHandler(async (_req, res) => {
    const response = await runnerFetch('/health');
    res.json(await response.json());
  }));

  router.get('/sessions', asyncHandler(async (req, res) => {
    const owner = ownerFor(req);
    res.json([...sessions.values()]
      .filter(session => session.owner === owner && session.dto)
      .map(session => session.dto)
      .sort((a, b) => (b?.updatedAt ?? '').localeCompare(a?.updatedAt ?? '')));
  }));

  router.post('/sessions', asyncHandler(async (req, res) => {
    const owner = ownerFor(req);
    const ownedCount = [...sessions.values()].filter(session => session.owner === owner).length;
    if (env.opencodeMaxSessionsPerUser > 0 && ownedCount >= env.opencodeMaxSessionsPerUser) {
      throw new OpenCodeError('SESSION_LIMIT_REACHED', 'The per-user OpenCode session limit has been reached', 429, true);
    }
    if (env.opencodeMaxSessionsGlobal > 0 && sessions.size >= env.opencodeMaxSessionsGlobal) {
      throw new OpenCodeError('SESSION_LIMIT_REACHED', 'The global OpenCode session limit has been reached', 429, true);
    }
    const browserInput = (req.body ?? {}) as CreateOpenCodeSessionRequest;
    const { environment, toolContext, toolBridge: _untrustedToolBridge, ...runnerInput } = browserInput;
    const { workspaceOrigin, ...activeLibrary } = browserInput.activeLibrary ?? {};
    const input = { ...runnerInput, activeLibrary } as CreateOpenCodeSessionRequest;
    if (!input.activeLibrary?.id || !input.activeLibrary?.cqlContent?.trim()) {
      throw new OpenCodeError('INVALID_SESSION', 'An active CQL library with non-empty CQL content is required', 400, false);
    }
    const authorizedWorkspaceOrigin = await authorizeWorkspaceOrigin(
      req,
      workspaceOrigin,
      input.activeLibrary.id
    );
    const capability = randomUUID();
    const gatewaySession: GatewaySession = {
      id: 'pending',
      owner,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      environment,
      toolContext,
      capability,
      workspaceOrigin: authorizedWorkspaceOrigin,
    };
    capabilities.set(capability, gatewaySession);
    try {
      const response = await runnerFetch('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          toolBridge: { baseUrl: env.opencodeToolBridgeUrl, capability },
        } satisfies CreateOpenCodeSessionRequest),
      });
      const created = await response.json() as OpenCodeSessionDto;
      gatewaySession.id = created.id;
      gatewaySession.dto = withWorkspaceOrigin(created, gatewaySession);
      sessions.set(created.id, gatewaySession);
      res.status(201).json(gatewaySession.dto);
    } catch (error) {
      capabilities.delete(capability);
      throw error;
    }
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}`);
    const dto = await response.json() as OpenCodeSessionDto;
    session.dto = withWorkspaceOrigin(dto, session);
    res.json(session.dto);
  }));

  router.get('/sessions/:id/state', asyncHandler(async (req, res) => {
    const session = requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/state`);
    const state = await response.json() as OpenCodeSessionStateDto;
    state.session = withWorkspaceOrigin(state.session, session);
    session.dto = state.session;
    res.json(state);
  }));

  for (const suffix of ['messages', 'diff', 'commands'] as const) {
    router.get(`/sessions/:id/${suffix}`, asyncHandler(async (req, res) => {
      requireOwnedSession(req);
      const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/${suffix}`);
      res.json(await response.json());
    }));
  }

  router.get('/sessions/:id/files', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const search = new URLSearchParams({ q: String(req.query.q ?? ''), limit: String(req.query.limit ?? 30) });
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/files?${search}`);
    res.json(await response.json());
  }));

  router.post('/sessions/:id/attachments', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ name: req.body?.name, mimeType: req.body?.mimeType, data: req.body?.data }),
    });
    res.status(201).json(await response.json());
  }));

  router.delete('/sessions/:id/attachments/:attachmentId', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/attachments/${encodeURIComponent(req.params.attachmentId)}`, {
      method: 'DELETE',
    });
    res.status(204).send();
  }));

  router.put('/sessions/:id/active-file', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/active-file`, {
      method: 'PUT',
      body: JSON.stringify({ content: req.body?.content, documentRevision: req.body?.documentRevision }),
    });
    res.status(204);
    await response.arrayBuffer();
    res.send();
  }));

  router.post('/sessions/:id/prompt', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/prompt`, {
      method: 'POST',
      body: JSON.stringify({
        message: req.body?.message,
        agent: req.body?.agent,
        references: req.body?.references,
        attachments: req.body?.attachments,
        reasoning: req.body?.reasoning,
        editorContext: req.body?.editorContext,
      }),
    });
    res.status(202).json(await response.json());
  }));

  router.post('/sessions/:id/model', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/model`, {
      method: 'POST',
      body: JSON.stringify({ provider: req.body?.provider, model: req.body?.model }),
    });
    res.status(response.status).send();
  }));

  router.post('/sessions/:id/commands/:command', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(
      `/sessions/${encodeURIComponent(req.params.id)}/commands/${encodeURIComponent(req.params.command)}`,
      { method: 'POST', body: JSON.stringify({ arguments: req.body?.arguments, reasoning: req.body?.reasoning }) }
    );
    res.status(202).json(await response.json());
  }));

  for (const action of ['abort', 'validate'] as const) {
    router.post(`/sessions/:id/${action}`, asyncHandler(async (req, res) => {
      requireOwnedSession(req);
      const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/${action}`, { method: 'POST' });
      res.status(action === 'abort' ? 200 : 200).json(await response.json());
    }));
  }

  router.post('/sessions/:id/permissions/:permissionId', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(
      `/sessions/${encodeURIComponent(req.params.id)}/permissions/${encodeURIComponent(req.params.permissionId)}`,
      { method: 'POST', body: JSON.stringify({ response: req.body?.response }) }
    );
    res.json(await response.json());
  }));

  router.post('/sessions/:id/questions/:requestId', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const response = await runnerFetch(
      `/sessions/${encodeURIComponent(req.params.id)}/questions/${encodeURIComponent(req.params.requestId)}`,
      { method: 'POST', body: JSON.stringify({ answers: req.body?.answers }) }
    );
    res.json(await response.json());
  }));

  router.delete('/sessions/:id/questions/:requestId', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    await runnerFetch(
      `/sessions/${encodeURIComponent(req.params.id)}/questions/${encodeURIComponent(req.params.requestId)}`,
      { method: 'DELETE' }
    );
    res.status(204).send();
  }));

  router.get('/sessions/:id/events', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    const after = req.get('last-event-id') ?? String(req.query.after ?? '0');
    const response = await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}/events?after=${encodeURIComponent(after)}`, {
      signal: abort.signal,
    });
    if (!response.body) throw new OpenCodeError('EMPTY_EVENT_STREAM', 'OpenCode runner returned an empty event stream', 502, true);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const reader = response.body.getReader();
    try {
      while (!abort.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      reader.releaseLock();
      if (!res.writableEnded) res.end();
    }
  }));

  router.delete('/sessions/:id', asyncHandler(async (req, res) => {
    requireOwnedSession(req);
    await runnerFetch(`/sessions/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    forget(req.params.id);
    res.status(204).send();
  }));

  const cleanupTimer = setInterval(() => {
    void (async () => {
      for (const session of [...sessions.values()]) {
        if (Date.now() - session.lastActivityAt < env.opencodeSessionIdleMs) continue;
        try {
          const response = await runnerFetch(`/sessions/${encodeURIComponent(session.id)}`);
          const dto = await response.json() as OpenCodeSessionDto;
          session.dto = dto;
          if (dto.status === 'busy' || Date.parse(dto.expiresAt) > Date.now()) continue;
          await runnerFetch(`/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
        } catch {
          // Missing and already-expired runner sessions are removed from gateway state below.
        }
        forget(session.id);
      }
    })();
  }, env.opencodeCleanupIntervalMs);
  cleanupTimer.unref();

  // A gateway restart loses browser ownership/capability state, so old runner sessions
  // cannot safely be reattached. Reset them at startup to avoid orphaned workspaces.
  void runnerFetch('/sessions', { method: 'DELETE' }).catch(error => {
    openCodeLogger.warn({ operation: 'gateway.reconcile', err: error }, 'Could not reset orphaned runner sessions');
  });

  return router;
}
