// Author: Preston Lee

import type { ValueSet } from 'fhir/r4';

type ExpansionContains = NonNullable<NonNullable<ValueSet['expansion']>['contains']>[number];

/**
 * HAPI `$expand` follows `compose.include.valueSet` and returns HAPI-0889 when that
 * ValueSet is not on the server, even if `expansion.contains` was already stored.
 * An include/exclude of the same placeholder code expands to an empty set without
 * requiring another ValueSet or CodeSystem.
 */
const EMPTY_EXPANSION_SYSTEM = 'http://cql-studio.local/CodeSystem/empty-expansion';
const EMPTY_EXPANSION_CODE = 'empty';

export interface StoredExpansionPeek {
  codes: Array<{ system?: string; code?: string; display?: string }>;
  truncated: boolean;
}

export function flattenExpansionContains(contains: readonly ExpansionContains[] | undefined): ExpansionContains[] {
  const flat: ExpansionContains[] = [];
  const walk = (items: readonly ExpansionContains[]) => {
    for (const item of items) {
      flat.push(item);
      if (item.contains?.length) {
        walk(item.contains);
      }
    }
  };
  if (contains?.length) {
    walk(contains);
  }
  return flat;
}

/** Extensional compose built from a completed expansion, so local `$expand` does not resolve includes. */
export function composeFromExpandedValueSet(valueSet: ValueSet): ValueSet['compose'] | undefined {
  const expansion = valueSet.expansion;
  if (!expansion) {
    return undefined;
  }
  const bySystem = new Map<string, Map<string, { code: string; display?: string }>>();
  for (const entry of flattenExpansionContains(expansion.contains)) {
    const system = entry.system?.trim();
    const code = entry.code?.trim();
    if (!system || !code) {
      continue;
    }
    const concepts = bySystem.get(system) ?? new Map<string, { code: string; display?: string }>();
    if (!concepts.has(code)) {
      concepts.set(code, {
        code,
        ...(entry.display ? { display: entry.display } : {}),
      });
    }
    bySystem.set(system, concepts);
  }
  if (bySystem.size > 0) {
    return {
      include: [...bySystem.entries()].map(([system, concepts]) => ({
        system,
        concept: [...concepts.values()],
      })),
    };
  }
  const noCodes = !expansion.contains?.length && flattenExpansionContains(expansion.contains).length === 0;
  if (noCodes && (expansion.total === 0 || Array.isArray(expansion.contains))) {
    return {
      include: [{ system: EMPTY_EXPANSION_SYSTEM, concept: [{ code: EMPTY_EXPANSION_CODE }] }],
      exclude: [{ system: EMPTY_EXPANSION_SYSTEM, concept: [{ code: EMPTY_EXPANSION_CODE }] }],
    };
  }
  return undefined;
}

/** Codes already stored on a ValueSet, for peek when `$expand` cannot resolve included ValueSets. */
export function peekCodesFromStoredExpansion(valueSet: ValueSet, limit: number): StoredExpansionPeek | null {
  const expansion = valueSet.expansion;
  if (!expansion || (!Array.isArray(expansion.contains) && expansion.total !== 0)) {
    return null;
  }
  const flat = flattenExpansionContains(expansion.contains).filter(entry => !!entry.code?.trim());
  const capped = Math.max(0, limit);
  const page = flat.slice(0, capped);
  return {
    codes: page.map(entry => ({
      system: entry.system,
      code: entry.code,
      display: entry.display,
    })),
    truncated: typeof expansion.total === 'number' ? expansion.total > page.length : flat.length > capped,
  };
}
