// Author: Preston Lee

import type { CqlDebugVariableDto } from './cql-debug-breakpoint-handler';
import {
  CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD,
  CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD,
  CQL_DEBUG_STATE_STACK_FIELD,
  CQL_DEBUG_VARIABLE_NAME_FIELD,
  CQL_DEBUG_VARIABLE_VALUE_FIELD,
} from './cql-debug-engine-api';
import { extractFhirJsonPayload } from './cql-debug-fhir-bridge';

function cqlValueToDisplay(value: unknown): { type: string; value: string } {
  if (value === null || value === undefined) {
    return { type: 'Null', value: 'null' };
  }
  const typeAsString =
    (value as { typeAsString?: string }).typeAsString ??
    (value as { type?: { getLocalPart?: () => string } }).type?.getLocalPart?.() ??
    typeof value;

  if (typeof (value as { value?: unknown }).value === 'boolean') {
    return {
      type: 'Boolean',
      value: String((value as { value: boolean }).value),
    };
  }
  if (typeof (value as { value?: unknown }).value === 'number') {
    const n = (value as { value: number }).value;
    return {
      type: Number.isInteger(n) ? 'Integer' : 'Decimal',
      value: String(n),
    };
  }
  if (typeof (value as { value?: unknown }).value === 'bigint') {
    return { type: 'Long', value: String((value as { value: bigint }).value) };
  }
  if (typeof (value as { value?: unknown }).value === 'string') {
    const local = typeAsString.includes('.') ? typeAsString.split('.').pop()! : typeAsString;
    return {
      type: local || 'String',
      value: (value as { value: string }).value,
    };
  }

  const asString = (() => {
    try {
      return String(value);
    } catch {
      return '[unprintable]';
    }
  })();

  const local = typeAsString.includes('.') ? typeAsString.split('.').pop()! : String(typeAsString);
  return {
    type: local || 'Value',
    value: asString,
  };
}

type KotlinIterator = { u: () => boolean; v: () => unknown };

function iterateKotlinDeque(deque: unknown): unknown[] {
  if (!deque || typeof deque !== 'object') {
    return [];
  }
  const obj = deque as Record<string, unknown>;
  if (typeof obj['t'] !== 'function') {
    return [];
  }
  const out: unknown[] = [];
  try {
    const iterator = (obj['t'] as () => KotlinIterator).call(obj);
    while (iterator.u()) {
      out.push(iterator.v());
    }
  } catch {
    /* ignore version-sensitive iterator failures */
  }
  return out;
}

function variableFromEngineObject(obj: Record<string, unknown>): CqlDebugVariableDto | null {
  const name =
    (typeof obj['name'] === 'string' && obj['name']) ||
    (typeof obj[CQL_DEBUG_VARIABLE_NAME_FIELD] === 'string' &&
      (obj[CQL_DEBUG_VARIABLE_NAME_FIELD] as string)) ||
    null;
  if (!name) {
    return null;
  }
  const value = obj['value'] ?? obj[CQL_DEBUG_VARIABLE_VALUE_FIELD];
  if (value === undefined) {
    return null;
  }
  const display = debugValueToDto(value);
  return {
    name,
    type: display.type,
    value: display.value,
    ...(display.fhir ? { fhir: true } : {}),
  };
}

function serializeVariablesFromActivationFrame(frame: unknown): CqlDebugVariableDto[] {
  if (!frame || typeof frame !== 'object') {
    return [];
  }
  const record = frame as Record<string, unknown>;
  const variablesDeque = record[CQL_DEBUG_ACTIVATION_FRAME_VARIABLES_FIELD] ?? record['variables'];
  const out: CqlDebugVariableDto[] = [];
  for (const item of iterateKotlinDeque(variablesDeque)) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const variable = variableFromEngineObject(item as Record<string, unknown>);
    if (variable) {
      out.push(variable);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * True when an activation-frame element looks like an ExpressionDef (has a define name).
 * Skips root (null) and Retrieve frames (dataType, no ExpressionDef name).
 */
function isExpressionDefElement(element: unknown): boolean {
  if (!element || typeof element !== 'object') {
    return false;
  }
  const record = element as { name?: unknown; dataType?: unknown };
  return typeof record.name === 'string' && record.name.trim().length > 0 && record.dataType == null;
}

/**
 * Per ExpressionDef activation frame, top (current) first — matches UI call-stack order.
 * No cross-frame name collapse.
 */
export function serializeDebugVariablesByActivationFrame(state: unknown): CqlDebugVariableDto[][] {
  if (!state || typeof state !== 'object') {
    return [];
  }
  const record = state as Record<string, unknown>;
  const stack = record[CQL_DEBUG_STATE_STACK_FIELD] ?? record['stack'];
  const frames = iterateKotlinDeque(stack);
  const out: CqlDebugVariableDto[][] = [];
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') {
      continue;
    }
    const frameRecord = frame as Record<string, unknown>;
    const element =
      frameRecord[CQL_DEBUG_ACTIVATION_FRAME_ELEMENT_FIELD] ?? frameRecord['element'];
    if (!isExpressionDefElement(element)) {
      continue;
    }
    out.push(serializeVariablesFromActivationFrame(frame));
  }
  return out;
}

/**
 * Flat variable list for condition evaluation (innermost / first frame wins on shadowing).
 */
export function serializeDebugVariables(state: unknown): CqlDebugVariableDto[] {
  const byFrame = serializeDebugVariablesByActivationFrame(state);
  if (byFrame.length > 0) {
    const byName = new Map<string, CqlDebugVariableDto>();
    // Walk outermost → innermost so innermost overwrites (matches resolveVariable top-first).
    for (let i = byFrame.length - 1; i >= 0; i--) {
      for (const variable of byFrame[i]) {
        byName.set(variable.name, variable);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Fallback: legacy deep scan when stack fields are unavailable.
  const out: CqlDebugVariableDto[] = [];
  const record = state as Record<string, unknown>;
  for (const value of Object.values(record)) {
    collectFromUnknown(value, out, 0);
  }
  const byName = new Map<string, CqlDebugVariableDto>();
  for (const variable of out) {
    byName.set(variable.name, variable);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectFromUnknown(node: unknown, out: CqlDebugVariableDto[], depth: number): void {
  if (!node || depth > 4) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectFromUnknown(item, out, depth + 1);
    }
    return;
  }
  if (typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;

  if (typeof obj['t'] === 'function') {
    for (const item of iterateKotlinDeque(obj)) {
      collectFromUnknown(item, out, depth + 1);
    }
  }

  const variable = variableFromEngineObject(obj);
  if (variable) {
    out.push(variable);
  }

  for (const child of Object.values(obj)) {
    if (child && typeof child === 'object') {
      collectFromUnknown(child, out, depth + 1);
    }
  }
}

export function debugValueToDto(value: unknown): {
  type: string;
  value: string;
  fhir?: boolean;
} {
  const fhirPayload = extractFhirJsonPayload(value);
  if (fhirPayload != null) {
    const type = Array.isArray(fhirPayload)
      ? 'List'
      : typeof fhirPayload['resourceType'] === 'string'
        ? (fhirPayload['resourceType'] as string)
        : 'Resource';
    return {
      type,
      value: JSON.stringify(fhirPayload, null, 2),
      fhir: true,
    };
  }
  return cqlValueToDisplay(value);
}

/**
 * Cheap display for the continue hot path — avoids JSON.stringify of large FHIR payloads.
 */
export function compactDebugValue(value: unknown): {
  type: string;
  value: string;
  fhir?: boolean;
} {
  const fhirPayload = extractFhirJsonPayload(value);
  if (fhirPayload != null) {
    if (Array.isArray(fhirPayload)) {
      return { type: 'List', value: `[${fhirPayload.length} item(s)]`, fhir: true };
    }
    const resourceType =
      typeof fhirPayload['resourceType'] === 'string'
        ? (fhirPayload['resourceType'] as string)
        : 'Resource';
    const id = typeof fhirPayload['id'] === 'string' ? (fhirPayload['id'] as string) : null;
    return {
      type: resourceType,
      value: id ? `${resourceType}/${id}` : resourceType,
      fhir: true,
    };
  }
  return cqlValueToDisplay(value);
}

export function expressionResultToDto(name: string, value: unknown): {
  name: string;
  type: string;
  value: string;
  fhir?: boolean;
} {
  const display = debugValueToDto(value);
  return {
    name,
    type: display.type,
    value: display.value,
    ...(display.fhir ? { fhir: true } : {}),
  };
}
