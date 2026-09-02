// Author: Preston Lee

import type { ValueSet } from 'fhir/r4';
import type { ValueSetReference } from '../../components/sql-on-fhir/elm-to-sql';
import {
  indexBundledValueSets,
  lookupBundledValueSet,
  normalizeValueSetUrl,
  valueSetIdentityKey,
} from './sql-on-fhir-execution-data.lib';

/** Canonical URL variants used when searching or storing ValueSets on a FHIR server. */
export function valueSetUrlVariants(url: string): string[] {
  const variants = new Set<string>();
  const trimmed = url.trim();
  if (!trimmed) {
    return [];
  }
  variants.add(trimmed);
  const oid = valueSetIdentityKey(trimmed);
  if (/^\d/.test(oid)) {
    variants.add(`urn:oid:${oid}`);
    variants.add(`http://cts.nlm.nih.gov/fhir/ValueSet/${oid}`);
  }
  return [...variants];
}

/** Merge bundled expansion content with the canonical URL declared in ELM. */
export function mergeBundledValueSetForElmRef(bundled: ValueSet, ref: ValueSetReference): ValueSet {
  return {
    ...bundled,
    resourceType: 'ValueSet',
    url: ref.url,
    name: bundled.name ?? ref.name.replace(/\s+/g, ''),
    status: bundled.status ?? 'active',
  };
}

export function buildCms125ValueSetsForServerPublish(
  refs: ValueSetReference[],
  bundledValueSets: ValueSet[],
): ValueSet[] {
  const indexes = indexBundledValueSets(bundledValueSets);
  const published: ValueSet[] = [];
  for (const ref of refs) {
    const bundled = lookupBundledValueSet(ref, indexes);
    if (!bundled?.id?.trim()) {
      continue;
    }
    published.push(mergeBundledValueSetForElmRef(bundled, ref));
  }
  return published;
}

function aliasValueSetId(baseId: string, variantUrl: string): string {
  const suffix = valueSetIdentityKey(variantUrl).replace(/\./g, '-');
  return `${baseId}-${suffix}`;
}

/** Primary ELM-aligned ValueSets plus urn:oid / HTTP URL aliases for server lookup. */
export function expandValueSetsForServerPublish(
  refs: ValueSetReference[],
  bundledValueSets: ValueSet[],
): ValueSet[] {
  const primary = buildCms125ValueSetsForServerPublish(refs, bundledValueSets);
  const expanded: ValueSet[] = [];
  for (const vs of primary) {
    expanded.push(vs);
    const canonical = vs.url?.trim();
    if (!canonical) {
      continue;
    }
    for (const variant of valueSetUrlVariants(canonical)) {
      if (normalizeValueSetUrl(variant) === normalizeValueSetUrl(canonical)) {
        continue;
      }
      expanded.push({
        ...vs,
        id: aliasValueSetId(vs.id!, variant),
        url: variant,
      });
    }
  }
  return expanded;
}

export function bundledValueSetsForServerPublish(bundledValueSets: ValueSet[]): ValueSet[] {
  const refs: ValueSetReference[] = bundledValueSets
    .filter(vs => vs.url?.trim())
    .map(vs => ({
      name: vs.name ?? vs.title ?? vs.id ?? 'ValueSet',
      url: vs.url!,
    }));
  return expandValueSetsForServerPublish(refs, bundledValueSets);
}

export function valueSetComposeFromExpansion(vs: ValueSet): ValueSet['compose'] | undefined {
  const contains = vs.expansion?.contains ?? [];
  if (contains.length === 0) {
    return undefined;
  }
  const bySystem = new Map<string, Array<{ code: string; display?: string }>>();
  for (const entry of contains) {
    if (!entry.system?.trim() || !entry.code?.trim()) {
      continue;
    }
    const concepts = bySystem.get(entry.system) ?? [];
    concepts.push({
      code: entry.code,
      ...(entry.display ? { display: entry.display } : {}),
    });
    bySystem.set(entry.system, concepts);
  }
  if (bySystem.size === 0) {
    return undefined;
  }
  return {
    include: [...bySystem.entries()].map(([system, concept]) => ({ system, concept })),
  };
}

export function valueSetForServerPut(vs: ValueSet): ValueSet {
  if (!vs.id?.trim()) {
    throw new Error(`ValueSet "${vs.name ?? vs.url ?? 'unknown'}" is missing an id for FHIR PUT`);
  }
  if (!vs.url?.trim()) {
    throw new Error(`ValueSet "${vs.id}" is missing a canonical url`);
  }
  const compose = vs.compose?.include?.length ? vs.compose : valueSetComposeFromExpansion(vs);
  if (!compose?.include?.length) {
    throw new Error(`ValueSet "${vs.id}" is missing compose.include`);
  }
  const { expansion: _expansion, ...withoutExpansion } = vs;
  return {
    ...withoutExpansion,
    resourceType: 'ValueSet',
    status: vs.status ?? 'active',
    compose,
  };
}
