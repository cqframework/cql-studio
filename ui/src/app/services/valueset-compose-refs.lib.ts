// Author: Preston Lee

import { ValueSet } from 'fhir/r4';

export type ValueSetComposeRelation = 'include' | 'exclude';

export interface ValueSetComposeValueSetRef {
  relation: ValueSetComposeRelation;
  reference: string;
}

/** Collect nested ValueSet canonical refs from compose include/exclude. */
export function extractComposeValueSetReferences(vs: ValueSet): ValueSetComposeValueSetRef[] {
  const refs: ValueSetComposeValueSetRef[] = [];
  for (const inc of vs.compose?.include ?? []) {
    for (const ref of inc.valueSet ?? []) {
      if (ref?.trim()) {
        refs.push({ relation: 'include', reference: ref.trim() });
      }
    }
  }
  for (const exc of vs.compose?.exclude ?? []) {
    for (const ref of exc.valueSet ?? []) {
      if (ref?.trim()) {
        refs.push({ relation: 'exclude', reference: ref.trim() });
      }
    }
  }
  return refs;
}

/** Collect code system URIs referenced by compose include/exclude. */
export function extractComposeCodeSystemUrls(vs: ValueSet): string[] {
  const systems = new Set<string>();
  for (const inc of vs.compose?.include ?? []) {
    if (inc.system?.trim()) {
      systems.add(inc.system.trim());
    }
  }
  for (const exc of vs.compose?.exclude ?? []) {
    if (exc.system?.trim()) {
      systems.add(exc.system.trim());
    }
  }
  return [...systems];
}

export function normalizeCanonicalKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'unknown';
  }
  return /^https?:\/\//i.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed.replace(/^urn:oid:/i, '').toLowerCase();
}
