// Author: Preston Lee

import type { CqlDebugVariableDto } from './cql-debug-breakpoint-handler';
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

/**
 * Best-effort variable extraction from engine State (version-sensitive internals).
 */
export function serializeDebugVariables(state: unknown): CqlDebugVariableDto[] {
  const out: CqlDebugVariableDto[] = [];
  if (!state || typeof state !== 'object') {
    return out;
  }
  const record = state as Record<string, unknown>;

  // Activation frame stacks are mangled; scan array-like deques for Variable-like objects.
  for (const value of Object.values(record)) {
    collectFromUnknown(value, out, 0);
  }

  // Deduplicate by name (last wins).
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

  // Kotlin ArrayDeque-like: try iterator protocol via .t()
  if (typeof obj['t'] === 'function') {
    try {
      const iterator = (obj['t'] as () => { u: () => boolean; v: () => unknown }).call(obj);
      while (iterator.u()) {
        collectFromUnknown(iterator.v(), out, depth + 1);
      }
    } catch {
      /* ignore */
    }
  }

  // Variable-like: name + value fields (mangled y9i_1 / z9i_1 in 5.3.0, or public)
  const name =
    (typeof obj['name'] === 'string' && obj['name']) ||
    (typeof obj['y9i_1'] === 'string' && (obj['y9i_1'] as string)) ||
    null;
  const value = obj['value'] ?? obj['z9i_1'];
  if (name && value !== undefined) {
    const display = debugValueToDto(value);
    out.push({
      name,
      type: display.type,
      value: display.value,
      ...(display.fhir ? { fhir: true } : {}),
    });
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
