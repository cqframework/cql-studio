// Author: Preston Lee

import { ClassInstance, Code } from '@cqframework/cql/engine';
import { KtList, KtMutableMap } from '@cqframework/cql/kotlin-kotlin-stdlib';
import { QName } from '@cqframework/cql/shared';
import { FHIR_MODEL_URI } from './cql-debug-engine-api';
import { readClassInstanceId } from './cql-debug-fhir-bridge';
import type { PrefetchedValueSetExpansion } from './cql-debug-terminology-provider';

interface BundleDataProviderOptions {
  resources: ClassInstance[];
  patientId?: string | null;
  /** Needed so retrieve(..., valueSetId) can filter coded resources. */
  valueSetExpansions?: PrefetchedValueSetExpansion[];
  /**
   * When true, return filtered resources in input order (no temporal re-sort).
   * Tests use this so First/Last assertions cannot pass via retrieve-order coincidence
   * when `sort by start of effective` keys are null.
   */
  preserveRetrieveOrder?: boolean;
}

function emptyElements(): ReturnType<typeof KtMutableMap.fromJsMap> {
  return KtMutableMap.fromJsMap(new Map());
}

function readFhirPrimitiveString(node: unknown): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node !== 'object') {
    return String(node);
  }
  const record = node as {
    value?: unknown;
    elements?: { z2?: (k: string) => unknown };
    toString?: () => string;
  };
  if (typeof record.value === 'string') {
    return record.value;
  }
  // System.DateTime / Date / Time stored in FHIR primitive .value
  if (record.value != null && typeof record.value === 'object') {
    const nested = record.value as { value?: unknown; toString?: () => string };
    if (typeof nested.value === 'string') {
      return nested.value;
    }
    const asText = typeof nested.toString === 'function' ? nested.toString() : String(record.value);
    if (asText && asText !== '[object Object]') {
      return asText.replace(/^@/, '');
    }
  }
  const wrapped = record.elements?.z2?.('value');
  if (wrapped != null) {
    return readFhirPrimitiveString(wrapped);
  }
  // Bare System.DateTime / Date / Time (no FHIR wrapper)
  if (typeof record.toString === 'function') {
    const asText = record.toString();
    if (asText && asText !== '[object Object]' && asText.includes('-')) {
      return asText.replace(/^@/, '');
    }
  }
  return '';
}

function readReferenceValue(resource: ClassInstance, path: string): string {
  try {
    const elements = resource.elements as { z2?: (k: string) => unknown };
    const ref = elements.z2?.(path) as { elements?: { z2?: (k: string) => unknown } } | null | undefined;
    return readFhirPrimitiveString(ref?.elements?.z2?.('reference'));
  } catch {
    return '';
  }
}

function elementAt(resource: ClassInstance, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = resource;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return null;
    }
    const elements = (current as { elements?: { z2?: (k: string) => unknown } }).elements;
    current = elements?.z2?.(part) ?? null;
  }
  return current;
}

function collectCodings(node: unknown): Array<{ code: string; system: string }> {
  const out: Array<{ code: string; system: string }> = [];
  if (node == null) {
    return out;
  }
  // Engine List wrapper
  const listValue =
    node && typeof node === 'object' && 'value' in (node as object)
      ? (node as { value?: unknown }).value
      : node;

  const asArray: unknown[] = [];
  if (listValue && typeof listValue === 'object' && typeof (listValue as { t?: () => unknown }).t === 'function') {
    const iterator = (listValue as { t: () => { u: () => boolean; v: () => unknown } }).t();
    while (iterator.u()) {
      asArray.push(iterator.v());
    }
  } else if (Array.isArray(listValue)) {
    asArray.push(...listValue);
  } else {
    asArray.push(node);
  }

  for (const item of asArray) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const elements = (item as { elements?: { z2?: (k: string) => unknown } }).elements;
    if (!elements?.z2) {
      continue;
    }
    // CodeableConcept.coding[*]
    const coding = elements.z2('coding');
    if (coding != null) {
      out.push(...collectCodings(coding));
      continue;
    }
    const code = readFhirPrimitiveString(elements.z2('code'));
    const system = readFhirPrimitiveString(elements.z2('system'));
    if (code) {
      out.push({ code, system });
    }
  }
  return out;
}

function resourceMatchesCodes(
  resource: ClassInstance,
  codeProperty: string | null | undefined,
  allowed: Set<string>
): boolean {
  if (allowed.size === 0) {
    return true;
  }
  const paths = codeProperty
    ? [codeProperty]
    : ['code', 'medicationCodeableConcept', 'medication', 'type', 'category', 'vaccineCode'];
  for (const path of paths) {
    const node = elementAt(resource, path);
    for (const coding of collectCodings(node)) {
      const key = coding.system ? `${coding.system}|${coding.code}` : coding.code;
      if (allowed.has(key) || allowed.has(coding.code)) {
        return true;
      }
    }
  }
  return false;
}

/** Prefer effectiveDateTime / Period.start / authoredOn for stable First/Last when sort keys are null. */
function temporalSortKey(resource: ClassInstance): string {
  const effective = elementAt(resource, 'effective');
  if (effective && typeof effective === 'object') {
    const elements = (effective as { elements?: { z2?: (k: string) => unknown } }).elements;
    // FHIR.dateTime primitive or Period.start
    const asPrimitive = readFhirPrimitiveString(effective);
    if (asPrimitive) {
      return asPrimitive;
    }
    const start = elements?.z2?.('start');
    const startStr = readFhirPrimitiveString(start);
    if (startStr) {
      return startStr;
    }
  }
  const effectiveDateTime = elementAt(resource, 'effectiveDateTime');
  const edt = readFhirPrimitiveString(effectiveDateTime);
  if (edt) {
    return edt;
  }
  const authoredOn = elementAt(resource, 'authoredOn');
  const authored = readFhirPrimitiveString(authoredOn);
  if (authored) {
    return authored;
  }
  const recordedDate = elementAt(resource, 'recordedDate');
  return readFhirPrimitiveString(recordedDate);
}

function sortByTemporalAscending(resources: ClassInstance[]): ClassInstance[] {
  return [...resources].sort((a, b) => {
    const ka = temporalSortKey(a);
    const kb = temporalSortKey(b);
    if (ka && kb) {
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }
    if (ka) {
      return -1;
    }
    if (kb) {
      return 1;
    }
    return 0;
  });
}

function codesFromRetrieveArgs(
  codes: unknown,
  valueSetId: string | null | undefined,
  expansionsByUrl: Map<string, PrefetchedValueSetExpansion>
): Set<string> {
  const allowed = new Set<string>();

  if (typeof valueSetId === 'string' && valueSetId) {
    const expansion =
      expansionsByUrl.get(valueSetId) ?? expansionsByUrl.get(valueSetId.split('|')[0] ?? '');
    for (const c of expansion?.codes ?? []) {
      allowed.add(c.code);
      if (c.system) {
        allowed.add(`${c.system}|${c.code}`);
      }
    }
  }

  if (codes == null) {
    return allowed;
  }

  const pushCode = (code: unknown): void => {
    if (code == null) {
      return;
    }
    if (typeof code === 'string') {
      allowed.add(code);
      return;
    }
    if (code instanceof Code || (typeof code === 'object' && code && 'code' in code)) {
      const record = code as { code?: string | null; system?: string | null };
      if (record.code) {
        allowed.add(record.code);
        if (record.system) {
          allowed.add(`${record.system}|${record.code}`);
        }
      }
    }
  };

  if (typeof (codes as { t?: () => unknown }).t === 'function') {
    const iterator = (codes as { t: () => { u: () => boolean; v: () => unknown } }).t();
    while (iterator.u()) {
      pushCode(iterator.v());
    }
  } else if (Array.isArray(codes)) {
    for (const c of codes) {
      pushCode(c);
    }
  } else {
    pushCode(codes);
  }

  return allowed;
}

/**
 * Duck-typed DataProvider serving a prefetched in-memory FHIR snapshot.
 * Satisfies @cqframework/cql@5.3.0 retrieve / ModelResolver call sites.
 */
export function createBundleDataProvider(options: BundleDataProviderOptions): object {
  const byType = new Map<string, ClassInstance[]>();
  for (const resource of options.resources) {
    let typeName = 'Resource';
    try {
      typeName = resource.type.getLocalPart();
    } catch {
      const typeAsString = (resource as unknown as { typeAsString?: string }).typeAsString;
      if (typeAsString?.includes('.')) {
        typeName = typeAsString.split('.').pop() ?? typeName;
      }
    }
    const list = byType.get(typeName) ?? [];
    list.push(resource);
    byType.set(typeName, list);
  }

  const expansionsByUrl = new Map<string, PrefetchedValueSetExpansion>();
  for (const expansion of options.valueSetExpansions ?? []) {
    expansionsByUrl.set(expansion.url, expansion);
    const bare = expansion.url.split('|')[0];
    if (bare) {
      expansionsByUrl.set(bare, expansion);
    }
  }

  const matchesContext = (
    resource: ClassInstance,
    context: string | null | undefined,
    contextPath: string | null | undefined,
    contextValue: string | null | undefined
  ): boolean => {
    if (!context || !contextValue) {
      return true;
    }
    if (context !== 'Patient') {
      return true;
    }
    const id = readClassInstanceId(resource);
    if (id && (id === contextValue || `Patient/${id}` === contextValue)) {
      return true;
    }
    if (!contextPath) {
      return true;
    }
    const refValue = readReferenceValue(resource, contextPath);
    return (
      refValue === contextValue ||
      refValue === `Patient/${contextValue}` ||
      refValue.endsWith(`/${contextValue}`)
    );
  };

  return {
    retrieve(
      context: string | null,
      contextPath: string | null,
      contextValue: string | null,
      dataType: string,
      _templateId?: string | null,
      codeProperty?: string | null,
      codes?: unknown,
      valueSet?: string | null
    ) {
      const candidates = byType.get(dataType) ?? [];
      const allowedCodes = codesFromRetrieveArgs(codes, valueSet, expansionsByUrl);
      const filtered = candidates.filter(resource => {
        if (!matchesContext(resource, context, contextPath, contextValue)) {
          return false;
        }
        if (allowedCodes.size === 0) {
          return true;
        }
        return resourceMatchesCodes(resource, codeProperty, allowedCodes);
      });
      // Oldest-first when CQL sort keys are null (typical for `start of effective` on
      // dateTime choice arms: As(dateTime, Period) → null). Matches HAPI retrieve order
      // so First/Last without a working sort agree with $evaluate.
      if (options.preserveRetrieveOrder) {
        return KtList.fromJsArray(filtered);
      }
      return KtList.fromJsArray(sortByTemporalAscending(filtered));
    },
    getContextPath(contextType: string | null, _targetType: string | null): string | null {
      return contextType === 'Patient' ? 'subject' : null;
    },
    is(valueType: string, type: QName): boolean | null {
      try {
        return type.getLocalPart() === valueType || type.getLocalPart() === 'Any';
      } catch {
        return true;
      }
    },
    createInstance(typeName: string | null) {
      if (!typeName) {
        return null;
      }
      return new ClassInstance(new QName(FHIR_MODEL_URI, typeName, ''), emptyElements() as never);
    },
    resolveId(target: ClassInstance | null): string | null {
      return target ? readClassInstanceId(target) : null;
    },
    objectEquivalent(left: ClassInstance, right: ClassInstance): boolean {
      return left === right || readClassInstanceId(left) === readClassInstanceId(right);
    },
    phiObfuscationSupplier() {
      return () => null;
    },
  };
}
