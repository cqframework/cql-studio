// Author: Preston Lee

import { Bundle, ImplementationGuide, Resource } from 'fhir/r4';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import {
  DEFAULT_FHIR_CORE_PACKAGE,
  DEFAULT_FHIR_CORE_VERSION,
  FhirPackageManifestInput
} from './fhir-package-manifest.lib';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';
import { decodeUtf8Bytes } from './utf8-encoding.lib';
import { guessResourceTypeFromCanonicalUrl, isConformanceResourceType } from './fhir-resource-endpoint.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';

export interface IgResourceEntryVm {
  key: string;
  reference: string;
  name?: string;
  groupingId?: string;
  relativePath?: string;
  isExample: boolean;
  importable: boolean;
  skipReason?: string;
  matchedRowKey?: string;
  matchedResourceKey?: string;
  resourceTypeHint?: string;
}

export interface IgEntryImportability {
  importable: boolean;
  reason?: string;
}

const NON_IMPORTABLE_TYPES = new Set(['CapabilityStatement', 'Binary']);

export function isDefaultIgImportableResourceType(resourceType: string): boolean {
  return !!resourceType && !NON_IMPORTABLE_TYPES.has(resourceType);
}

function referenceKey(ref: string): string {
  return ref.trim().toLowerCase();
}

function igEntryReferenceText(entry: {
  reference?: { reference?: string; display?: string };
}): string {
  return entry.reference?.reference ?? entry.reference?.display ?? '';
}

function parseReferenceParts(ref: string): { type?: string; id?: string; url?: string } {
  const trimmed = ref.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('urn:')) {
    const pipe = trimmed.indexOf('|');
    const url = pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
    return { url, type: guessResourceTypeFromCanonicalUrl(url) };
  }
  const slash = trimmed.indexOf('/');
  if (slash > 0) {
    return { type: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
  }
  return { url: trimmed };
}

function entryIsExample(entry: {
  exampleBoolean?: boolean;
  exampleCanonical?: string;
}): boolean {
  return entry.exampleBoolean === true || !!entry.exampleCanonical?.trim();
}

function bundleIsSearchset(resource: Resource | undefined): boolean {
  return resourceTypeOf(resource) === 'Bundle' && (resource as Bundle).type === 'searchset';
}

export function classifyIgEntryImportability(
  entry: IgResourceEntryVm,
  resolvedResource?: Resource
): IgEntryImportability {
  if (entry.isExample) {
    return { importable: false, reason: 'Example instance' };
  }
  const hint = entry.resourceTypeHint ?? parseReferenceParts(entry.reference).type ?? '';
  if (hint && !isDefaultIgImportableResourceType(hint)) {
    return { importable: false, reason: `${hint} is not imported by default` };
  }
  if (bundleIsSearchset(resolvedResource)) {
    return { importable: false, reason: 'searchset Bundle is not persistable on most servers' };
  }
  // Bundle without resolved bytes: allow selection when archive matching later finds a row.
  // Only reject searchset once the resource body is available.
  return { importable: true };
}

function definitionEntryKey(
  reference: string,
  relativePath?: string
): string {
  const base = referenceKey(reference);
  return relativePath ? `${base}|${relativePath.trim().toLowerCase()}` : base;
}

export function parseImplementationGuideEntries(ig: ImplementationGuide): IgResourceEntryVm[] {
  const map = new Map<string, IgResourceEntryVm>();

  const add = (opts: {
    reference: string;
    name?: string;
    groupingId?: string;
    relativePath?: string;
    isExample: boolean;
  }) => {
    const ref = opts.reference?.trim();
    if (!ref) {
      return;
    }
    // Selection identity is pathless so definition + manifest rows for the same ref merge.
    const key = definitionEntryKey(ref);
    const parts = parseReferenceParts(ref);
    const existing = map.get(key);
    const vm: IgResourceEntryVm = {
      key,
      reference: ref,
      name: opts.name ?? existing?.name,
      groupingId: opts.groupingId ?? existing?.groupingId,
      relativePath: opts.relativePath ?? existing?.relativePath,
      isExample: opts.isExample || (existing?.isExample ?? false),
      importable: true,
      resourceTypeHint: parts.type
    };
    const classified = classifyIgEntryImportability(vm);
    vm.importable = classified.importable;
    vm.skipReason = classified.reason;
    map.set(key, vm);
  };

  for (const r of ig.definition?.resource ?? []) {
    const ref = igEntryReferenceText(r);
    add({
      reference: ref,
      name: r.name,
      groupingId: r.groupingId,
      isExample: entryIsExample(r)
    });
  }

  for (const r of ig.manifest?.resource ?? []) {
    const ref = igEntryReferenceText(r);
    add({
      reference: ref,
      name: undefined,
      relativePath: r.relativePath,
      isExample: entryIsExample(r)
    });
  }

  return [...map.values()].sort((a, b) => a.reference.localeCompare(b.reference));
}

export function defaultSelectedIgEntryKeys(entries: IgResourceEntryVm[]): Set<string> {
  const keys = new Set<string>();
  for (const e of entries) {
    if (!e.importable) {
      continue;
    }
    const type = e.resourceTypeHint ?? parseReferenceParts(e.reference).type ?? '';
    if (type && isConformanceResourceType(type)) {
      keys.add(e.key);
    }
  }
  return keys;
}

export function matchIgReferenceToArchiveRow(
  reference: string,
  relativePath: string | undefined,
  rows: IndexedResourceRowVm[]
): IndexedResourceRowVm | null {
  if (relativePath?.trim()) {
    const norm = relativePath.trim().toLowerCase();
    const byPath = rows.find(
      (r) =>
        r.filename.toLowerCase() === norm ||
        r.filename.toLowerCase().endsWith('/' + norm.replace(/^package\//, ''))
    );
    if (byPath) {
      return byPath;
    }
  }

  const parts = parseReferenceParts(reference);
  if (parts.type && parts.id) {
    const byId = rows.find((r) => r.resourceType === parts.type && r.id === parts.id);
    if (byId) {
      return byId;
    }
  }

  if (parts.url) {
    const urlLower = parts.url.toLowerCase();
    const byUrl = rows.find((r) => (r.url ?? '').toLowerCase() === urlLower);
    if (byUrl) {
      return byUrl;
    }
  }

  return null;
}

export function matchIgReferenceToBundleEntry(
  reference: string,
  resources: Resource[]
): Resource | null {
  const parts = parseReferenceParts(reference);
  if (parts.type && parts.id) {
    const hit = resources.find(
      (r) => resourceTypeOf(r) === parts.type && (r as { id?: string }).id === parts.id
    );
    if (hit) {
      return hit;
    }
  }
  if (parts.url) {
    const urlLower = parts.url.toLowerCase();
    const hit = resources.find((r) => {
      const url = (r as { url?: string }).url;
      return typeof url === 'string' && url.toLowerCase() === urlLower;
    });
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function enrichIgEntriesForArchive(
  entries: IgResourceEntryVm[],
  rows: IndexedResourceRowVm[],
  filesResources?: Map<string, Resource>
): IgResourceEntryVm[] {
  return entries.map((e) => {
    const row = matchIgReferenceToArchiveRow(e.reference, e.relativePath, rows);
    let resolved: Resource | undefined;
    if (row && filesResources) {
      resolved = filesResources.get(row.filename) ?? filesResources.get(row.rowKey);
    }
    const classified = classifyIgEntryImportability(e, resolved);
    const matched = !!row;
    return {
      ...e,
      matchedRowKey: row?.rowKey,
      importable: classified.importable && matched,
      skipReason: !matched ? 'Not in package' : classified.reason,
      matchedResourceKey: resolved ? exportDataResourceKey(resolved) : undefined
    };
  });
}

export function enrichIgEntriesForBundle(
  entries: IgResourceEntryVm[],
  resources: Resource[]
): IgResourceEntryVm[] {
  return entries.map((e) => {
    const matched = matchIgReferenceToBundleEntry(e.reference, resources);
    const classified = classifyIgEntryImportability(e, matched ?? undefined);
    return {
      ...e,
      matchedResourceKey: matched ? exportDataResourceKey(matched) : undefined,
      importable: classified.importable && !!matched,
      skipReason: !matched ? 'Not present in bundle' : classified.reason
    };
  });
}

export function filterImplementationGuide(
  ig: ImplementationGuide,
  includedEntryKeys: ReadonlySet<string>,
  includedGlobalIndices?: ReadonlySet<number>
): ImplementationGuide {
  const copy = JSON.parse(JSON.stringify(ig)) as ImplementationGuide;
  const keepRef = (ref: string, relativePath?: string) =>
    includedEntryKeys.has(definitionEntryKey(ref, relativePath));

  if (copy.definition?.resource) {
    copy.definition.resource = copy.definition.resource.filter((r) => {
      const ref = igEntryReferenceText(r);
      return !!ref && keepRef(ref);
    });
  }
  if (copy.manifest?.resource) {
    copy.manifest.resource = copy.manifest.resource.filter((r) => {
      const ref = igEntryReferenceText(r);
      // Accept pathless selection keys (current) or legacy path-qualified keys.
      return !!ref && (keepRef(ref) || keepRef(ref, r.relativePath));
    });
  }
  if (copy.global) {
    copy.global = copy.global.filter((_, i) =>
      includedGlobalIndices ? includedGlobalIndices.has(i) : true
    );
  }
  return copy;
}

export function buildFhirPackageManifestFromIg(
  ig: ImplementationGuide,
  extraDeps?: Record<string, string>
): FhirPackageManifestInput {
  const deps: Record<string, string> = {
    [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION,
    ...(extraDeps ?? {})
  };
  for (const d of ig.dependsOn ?? []) {
    const pkgId = d.packageId?.trim();
    const ver = d.version?.trim() || '*';
    if (pkgId) {
      deps[pkgId] = ver;
    }
  }
  return {
    name: ig.packageId?.trim() || 'org.example.ig-export',
    version: ig.version?.trim() || '0.1.0',
    author: ig.publisher?.trim() || 'Unknown',
    description: ig.description?.trim() || ig.title?.trim() || ig.name || 'Implementation Guide export',
    title: ig.title?.trim() || ig.name,
    type: 'IG',
    canonical: ig.url,
    fhirVersions: ig.fhirVersion?.length ? [...ig.fhirVersion] : undefined,
    dependencies: deps
  };
}

export function findImplementationGuideInResources(resources: Resource[]): ImplementationGuide | null {
  for (const r of resources) {
    if (resourceTypeOf(r) === 'ImplementationGuide') {
      return r as ImplementationGuide;
    }
  }
  return null;
}

export function parseImplementationGuideFromPackageFiles(
  rows: IndexedResourceRowVm[],
  files: Map<string, Uint8Array>,
  filename?: string
): ImplementationGuide | null {
  const igRow = filename
    ? rows.find((r) => r.resourceType === 'ImplementationGuide' && r.filename === filename)
    : rows.find((r) => r.resourceType === 'ImplementationGuide');
  if (!igRow) {
    return null;
  }
  const key = resolvePackageArchiveKey(igRow.filename, files) ?? igRow.filename;
  const raw = files.get(key);
  if (!raw) {
    return null;
  }
  try {
    const text = decodeUtf8Bytes(raw, { fatal: false });
    const obj = JSON.parse(text) as ImplementationGuide;
    return obj.resourceType === 'ImplementationGuide' ? obj : null;
  } catch {
    return null;
  }
}

export function exportDataResourceKey(resource: Resource): string {
  const rt = resourceTypeOf(resource) ?? 'Resource';
  const id = (resource as { id?: string }).id?.trim();
  if (id) {
    return `${rt}|${id}`;
  }
  const url = (resource as { url?: string }).url?.trim();
  if (url) {
    return `${rt}|${url.toLowerCase()}`;
  }
  return `${rt}|${JSON.stringify(resource).length}`;
}
