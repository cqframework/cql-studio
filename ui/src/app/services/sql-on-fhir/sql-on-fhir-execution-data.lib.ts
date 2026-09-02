// Author: Preston Lee

import type { Bundle, ValueSet } from 'fhir/r4';
import {
  extractUsedValueSets,
  extractValueSets,
  loadValueSetExpansions,
  type ValueSetExpansionRow,
  type ValueSetLoadResult,
  type ValueSetReference,
} from '../../components/sql-on-fhir/elm-to-sql';
import type { FlatRow } from './sql-on-fhir-bundle-flattener.lib';
import { flattenValueSets } from './sql-on-fhir-bundle-flattener.lib';
import { isResourceType } from '../fhir-resource-type.lib';

export interface PrepareValueSetRowsResult {
  rows: FlatRow[];
  errors: string[];
  unresolvedRefs: string[];
}

export function normalizeValueSetUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function normalizeValueSetName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

/** Extract comparable OID suffix from urn:oid, VSAC HTTP, or plain OID strings. */
export function valueSetIdentityKey(url: string): string {
  const trimmed = url.trim();
  const urn = trimmed.match(/^urn:oid:(\d[\d.]*)$/i);
  if (urn) {
    return urn[1];
  }
  const http = trimmed.match(/\/ValueSet\/(\d[\d.]*)$/i);
  if (http) {
    return http[1];
  }
  return normalizeValueSetUrl(trimmed);
}

export interface BundledValueSetIndexes {
  byUrl: Map<string, ValueSet>;
  byIdentity: Map<string, ValueSet>;
  byName: Map<string, ValueSet>;
}

export function indexBundledValueSets(valueSets: ValueSet[]): BundledValueSetIndexes {
  const byUrl = new Map<string, ValueSet>();
  const byIdentity = new Map<string, ValueSet>();
  const byName = new Map<string, ValueSet>();
  for (const vs of valueSets) {
    if (vs.url?.trim()) {
      byUrl.set(normalizeValueSetUrl(vs.url), vs);
      byIdentity.set(valueSetIdentityKey(vs.url), vs);
    }
    for (const label of [vs.name, vs.title].filter(Boolean)) {
      byName.set(normalizeValueSetName(label!), vs);
    }
  }
  return { byUrl, byIdentity, byName };
}

export function lookupBundledValueSet(
  ref: ValueSetReference,
  indexes: BundledValueSetIndexes,
): ValueSet | undefined {
  return (
    indexes.byUrl.get(normalizeValueSetUrl(ref.url)) ??
    indexes.byIdentity.get(valueSetIdentityKey(ref.url)) ??
    indexes.byName.get(normalizeValueSetName(ref.name))
  );
}

function appendBundledValueSetRows(ref: ValueSetReference, bundled: ValueSet, rows: FlatRow[]): void {
  for (const row of flattenValueSets([bundled])) {
    rows.push({ ...row, value_set_id: ref.url });
  }
}

export function resolveValueSetReferences(
  elmJson: string,
  bundledValueSets: ValueSet[] = [],
): ValueSetReference[] {
  const elm = JSON.parse(elmJson) as { library?: unknown };
  const lib = 'library' in elm ? elm : { library: elm };
  const wrapper = lib as Parameters<typeof extractUsedValueSets>[0];
  const used = extractUsedValueSets(wrapper);
  if (used.length > 0) {
    return used;
  }
  if (bundledValueSets.length === 0) {
    return [];
  }
  const indexes = indexBundledValueSets(bundledValueSets);
  return extractValueSets(wrapper).filter(ref => lookupBundledValueSet(ref, indexes) != null);
}

export async function prepareValueSetRowsForExecution(
  elmJson: string,
  bundledValueSets: ValueSet[] = [],
  fetchExpansions?: (refs: ValueSetReference[]) => Promise<ValueSetLoadResult[]>,
): Promise<PrepareValueSetRowsResult> {
  const refs = resolveValueSetReferences(elmJson, bundledValueSets);
  if (refs.length === 0) {
    return { rows: [], errors: [], unresolvedRefs: [] };
  }

  const bundledIndexes = indexBundledValueSets(bundledValueSets);
  const rows: FlatRow[] = [];
  const errors: string[] = [];
  const toFetch: ValueSetReference[] = [];

  for (const ref of refs) {
    const bundled = lookupBundledValueSet(ref, bundledIndexes);
    if (bundled) {
      appendBundledValueSetRows(ref, bundled, rows);
    } else {
      toFetch.push(ref);
    }
  }

  if (toFetch.length > 0) {
    if (!fetchExpansions) {
      for (const ref of toFetch) {
        errors.push(`${ref.name}: No bundled expansion available for ${ref.url}`);
      }
    } else {
      const results = await fetchExpansions(toFetch);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const ref = toFetch[i];
        if (result.error) {
          errors.push(`${result.name}: ${result.error}`);
        }
        for (const row of valueSetExpansionRowsToFlatRows(result.rows)) {
          rows.push({ ...row, value_set_id: ref.url });
        }
      }
    }
  }

  const unresolvedRefs: string[] = [];
  for (const ref of refs) {
    const normalized = normalizeValueSetUrl(ref.url);
    const identity = valueSetIdentityKey(ref.url);
    const hasRows = rows.some(r => {
      const rowId = r['value_set_id'];
      if (rowId == null) {
        return false;
      }
      const asString = String(rowId);
      return (
        normalizeValueSetUrl(asString) === normalized ||
        valueSetIdentityKey(asString) === identity
      );
    });
    if (!hasRows) {
      unresolvedRefs.push(ref.name);
      if (!errors.some(e => e.startsWith(`${ref.name}:`))) {
        errors.push(`${ref.name}: Referenced value set has no expansion rows`);
      }
    }
  }

  return { rows, errors, unresolvedRefs };
}

export interface BundleResourceSummary {
  patientIds: string[];
  countsByType: Record<string, number>;
  totalResources: number;
}

export function summarizeBundleResources(bundle: Bundle | null): BundleResourceSummary {
  const countsByType: Record<string, number> = {};
  const patientIds: string[] = [];
  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (!resource?.resourceType) {
      continue;
    }
    countsByType[resource.resourceType] = (countsByType[resource.resourceType] ?? 0) + 1;
    if (resource.resourceType === 'Patient' && resource.id) {
      patientIds.push(resource.id);
    }
  }
  return {
    patientIds: [...new Set(patientIds)].sort(),
    countsByType,
    totalResources: (bundle?.entry ?? []).filter(e => e.resource?.resourceType).length,
  };
}

export function mergeBundles(bundles: Bundle[]): Bundle {
  const seen = new Set<string>();
  const entry: Bundle['entry'] = [];
  for (const bundle of bundles) {
    for (const e of bundle.entry ?? []) {
      const r = e.resource;
      if (!r?.resourceType || !r.id) {
        continue;
      }
      const key = `${r.resourceType}/${r.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entry.push({ resource: r });
    }
  }
  return { resourceType: 'Bundle', type: 'collection', entry };
}

export function valueSetExpansionRowsToFlatRows(rows: ValueSetExpansionRow[]): FlatRow[] {
  return rows.map(r => ({
    value_set_id: r.value_set_id,
    code: r.code,
    system: r.system,
    display: r.display ?? null,
    version: r.version ?? null,
  }));
}

export function validateCms125DemoBundle(bundle: Bundle): void {
  if (bundle.resourceType !== 'Bundle') {
    throw new Error(`Expected cms125-bundle.json to contain a FHIR Bundle; got ${bundle.resourceType ?? 'unknown'}.`);
  }
  if (!bundleHasClinicalResources(bundle)) {
    throw new Error(
      'cms125-bundle.json has no Patient, Encounter, Observation, Procedure, or Condition resources.',
    );
  }
}

export function resourceTypesInBundle(bundle: Bundle | null): string[] {
  const types = new Set<string>();
  for (const entry of bundle?.entry ?? []) {
    const resourceType = entry.resource?.resourceType;
    if (resourceType) {
      types.add(resourceType);
    }
  }
  if (types.size === 0) {
    return ['Patient'];
  }
  if (!types.has('Patient')) {
    types.add('Patient');
  }
  return [...types].sort();
}

export function bundleHasClinicalResources(bundle: Bundle | null): boolean {
  if (!bundle?.entry?.length) {
    return false;
  }
  return bundle.entry.some(e => {
    const r = e.resource;
    return (
      isResourceType(r, 'Patient') ||
      isResourceType(r, 'Encounter') ||
      isResourceType(r, 'Observation') ||
      isResourceType(r, 'Procedure') ||
      isResourceType(r, 'Condition')
    );
  });
}
