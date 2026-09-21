// Author: Preston Lee

import { Injectable, computed, inject, signal } from '@angular/core';
import { IdeContextService } from '../ide-context.service';
import { IdeStateService } from '../ide-state.service';
import { TranslationService } from '../translation.service';
import { LibraryTranslationContextBuilder } from '../library-translation-context.lib';
import { CqlDebugPrefetchService, countResourcesByType } from './cql-debug-prefetch.service';
import {
  createDebugSharedBuffer,
  notifyDebugResume,
  writeDebugBreakpointsToSab,
  type CqlDebugBreakpointSpec,
  type CqlDebugLastValueDto,
  type CqlDebugPauseFrame,
  type CqlDebugStackFrame,
  type CqlDebugStepMode,
  type CqlDebugVariableDto,
} from './cql-debug-breakpoint-handler';
import type {
  CqlDebugExpressionResultDto,
  CqlDebugWorkerInboundMessage,
  CqlDebugWorkerOutboundMessage,
} from './cql-debug-protocol';
import {
  breakpointRejectionReason,
  type CqlDebugExecutableLineMeta,
} from './cql-debug-breakpoint-lines.lib';

type CqlDebugStatus =
  | 'idle'
  | 'prefetching'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

@Injectable({ providedIn: 'root' })
export class CqlDebugService {
  private readonly ideContextService = inject(IdeContextService);
  private readonly ideStateService = inject(IdeStateService);
  private readonly translationService = inject(TranslationService);
  private readonly libraryTranslationContextBuilder = inject(LibraryTranslationContextBuilder);
  private readonly prefetchService = inject(CqlDebugPrefetchService);

  private readonly _isDebugging = signal(false);
  private readonly _status = signal<CqlDebugStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _breakpoints = signal<CqlDebugBreakpointSpec[]>([]);
  private readonly _pausedFrame = signal<CqlDebugPauseFrame | null>(null);
  private readonly _variables = signal<CqlDebugVariableDto[]>([]);
  private readonly _callStack = signal<CqlDebugStackFrame[]>([]);
  private readonly _selectedStackIndex = signal(0);
  private readonly _lastValue = signal<CqlDebugLastValueDto | null>(null);
  private readonly _results = signal<CqlDebugExpressionResultDto[]>([]);
  private readonly _banner = signal(
    "Debugging uses an in-browser CQL execution engine instead of the execution endpoint from your active environment profile."
  );
  private readonly _warnings = signal<string[]>([]);
  private readonly _prefetchResourceCounts = signal<Array<{ type: string; count: number }>>([]);
  private readonly _focusBreakpointId = signal<string | null>(null);
  private readonly _pausedLine = signal<number | null>(null);
  private readonly _breakpointPlacementMessage = signal<string | null>(null);
  private readonly _executableLines = signal<Map<number, CqlDebugExecutableLineMeta> | null>(null);
  private readonly _declarationLines = signal<Set<number> | null>(null);
  private readonly _progressDetail = signal<string | null>(null);
  private readonly _progressElapsedMs = signal(0);

  readonly isDebugging = this._isDebugging.asReadonly();
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly breakpoints = this._breakpoints.asReadonly();
  readonly pausedFrame = this._pausedFrame.asReadonly();
  readonly variables = this._variables.asReadonly();
  readonly callStack = this._callStack.asReadonly();
  readonly selectedStackIndex = this._selectedStackIndex.asReadonly();
  readonly lastValue = this._lastValue.asReadonly();
  readonly results = this._results.asReadonly();
  readonly banner = this._banner.asReadonly();
  readonly warnings = this._warnings.asReadonly();
  readonly prefetchResourceCounts = this._prefetchResourceCounts.asReadonly();
  readonly focusBreakpointId = this._focusBreakpointId.asReadonly();
  readonly pausedLine = this._pausedLine.asReadonly();
  readonly breakpointPlacementMessage = this._breakpointPlacementMessage.asReadonly();
  readonly progressDetail = this._progressDetail.asReadonly();
  readonly progressElapsedMs = this._progressElapsedMs.asReadonly();
  readonly isPaused = computed(() => this._status() === 'paused');

  private worker: Worker | null = null;
  private sab: SharedArrayBuffer | null = null;
  private expressionNames: string[] = [];

  canStartDebug(): boolean {
    return (
      !this._isDebugging() &&
      !this.ideStateService.isExecuting() &&
      !!this.ideStateService.getActiveLibraryResource()?.cqlContent?.trim()
    );
  }

  /**
   * Updates the set of lines that may hold breakpoints (from last successful ELM).
   * Pass null maps only when intentionally clearing; failed validation should omit the call.
   */
  setExecutableBreakpointLines(
    executable: Map<number, CqlDebugExecutableLineMeta>,
    declarationLines: Set<number>
  ): void {
    this._executableLines.set(executable);
    this._declarationLines.set(declarationLines);
    const pruned = this.pruneBreakpointsNotIn(executable);
    if (pruned > 0) {
      this._breakpointPlacementMessage.set(
        `${pruned} breakpoint(s) removed because translation changed.`
      );
      this.ensureInspectorVisible();
    }
  }

  /**
   * @returns true when the breakpoint list changed (accept); false when rejected.
   */
  setBreakpointAtLine(line: number, enabled: boolean): boolean {
    if (!enabled) {
      const existing = this._breakpoints().find(bp => bp.line === line);
      if (!existing) {
        // Accept so a desynced gutter marker can still be cleared.
        this._breakpointPlacementMessage.set(null);
        return true;
      }
      this._breakpoints.update(list => list.filter(bp => bp.id !== existing.id));
      this._breakpointPlacementMessage.set(null);
      this.syncBreakpointsToWorker();
      return true;
    }

    const executable = this._executableLines();
    const reason = breakpointRejectionReason(line, executable, this._declarationLines());
    if (reason) {
      this._breakpointPlacementMessage.set(reason);
      this.ensureInspectorVisible();
      return false;
    }

    const meta = executable!.get(line)!;
    this._breakpoints.update(list => {
      const existing = list.find(bp => bp.line === line);
      if (existing) {
        return list.map(bp =>
          bp.id === existing.id
            ? {
                ...bp,
                enabled: true,
                locator: meta.locator,
                localId: meta.localId,
              }
            : bp
        );
      }
      return [
        ...list,
        {
          id: `bp-${line}-${Date.now()}`,
          line,
          enabled: true,
          condition: null,
          locator: meta.locator,
          localId: meta.localId,
        },
      ];
    });
    this._breakpointPlacementMessage.set(null);
    this.syncBreakpointsToWorker();
    return true;
  }

  focusBreakpointCondition(line: number): boolean {
    let bp = this._breakpoints().find(b => b.line === line);
    if (!bp) {
      if (!this.setBreakpointAtLine(line, true)) {
        return false;
      }
      bp = this._breakpoints().find(b => b.line === line);
    }
    if (bp) {
      this._focusBreakpointId.set(bp.id);
      this.ensureInspectorVisible();
      return true;
    }
    return false;
  }

  updateBreakpointCondition(id: string, condition: string): void {
    this._breakpoints.update(list =>
      list.map(bp => (bp.id === id ? { ...bp, condition } : bp))
    );
    this.syncBreakpointsToWorker();
  }

  setBreakpointEnabled(id: string, enabled: boolean): void {
    this._breakpoints.update(list =>
      list.map(bp => (bp.id === id ? { ...bp, enabled } : bp))
    );
    this.syncBreakpointsToWorker();
  }

  removeBreakpoint(id: string): void {
    this._breakpoints.update(list => list.filter(bp => bp.id !== id));
    this.syncBreakpointsToWorker();
  }

  clearFocusBreakpoint(): void {
    this._focusBreakpointId.set(null);
  }

  ensureInspectorVisible(): void {
    const rightPanel = this.ideStateService.getPanel('right');
    if (!rightPanel) {
      return;
    }
    if (!rightPanel.tabs.some(tab => tab.type === 'inspector')) {
      this.ideStateService.addTabToPanel('right', {
        id: 'inspector-tab',
        title: 'Inspector',
        icon: 'bi-bug',
        type: 'inspector',
        isActive: false,
        isClosable: true,
        component: null,
      });
    }
    this.ideStateService.setActiveTab('right', 'inspector-tab');
    if (!this.ideStateService.getPanel('right')?.isVisible) {
      this.ideStateService.togglePanel('right');
    }
  }

  async startDebug(expressionNames?: string[]): Promise<void> {
    if (!this.canStartDebug()) {
      return;
    }
    const library = this.ideStateService.getActiveLibraryResource();
    if (!library?.cqlContent?.trim()) {
      return;
    }

    this.expressionNames = expressionNames ?? [];
    this._isDebugging.set(true);
    this._status.set('prefetching');
    this._error.set(null);
    this._results.set([]);
    this._prefetchResourceCounts.set([]);
    this._pausedFrame.set(null);
    this._pausedLine.set(null);
    this._callStack.set([]);
    this._selectedStackIndex.set(0);
    this._lastValue.set(null);
    this._variables.set([]);
    this._warnings.set([]);
    this._progressDetail.set('Preparing session…');
    this._progressElapsedMs.set(0);
    this.ideStateService.setExecutionStatus('Preparing debug session...');

    try {
      if (typeof SharedArrayBuffer === 'undefined' || !crossOriginIsolated) {
        throw new Error(
          'Interactive CQL debugging requires cross-origin isolation (SharedArrayBuffer). ' +
            'Serve the app with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.'
        );
      }

      const translation = await this.translationService.translateCqlToElmAsync(
        library.cqlContent,
        this.libraryTranslationContextBuilder.fromLibraryResource(library)
      );

      this._progressDetail.set('Prefetching patient data and ValueSets…');
      this.ideStateService.setExecutionStatus('Prefetching debug snapshot...');

      const subjects = this.ideContextService.getSelectedSubjects();
      const subjectId = subjects[0]?.id ?? null;
      const usesPatientContext = /\bcontext\s+Patient\b/i.test(library.cqlContent);
      if (usesPatientContext && !subjectId) {
        this._warnings.update(list => [
          ...list,
          'No Patient subject selected — Patient-context expressions will likely fail or return empty.',
        ]);
      }

      const payload = await this.prefetchService.buildStartPayload({
        libraryName: library.name || library.id || 'Library',
        libraryVersion: library.version ?? '0.0.1',
        cql: library.cqlContent,
        subjectId,
        expressionNames: this.expressionNames,
        breakpoints: this._breakpoints(),
        elmXml: translation.elmXml,
      });

      const typeCounts = countResourcesByType(payload.bundle);
      this._prefetchResourceCounts.set(
        Object.entries(typeCounts)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => a.type.localeCompare(b.type))
      );
      if (!payload.bundle?.entry?.length) {
        this._warnings.update(list => [
          ...list,
          'Prefetch snapshot has no resources — retrieves will be empty.',
        ]);
      } else {
        const clinical = Object.keys(typeCounts).filter(t => t !== 'Patient');
        if (clinical.length === 0 && usesPatientContext) {
          this._warnings.update(list => [
            ...list,
            'Patient/$everything returned Patient only (no clinical resources). Retrieves may be empty.',
          ]);
        }
      }

      const emptyValueSets = payload.valueSetExpansions.filter(vs => vs.codes.length === 0);
      if (emptyValueSets.length > 0) {
        this._warnings.update(list => [
          ...list,
          `${emptyValueSets.length} ValueSet expansion(s) are empty — code filters may drop all rows.`,
        ]);
      }

      this.ensureWorker();
      this.sab = createDebugSharedBuffer();
      writeDebugBreakpointsToSab(this.sab, this._breakpoints());
      this._status.set('running');
      this._progressDetail.set('Starting in-browser engine…');
      this.ideStateService.setExecutionStatus('Debugging (in-browser engine)...');
      this.postToWorker({
        type: 'start',
        requestId: `dbg-${Date.now()}`,
        sab: this.sab,
        payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._error.set(message);
      this._status.set('error');
      this._isDebugging.set(false);
      this.ideStateService.setExecutionStatus('');
      this.ideStateService.addTextOutput('CQL Debug Error', message, 'error');
    }
  }

  resume(): void {
    this.sendCommand('continue');
  }

  stepInto(): void {
    this.sendCommand('stepInto');
  }

  stepOver(): void {
    this.sendCommand('stepOver');
  }

  stepOut(): void {
    this.sendCommand('stepOut');
  }

  selectStackFrame(index: number): void {
    const stack = this._callStack();
    if (index < 0 || index >= stack.length) {
      return;
    }
    this._selectedStackIndex.set(index);
    const frame = stack[index];
    this._variables.set(frame.variables ?? []);
    // Drive editor pause highlight from the selected frame (not only the top pause site).
    this._pausedLine.set(frame.line);
  }

  stop(): void {
    this.sendCommand('stop');
    this.postToWorker({ type: 'stop' });
    this.finishSession('completed');
  }

  abortOnEnvironmentOrLibraryChange(): void {
    if (this._isDebugging()) {
      this.stop();
    }
  }

  private pruneBreakpointsNotIn(executable: Map<number, CqlDebugExecutableLineMeta>): number {
    const before = this._breakpoints();
    const next = before.filter(bp => executable.has(bp.line));
    if (next.length === before.length) {
      return 0;
    }
    this._breakpoints.set(next);
    this.syncBreakpointsToWorker();
    return before.length - next.length;
  }

  private sendCommand(command: CqlDebugStepMode): void {
    if (!this._isDebugging()) {
      return;
    }
    // Publish breakpoints before waking the worker so resume/continue does not
    // re-hit breakpoints removed while paused (postMessage is stalled in Atomics.wait).
    if (this.sab) {
      writeDebugBreakpointsToSab(this.sab, this._breakpoints());
      notifyDebugResume(this.sab, command);
    }
    this.postToWorker({ type: 'command', command });
    if (command !== 'stop') {
      this._status.set('running');
      this._progressDetail.set('Resuming…');
      this._pausedFrame.set(null);
      this._pausedLine.set(null);
      this._callStack.set([]);
      this._selectedStackIndex.set(0);
      // Keep lastValue visible between steps; clear bindings until the next pause.
      this._variables.set([]);
    }
  }

  private syncBreakpointsToWorker(): void {
    if (this.sab) {
      writeDebugBreakpointsToSab(this.sab, this._breakpoints());
    }
    this.postToWorker({ type: 'setBreakpoints', breakpoints: this._breakpoints() });
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }
    this.worker = new Worker(new URL('../../workers/cql-debug.worker', import.meta.url));
    this.worker.onmessage = (event: MessageEvent<CqlDebugWorkerOutboundMessage>) => {
      this.handleWorkerMessage(event.data);
    };
    this.worker.onerror = event => {
      this._error.set(event.message || 'Debug worker error');
      this.finishSession('error');
    };
  }

  private postToWorker(message: CqlDebugWorkerInboundMessage): void {
    this.worker?.postMessage(message);
  }

  private handleWorkerMessage(message: CqlDebugWorkerOutboundMessage): void {
    switch (message.type) {
      case 'progress': {
        this._progressElapsedMs.set(message.elapsedMs);
        const seconds = Math.max(1, Math.round(message.elapsedMs / 1000));
        const phaseLabel =
          message.phase === 'translating' ? 'Translating includes' : 'Evaluating';
        const detail = message.detail ? ` · ${message.detail}` : '';
        const text = `${phaseLabel}${detail} · ${seconds}s`;
        this._progressDetail.set(text);
        this.ideStateService.setExecutionStatus(text);
        break;
      }
      case 'paused':
        this._status.set('paused');
        this._progressDetail.set(null);
        this._pausedFrame.set(message.frame);
        this._callStack.set(message.frame.stack);
        this._selectedStackIndex.set(0);
        this._variables.set(message.frame.stack[0]?.variables ?? message.frame.variables);
        this._lastValue.set(message.frame.lastValue);
        {
          const highlightLine = message.frame.stack[0]?.line ?? message.frame.line;
          this._pausedLine.set(highlightLine);
          if (highlightLine != null) {
            this.ideStateService.requestNavigateToPosition(highlightLine, 0);
          }
        }
        {
          const parts: string[] = [];
          if (message.frame.defineName) {
            parts.push(message.frame.defineName);
          }
          if (message.frame.line != null) {
            parts.push(`line ${message.frame.line}`);
          }
          this.ideStateService.setExecutionStatus(parts.join(' · '));
        }
        break;
      case 'completed':
        this._results.set(message.results);
        this.ideStateService.addTextOutput(
          'CQL Debug Results',
          message.results.map(r => `${r.name} (${r.type}): ${r.value}`).join('\n') ||
            '(no expression results)',
          'success'
        );
        this.finishSession('completed');
        break;
      case 'error':
        this._error.set(message.message);
        this.ideStateService.addTextOutput('CQL Debug Error', message.message, 'error');
        this.finishSession('error');
        break;
      default:
        break;
    }
  }

  private finishSession(status: CqlDebugStatus): void {
    this._status.set(status);
    this._isDebugging.set(false);
    this._pausedFrame.set(null);
    this._pausedLine.set(null);
    this._callStack.set([]);
    this._selectedStackIndex.set(0);
    this._lastValue.set(null);
    this._progressDetail.set(null);
    this._progressElapsedMs.set(0);
    this.ideStateService.setExecutionStatus('');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.sab = null;
  }
}
