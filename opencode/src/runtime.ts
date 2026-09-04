// Author: Preston Lee

import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MCPToolNames, normalizeOpenCodeLibraries } from '@cql-studio/core';
import {
  createOpencode,
  createOpencodeClient,
  type Event,
  type FilePartInput,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2';
import type {
  CreateOpenCodeSessionRequest,
  OpenCodeAttachmentDto,
  OpenCodeAttachmentUploadRequest,
  OpenCodeModelSwitchRequest,
  OpenCodeCommandDto,
  OpenCodeActiveFileSyncRequest,
  OpenCodeWorkspaceSyncRequest,
  OpenCodeEventEnvelope,
  OpenCodeFileDiffDto,
  OpenCodeFileReferenceDto,
  OpenCodePermissionRequestDto,
  OpenCodeQuestionRequestDto,
  OpenCodePermissionResponse,
  OpenCodePromptRequest,
  OpenCodeSessionDto,
  OpenCodeSessionStateDto,
  OpenCodeValidationDto,
} from '@cql-studio/core';
import { normalizeOpenCodeError, OpenCodeError, openCodeResumeTranscript } from '@cql-studio/core';
import type { OpenCodeEnv } from './config/env.js';
import { loadEnv } from './config/env.js';
import { OpenCodeExitCode, OpenCodeFatalError } from './fatal.js';
import { openCodeLogger } from './logger.js';
import {
  assertMarkitdownAvailable,
  OpenCodeWorkspaceManager,
  providerFor,
  providerIdFor,
  type MaterializedWorkspace,
} from './workspace.js';
export { openCodeResumeTranscript } from '@cql-studio/core';

const require = createRequire(import.meta.url);

/**
 * Fail fast when the opencode-ai CLI was never installed (common after
 * --ignore-scripts) so startup exits with a clear UNAVAILABLE message instead
 * of an opaque spawn ENOEXEC from createOpencode.
 */
export function assertOpenCodeCliAvailable(): void {
  let packageJson: string;
  try {
    packageJson = require.resolve('opencode-ai/package.json');
  } catch {
    throw new OpenCodeFatalError(
      'The opencode-ai package is not installed. Run npm install from the monorepo root.',
      OpenCodeExitCode.UNAVAILABLE
    );
  }
  const binPath = path.join(path.dirname(packageJson), 'bin', 'opencode.exe');
  let size = 0;
  try {
    size = statSync(binPath).size;
  } catch {
    throw new OpenCodeFatalError(
      `The opencode CLI binary is missing at ${binPath}. Reinstall opencode-ai or run: node node_modules/opencode-ai/postinstall.mjs`,
      OpenCodeExitCode.UNAVAILABLE
    );
  }
  // The published package ships a tiny shell stub until postinstall replaces it.
  if (size < 10_000) {
    let head = '';
    try {
      head = readFileSync(binPath).subarray(0, 200).toString('utf8');
    } catch {
      head = '';
    }
    if (head.includes('postinstall script was not run') || size < 2_000) {
      throw new OpenCodeFatalError(
        'opencode-ai postinstall did not install the native CLI binary. Fix: node node_modules/opencode-ai/postinstall.mjs (or reinstall without --ignore-scripts).',
        OpenCodeExitCode.UNAVAILABLE
      );
    }
  }
}

type RuntimeEvent = Event | { type: string; properties: Record<string, unknown> };
type EventListener = (event: OpenCodeEventEnvelope) => void;

interface RuntimeSession {
  dto: OpenCodeSessionDto;
  workspace: MaterializedWorkspace;
  client: OpencodeClient;
  listeners: Set<EventListener>;
  history: OpenCodeEventEnvelope[];
  nextEventId: number;
  eventAbort: AbortController;
  validation: OpenCodeValidationDto | null;
  validationPending: boolean;
  toolBridge?: { baseUrl: string; capability: string };
  stallTimer?: NodeJS.Timeout;
  stallGeneration: number;
  browserRevisions: Map<string, number>;
  lastWorkspaceContentByFile: Map<string, string>;
  pendingWorkspaceSync?: OpenCodeWorkspaceSyncRequest;
  attachments: Map<string, OpenCodeAttachmentDto>;
  seedMessages: unknown[];
}

const CQL_COMMANDS = new Set([
  'validate', 'review', 'explain', 'dependencies', 'library', 'valueset',
  'context', 'fhir', 'research', 'terminology', 'validate-vsac',
]);

/**
 * Only events scoped to this OpenCode session prove that its provider request
 * is making progress. Global events such as server.heartbeat must never keep a
 * stalled request alive indefinitely.
 */
export function isOpenCodeSessionProgress(eventSessionId: unknown, openCodeSessionId: string): boolean {
  return typeof eventSessionId === 'string' && eventSessionId === openCodeSessionId;
}

export function openCodeAttachmentMimeType(converted: boolean): 'text/markdown' | 'text/plain' {
  return converted ? 'text/markdown' : 'text/plain';
}

const LIGHTWEIGHT_CONVERSATION_MESSAGES = new Set([
  'hi',
  'hi there',
  'hello',
  'hello there',
  'hey',
  'hey there',
  'good morning',
  'good afternoon',
  'good evening',
  'how are you',
  'thank you',
  'thanks',
  'who are you',
  'what can you do',
]);

/**
 * Trivial conversation does not need the large IDE and MCP tool schemas. Keep
 * this deliberately conservative so any prompt with working context, an
 * attachment, or an actual request retains the complete OpenCode toolset.
 */
export function isLightweightOpenCodeConversation(input: Pick<OpenCodePromptRequest,
  'message' | 'references' | 'attachments' | 'editorContext'>): boolean {
  if (input.editorContext || input.references?.length || input.attachments?.length) return false;
  const normalized = input.message
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/u, '')
    .replace(/\s+/g, ' ');
  return LIGHTWEIGHT_CONVERSATION_MESSAGES.has(normalized);
}

/**
 * OpenCode persists a prompt's wildcard tool override for later turns in the
 * same session. Always send the inverse override so a tool-free greeting
 * cannot leave subsequent CQL work without file and MCP tools.
 */
export function openCodeToolsForPrompt(input: Pick<OpenCodePromptRequest,
  'message' | 'references' | 'attachments' | 'editorContext'>): Record<string, boolean> {
  return { '*': !isLightweightOpenCodeConversation(input) };
}

export class OpenCodeRuntime {
  private readonly env: OpenCodeEnv;
  private readonly workspaces: OpenCodeWorkspaceManager;
  private readonly sessions = new Map<string, RuntimeSession>();
  private server: Awaited<ReturnType<typeof createOpencode>> | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly idleMs: number;
  private readonly cleanupMs: number;
  // Ollama can spend time loading a cold model, but a request must not leave
  // the browser spinning indefinitely when the provider never produces an event.
  // Deployments with slower hardware can override this value explicitly.
  private readonly providerStallMs: number;

  constructor(env: OpenCodeEnv = loadEnv()) {
    this.env = env;
    this.workspaces = new OpenCodeWorkspaceManager(env.workspaceRoot, {
      rewriteLocalhost: env.rewriteLocalhost,
      mcpBridgeBin: env.mcpBridgeBin,
    });
    this.idleMs = env.sessionIdleMs;
    this.cleanupMs = env.cleanupIntervalMs;
    this.providerStallMs = env.providerStallMs;
  }

  private modelFor(session: RuntimeSession): { providerID: string; modelID: string; model: string } {
    const separator = session.dto.model.indexOf('/');
    if (separator < 1) return { providerID: 'ollama', modelID: session.dto.model, model: `ollama/${session.dto.model}` };
    const providerID = session.dto.model.slice(0, separator);
    const modelID = session.dto.model.slice(separator + 1);
    return { providerID, modelID, model: session.dto.model };
  }

  async initialize(): Promise<void> {
    try {
      await this.workspaces.initialize();
    } catch (error) {
      if (error instanceof OpenCodeFatalError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new OpenCodeFatalError(
        `Failed to initialize OpenCode workspace root at "${this.env.workspaceRoot}": ${detail}`,
        OpenCodeExitCode.OSERR
      );
    }
    assertOpenCodeCliAvailable();
    this.workspaces.useMarkitdownBin(assertMarkitdownAvailable());
    try {
      this.server = await createOpencode({
        hostname: '127.0.0.1',
        port: this.env.internalPort,
        timeout: 20_000,
        config: { autoupdate: false, share: 'disabled', logLevel: 'WARN' },
      });
    } catch (error) {
      if (error instanceof OpenCodeFatalError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const hint = /ENOENT|ENOEXEC|not found/i.test(detail)
        ? ' Ensure the opencode CLI is on PATH (npm installs it under node_modules/.bin) and that opencode-ai postinstall completed.'
        : '';
      throw new OpenCodeFatalError(
        `Failed to start embedded OpenCode server on 127.0.0.1:${this.env.internalPort}: ${detail}.${hint}`,
        OpenCodeExitCode.UNAVAILABLE
      );
    }
    this.cleanupTimer = setInterval(() => void this.removeExpired(), this.cleanupMs);
    this.cleanupTimer.unref();
  }

  health(): { healthy: boolean; sessions: number; serverUrl?: string } {
    return { healthy: !!this.server, sessions: this.sessions.size, serverUrl: this.server?.server.url };
  }

  list(): OpenCodeSessionDto[] {
    return [...this.sessions.values()].map(session => session.dto).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: CreateOpenCodeSessionRequest): Promise<OpenCodeSessionDto> {
    if (!this.server) throw new OpenCodeError('RUNNER_UNAVAILABLE', 'OpenCode runtime is not initialized', 503, true);
    const libraries = normalizeOpenCodeLibraries(input);
    const workspace = await this.workspaces.create({ ...input, libraries });
    try {
      const client = createOpencodeClient({
        baseUrl: this.server.server.url,
        directory: workspace.directory,
        throwOnError: true,
      });
      const provider = providerFor(input);
      const providerId = providerIdFor(provider);
      const modelId = provider.model || input.ollamaModel;
      const title = input.title
        || (libraries.length === 1 ? libraries[0].name : undefined)
        || (libraries.length > 1 ? `${libraries.length} libraries in CQL Studio` : undefined)
        || 'CQL Studio';
      const created = await client.session.create({
        title,
        model: { id: modelId, providerID: providerId, variant: 'fast' },
      });
      const openCodeSession = created.data;
      if (!openCodeSession) throw new Error('OpenCode did not return a session');
      const now = new Date();
      const libraryIds = this.workspaces.writableLibraryIds(workspace);
      const dto: OpenCodeSessionDto = {
        id: workspace.id,
        openCodeSessionId: openCodeSession.id,
        title,
        status: 'idle',
        activeLibraryId: workspace.manifest.activeLibraryId || undefined,
        activeFile: workspace.activeFile || undefined,
        libraryIds,
        createdAt: input.resume?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        lastActivityAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.idleMs).toISOString(),
        model: `${providerId}/${modelId}`,
        reasoningEnabled: false,
      };
      const browserRevisions = new Map<string, number>();
      const lastWorkspaceContentByFile = new Map<string, string>();
      for (const [file, content] of workspace.baselineByFile) {
        const libraryId = workspace.manifest.files[file]?.libraryId;
        if (libraryId) {
          browserRevisions.set(libraryId, 0);
          lastWorkspaceContentByFile.set(file, content);
        }
      }
      const runtime: RuntimeSession = {
        dto,
        workspace,
        client,
        listeners: new Set(),
        history: [],
        nextEventId: 1,
        eventAbort: new AbortController(),
        validation: null,
        validationPending: false,
        stallGeneration: 0,
        browserRevisions,
        lastWorkspaceContentByFile,
        attachments: new Map(),
        toolBridge: input.toolBridge,
        seedMessages: input.resume?.messages ?? [],
      };
      if (input.resume?.messages.length) {
        await client.session.promptAsync({
          sessionID: openCodeSession.id,
          noReply: true,
          tools: { '*': false },
          parts: [{
            type: 'text',
            text: `<cql-studio-resume-context>\n${openCodeResumeTranscript(input.resume.messages)}\n</cql-studio-resume-context>`,
          }],
        });
      }
      this.sessions.set(dto.id, runtime);
      void this.pumpEvents(runtime);
      openCodeLogger.info({ operation: 'session.create', sessionId: dto.id, libraryIds: dto.libraryIds }, 'OpenCode session created');
      return dto;
    } catch (error) {
      await this.workspaces.remove(workspace);
      throw error;
    }
  }

  get(id: string): RuntimeSession {
    const session = this.sessions.get(id);
    if (!session) throw new OpenCodeError('SESSION_NOT_FOUND', 'OpenCode session not found', 404, false);
    if (session.dto.status !== 'busy' && Date.parse(session.dto.expiresAt) <= Date.now()) {
      void this.remove(id);
      throw new OpenCodeError('SESSION_EXPIRED', 'OpenCode session expired after 60 minutes of inactivity', 410, false);
    }
    return session;
  }

  async prompt(id: string, input: OpenCodePromptRequest): Promise<void> {
    const session = this.get(id);
    const writableFiles = new Set(
      Object.entries(session.workspace.manifest.files)
        .filter(([, entry]) => entry.writable)
        .map(([file]) => file)
    );
    if (input.editorContext && !writableFiles.has(input.editorContext.file)) {
      throw new OpenCodeError('INVALID_EDITOR_CONTEXT', 'Editor context does not match a writable CQL library', 400, false);
    }
    const lightweightConversation = isLightweightOpenCodeConversation(input);
    const ideDiagnostics = lightweightConversation ? undefined : input.ideDiagnostics;
    if (ideDiagnostics) {
      const expectedRevision = session.browserRevisions.get(ideDiagnostics.libraryId);
      const file = this.workspaces.fileForLibrary(session.workspace, ideDiagnostics.libraryId);
      const writable = file ? session.workspace.manifest.files[file]?.writable : false;
      if (!writable || expectedRevision === undefined || ideDiagnostics.documentRevision !== expectedRevision) {
        throw new OpenCodeError(
          'STALE_IDE_DIAGNOSTICS',
          'The IDE Problems context does not match a synchronized writable CQL document',
          409,
          true
        );
      }
    }
    this.touch(session);
    session.dto.status = 'busy';
    session.dto.reasoningEnabled = Boolean(input.reasoning);
    this.armStallTimer(session);
    const parts: Array<{ type: 'text'; text: string } | FilePartInput> = [{ type: 'text', text: input.message }];
    if (input.editorContext) {
      const context = input.editorContext;
      const selectedText = context.selectedText.slice(0, 50_000);
      parts.push({
        type: 'text',
        text: [
          '',
          `<cql-studio-editor-context mode="${context.mode}" file="${context.file}" revision="${context.documentRevision}" range="${context.startLine}:${context.startColumn}-${context.endLine}:${context.endColumn}">`,
          selectedText,
          '</cql-studio-editor-context>',
          context.mode === 'inline'
            ? 'Limit the requested edit to this selected range (or current line) unless a wider change is required for valid CQL.'
            : 'Treat this editor selection as the user\'s current focus.',
        ].join('\n'),
      });
    }
    if (ideDiagnostics?.diagnostics.length) {
      const diagnosticsFile = this.workspaces.fileForLibrary(session.workspace, ideDiagnostics.libraryId) || session.workspace.activeFile;
      const diagnostics = ideDiagnostics.diagnostics.slice(0, 100).map(item => ({
        severity: item.severity,
        message: item.message.slice(0, 2_000),
        file: diagnosticsFile,
        line: item.line,
        column: item.column,
      }));
      const serialized = JSON.stringify(diagnostics).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
      parts.push({
        type: 'text',
        text: [
          `<cql-studio-problems-context library="${ideDiagnostics.libraryId}" revision="${ideDiagnostics.documentRevision}">`,
          serialized,
          '</cql-studio-problems-context>',
          'These are the current diagnostics shown in the CQL Studio Problems tab. Use them as the initial repair target, then run cql_validate after editing.',
        ].join('\n'),
      });
    }
    const references = new Set(input.references ?? []);
    if (ideDiagnostics?.diagnostics.length && session.workspace.manifest.files['dependencies/FHIRHelpers.cql']) {
      references.add('dependencies/FHIRHelpers.cql');
    }
    for (const reference of [...references].slice(0, 20)) {
      const absolute = this.workspaces.resolveReference(session.workspace, reference);
      const marker = `@${reference}`;
      const start = Math.max(0, input.message.indexOf(marker));
      parts.push({
        type: 'file',
        mime: 'text/plain',
        filename: reference,
        url: pathToFileURL(absolute).href,
        source: { type: 'file', path: absolute, text: { value: marker, start, end: start + marker.length } },
      });
    }
    for (const attachmentId of [...new Set(input.attachments ?? [])].slice(0, 20)) {
      const attachment = session.attachments.get(attachmentId);
      if (!attachment) {
        session.dto.status = 'error';
        this.clearStallTimer(session);
        throw new OpenCodeError('ATTACHMENT_NOT_FOUND', `Attachment was not found: ${attachmentId}`, 404, false);
      }
      const absolute = path.join(session.workspace.directory, attachment.path);
      parts.push({
        type: 'file',
        mime: openCodeAttachmentMimeType(attachment.converted),
        filename: attachment.converted ? `${attachment.name}.md` : attachment.name,
        url: pathToFileURL(absolute).href,
        source: { type: 'file', path: absolute, text: { value: attachment.name, start: 0, end: attachment.name.length } },
      });
    }
    try {
      const selectedModel = this.modelFor(session);
      await session.client.session.promptAsync({
        sessionID: session.dto.openCodeSessionId,
        agent: input.agent === 'plan' ? 'plan' : 'build',
        model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID },
        variant: input.reasoning ? 'thinking' : 'fast',
        tools: openCodeToolsForPrompt(input),
        parts,
      });
      openCodeLogger.info({
        operation: 'prompt.accepted',
        sessionId: id,
        model: selectedModel.model,
        toolsEnabled: !lightweightConversation,
        references: input.references?.length ?? 0,
        attachments: input.attachments?.length ?? 0,
        editorContext: Boolean(input.editorContext),
      }, 'OpenCode prompt accepted');
    } catch (error) {
      session.dto.status = 'error';
      this.clearStallTimer(session);
      throw error;
    }
  }

  async switchModel(id: string, input: OpenCodeModelSwitchRequest): Promise<void> {
    const session = this.get(id);
    if (!input?.provider || typeof input.model !== 'string' || !input.model.trim()) {
      throw new OpenCodeError('INVALID_MODEL', 'A provider and model are required', 400, false);
    }
    const providerId = providerIdFor(input.provider);
    await this.workspaces.ensureProviderModel(session.workspace, input.provider, input.model);
    session.dto.model = `${providerId}/${input.model.trim()}`;
    this.touch(session);
    openCodeLogger.info({ operation: 'session.model.switch', sessionId: id, provider: providerId, model: input.model.trim() }, 'OpenCode model switched');
  }

  async addAttachment(id: string, input: OpenCodeAttachmentUploadRequest): Promise<OpenCodeAttachmentDto> {
    const session = this.get(id);
    if (session.attachments.size >= 20) throw new OpenCodeError('ATTACHMENT_LIMIT_REACHED', 'A session may contain at most 20 attachments', 413, false);
    try {
      const attachment = await this.workspaces.addAttachment(session.workspace, input);
      session.attachments.set(attachment.id, attachment);
      this.touch(session);
      openCodeLogger.info({ operation: 'attachment.add', sessionId: id, attachmentId: attachment.id, name: attachment.name, converted: attachment.converted }, 'OpenCode attachment added');
      return attachment;
    } catch (error) {
      throw new OpenCodeError('INVALID_ATTACHMENT', error instanceof Error ? error.message : String(error), 400, false);
    }
  }

  async removeAttachment(id: string, attachmentId: string): Promise<void> {
    const session = this.get(id);
    const attachment = session.attachments.get(attachmentId);
    if (!attachment) throw new OpenCodeError('ATTACHMENT_NOT_FOUND', 'OpenCode attachment was not found', 404, false);
    await this.workspaces.removeAttachment(session.workspace, attachment);
    session.attachments.delete(attachmentId);
    this.touch(session);
  }

  async executeCommand(id: string, command: string, args = '', reasoning = false): Promise<void> {
    const session = this.get(id);
    const normalized = command.replace(/^\//, '').trim();
    if (!/^[a-z][a-z0-9_-]*$/i.test(normalized)) throw new OpenCodeError('INVALID_COMMAND', 'Command name is invalid', 400);
    this.touch(session);
    session.dto.status = 'busy';
    session.dto.reasoningEnabled = reasoning;
    this.armStallTimer(session);
    try {
      if (normalized === 'compact') {
        const selectedModel = this.modelFor(session);
        this.runDetachedCommand(session, session.client.session.summarize({
          sessionID: session.dto.openCodeSessionId,
          providerID: selectedModel.providerID,
          modelID: selectedModel.modelID,
          auto: false,
        }), normalized, async () => {
          await Promise.all([...session.attachments.values()].map(attachment => this.workspaces.removeAttachment(session.workspace, attachment)));
          session.attachments.clear();
          this.emit(session, { type: 'attachments.compacted', properties: {} });
          openCodeLogger.info({ operation: 'attachment.compact', sessionId: id }, 'OpenCode attachments purged after compaction');
        });
        return;
      }
      const selectedModel = this.modelFor(session);
      const commands = await this.commands(id);
      if (!commands.some(item => item.name === normalized && item.source !== 'web')) {
        throw new OpenCodeError('COMMAND_NOT_FOUND', `OpenCode command was not found: /${normalized}`, 404);
      }
      const attachmentHint = [...session.attachments.values()]
        .map(attachment => `Session attachment: ${attachment.path} (original name: ${attachment.name}). Read it when relevant.`)
        .join('\n');
      const commandArguments = [args.trim(), attachmentHint].filter(Boolean).join('\n\n');
      this.runDetachedCommand(session, session.client.session.command({
        sessionID: session.dto.openCodeSessionId,
        command: normalized,
        arguments: commandArguments,
        agent: 'build',
        model: selectedModel.model,
        variant: reasoning ? 'thinking' : 'fast',
      }), normalized);
    } catch (error) {
      session.dto.status = 'error';
      this.clearStallTimer(session);
      throw error;
    }
  }

  async commands(id: string): Promise<OpenCodeCommandDto[]> {
    const session = this.get(id);
    const result = await session.client.command.list();
    const commands = result.data ?? [];
    return commands
      .filter(command => !command.source || command.source === 'command')
      .filter(command => !['connect', 'models', 'sessions', 'editor', 'init', 'export', 'themes', 'share', 'unshare', 'exit', 'undo', 'redo'].includes(command.name))
      .map(command => ({
        name: command.name,
        description: command.description || `Run /${command.name}`,
        source: CQL_COMMANDS.has(command.name) ? 'cql-studio' as const : 'opencode' as const,
        acceptsArguments: command.template.includes('$ARGUMENTS'),
      }));
  }

  async files(id: string, query = '', limit = 30): Promise<OpenCodeFileReferenceDto[]> {
    const session = this.get(id);
    const allowed = this.workspaces.references(session.workspace, '', 50);
    const allowedByPath = new Map(allowed.map(file => [file.path, file]));
    const result = await session.client.find.files({ query, type: 'file', limit: Math.min(Math.max(limit, 1), 50) });
    const sdkPaths = (result.data ?? []).map(item => typeof item === 'string' ? item : String(item));
    return sdkPaths.map(file => file.replace(/^\.\//, '')).filter(file => allowedByPath.has(file))
      .map(file => allowedByPath.get(file)!)
      .slice(0, limit);
  }

  async messages(id: string): Promise<unknown[]> {
    const session = this.get(id);
    const result = await session.client.session.messages({ sessionID: session.dto.openCodeSessionId });
    return [...session.seedMessages, ...(result.data ?? [])];
  }

  async diff(id: string): Promise<OpenCodeFileDiffDto[]> {
    return this.workspaces.diff(this.get(id).workspace);
  }

  async syncActiveFile(id: string, input: OpenCodeActiveFileSyncRequest): Promise<void> {
    const session = this.get(id);
    if (session.dto.status === 'busy') {
      throw new OpenCodeError('SESSION_BUSY', 'Wait for OpenCode to finish before synchronizing the editor', 409, true);
    }
    if (Buffer.byteLength(input.content, 'utf8') > 1_048_576) {
      throw new OpenCodeError('ACTIVE_FILE_TOO_LARGE', 'The CQL file exceeds the 1 MiB OpenCode limit', 413, false);
    }
    const libraryId = input.libraryId || session.dto.activeLibraryId;
    const file = libraryId
      ? this.workspaces.fileForLibrary(session.workspace, libraryId)
      : session.workspace.activeFile;
    if (!file) throw new OpenCodeError('INVALID_ACTIVE_FILE', 'No writable CQL library is available to synchronize', 400, false);
    const previous = session.lastWorkspaceContentByFile.get(file);
    const contentChanged = input.content !== previous;
    await this.workspaces.syncActiveFile(session.workspace, input.content, libraryId);
    if (libraryId) session.browserRevisions.set(libraryId, Math.max(0, Math.trunc(input.documentRevision)));
    session.lastWorkspaceContentByFile.set(file, input.content);
    if (contentChanged) session.validation = null;
    session.validationPending = false;
    this.touch(session);
  }

  async syncWorkspace(id: string, input: OpenCodeWorkspaceSyncRequest): Promise<OpenCodeSessionDto> {
    const session = this.get(id);
    if (session.dto.status === 'busy') {
      session.pendingWorkspaceSync = input;
      this.touch(session);
      return session.dto;
    }
    await this.applyWorkspaceSync(session, input);
    return session.dto;
  }

  private async applyWorkspaceSync(session: RuntimeSession, input: OpenCodeWorkspaceSyncRequest): Promise<void> {
    for (const library of input.libraries) {
      if (Buffer.byteLength(library.cqlContent, 'utf8') > 1_048_576) {
        throw new OpenCodeError('ACTIVE_FILE_TOO_LARGE', `Library ${library.name} exceeds the 1 MiB OpenCode limit`, 413, false);
      }
    }
    const pendingDiffs = await this.workspaces.diff(session.workspace);
    const pendingLibraryIds = new Set(pendingDiffs.map(diff => diff.libraryId));
    const nextWritableIds = new Set(input.libraries.map(library => library.id));
    const protectedIds = [...pendingLibraryIds].filter(libraryId => !nextWritableIds.has(libraryId));
    if (protectedIds.length) {
      // Keep libraries with outstanding runner diffs writable until the user discards/applies them.
      for (const libraryId of protectedIds) {
        const file = this.workspaces.fileForLibrary(session.workspace, libraryId);
        const entry = file ? session.workspace.manifest.files[file] : undefined;
        if (!file || !entry) continue;
        const content = session.lastWorkspaceContentByFile.get(file)
          ?? await this.workspaces.readFileContent(session.workspace, file);
        input.libraries.push({
          id: libraryId,
          name: entry.name,
          version: entry.version,
          canonicalUrl: entry.canonicalUrl,
          fhirVersionId: entry.fhirVersionId,
          cqlContent: content,
          originalContent: content,
        });
        nextWritableIds.add(libraryId);
      }
    }
    await this.workspaces.syncWorkspace(session.workspace, input, { allowRemove: true });
    session.dto.libraryIds = this.workspaces.writableLibraryIds(session.workspace);
    session.dto.activeLibraryId = session.workspace.manifest.activeLibraryId || undefined;
    session.dto.activeFile = session.workspace.activeFile || undefined;
    const nextRevisions = new Map<string, number>();
    const nextContents = new Map<string, string>();
    for (const [file, entry] of Object.entries(session.workspace.manifest.files)) {
      if (!entry.writable) continue;
      const revision = input.revisions?.[entry.libraryId] ?? session.browserRevisions.get(entry.libraryId) ?? 0;
      nextRevisions.set(entry.libraryId, Math.max(0, Math.trunc(revision)));
      nextContents.set(file, session.workspace.baselineByFile.get(file) ?? '');
    }
    session.browserRevisions = nextRevisions;
    session.lastWorkspaceContentByFile = nextContents;
    session.pendingWorkspaceSync = undefined;
    session.validation = null;
    session.validationPending = false;
    this.touch(session);
  }

  async state(id: string): Promise<OpenCodeSessionStateDto> {
    const session = this.get(id);
    const [messages, diffs, commands, permissions, questions] = await Promise.all([
      this.messages(id),
      this.diff(id),
      this.commands(id),
      this.permissions(id),
      this.questions(id),
    ]);
    return {
      session: session.dto,
      messages,
      diffs,
      attachments: [...session.attachments.values()],
      commands,
      validation: session.validation,
      permissions,
      questions,
      lastEventId: session.nextEventId - 1,
    };
  }

  async permissions(id: string): Promise<OpenCodePermissionRequestDto[]> {
    const session = this.get(id);
    const result = await session.client.permission.list();
    return (result.data ?? [])
      .filter(request => request.sessionID === session.dto.openCodeSessionId)
      .map(request => ({
        id: request.id,
        type: request.permission,
        title: `OpenCode requests permission to ${request.permission}`,
        pattern: request.patterns,
        metadata: request.metadata,
      }));
  }

  async questions(id: string): Promise<OpenCodeQuestionRequestDto[]> {
    const session = this.get(id);
    const result = await session.client.question.list();
    return (result.data ?? [])
      .filter(request => request.sessionID === session.dto.openCodeSessionId)
      .map(request => ({ id: request.id, questions: request.questions }));
  }

  async validate(id: string): Promise<OpenCodeValidationDto> {
    const session = this.get(id);
    if (!session.toolBridge) throw new OpenCodeError('VALIDATION_UNAVAILABLE', 'CQL validation bridge is unavailable', 503, true);
    const workspace = await this.workspaces.validationPayload(session.workspace);
    const response = await fetch(`${session.toolBridge.baseUrl.replace(/\/+$/, '')}/execute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.toolBridge.capability}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: MCPToolNames.CQL_VALIDATE, arguments: { __workspace: workspace } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new OpenCodeError('VALIDATION_UNAVAILABLE', `CQL validation failed (${response.status})`, 503, true);
    session.validation = await response.json() as OpenCodeValidationDto;
    session.validationPending = false;
    this.emit(session, { type: 'cql.validation.updated', properties: session.validation as unknown as Record<string, unknown> });
    return session.validation;
  }

  async abort(id: string): Promise<void> {
    const session = this.get(id);
    await session.client.session.abort({ sessionID: session.dto.openCodeSessionId });
    session.dto.status = 'idle';
    this.clearStallTimer(session);
    this.touch(session);
  }

  async permission(id: string, permissionId: string, response: OpenCodePermissionResponse): Promise<void> {
    const session = this.get(id);
    await session.client.permission.reply({ requestID: permissionId, reply: response });
    this.touch(session);
  }

  async answerQuestion(id: string, requestId: string, answers: string[][]): Promise<void> {
    const session = this.get(id);
    await session.client.question.reply({ requestID: requestId, answers });
    this.touch(session);
  }

  async rejectQuestion(id: string, requestId: string): Promise<void> {
    const session = this.get(id);
    await session.client.question.reject({ requestID: requestId });
    this.touch(session);
  }

  subscribe(id: string, listener: EventListener, afterId = 0): () => void {
    const session = this.get(id);
    session.history.filter(envelope => envelope.id > afterId).forEach(listener);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async remove(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.eventAbort.abort();
    this.clearStallTimer(session);
    await session.client.session.delete({ sessionID: session.dto.openCodeSessionId }).catch(() => undefined);
    await this.workspaces.remove(session.workspace);
    this.sessions.delete(id);
    openCodeLogger.info({ operation: 'session.remove', sessionId: id }, 'OpenCode session removed');
  }

  async removeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(id => this.remove(id)));
  }

  private touch(session: RuntimeSession): void {
    const now = new Date();
    session.dto.updatedAt = now.toISOString();
    session.dto.lastActivityAt = now.toISOString();
    session.dto.expiresAt = new Date(now.getTime() + this.idleMs).toISOString();
  }

  private emit(session: RuntimeSession, event: RuntimeEvent): void {
    const envelope: OpenCodeEventEnvelope = {
      id: session.nextEventId++,
      sessionId: session.dto.id,
      emittedAt: new Date().toISOString(),
      event: event as OpenCodeEventEnvelope['event'],
    };
    session.history.push(envelope);
    if (session.history.length > 1_000) session.history.shift();
    session.listeners.forEach(listener => listener(envelope));
  }

  private async pumpEvents(session: RuntimeSession): Promise<void> {
    try {
      const subscription = await session.client.event.subscribe({}, { signal: session.eventAbort.signal });
      for await (const event of subscription.stream) {
        const typed = event as Event;
        const properties = typed.properties as Record<string, any>;
        const eventSessionId = properties['sessionID'] ?? properties['info']?.sessionID ?? properties['part']?.sessionID;
        if (eventSessionId && eventSessionId !== session.dto.openCodeSessionId) continue;
        if ((typed.type === 'file.edited' || typed.type === 'file.watcher.updated') &&
            typeof properties['file'] === 'string' &&
            this.workspaces.isWritableFile(session.workspace, properties['file'])) {
          await this.emitWorkspaceChange(session, properties['file']);
        }
        if (typed.type === 'session.status') {
          session.dto.status = properties['status']?.type === 'busy' ? 'busy' : 'idle';
          if (session.dto.status === 'idle') {
            this.clearStallTimer(session);
            await this.flushPendingWorkspaceSync(session);
          }
        } else if (typed.type === 'session.idle') {
          session.dto.status = 'idle';
          this.clearStallTimer(session);
          this.touch(session);
          await this.flushPendingWorkspaceSync(session);
        } else if (typed.type === 'session.error') {
          session.dto.status = 'error';
          this.clearStallTimer(session);
        }
        if (session.dto.status === 'busy' && isOpenCodeSessionProgress(eventSessionId, session.dto.openCodeSessionId)) {
          this.armStallTimer(session);
        }
        this.emit(session, typed);
        if (typed.type === 'session.idle') {
          this.validatePendingWorkspace(session);
        }
      }
    } catch (error) {
      if (session.eventAbort.signal.aborted) return;
      session.dto.status = 'error';
      this.emit(session, {
        type: 'runner.error',
        properties: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async flushPendingWorkspaceSync(session: RuntimeSession): Promise<void> {
    const pending = session.pendingWorkspaceSync;
    if (!pending || session.dto.status === 'busy') return;
    try {
      await this.applyWorkspaceSync(session, pending);
    } catch (error) {
      this.emit(session, {
        type: 'runner.error',
        properties: {
          message: error instanceof Error ? error.message : String(error),
          code: 'WORKSPACE_SYNC_FAILED',
          retryable: true,
        },
      });
    }
  }

  private async emitWorkspaceChange(session: RuntimeSession, relativeFile?: string): Promise<void> {
    const file = relativeFile?.replace(/\\/g, '/').replace(/^\.\//, '') || session.workspace.activeFile;
    if (!file || !session.workspace.manifest.files[file]?.writable) return;
    const content = await this.workspaces.readFileContent(session.workspace, file);
    if (content === session.lastWorkspaceContentByFile.get(file)) return;
    session.lastWorkspaceContentByFile.set(file, content);
    session.validation = null;
    session.validationPending = true;
    const libraryId = session.workspace.manifest.files[file].libraryId;
    this.emit(session, {
      type: 'cql.workspace.changed',
      properties: {
        file,
        libraryId,
        content,
        baseRevision: session.browserRevisions.get(libraryId) ?? 0,
      },
    });
    if (session.dto.status !== 'busy') this.validatePendingWorkspace(session);
  }

  private validatePendingWorkspace(session: RuntimeSession): void {
    if (!session.validationPending) return;
    // Consume the flag before starting so duplicate OpenCode idle events cannot
    // launch duplicate validation requests for the same edit.
    session.validationPending = false;
    void this.validate(session.dto.id).catch(error => {
      this.emit(session, { type: 'cql.validation.error', properties: { message: error instanceof Error ? error.message : String(error) } });
    });
  }

  private async removeExpired(): Promise<void> {
    const now = Date.now();
    const expired = [...this.sessions.values()]
      .filter(session => session.dto.status !== 'busy' && Date.parse(session.dto.expiresAt) <= now)
      .map(session => session.dto.id);
    await Promise.all(expired.map(id => this.remove(id)));
  }

  private armStallTimer(session: RuntimeSession): void {
    this.clearStallTimer(session);
    const generation = session.stallGeneration;
    session.stallTimer = setTimeout(() => {
      if (session.stallGeneration !== generation || session.dto.status !== 'busy') return;
      this.clearStallTimer(session);
      void session.client.session.abort({ sessionID: session.dto.openCodeSessionId }).catch(() => undefined);
      session.dto.status = 'error';
      this.emit(session, {
        type: 'runner.error',
        properties: {
          code: 'OLLAMA_STALLED',
          message: `The AI provider produced no progress for ${Math.round(this.providerStallMs / 1000)} seconds. The request was stopped; retry after the model finishes loading or increase CQL_STUDIO_OPENCODE_PROVIDER_STALL_MS.`,
          retryable: true,
        },
      });
    }, this.providerStallMs);
    session.stallTimer.unref();
  }

  private clearStallTimer(session: RuntimeSession): void {
    session.stallGeneration += 1;
    if (session.stallTimer) clearTimeout(session.stallTimer);
    session.stallTimer = undefined;
  }

  private runDetachedCommand(session: RuntimeSession, operation: PromiseLike<unknown>, command: string, onSuccess?: () => Promise<void>): void {
    void Promise.resolve(operation).then(async () => {
      if (onSuccess) await onSuccess();
      if (session.dto.status !== 'busy') return;
      session.dto.status = 'idle';
      this.clearStallTimer(session);
      this.touch(session);
      this.emit(session, { type: 'session.status', properties: { status: { type: 'idle' } } });
      this.validatePendingWorkspace(session);
    }).catch(error => {
      const normalized = normalizeOpenCodeError(error);
      session.dto.status = 'error';
      this.clearStallTimer(session);
      this.emit(session, {
        type: 'runner.error',
        properties: {
          code: normalized.code,
          message: `/${command} failed: ${normalized.message}`,
          retryable: normalized.retryable,
        },
      });
    });
  }
}
