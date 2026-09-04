// Author: Preston Lee

import type { WorkspaceRole } from './workspace.js';

export interface OpenCodeWorkspaceOrigin {
  workspaceId: string;
  workspaceName: string;
  resourceReferenceId: string;
  role?: WorkspaceRole | null;
}

export interface OpenCodeLibraryInput {
  id: string;
  name: string;
  version?: string;
  canonicalUrl?: string;
  cqlContent: string;
  originalContent?: string;
  fhirVersionId?: string;
  workspaceOrigin?: OpenCodeWorkspaceOrigin;
}

export interface OpenCodeDependencyInput extends OpenCodeLibraryInput {
  system?: string;
}

export type OpenCodeProviderType = 'ollama' | 'openai' | 'openai-compatible';

export interface OpenCodeProviderConfig {
  type: OpenCodeProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

export interface CreateOpenCodeSessionRequest {
  title?: string;
  provider?: OpenCodeProviderConfig;
  providers?: OpenCodeProviderConfig[];
  /** @deprecated retained for clients from before provider selection. */
  ollamaBaseUrl: string;
  /** @deprecated retained for clients from before provider selection. */
  ollamaModel: string;
  /** Writable open CQL editor snapshots (0..n). Prefer this over activeLibrary. */
  libraries?: OpenCodeLibraryInput[];
  /**
   * @deprecated Single-library clients. When `libraries` is absent, gateway/runner
   * wrap this as a one-element `libraries` array.
   */
  activeLibrary?: OpenCodeLibraryInput;
  dependencies?: OpenCodeDependencyInput[];
  focusedLibraryId?: string;
  /** Browser-provided endpoint context retained only in gateway memory. */
  environment?: unknown;
  /** Browser-provided tool credentials retained only in gateway memory. */
  toolContext?: {
    vsacFhirBaseUrl?: string;
    vsacApiUsername?: string;
    vsacApiPassword?: string;
    searxngBaseUrl?: string;
  };
  /** Injected by the trusted gateway. Never accepted from the browser verbatim. */
  toolBridge?: {
    baseUrl: string;
    capability: string;
  };
  /** Injected only by the trusted gateway when an archived session is resumed. */
  resume?: {
    sessionId: string;
    createdAt: string;
    messages: unknown[];
  };
}

export type ResumeOpenCodeSessionRequest = Omit<CreateOpenCodeSessionRequest, 'resume' | 'toolBridge'>;

export interface OpenCodeModelSwitchRequest {
  provider: OpenCodeProviderConfig;
  model: string;
}

export interface OpenCodePromptRequest {
  message: string;
  agent?: 'plan' | 'build';
  references?: string[];
  attachments?: string[];
  reasoning?: boolean;
  editorContext?: OpenCodeEditorContext;
  /** Current diagnostics shown in the IDE Problems tab for the synchronized document. */
  ideDiagnostics?: OpenCodeIdeDiagnosticsContext;
}

export interface OpenCodeIdeDiagnosticsContext {
  libraryId: string;
  documentRevision: number;
  diagnostics: OpenCodeDiagnosticDto[];
}

export interface OpenCodeAttachmentUploadRequest {
  name: string;
  mimeType?: string;
  data: string;
}

export interface OpenCodeAttachmentDto {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  converted: boolean;
  createdAt: string;
}

export interface OpenCodeEditorContext {
  libraryId?: string;
  file: string;
  selectedText: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  documentRevision: number;
  mode: 'selection' | 'inline';
}

/** @deprecated Prefer OpenCodeWorkspaceSyncRequest for multi-library sessions. */
export interface OpenCodeActiveFileSyncRequest {
  content: string;
  documentRevision: number;
  libraryId?: string;
}

export interface OpenCodeWorkspaceSyncRequest {
  libraries: OpenCodeLibraryInput[];
  dependencies?: OpenCodeDependencyInput[];
  focusedLibraryId?: string;
  revisions?: Record<string, number>;
}

export interface OpenCodeIdeActionAckRequest {
  ok: boolean;
  libraryId?: string;
  name?: string;
  file?: string;
  error?: string;
}

export interface OpenCodeWorkspaceManifestEntry {
  libraryId: string;
  name: string;
  version?: string;
  canonicalUrl?: string;
  fhirVersionId?: string;
  sourceHash: string;
  draft: boolean;
  writable: boolean;
}

export interface OpenCodeWorkspaceManifest {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  /** Focused library id when one exists; empty string when the session has no writables. */
  activeLibraryId: string;
  files: Record<string, OpenCodeWorkspaceManifestEntry>;
}

export interface OpenCodeSessionDto {
  id: string;
  openCodeSessionId: string;
  title: string;
  status: 'starting' | 'idle' | 'busy' | 'error';
  /** Focused writable library id, when any. */
  activeLibraryId?: string;
  /** Focused writable relative path, when any. */
  activeFile?: string;
  /** Writable library ids currently in the runner workspace. */
  libraryIds: string[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  model: string;
  reasoningEnabled: boolean;
  /** Live sessions can accept prompts; archived sessions retain server-backed history only. */
  availability?: 'live' | 'archived';
  workspaceOrigin?: OpenCodeWorkspaceOrigin;
}

export interface OpenCodeFileDiffDto {
  file: string;
  libraryId: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface OpenCodeCommandDto {
  name: string;
  description: string;
  source: 'web' | 'opencode' | 'cql-studio';
  acceptsArguments: boolean;
}

export interface OpenCodeFileReferenceDto {
  path: string;
  name: string;
  writable: boolean;
}

export interface OpenCodeDiagnosticDto {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface OpenCodeValidationDto {
  valid: boolean;
  diagnostics: OpenCodeDiagnosticDto[];
  checkedAt: string;
}

export interface OpenCodePermissionRequestDto {
  id: string;
  type: string;
  title: string;
  pattern?: string | string[];
  metadata?: Record<string, unknown>;
}

export interface OpenCodeQuestionRequestDto {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
}

export interface OpenCodeSessionStateDto {
  session: OpenCodeSessionDto;
  messages: unknown[];
  diffs: OpenCodeFileDiffDto[];
  attachments: OpenCodeAttachmentDto[];
  commands: OpenCodeCommandDto[];
  validation: OpenCodeValidationDto | null;
  permissions: OpenCodePermissionRequestDto[];
  questions: OpenCodeQuestionRequestDto[];
  lastEventId: number;
}

export interface OpenCodeEventEnvelope {
  id: number;
  sessionId: string;
  emittedAt: string;
  event: { type: string; properties: Record<string, unknown> };
}

export interface OpenCodeErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export type OpenCodePermissionResponse = 'once' | 'always' | 'reject';

/** Normalize create/resume payloads that still send a single activeLibrary. */
export function normalizeOpenCodeLibraries(input: {
  libraries?: OpenCodeLibraryInput[];
  activeLibrary?: OpenCodeLibraryInput;
}): OpenCodeLibraryInput[] {
  if (Array.isArray(input.libraries)) {
    return input.libraries;
  }
  if (input.activeLibrary?.id) {
    return [input.activeLibrary];
  }
  return [];
}

export function openCodeSessionLibraryIdsFromState(
  state: unknown,
  fallbackActiveLibraryId?: string | null
): string[] {
  if (state && typeof state === 'object') {
    const session = (state as { session?: { libraryIds?: unknown; activeLibraryId?: unknown } }).session;
    if (session && Array.isArray(session.libraryIds)) {
      return session.libraryIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }
    if (typeof session?.activeLibraryId === 'string' && session.activeLibraryId) {
      return [session.activeLibraryId];
    }
  }
  if (fallbackActiveLibraryId) {
    return [fallbackActiveLibraryId];
  }
  return [];
}
