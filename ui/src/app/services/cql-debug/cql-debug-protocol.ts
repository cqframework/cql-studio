// Author: Preston Lee

import type {
  CqlDebugBreakpointSpec,
  CqlDebugPauseFrame,
  CqlDebugStepMode,
} from './cql-debug-breakpoint-handler';
import type { PrefetchedValueSetExpansion } from './cql-debug-terminology-provider';
import type { Bundle } from 'fhir/r4';

export type CqlDebugWorkerInboundMessage =
  | {
      type: 'start';
      requestId: string;
      sab: SharedArrayBuffer;
      payload: CqlDebugStartPayload;
    }
  | { type: 'setBreakpoints'; breakpoints: CqlDebugBreakpointSpec[] }
  | { type: 'command'; command: CqlDebugStepMode }
  | { type: 'stop' };

export type CqlDebugWorkerOutboundMessage =
  | { type: 'ready' }
  | { type: 'progress'; phase: 'translating' | 'evaluating'; elapsedMs: number; detail?: string }
  | { type: 'paused'; frame: CqlDebugPauseFrame }
  | { type: 'completed'; results: CqlDebugExpressionResultDto[]; executionTimeMs: number }
  | { type: 'error'; message: string };

export interface CqlDebugStartPayload {
  libraryName: string;
  libraryVersion?: string | null;
  cql: string;
  includeSources: Array<{ id: string; version?: string | null; cql: string }>;
  /** @deprecated Prefer modelInfoByKey; retained for older workers. */
  systemModelInfoXml: string;
  /** @deprecated Prefer modelInfoByKey; retained for older workers. */
  fhirModelInfoXml: string;
  /** Map of `name|version` → ModelInfo XML (includes System and FHIR). */
  modelInfoByKey: Record<string, string>;
  fhirHelpersCql: string;
  subjectId: string | null;
  expressionNames: string[];
  bundle: Bundle | null;
  valueSetExpansions: PrefetchedValueSetExpansion[];
  breakpoints: CqlDebugBreakpointSpec[];
}

export interface CqlDebugExpressionResultDto {
  name: string;
  type: string;
  value: string;
  /** True when `value` is FHIR resource JSON (object or array) from the prefetch snapshot. */
  fhir?: boolean;
}
