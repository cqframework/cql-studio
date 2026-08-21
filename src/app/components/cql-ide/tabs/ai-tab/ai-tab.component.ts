import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MarkdownComponent } from 'ngx-markdown';
import {
  OpenCodeActivity,
  OpenCodeCommand,
  OpenCodeEvent,
  OpenCodeEventEnvelope,
  OpenCodeFileDiff,
  OpenCodeFileReference,
  OpenCodeLibrarySnapshot,
  OpenCodePermissionRequest,
  OpenCodeQuestionRequest,
  OpenCodeSession,
  OpenCodeSessionState,
  OpenCodeUiMessage,
  OpenCodeValidation,
} from '../../../../models/opencode.model';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OpenCodeApiError, OpenCodeService } from '../../../../services/opencode.service';
import { SettingsService } from '../../../../services/settings.service';
import { LibraryResource } from '../../shared/ide-types';

interface OpenCodeLibraryChange {
  libraryId: string;
  cqlContent: string;
  save?: boolean;
}

const WEB_COMMANDS: OpenCodeCommand[] = [
  { name: 'help', description: 'Show supported OpenCode web commands', source: 'web', acceptsArguments: false },
  { name: 'new', description: 'Start a new workspace for the active library', source: 'web', acceptsArguments: false },
  { name: 'sessions', description: 'Open the live session picker', source: 'web', acceptsArguments: false },
  { name: 'details', description: 'Toggle detailed tool input and output', source: 'web', acceptsArguments: false },
  { name: 'thinking', description: 'Toggle display of reasoning content', source: 'web', acceptsArguments: false },
  { name: 'compact', description: 'Compact this OpenCode session', source: 'opencode', acceptsArguments: false },
];

@Component({
  selector: 'app-ai-tab',
  imports: [FormsModule, MarkdownComponent],
  templateUrl: './ai-tab.component.html',
  styleUrls: ['./ai-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiTabComponent implements OnInit, OnDestroy {
  readonly applyLibraryChange = output<OpenCodeLibraryChange>();

  private readonly ideStateService = inject(IdeStateService);
  readonly settingsService = inject(SettingsService);
  private readonly openCodeService = inject(OpenCodeService);
  private readonly messageRoles = new Map<string, 'user' | 'assistant'>();
  private readonly messageParts = new Map<string, Map<string, string>>();
  private readonly activityParts = new Map<string, OpenCodeActivity>();
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastEventId = 0;
  private repairInFlight = false;

  readonly session = signal<OpenCodeSession | null>(null);
  readonly liveSessions = signal<OpenCodeSession[]>([]);
  readonly messages = signal<OpenCodeUiMessage[]>([]);
  readonly activities = signal<OpenCodeActivity[]>([]);
  readonly diffs = signal<OpenCodeFileDiff[]>([]);
  readonly validation = signal<OpenCodeValidation | null>(null);
  readonly permissions = signal<OpenCodePermissionRequest[]>([]);
  readonly questions = signal<OpenCodeQuestionRequest[]>([]);
  readonly questionAnswers = signal<Record<string, string[][]>>({});
  readonly commands = signal<OpenCodeCommand[]>(WEB_COMMANDS);
  readonly fileSuggestions = signal<OpenCodeFileReference[]>([]);
  readonly promptText = signal('');
  readonly agent = signal<'plan' | 'build'>('build');
  readonly status = signal<'idle' | 'starting' | 'busy' | 'error'>('idle');
  readonly error = signal<string | null>(null);
  readonly errorRetryable = signal(false);
  readonly streamConnected = signal(false);
  readonly detailsShown = signal(false);
  readonly reasoningShown = signal(false);
  readonly reasoningEnabled = signal(false);
  readonly showHelp = signal(false);
  readonly showSessions = signal(false);
  readonly repairAttempts = signal(0);

  readonly isAvailable = computed(() => this.openCodeService.isAvailable());
  readonly activeLibrary = computed(() => this.ideStateService.getActiveLibraryResource());
  readonly canStart = computed(() => this.isAvailable() && Boolean(this.activeLibrary()) && this.status() !== 'starting');
  readonly canSend = computed(() => Boolean(this.session()) && this.promptText().trim().length > 0 && this.status() !== 'busy');
  readonly visibleCommands = computed(() => {
    const match = this.promptText().match(/^\/([a-z0-9_-]*)$/i);
    if (!match) return [];
    const query = match[1].toLowerCase();
    return this.commands().filter(command => command.name.toLowerCase().includes(query)).slice(0, 12);
  });
  readonly hasValidationErrors = computed(() => Boolean(this.validation()?.diagnostics.some(item => item.severity === 'error')));
  readonly canApplyAndSave = computed(() => Boolean(this.validation()?.valid));

  ngOnInit(): void {
    setTimeout(() => void this.restoreSession(), 0);
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  async startSession(): Promise<void> {
    const active = this.activeLibrary();
    if (!active) {
      this.error.set('Open or create a CQL library before starting OpenCode.');
      return;
    }
    this.resetConversation();
    this.status.set('starting');
    try {
      const session = await this.openCodeService.createSession({
        title: `${active.name} in CQL Studio`,
        ollamaBaseUrl: this.settingsService.getEffectiveOllamaBaseUrl(),
        ollamaModel: this.settingsService.getEffectiveOllamaModel(),
        activeLibrary: this.snapshot(active),
        dependencies: await this.collectDependencies(active),
        environment: this.settingsService.getActiveEnvironment(),
        toolContext: {
          vsacFhirBaseUrl: this.settingsService.getEffectiveVsacFhirBaseUrl(),
          vsacApiUsername: this.settingsService.getEffectiveVsacApiUsername(),
          vsacApiPassword: this.settingsService.getEffectiveVsacApiPassword(),
          searxngBaseUrl: this.settingsService.getEffectiveSearxngBaseUrl(),
        },
      });
      this.session.set(session);
      this.status.set(session.status === 'error' ? 'error' : 'idle');
      await this.loadCommandsAndFiles();
      this.connectEvents(session.id);
    } catch (error) {
      this.setError(error);
    }
  }

  async attachSession(session: OpenCodeSession): Promise<void> {
    this.showSessions.set(false);
    this.resetConversation();
    this.status.set('starting');
    try {
      const state = await this.openCodeService.getState(session.id);
      this.hydrate(state);
      this.connectEvents(session.id);
    } catch (error) {
      this.setError(error);
    }
  }

  async sendPrompt(): Promise<void> {
    const session = this.session();
    const message = this.promptText().trim();
    if (!session || !message || this.status() === 'busy') return;

    if (message.startsWith('/')) {
      await this.runSlashCommand(message);
      return;
    }
    this.promptText.set('');
    this.fileSuggestions.set([]);
    this.error.set(null);
    this.repairAttempts.set(0);
    this.validation.set(null);
    this.status.set('busy');
    try {
      await this.openCodeService.prompt(
        session.id,
        message,
        this.agent(),
        this.referencesFrom(message),
        this.reasoningEnabled()
      );
    } catch (error) {
      this.setError(error);
    }
  }

  onPromptChanged(value: string): void {
    this.promptText.set(value);
    const match = value.match(/@([A-Za-z0-9._\/-]*)$/);
    const session = this.session();
    if (!match || !session) {
      this.fileSuggestions.set([]);
      return;
    }
    void this.openCodeService.findFiles(session.id, match[1]).then(files => this.fileSuggestions.set(files)).catch(() => {
      this.fileSuggestions.set([]);
    });
  }

  chooseCommand(command: OpenCodeCommand): void {
    this.promptText.set(`/${command.name}${command.acceptsArguments ? ' ' : ''}`);
  }

  chooseFile(file: OpenCodeFileReference): void {
    this.promptText.update(value => value.replace(/@[A-Za-z0-9._\/-]*$/, `@${file.path} `));
    this.fileSuggestions.set([]);
  }

  onPromptKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void this.sendPrompt();
    }
  }

  async stop(): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      await this.openCodeService.abort(session.id);
      this.status.set('idle');
      await this.refreshDiff();
    } catch (error) {
      this.setError(error);
    }
  }

  async refreshDiff(): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      this.diffs.set(await this.openCodeService.getDiff(session.id));
    } catch (error) {
      this.setError(error);
    }
  }

  async refreshValidation(): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      await this.processValidation(await this.openCodeService.validate(session.id));
    } catch (error) {
      this.setError(error);
    }
  }

  async applyAndSave(diff: OpenCodeFileDiff): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      const result = await this.openCodeService.validate(session.id);
      this.validation.set(result);
      if (!result.valid) {
        this.error.set('Apply & save is blocked until all CQL validation errors are fixed.');
        return;
      }
      this.applyLibraryChange.emit({ libraryId: diff.libraryId, cqlContent: diff.after, save: true });
    } catch (error) {
      this.setError(error);
    }
  }

  applyLocally(diff: OpenCodeFileDiff): void {
    this.applyLibraryChange.emit({ libraryId: diff.libraryId, cqlContent: diff.after, save: false });
    this.diffs.update(diffs => diffs.filter(candidate => candidate.file !== diff.file));
  }

  async respondToPermission(permission: OpenCodePermissionRequest, response: 'once' | 'always' | 'reject'): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      await this.openCodeService.respondToPermission(session.id, permission.id, response);
      this.permissions.update(items => items.filter(item => item.id !== permission.id));
    } catch (error) {
      this.setError(error);
    }
  }

  toggleQuestionAnswer(request: OpenCodeQuestionRequest, index: number, label: string, multiple = false): void {
    this.questionAnswers.update(current => {
      const answers = (current[request.id] ?? request.questions.map(() => [])).map(answer => [...answer]);
      if (multiple) {
        answers[index] = answers[index].includes(label)
          ? answers[index].filter(item => item !== label)
          : [...answers[index], label];
      } else {
        answers[index] = [label];
      }
      return { ...current, [request.id]: answers };
    });
  }

  questionOptionSelected(requestId: string, index: number, label: string): boolean {
    return Boolean(this.questionAnswers()[requestId]?.[index]?.includes(label));
  }

  canAnswerQuestion(request: OpenCodeQuestionRequest): boolean {
    const answers = this.questionAnswers()[request.id] ?? [];
    return request.questions.every((_question, index) => Boolean(answers[index]?.length));
  }

  async submitQuestion(request: OpenCodeQuestionRequest): Promise<void> {
    const session = this.session();
    const answers = this.questionAnswers()[request.id];
    if (!session || !answers || !this.canAnswerQuestion(request)) return;
    try {
      await this.openCodeService.answerQuestion(session.id, request.id, answers);
      this.removeQuestion(request.id);
    } catch (error) {
      this.setError(error);
    }
  }

  async rejectQuestion(request: OpenCodeQuestionRequest): Promise<void> {
    const session = this.session();
    if (!session) return;
    try {
      await this.openCodeService.rejectQuestion(session.id, request.id);
      this.removeQuestion(request.id);
    } catch (error) {
      this.setError(error);
    }
  }

  async endSession(): Promise<void> {
    const session = this.session();
    if (!session) return;
    this.eventSource?.close();
    this.eventSource = null;
    try {
      await this.openCodeService.endSession(session.id);
    } catch (error) {
      this.setError(error);
    } finally {
      this.resetConversation();
      this.session.set(null);
      this.status.set('idle');
    }
  }

  async retryConnection(): Promise<void> {
    const session = this.session();
    if (!session) return void this.restoreSession();
    await this.attachSession(session);
  }

  activityDuration(activity: OpenCodeActivity): string {
    if (!activity.startedAt) return '';
    const end = activity.endedAt ?? Date.now();
    return `${Math.max(0, (end - activity.startedAt) / 1000).toFixed(1)}s`;
  }

  private async restoreSession(): Promise<void> {
    if (!this.isAvailable()) return;
    const active = this.activeLibrary();
    try {
      const sessions = await this.openCodeService.listSessions();
      this.liveSessions.set(sessions);
      // The IDE's open-library state is not persisted across a full browser reload.
      // Reattach the newest owned session in that case so the conversation and diff
      // remain recoverable while the user reopens the matching Library.
      const matching = active ? sessions.find(session => session.activeLibraryId === active.id) : sessions[0];
      if (matching) await this.attachSession(matching);
    } catch (error) {
      this.setError(error);
    }
  }

  private async loadCommandsAndFiles(): Promise<void> {
    const session = this.session();
    if (!session) return;
    const [commands] = await Promise.all([
      this.openCodeService.getCommands(session.id),
      this.openCodeService.findFiles(session.id, ''),
    ]);
    const names = new Set(WEB_COMMANDS.map(command => command.name));
    this.commands.set([...WEB_COMMANDS, ...commands.filter(command => !names.has(command.name))]);
  }

  private async runSlashCommand(value: string): Promise<void> {
    const session = this.session();
    if (!session) return;
    const match = value.match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
      this.error.set('Slash command is incomplete.');
      return;
    }
    const [, name, args = ''] = match;
    this.promptText.set('');
    switch (name) {
      case 'help': this.showHelp.update(value => !value); return;
      case 'details': this.detailsShown.update(value => !value); return;
      case 'thinking': this.reasoningShown.update(value => !value); return;
      case 'sessions':
        this.liveSessions.set(await this.openCodeService.listSessions());
        this.showSessions.set(true);
        return;
      case 'new':
        this.eventSource?.close();
        await this.startSession();
        return;
      default:
        this.error.set(null);
        this.repairAttempts.set(0);
        this.validation.set(null);
        this.status.set('busy');
        try {
          await this.openCodeService.executeCommand(session.id, name, args, this.reasoningEnabled());
        } catch (error) {
          this.setError(error);
        }
    }
  }

  private connectEvents(sessionId: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.eventSource?.close();
    this.eventSource = this.openCodeService.events(
      sessionId,
      envelope => this.handleEnvelope(envelope),
      () => {
        this.streamConnected.set(false);
        this.eventSource?.close();
        this.scheduleReconnect(sessionId);
      },
      () => {
        this.streamConnected.set(true);
        this.errorRetryable.set(false);
        this.reconnectAttempts = 0;
      },
      this.lastEventId
    );
  }

  private scheduleReconnect(sessionId: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(30_000, 1_000 * (2 ** this.reconnectAttempts++));
    this.reconnectTimer = setTimeout(() => void this.reconnectSession(sessionId), delay);
  }

  private async reconnectSession(sessionId: string): Promise<void> {
    if (this.session()?.id !== sessionId) return;
    try {
      this.hydrate(await this.openCodeService.getState(sessionId));
      this.connectEvents(sessionId);
    } catch (error) {
      if (error instanceof OpenCodeApiError && ['SESSION_NOT_FOUND', 'SESSION_EXPIRED'].includes(error.code)) {
        this.resetConversation();
        this.session.set(null);
        this.status.set('idle');
        this.error.set('The OpenCode session ended. Start a new session to continue.');
        return;
      }
      this.errorRetryable.set(true);
      this.scheduleReconnect(sessionId);
    }
  }

  private handleEnvelope(envelope: OpenCodeEventEnvelope): void {
    this.lastEventId = Math.max(this.lastEventId, envelope.id);
    this.streamConnected.set(true);
    this.handleEvent(envelope.event);
  }

  private handleEvent(event: OpenCodeEvent): void {
    if (event.type === 'message.updated') {
      const info = event.properties['info'] as Record<string, unknown> | undefined;
      this.ingestMessageInfo(info);
      return;
    }
    if (event.type === 'message.part.updated') {
      this.ingestPart(event.properties['part'] as Record<string, unknown> | undefined);
      return;
    }
    if (event.type === 'permission.updated' || event.type === 'permission.asked') {
      const raw = event.properties as Record<string, unknown>;
      const id = String(raw['id'] ?? raw['requestID'] ?? '');
      if (id) this.permissions.update(items => [...items.filter(item => item.id !== id), { ...raw, id } as unknown as OpenCodePermissionRequest]);
      return;
    }
    if (event.type === 'permission.replied') {
      const permissionId = event.properties['permissionID'] ?? event.properties['requestID'];
      if (typeof permissionId === 'string') this.permissions.update(items => items.filter(item => item.id !== permissionId));
      return;
    }
    if (event.type === 'question.asked') {
      const raw = event.properties as unknown as OpenCodeQuestionRequest;
      if (raw.id) this.questions.update(items => [...items.filter(item => item.id !== raw.id), raw]);
      return;
    }
    if (event.type === 'question.replied' || event.type === 'question.rejected') {
      const requestId = event.properties['requestID'];
      if (typeof requestId === 'string') this.removeQuestion(requestId);
      return;
    }
    if (event.type === 'session.status') {
      const sessionStatus = event.properties['status'] as { type?: string } | undefined;
      this.status.set(sessionStatus?.type === 'busy' ? 'busy' : 'idle');
      return;
    }
    if (event.type === 'session.idle') {
      this.status.set('idle');
      this.repairInFlight = false;
      void this.refreshDiff();
      return;
    }
    if (event.type === 'cql.validation.updated') {
      void this.processValidation(event.properties as unknown as OpenCodeValidation);
      return;
    }
    if (event.type === 'cql.validation.error') {
      this.activities.update(items => [...items, {
        id: `validation-error-${Date.now()}`,
        kind: 'validation', title: 'CQL validation unavailable', status: 'error',
        detail: String(event.properties['message'] ?? 'Validation failed'),
      }]);
      return;
    }
    if (event.type === 'session.error' || event.type === 'runner.error') {
      this.status.set('error');
      const message = event.properties['message'];
      this.error.set(typeof message === 'string' ? message : 'The OpenCode session failed.');
      this.errorRetryable.set(true);
    }
  }

  private ingestMessageInfo(info?: Record<string, unknown>): void {
    const id = typeof info?.['id'] === 'string' ? info['id'] : null;
    const role = info?.['role'];
    if (!id || (role !== 'user' && role !== 'assistant')) return;
    this.messageRoles.set(id, role);
    const messageError = info?.['error'] as { data?: { message?: string } } | undefined;
    if (messageError?.data?.message) this.error.set(messageError.data.message);
    this.rebuildMessages();
  }

  private ingestPart(part?: Record<string, any>): void {
    if (!part) return;
    const messageId = typeof part['messageID'] === 'string' ? part['messageID'] : undefined;
    const partId = typeof part['id'] === 'string' ? part['id'] : `${part['type']}-${Date.now()}`;
    if (part['type'] === 'text' && messageId) {
      const parts = this.messageParts.get(messageId) ?? new Map<string, string>();
      parts.set(partId, typeof part['text'] === 'string' ? part['text'] : '');
      this.messageParts.set(messageId, parts);
      this.rebuildMessages();
      return;
    }
    if (part['type'] === 'reasoning') {
      this.activityParts.set(partId, {
        id: partId, messageId, kind: 'reasoning', title: part['time']?.end ? 'Reasoning completed' : 'Reasoning…',
        status: part['time']?.end ? 'completed' : 'running', detail: String(part['text'] ?? ''),
        startedAt: part['time']?.start, endedAt: part['time']?.end,
      });
    } else if (part['type'] === 'tool') {
      const state = part['state'] ?? {};
      this.activityParts.set(partId, {
        id: partId, messageId, kind: 'tool', title: state.title || part['tool'] || 'Tool',
        status: state.status || 'pending',
        detail: this.safeJson(state.input), output: state.output || state.error,
        startedAt: state.time?.start, endedAt: state.time?.end,
      });
    } else if (part['type'] === 'step-finish') {
      this.activityParts.set(partId, {
        id: partId, messageId, kind: 'step', title: 'Step completed', status: 'completed',
        detail: `${part['tokens']?.input ?? 0} input · ${part['tokens']?.output ?? 0} output`,
        reasoningTokens: part['tokens']?.reasoning,
      });
    } else if (part['type'] === 'retry') {
      this.activityParts.set(partId, { id: partId, messageId, kind: 'retry', title: 'OpenCode retrying', status: 'running', detail: this.safeJson(part['error']) });
    } else if (part['type'] === 'compaction') {
      this.activityParts.set(partId, { id: partId, messageId, kind: 'compaction', title: 'Session compacted', status: 'completed' });
    }
    this.activities.set([...this.activityParts.values()]);
  }

  private async processValidation(validation: OpenCodeValidation): Promise<void> {
    this.validation.set(validation);
    await this.refreshDiff();
    this.activities.update(items => [
      ...items.filter(item => item.id !== 'current-validation'),
      {
        id: 'current-validation', kind: 'validation',
        title: validation.valid ? 'CQL validation passed' : 'CQL validation failed',
        status: validation.valid ? 'completed' : 'error',
        detail: `${validation.diagnostics.filter(item => item.severity === 'error').length} errors · ${validation.diagnostics.filter(item => item.severity === 'warning').length} warnings`,
      },
    ]);
    if (validation.valid || this.diffs().length === 0 || this.repairInFlight || this.repairAttempts() >= 2) return;
    const session = this.session();
    if (!session) return;
    const attempt = this.repairAttempts() + 1;
    this.repairAttempts.set(attempt);
    this.repairInFlight = true;
    this.activities.update(items => [...items, {
      id: `repair-${attempt}`, kind: 'repair', title: `Automatic CQL repair ${attempt}/2`, status: 'running',
      detail: 'OpenCode is repairing compiler errors before changes can be saved.',
    }]);
    const diagnostics = validation.diagnostics.filter(item => item.severity === 'error')
      .map(item => `${item.file ?? ''}:${item.line ?? '?'}:${item.column ?? '?'} ${item.message}`).join('\n');
    this.status.set('busy');
    try {
      await this.openCodeService.prompt(
        session.id,
        `The proposed CQL failed validation. Repair only these errors while preserving the user's intent. This is automatic repair attempt ${attempt} of 2.\n\n${diagnostics}`,
        'build',
        [session.activeFile],
        this.reasoningEnabled()
      );
    } catch (error) {
      this.repairInFlight = false;
      this.setError(error);
    }
  }

  private hydrate(state: OpenCodeSessionState): void {
    this.session.set(state.session);
    this.status.set(state.session.status);
    this.reasoningEnabled.set(state.session.reasoningEnabled);
    this.diffs.set(state.diffs);
    this.validation.set(state.validation);
    this.permissions.set(state.permissions ?? []);
    this.questions.set(state.questions ?? []);
    this.lastEventId = state.lastEventId ?? 0;
    this.commands.set([...WEB_COMMANDS, ...state.commands.filter(command => !WEB_COMMANDS.some(local => local.name === command.name))]);
    for (const raw of state.messages as Array<Record<string, any>>) {
      this.ingestMessageInfo(raw['info']);
      for (const part of raw['parts'] ?? []) this.ingestPart(part);
    }
  }

  private rebuildMessages(): void {
    const messages: OpenCodeUiMessage[] = [];
    for (const [id, role] of this.messageRoles) {
      const text = [...(this.messageParts.get(id)?.values() ?? [])].join('\n');
      if (text.trim()) messages.push({ id, role, text });
    }
    this.messages.set(messages);
  }

  private referencesFrom(message: string): string[] {
    return [...message.matchAll(/@((?:libraries|dependencies)\/[A-Za-z0-9._-]+\.cql)\b/g)].map(match => match[1]);
  }

  private resetConversation(): void {
    this.eventSource?.close();
    this.eventSource = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.lastEventId = 0;
    this.messages.set([]);
    this.activities.set([]);
    this.diffs.set([]);
    this.validation.set(null);
    this.permissions.set([]);
    this.questions.set([]);
    this.questionAnswers.set({});
    this.promptText.set('');
    this.fileSuggestions.set([]);
    this.messageRoles.clear();
    this.messageParts.clear();
    this.activityParts.clear();
    this.error.set(null);
    this.errorRetryable.set(false);
    this.streamConnected.set(false);
    this.repairAttempts.set(0);
    this.repairInFlight = false;
  }

  private removeQuestion(requestId: string): void {
    this.questions.update(items => items.filter(item => item.id !== requestId));
    this.questionAnswers.update(current => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
  }

  private snapshot(library: LibraryResource): OpenCodeLibrarySnapshot {
    return {
      id: library.id,
      name: library.name || library.id,
      version: library.version,
      canonicalUrl: library.url,
      cqlContent: library.cqlContent,
      originalContent: library.originalContent,
      fhirVersionId: library.library?.meta?.versionId,
    };
  }

  private async collectDependencies(active: LibraryResource): Promise<OpenCodeLibrarySnapshot[]> {
    const openLibraries = this.ideStateService.libraryResources();
    const byName = new Map(openLibraries.map(library => [library.name.toLowerCase(), library]));
    const selected = new Map<string, OpenCodeLibrarySnapshot>();
    const pending = [active.cqlContent];
    while (pending.length > 0) {
      for (const includeName of this.includeNames(pending.shift() ?? '')) {
        const dependency = byName.get(includeName.toLowerCase());
        if (!dependency || dependency.id === active.id || selected.has(dependency.id)) continue;
        selected.set(dependency.id, this.snapshot(dependency));
        pending.push(dependency.cqlContent);
      }
    }
    const needsFhirHelpers = this.includeNames(active.cqlContent).some(name => name.toLowerCase() === 'fhirhelpers');
    const hasFhirHelpers = [...selected.values()].some(dependency => dependency.name.toLowerCase() === 'fhirhelpers');
    if (needsFhirHelpers && !hasFhirHelpers) {
      try {
        const response = await fetch('/cql/FHIRHelpers-4.0.1.cql');
        if (response.ok) selected.set('FHIRHelpers', { id: 'FHIRHelpers', name: 'FHIRHelpers', version: '4.0.1', cqlContent: await response.text() });
      } catch {
        // Validation will report a missing dependency if the bundled helper is unavailable.
      }
    }
    return [...selected.values()];
  }

  private includeNames(content: string): string[] {
    return [...content.matchAll(/^\s*include\s+([A-Za-z][A-Za-z0-9_]*)\b/gim)].map(match => match[1]);
  }

  private safeJson(value: unknown): string | undefined {
    if (value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)) return undefined;
    try { return JSON.stringify(value, null, 2).slice(0, 4_000); } catch { return String(value); }
  }

  private setError(error: unknown): void {
    this.status.set('error');
    this.error.set(error instanceof Error ? error.message : String(error));
    this.errorRetryable.set(error instanceof OpenCodeApiError && error.retryable);
  }
}
