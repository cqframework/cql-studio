// Author: Preston Lee

import { CqlEnvironment } from './environment.model';
import { ActiveEnvironmentSource, AiProviderType } from './settings.model';

export interface OpenCodeProviderConfig {
  type: AiProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

export interface OpenCodeEnvironmentBinding {
  key: string;
  source: ActiveEnvironmentSource;
  environmentId: string;
  workspaceId?: string;
  label: string;
  configurationFingerprint: string;
}

export interface OpenCodeLibrarySnapshot {
  id: string;
  name: string;
  version?: string;
  canonicalUrl?: string;
  cqlContent: string;
  originalContent?: string;
  fhirVersionId?: string;
}

export interface CreateOpenCodeSessionRequest {
  title?: string;
  provider?: OpenCodeProviderConfig;
  providers?: OpenCodeProviderConfig[];
  /** @deprecated retained for older clients and persisted sessions. */
  ollamaBaseUrl: string;
  /** @deprecated retained for older clients and persisted sessions. */
  ollamaModel: string;
  activeLibrary: OpenCodeLibrarySnapshot;
  dependencies: OpenCodeLibrarySnapshot[];
  /** Sent to CQL Studio Server only. It is never written into the runner workspace. */
  environment: CqlEnvironment;
  /** Secrets stay in server memory; the runner receives only an opaque capability. */
  toolContext: {
    vsacFhirBaseUrl: string;
    vsacApiUsername: string;
    vsacApiPassword: string;
    searxngBaseUrl: string;
  };
}

export interface OpenCodeSession {
  id: string;
  openCodeSessionId: string;
  title: string;
  status: 'starting' | 'idle' | 'busy' | 'error';
  activeLibraryId: string;
  activeFile: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  model: string;
  reasoningEnabled: boolean;
  environmentBinding?: OpenCodeEnvironmentBinding;
}

export interface OpenCodeFileDiff {
  file: string;
  libraryId: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface OpenCodeEditorContext {
  libraryId: string;
  file: string;
  selectedText: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  documentRevision: number;
  mode: 'selection' | 'inline';
}

export interface OpenCodeAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  converted: boolean;
  createdAt: string;
}

export interface OpenCodeLibraryChange {
  libraryId: string;
  cqlContent: string;
  save?: boolean;
  mode?: 'review' | 'live' | 'revert';
  baseRevision?: number;
  onSaveComplete?: (saved: boolean) => void;
}

export interface OpenCodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface OpenCodeEventEnvelope {
  id: number;
  sessionId: string;
  emittedAt: string;
  event: OpenCodeEvent;
}

export interface OpenCodeCommand {
  name: string;
  description: string;
  source: 'web' | 'opencode' | 'cql-studio';
  acceptsArguments: boolean;
}

export interface OpenCodeFileReference {
  path: string;
  name: string;
  writable: boolean;
}

export interface OpenCodeDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface OpenCodeValidation {
  valid: boolean;
  diagnostics: OpenCodeDiagnostic[];
  checkedAt: string;
}

export interface OpenCodeSessionState {
  session: OpenCodeSession;
  messages: unknown[];
  diffs: OpenCodeFileDiff[];
  attachments: OpenCodeAttachment[];
  commands: OpenCodeCommand[];
  validation: OpenCodeValidation | null;
  permissions: OpenCodePermissionRequest[];
  questions: OpenCodeQuestionRequest[];
  lastEventId: number;
}

export interface OpenCodeActivity {
  id: string;
  messageId?: string;
  kind: 'tool' | 'reasoning' | 'step' | 'retry' | 'compaction' | 'validation' | 'repair';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  detail?: string;
  output?: string;
  startedAt?: number;
  endedAt?: number;
  reasoningTokens?: number;
  order: number;
}

export interface OpenCodeApiErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface OpenCodePermissionRequest {
  id: string;
  type: string;
  title: string;
  pattern?: string | string[];
  metadata?: Record<string, unknown>;
}

export interface OpenCodeQuestionRequest {
  id: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
}

export interface OpenCodeUiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  order: number;
}
