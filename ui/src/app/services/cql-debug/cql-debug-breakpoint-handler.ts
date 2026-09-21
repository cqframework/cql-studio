// Author: Preston Lee

import {
  CqlDebugHandlerMethods,
  createPauseActionSentinel,
} from './cql-debug-engine-api';
import { debugValueToDto, compactDebugValue } from './cql-debug-value-dto';

export type CqlDebugStepMode = 'continue' | 'stepInto' | 'stepOver' | 'stepOut' | 'stop';

export interface CqlDebugStackFrame {
  defineName: string | null;
  libraryName: string | null;
  line: number | null;
  column: number | null;
  locator: string | null;
  localId: string | null;
}

export interface CqlDebugLastValueDto {
  defineName: string | null;
  line: number | null;
  type: string;
  value: string;
  /** True when `value` is FHIR resource JSON (object or array) from the prefetch snapshot. */
  fhir?: boolean;
}

export interface CqlDebugPauseFrame {
  locator: string | null;
  localId: string | null;
  libraryName: string | null;
  defineName: string | null;
  line: number | null;
  column: number | null;
  stackDepth: number;
  stack: CqlDebugStackFrame[];
  variables: CqlDebugVariableDto[];
  lastValue: CqlDebugLastValueDto | null;
}

export interface CqlDebugVariableDto {
  name: string;
  type: string;
  value: string;
  /** True when `value` is FHIR resource JSON (object or array) from the prefetch snapshot. */
  fhir?: boolean;
}

export interface CqlDebugBreakpointSpec {
  id: string;
  line: number;
  enabled: boolean;
  condition?: string | null;
  localId?: string | null;
  locator?: string | null;
}

interface CqlDebugBreakpointHandlerOptions {
  sab: SharedArrayBuffer;
  /** Index 0 = wait flag (0 wait, 1 resume). Index 1 = step mode enum. */
  onPause: (frame: CqlDebugPauseFrame) => void;
  getBreakpoints: () => CqlDebugBreakpointSpec[];
  getStepMode: () => CqlDebugStepMode;
  setStepMode: (mode: CqlDebugStepMode) => void;
  shouldAbort: () => boolean;
  serializeVariables: (state: unknown) => CqlDebugVariableDto[];
  resolveDefineName?: (state: unknown) => string | null;
  resolveLibraryName?: (state: unknown) => string | null;
  /** Optional heartbeat while the engine is evaluating (not paused). */
  onProgress?: (info: { expressionCount: number; defineName: string | null }) => void;
}

const WAIT_INDEX = 0;
const MODE_INDEX = 1;

export const CqlDebugSabMode = {
  continue: 0,
  stepInto: 1,
  stepOver: 2,
  stepOut: 3,
  stop: 4,
} as const;

export function createDebugSharedBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(8);
}

export function notifyDebugResume(sab: SharedArrayBuffer, mode: CqlDebugStepMode): void {
  const view = new Int32Array(sab);
  view[MODE_INDEX] =
    mode === 'stepInto'
      ? CqlDebugSabMode.stepInto
      : mode === 'stepOver'
        ? CqlDebugSabMode.stepOver
        : mode === 'stepOut'
          ? CqlDebugSabMode.stepOut
          : mode === 'stop'
            ? CqlDebugSabMode.stop
            : CqlDebugSabMode.continue;
  Atomics.store(view, WAIT_INDEX, 1);
  Atomics.notify(view, WAIT_INDEX, 1);
}

export function modeFromSab(view: Int32Array): CqlDebugStepMode {
  switch (view[MODE_INDEX]) {
    case CqlDebugSabMode.stepInto:
      return 'stepInto';
    case CqlDebugSabMode.stepOver:
      return 'stepOver';
    case CqlDebugSabMode.stepOut:
      return 'stepOut';
    case CqlDebugSabMode.stop:
      return 'stop';
    default:
      return 'continue';
  }
}

function parseLocator(locator: string | null | undefined): { line: number | null; column: number | null } {
  if (!locator) {
    return { line: null, column: null };
  }
  const match = /^(\d+):(\d+)/.exec(locator.trim());
  if (!match) {
    return { line: null, column: null };
  }
  return { line: Number(match[1]), column: Number(match[2]) };
}

function readElmMeta(elm: unknown): { locator: string | null; localId: string | null } {
  if (!elm || typeof elm !== 'object') {
    return { locator: null, localId: null };
  }
  const record = elm as { locator?: string | null; localId?: string | null };
  return {
    locator: record.locator ?? null,
    localId: record.localId ?? null,
  };
}

function evaluateSimpleCondition(
  condition: string | null | undefined,
  variables: CqlDebugVariableDto[]
): boolean {
  if (!condition?.trim()) {
    return true;
  }
  const trimmed = condition.trim();
  const match = /^([A-Za-z_][\w]*)\s*(==|!=|=)\s*(.+)$/.exec(trimmed);
  if (!match) {
    return true;
  }
  const [, name, op, rawRight] = match;
  const variable = variables.find(v => v.name === name);
  if (!variable) {
    return false;
  }
  const right = rawRight.trim().replace(/^['"]|['"]$/g, '');
  const left = variable.value;
  if (op === '!=') {
    return left !== right;
  }
  return left === right;
}

function readDefineName(elm: unknown): string | null {
  if (!elm || typeof elm !== 'object') {
    return null;
  }
  const record = elm as { name?: string | null; getName?: () => string | null };
  if (typeof record.name === 'string' && record.name.trim()) {
    return record.name;
  }
  if (typeof record.getName === 'function') {
    try {
      const name = record.getName();
      return typeof name === 'string' && name.trim() ? name : null;
    } catch {
      return null;
    }
  }
  return null;
}

function buildStackFrame(
  elm: unknown,
  callSite: unknown,
  libraryName: string | null
): CqlDebugStackFrame {
  const meta = readElmMeta(elm);
  const loc = parseLocator(meta.locator);
  const callMeta = readElmMeta(callSite);
  const callLoc = parseLocator(callMeta.locator);
  return {
    defineName: readDefineName(elm),
    libraryName,
    line: callLoc.line ?? loc.line,
    column: callLoc.column ?? loc.column,
    locator: callMeta.locator ?? meta.locator,
    localId: meta.localId,
  };
}

/**
 * Builds a BreakpointHandler-compatible object for @cqframework/cql@5.3.0.
 */
/**
 * Match a breakpoint to an ELM node. Prefer exact locator / localId so line numbers in
 * included libraries (e.g. BMI under OpenCVDRisk) do not collide with the root editor.
 */
export function breakpointMatchesElm(
  bp: CqlDebugBreakpointSpec,
  meta: { locator: string | null; localId: string | null },
  line: number | null
): boolean {
  if (bp.locator && meta.locator) {
    return bp.locator === meta.locator;
  }
  if (bp.localId && meta.localId) {
    return bp.localId === meta.localId;
  }
  return line != null && bp.line === line;
}

export function createCqlDebugBreakpointHandler(options: CqlDebugBreakpointHandlerOptions): object {
  const view = new Int32Array(options.sab);
  const callStack: CqlDebugStackFrame[] = [];
  let stepOverDepth: number | null = null;
  let stepOutDepth: number | null = null;
  let lastValue: CqlDebugLastValueDto | null = null;
  let expressionCount = 0;
  let lastProgressAt = 0;

  const pauseSentinel = createPauseActionSentinel();

  const stackDepth = (): number => callStack.length;

  const hasEnabledBreakpoints = (): boolean =>
    options.getBreakpoints().some(bp => bp.enabled);

  const waitForResume = (): void => {
    Atomics.store(view, WAIT_INDEX, 0);
    Atomics.wait(view, WAIT_INDEX, 0);
    const mode = modeFromSab(view);
    options.setStepMode(mode);
    if (mode === 'stepOver') {
      stepOverDepth = stackDepth();
      stepOutDepth = null;
    } else if (mode === 'stepOut') {
      if (stackDepth() === 0) {
        // Depth 0: behave like continue.
        options.setStepMode('continue');
        stepOverDepth = null;
        stepOutDepth = null;
      } else {
        stepOutDepth = stackDepth();
        stepOverDepth = null;
      }
    } else if (mode === 'stepInto' || mode === 'continue') {
      stepOverDepth = null;
      stepOutDepth = null;
    }
  };

  /** Cheap pause decision — no variable walk. */
  const pauseReasonWithoutVariables = (
    elm: unknown
  ): 'abort' | 'step' | 'breakpoint' | 'breakpoint-condition' | null => {
    if (options.shouldAbort() || options.getStepMode() === 'stop') {
      return 'abort';
    }
    const mode = options.getStepMode();
    if (mode === 'stepInto') {
      return 'step';
    }
    if (mode === 'stepOver' && stepOverDepth != null && stackDepth() <= stepOverDepth) {
      return 'step';
    }
    if (mode === 'stepOut' && stepOutDepth != null && stackDepth() < stepOutDepth) {
      return 'step';
    }
    const meta = readElmMeta(elm);
    const { line } = parseLocator(meta.locator);
    let conditionalHit = false;
    for (const bp of options.getBreakpoints()) {
      if (!bp.enabled || !breakpointMatchesElm(bp, meta, line)) {
        continue;
      }
      if (bp.condition?.trim()) {
        conditionalHit = true;
        continue;
      }
      return 'breakpoint';
    }
    return conditionalHit ? 'breakpoint-condition' : null;
  };

  const conditionalBreakpointHits = (
    elm: unknown,
    variables: CqlDebugVariableDto[]
  ): boolean => {
    const meta = readElmMeta(elm);
    const { line } = parseLocator(meta.locator);
    for (const bp of options.getBreakpoints()) {
      if (!bp.enabled || !bp.condition?.trim()) {
        continue;
      }
      if (!breakpointMatchesElm(bp, meta, line)) {
        continue;
      }
      if (evaluateSimpleCondition(bp.condition, variables)) {
        return true;
      }
    }
    return false;
  };

  const maybeReportProgress = (): void => {
    if (!options.onProgress) {
      return;
    }
    const now = Date.now();
    if (now - lastProgressAt < 500) {
      return;
    }
    lastProgressAt = now;
    const current = callStack[callStack.length - 1] ?? null;
    options.onProgress({
      expressionCount,
      defineName: current?.defineName ?? null,
    });
  };

  const handler: Record<string, unknown> = {
    [CqlDebugHandlerMethods.onBeforeExpression](elm: unknown, state: unknown) {
      expressionCount += 1;
      maybeReportProgress();

      if (options.shouldAbort()) {
        waitForResume();
        return pauseSentinel;
      }

      const reason = pauseReasonWithoutVariables(elm);
      if (!reason) {
        return null;
      }
      if (reason === 'abort') {
        waitForResume();
        return pauseSentinel;
      }

      // Defer the expensive State walk until we know we may pause.
      const variables = options.serializeVariables(state);
      if (reason === 'breakpoint-condition' && !conditionalBreakpointHits(elm, variables)) {
        return null;
      }

      const meta = readElmMeta(elm);
      const loc = parseLocator(meta.locator);
      const current = callStack[callStack.length - 1] ?? null;
      const defineName =
        options.resolveDefineName?.(state) ?? current?.defineName ?? null;
      options.onPause({
        locator: meta.locator,
        localId: meta.localId,
        libraryName: options.resolveLibraryName?.(state) ?? current?.libraryName ?? null,
        defineName,
        line: loc.line,
        column: loc.column,
        stackDepth: stackDepth(),
        stack: [...callStack].reverse(),
        variables,
        lastValue,
      });
      waitForResume();
      if (options.shouldAbort() || options.getStepMode() === 'stop') {
        throw new Error('CQL debug session stopped');
      }
      return null;
    },
    [CqlDebugHandlerMethods.onAfterExpression](elm: unknown, _state: unknown, value: unknown) {
      // Skip FHIR pretty-printing on the continue hot path; lastValue is only shown when paused.
      const mode = options.getStepMode();
      if (mode === 'continue' && !hasEnabledBreakpoints()) {
        return;
      }
      const meta = readElmMeta(elm);
      const loc = parseLocator(meta.locator);
      const current = callStack[callStack.length - 1] ?? null;
      // With breakpoints but still running, keep a cheap summary — full FHIR JSON is expensive.
      const display =
        mode === 'continue' ? compactDebugValue(value) : debugValueToDto(value);
      lastValue = {
        defineName: current?.defineName ?? null,
        line: loc.line,
        type: display.type,
        value: display.value,
        ...(display.fhir ? { fhir: true } : {}),
      };
    },
    [CqlDebugHandlerMethods.onExpressionDefEntered](
      elm: unknown,
      callSite: unknown,
      state: unknown
    ) {
      const libraryName = options.resolveLibraryName?.(state) ?? null;
      callStack.push(buildStackFrame(elm, callSite, libraryName));
    },
    [CqlDebugHandlerMethods.onExpressionDefEvaluated](
      _elm: unknown,
      _state: unknown,
      _value: unknown
    ) {
      callStack.pop();
    },
    [CqlDebugHandlerMethods.waitForResume]: waitForResume,
  };

  return handler;
}
