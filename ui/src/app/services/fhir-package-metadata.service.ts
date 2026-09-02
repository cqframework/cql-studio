// Author: Preston Lee

import { Injectable } from '@angular/core';
import {
  FhirPackageIndexFile,
  FhirPackageIndexJson,
  FhirPackageJson
} from '../models/fhir-package-registry.types';
import {
  IndexedResourceRowVm,
  PackageSummaryVm,
  SuggestedImportTarget
} from '../models/fhir-package-view.model';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';
import { decodeUtf8Bytes } from './utf8-encoding.lib';
import {
  archivePathPrefixesForExampleDirectories,
  filenameIsUnderExamplePrefixes
} from './fhir-package-directories.lib';
import { fhirPackageAuthorToString } from './fhir-package-manifest.lib';

const TERMINOLOGY_TYPES = new Set(['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem']);

/** SearchParameter.base values that are not concrete REST types; HAPI rejects them on write (HAPI-1684). */
const ABSTRACT_SP_BASE_TYPES = new Set(['Resource', 'DomainResource']);

@Injectable({
  providedIn: 'root'
})
export class FhirPackageMetadataService {
  buildPackageSummary(pkg: FhirPackageJson): PackageSummaryVm {
    const name = pkg.name ?? '';
    const version = pkg.version ?? '';
    const fhirVersions = [...(pkg.fhirVersions ?? pkg['fhir-version-list'] ?? [])].filter(Boolean);
    const deps = pkg.dependencies ?? {};
    const dependencyList = Object.entries(deps).map(([n, v]) => ({ name: n, version: String(v) }));
    const canonical = pkg.canonical ?? '';
    let canonicalHref = '';
    if (canonical && /^https?:\/\//i.test(canonical)) {
      canonicalHref = canonical;
    }

    return {
      name,
      version,
      packageType: pkg.type ?? '',
      title: pkg.title ?? name,
      description: pkg.description ?? '',
      canonical,
      canonicalHref,
      fhirVersions,
      dependencies: dependencyList,
      jurisdiction: pkg.jurisdiction ?? '',
      specUrl: pkg.url ?? '',
      license: pkg.license != null ? String(pkg.license) : '',
      author: fhirPackageAuthorToString(pkg.author),
      date: pkg.date ?? '',
      exampleDirectoryPrefixes: archivePathPrefixesForExampleDirectories(pkg)
    };
  }

  buildIndexedRows(
    index: FhirPackageIndexJson | null,
    filesInArchive: Map<string, Uint8Array>,
    pkg: FhirPackageJson
  ): IndexedResourceRowVm[] {
    const examplePrefixes = archivePathPrefixesForExampleDirectories(pkg);
    const rows: IndexedResourceRowVm[] = [];
    const seen = new Set<string>();

    if (index?.files?.length) {
      for (const f of index.files) {
        const row = this.fileToRow(f, filesInArchive, examplePrefixes);
        if (row) {
          rows.push(row);
          seen.add(row.filename);
        }
      }
    }

    for (const path of filesInArchive.keys()) {
      if (!path.startsWith('package/') || !path.endsWith('.json')) {
        continue;
      }
      if (/(^|\/)package\.json$/.test(path) || /(^|\/)\.index\.json$/.test(path)) {
        continue;
      }
      if (seen.has(path)) {
        continue;
      }
      const synthetic: FhirPackageIndexFile = { filename: path };
      const row = this.fileToRow(synthetic, filesInArchive, examplePrefixes);
      if (row) {
        rows.push(row);
      }
    }

    return rows.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  private searchParameterHasAbstractBaseType(path: string, files: Map<string, Uint8Array>): boolean {
    const key = resolvePackageArchiveKey(path, files) ?? path;
    const raw = files.get(key);
    if (!raw) {
      return false;
    }
    try {
      const text = decodeUtf8Bytes(raw, { fatal: false });
      if (!text.trimStart().startsWith('{')) {
        return false;
      }
      const obj = JSON.parse(text) as { resourceType?: string; base?: string[] };
      if (obj.resourceType !== 'SearchParameter' || !Array.isArray(obj.base)) {
        return false;
      }
      return obj.base.some((b) => typeof b === 'string' && ABSTRACT_SP_BASE_TYPES.has(b));
    } catch {
      return false;
    }
  }

  /**
   * Best-effort parse of a package member's identity fields. Used to fill in `id`/`url`/`version`
   * when the package's `.index.json` entry is missing them (or there is no index at all), so
   * IG entry↔archive-row matching (`matchIgReferenceToArchiveRow`) doesn't silently fail on
   * synthetic rows built purely from the file list.
   */
  private readResourceSummary(
    path: string,
    files: Map<string, Uint8Array>
  ): { resourceType?: string; id?: string; url?: string; version?: string; kind?: string; type?: string } | null {
    const raw = files.get(path);
    if (!raw) {
      return null;
    }
    try {
      const text = decodeUtf8Bytes(raw, { fatal: false });
      if (!text.trimStart().startsWith('{')) {
        return null;
      }
      const obj = JSON.parse(text) as {
        resourceType?: string;
        id?: string;
        url?: string;
        version?: string;
        kind?: string;
        type?: unknown;
      };
      // `type` is a string on some resources (StructureDefinition.type, Bundle.type) but a
      // CodeableConcept on others (Library.type); only surface it when it's actually a string.
      return { ...obj, type: typeof obj.type === 'string' ? obj.type : undefined };
    } catch {
      return null;
    }
  }

  private fileToRow(
    f: FhirPackageIndexFile,
    files: Map<string, Uint8Array>,
    examplePrefixes: string[]
  ): IndexedResourceRowVm | null {
    const nameFromIndex = (f.filename ?? '').trim();
    if (!nameFromIndex) {
      return null;
    }
    const archiveKey = resolvePackageArchiveKey(nameFromIndex, files);
    const filename = archiveKey ?? nameFromIndex;
    const summary = this.readResourceSummary(filename, files);
    const fromFile = (summary?.resourceType ?? '').trim() || 'Unknown';
    let rt = (f.resourceType ?? '').trim() || fromFile;
    if (!rt) {
      rt = 'Unknown';
    }
    if (fromFile === 'CapabilityStatement') {
      rt = 'CapabilityStatement';
    }
    const isExample = filenameIsUnderExamplePrefixes(filename, examplePrefixes);
    const bundleType = fromFile === 'Bundle' ? summary?.type : undefined;
    const spAbstractBase =
      fromFile === 'SearchParameter' && this.searchParameterHasAbstractBaseType(filename, files);
    const suggested = this.suggestTarget(rt);
    return {
      rowKey: filename,
      filename,
      resourceType: rt,
      id: (f.id ?? summary?.id ?? '').trim(),
      url: (f.url ?? summary?.url ?? '').trim(),
      version: (f.version ?? summary?.version ?? '').trim(),
      kind: (f.kind ?? summary?.kind ?? '').trim(),
      typeField: (f.type ?? summary?.type ?? '').trim(),
      isExample,
      suggestedTarget: suggested,
      targetTerminology: suggested === 'terminology',
      targetData: suggested === 'data',
      category: this.categoryFor(rt, f.kind, f.type),
      importNote: this.importNoteFor(rt, suggested, isExample, bundleType, spAbstractBase),
      selected: this.rowSelectedByDefault(isExample, rt, fromFile, bundleType, spAbstractBase)
    };
  }

  /**
   * Example instances are selected. Default-off for CapabilityStatement, ImplementationGuide,
   * unknown/inferred-missing types, and searchset Bundles (not persistable; often referenced by IGs).
   */
  private rowSelectedByDefault(
    isExample: boolean,
    resourceType: string,
    inferredFromFile: string,
    bundleType: string | undefined,
    searchParameterAbstractBase: boolean
  ): boolean {
    if (isExample) {
      return true;
    }
    return !(
      inferredFromFile === 'Unknown' ||
      resourceType === 'Unknown' ||
      resourceType === 'CapabilityStatement' ||
      resourceType === 'ImplementationGuide' ||
      bundleType === 'searchset' ||
      searchParameterAbstractBase
    );
  }

  private suggestTarget(resourceType: string): SuggestedImportTarget {
    if (TERMINOLOGY_TYPES.has(resourceType)) {
      return 'terminology';
    }
    return 'data';
  }

  private categoryFor(resourceType: string, kind?: string, type?: string): string {
    if (TERMINOLOGY_TYPES.has(resourceType)) {
      return 'Terminology';
    }
    if (resourceType === 'StructureDefinition') {
      const k = (kind ?? '').toLowerCase();
      if (k === 'resource' || k === 'complex-type' || k === 'primitive-type') {
        return 'Profile / structure';
      }
      if (k === 'logical') {
        return 'Logical model';
      }
      return 'Profile / structure';
    }
    if (resourceType === 'ImplementationGuide') {
      return 'IG metadata';
    }
    if (resourceType === 'SearchParameter' || resourceType === 'OperationDefinition') {
      return 'Operations / search';
    }
    if (resourceType === 'CapabilityStatement' || resourceType === 'CompartmentDefinition') {
      return 'Conformance';
    }
    if (resourceType === 'Questionnaire' || resourceType === 'Library') {
      return 'Knowledge / narrative';
    }
    if (type) {
      return `${resourceType} (${type})`;
    }
    return resourceType === 'Unknown' ? 'Other' : resourceType;
  }

  private importNoteFor(
    resourceType: string,
    target: SuggestedImportTarget,
    isExample: boolean,
    bundleType: string | undefined,
    searchParameterAbstractBase: boolean
  ): string {
    if (resourceType === 'Bundle' && bundleType === 'searchset') {
      return 'FHIR search result bundle (searchset); not a storable instance on most servers (HAPI-0522). US Core lists these under the IG; skip import.';
    }
    if (resourceType === 'Bundle' && (bundleType === 'transaction' || bundleType === 'batch')) {
      return `FHIR ${bundleType} Bundle; posted to the server root so entries are processed. The Bundle wrapper is not stored.`;
    }
    if (isExample) {
      return 'Example instance (paths under package.json directories.example / directories.examples); optional for testing.';
    }
    if (target === 'terminology') {
      return 'Typical terminology server artifact (expand/validate).';
    }
    if (resourceType === 'ImplementationGuide') {
      return 'References many `definition.resource` entries, often example Bundles (`searchset`) that cannot be persisted. Importing this alone commonly fails with HAPI-1094 (missing referenced Bundle). Prefer profiles and ValueSets; omit this row for typical validation imports.';
    }
    if (resourceType === 'StructureDefinition') {
      return 'Conformance resource; requires a FHIR server that stores profiles.';
    }
    if (resourceType === 'CapabilityStatement') {
      return 'Server capability metadata; off by default—enable only if your FHIR server should store it.';
    }
    if (resourceType === 'SearchParameter' && searchParameterAbstractBase) {
      return 'SearchParameter targets abstract base type(s) (Resource, DomainResource); HAPI rejects these on write (HAPI-1684). Off by default.';
    }
    if (resourceType === 'Unknown') {
      return 'Could not infer type; confirm before import.';
    }
    return 'Import to FHIR data endpoint for profiles, artifacts, and examples.';
  }

  countByResourceType(rows: IndexedResourceRowVm[]): { resourceType: string; count: number }[] {
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = r.resourceType || 'Unknown';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([resourceType, count]) => ({ resourceType, count }))
      .sort((a, b) => b.count - a.count || a.resourceType.localeCompare(b.resourceType));
  }
}
