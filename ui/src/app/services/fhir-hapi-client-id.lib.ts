// Author: Preston Lee

import { Resource } from 'fhir/r4';
import { resourceTypeOf } from './fhir-resource-type.lib';

/**
 * HAPI (HAPI-0960) rejects client-assigned logical ids that contain only digits.
 * Registry packages such as hl7.fhir.r4.core may use numeric-only ids; we rewrite
 * them to a stable prefixed form and fix relative Reference.reference values.
 */
const NUMERIC_ONLY_ID = /^\d+$/;

function visitResourcesDepthFirst(root: Resource, visit: (r: Resource) => void): void {
  const stack: Resource[] = [root];
  while (stack.length > 0) {
    const r = stack.pop()!;
    visit(r);
    const contained = (r as { contained?: Resource[] }).contained;
    if (Array.isArray(contained)) {
      for (const c of contained) {
        if (resourceTypeOf(c)) {
          stack.push(c);
        }
      }
    }
  }
}

function rewriteReferenceValue(value: string, remap: Map<string, string>): string {
  const pipe = value.indexOf('|');
  const refPart = pipe >= 0 ? value.slice(0, pipe) : value;
  const rest = pipe >= 0 ? value.slice(pipe) : '';
  const mapped = remap.get(refPart);
  return mapped != null ? mapped + rest : value;
}

function rewriteReferencesDeep(node: unknown, remap: Map<string, string>): void {
  if (node === null || node === undefined) {
    return;
  }
  if (typeof node === 'string') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      rewriteReferencesDeep(item, remap);
    }
    return;
  }
  if (typeof node !== 'object') {
    return;
  }
  const o = node as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'reference' && typeof v === 'string') {
      o[k] = rewriteReferenceValue(v, remap);
    } else {
      rewriteReferencesDeep(v, remap);
    }
  }
}

function applyNumericIdPrefixToTree(root: Resource): void {
  visitResourcesDepthFirst(root, (res) => {
    const id = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
    if (!id || !NUMERIC_ONLY_ID.test(id)) {
      return;
    }
    (res as { id: string }).id = `n${id}`;
  });
}

/** Builds the `Type/oldId` → `Type/newId` (plus `#oldId` → `#newId`) remap for a resource set. */
function buildNumericIdRemap(roots: Resource[]): Map<string, string> {
  const remap = new Map<string, string>();
  for (const root of roots) {
    visitResourcesDepthFirst(root, (res) => {
      const id = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
      const resourceType = resourceTypeOf(res);
      if (!id || !NUMERIC_ONLY_ID.test(id)) {
        return;
      }
      if (resourceType) {
        remap.set(`${resourceType}/${id}`, `${resourceType}/n${id}`);
      }
      // Contained resources are referenced locally as "#id" rather than "Type/id"; a numeric-only
      // contained id needs the same prefix rewrite so `#1` still resolves after `id` becomes `n1`.
      remap.set(`#${id}`, `#n${id}`);
    });
  }
  return remap;
}

/**
 * For one transaction, build remap from every logical id (all roots and contained),
 * apply `n`+digit ids, then rewrite references so cross-resource links stay valid.
 */
export function applyHapiNumericIdRulesToTransactionRoots(roots: Resource[]): void {
  const remap = buildNumericIdRemap(roots);
  if (remap.size === 0) {
    return;
  }
  for (const root of roots) {
    applyNumericIdPrefixToTree(root);
    rewriteReferencesDeep(root, remap);
  }
}

/**
 * Mutates `root` in place: prefixes numeric-only logical ids and rewrites
 * `reference` strings that pointed at the old relative URLs (single-root graph only).
 */
export function mangleNumericOnlyIdsForHapi(root: Resource): void {
  applyHapiNumericIdRulesToTransactionRoots([root]);
}

/**
 * Deep-clones each resource, applies HAPI-safe id rules across the full transaction
 * so references between separate bundle entries are rewritten consistently.
 */
export function cloneResourcesWithHapiSafeClientIds(resources: Resource[]): Resource[] {
  const clones = resources.map((r) => structuredClone(r) as Resource);
  applyHapiNumericIdRulesToTransactionRoots(clones);
  return clones;
}

interface BundleEntryLike {
  fullUrl?: string;
  resource?: Resource;
  request?: { method?: string; url?: string; ifNoneExist?: string };
}

/**
 * Same numeric-id rewrite as `cloneResourcesWithHapiSafeClientIds`, but also fixes up
 * `request.url` on PUT entries (which otherwise still target the old, HAPI-rejected id) so a
 * pre-built transaction/collection bundle (e.g. from CRMI packaging) stays internally consistent.
 */
export function cloneBundleEntriesWithHapiSafeClientIds<T extends BundleEntryLike>(entries: T[]): T[] {
  const clones = entries.map((e) => structuredClone(e)) as T[];
  const roots = clones.map((e) => e.resource).filter((r): r is Resource => !!r);
  const remap = buildNumericIdRemap(roots);
  if (remap.size === 0) {
    return clones;
  }
  for (const root of roots) {
    applyNumericIdPrefixToTree(root);
    rewriteReferencesDeep(root, remap);
  }
  for (const entry of clones) {
    const url = entry.request?.url;
    if (entry.request && typeof url === 'string') {
      const mapped = remap.get(url);
      if (mapped) {
        entry.request.url = mapped;
      }
    }
  }
  return clones;
}
