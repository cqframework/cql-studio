// Author: Preston Lee

import { KtList } from '@cqframework/cql/kotlin-kotlin-stdlib';
import { CqlDebugTerminologyMethods, CQL_DEBUG_VALUESET_INFO_ID_FIELD } from './cql-debug-engine-api';
import { createCode } from './cql-debug-fhir-bridge';

export interface PrefetchedValueSetExpansion {
  url: string;
  codes: Array<{ code: string; system?: string; display?: string }>;
}

interface ValueSetInfoLike {
  id?: string | null;
  url?: string | null;
  /** @cqframework/cql@5.3.0 mangled ValueSetInfo.id */
  [key: string]: unknown;
}

interface CodeSystemInfoLike {
  id?: string | null;
}

function valueSetKey(info: ValueSetInfoLike | null | undefined): string {
  if (!info) {
    return '';
  }
  const mangled = info[CQL_DEBUG_VALUESET_INFO_ID_FIELD];
  return String(info.id ?? info.url ?? (typeof mangled === 'string' ? mangled : '') ?? '');
}

function codeOf(code: { code?: string | null; value?: string | null } | string): string {
  if (code && typeof code === 'object') {
    if ('code' in code && code.code != null) {
      return String(code.code);
    }
    if ('value' in code && code.value != null) {
      return String(code.value);
    }
  }
  return String(code);
}

/**
 * Duck-typed TerminologyProvider backed by prefetched ValueSet expansions.
 * Method names / ValueSetInfo.id field are mangled for @cqframework/cql@5.3.0.
 */
export function createPrefetchedTerminologyProvider(
  expansions: PrefetchedValueSetExpansion[]
): object {
  const byUrl = new Map<string, PrefetchedValueSetExpansion>();
  for (const expansion of expansions) {
    byUrl.set(expansion.url, expansion);
    const bare = expansion.url.split('|')[0];
    if (bare && bare !== expansion.url) {
      byUrl.set(bare, expansion);
    }
  }

  const resolveExpansion = (valueSet: ValueSetInfoLike): PrefetchedValueSetExpansion | undefined => {
    const key = valueSetKey(valueSet);
    if (!key) {
      return undefined;
    }
    return byUrl.get(key) ?? byUrl.get(key.split('|')[0] ?? '');
  };

  const expand = (valueSet: ValueSetInfoLike): unknown => {
    const expansion = resolveExpansion(valueSet);
    const codes = (expansion?.codes ?? []).map(c => createCode(c.code, c.system, c.display));
    return KtList.fromJsArray(codes);
  };

  const inValueSet = (code: unknown, valueSet: ValueSetInfoLike): boolean => {
    const expansion = resolveExpansion(valueSet);
    if (!expansion) {
      return false;
    }
    const needle = codeOf(code as { code?: string | null });
    return expansion.codes.some(c => c.code === needle);
  };

  const lookup = (code: unknown, _codeSystem: CodeSystemInfoLike): unknown => {
    return code ?? null;
  };

  return {
    [CqlDebugTerminologyMethods.expand]: expand,
    [CqlDebugTerminologyMethods.inValueSet]: inValueSet,
    [CqlDebugTerminologyMethods.lookup]: lookup,
    expand,
    in: inValueSet,
    lookup,
  };
}
