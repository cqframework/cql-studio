// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CodeSystem, Library, Resource, ValueSet } from 'fhir/r4';
import { LibraryService } from './library.service';
import { TerminologyService } from './terminology.service';
import { TranslationService } from './translation.service';
import { ElmIncludeParser } from './elm-include.lib';
import {
  extractElmValueSets,
  parseElmJsonForValueSets
} from './elm-value-set-extract.lib';
import {
  extractComposeCodeSystemUrls,
  extractComposeValueSetReferences,
  normalizeCanonicalKey
} from './valueset-compose-refs.lib';
import { prepareValueSetForCapability } from './fhir-package-manifest.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';

export type ExportNodeKind = 'library' | 'valueset' | 'codesystem';
export type ExportNodeStatus = 'resolved' | 'missing' | 'external' | 'cycle';

export interface ExportDependencyNode {
  key: string;
  kind: ExportNodeKind;
  status: ExportNodeStatus;
  label: string;
  detail?: string;
  resource?: Resource;
  cqlContent?: string;
  children: ExportDependencyNode[];
}

export interface ExportDependencyGraphOptions {
  includeCodeSystems?: boolean;
  terminologyCapability?: 'computable' | 'expanded';
}

export interface ExportDependencyGraph {
  roots: ExportDependencyNode[];
  libraries: Library[];
  valueSets: ValueSet[];
  codeSystems: CodeSystem[];
  flat: ExportDependencyNode[];
  missingCount: number;
  hasBlockingMissing: boolean;
  /** Fingerprint of options used to build this graph (for stale-check). */
  optionsKey: string;
}

export function exportGraphOptionsKey(options: ExportDependencyGraphOptions): string {
  return [
    options.includeCodeSystems !== false ? '1' : '0',
    options.terminologyCapability ?? 'computable'
  ].join('|');
}

@Injectable({
  providedIn: 'root'
})
export class ExportDependencyGraphService {
  private readonly libraryService = inject(LibraryService);
  private readonly terminologyService = inject(TerminologyService);
  private readonly translationService = inject(TranslationService);
  private readonly elmIncludeParser = inject(ElmIncludeParser);

  private readonly elmJsonCache = new Map<string, string | null>();
  private readonly elmXmlCache = new Map<string, string | null>();
  private readonly libraryCache = new Map<string, Library | null>();
  private readonly valueSetCache = new Map<string, ValueSet | null>();
  private readonly codeSystemCache = new Map<string, CodeSystem | null>();

  clearSessionCaches(): void {
    this.elmJsonCache.clear();
    this.elmXmlCache.clear();
    this.libraryCache.clear();
    this.valueSetCache.clear();
    this.codeSystemCache.clear();
  }

  async buildGraph(
    rootLibraries: Library[],
    options: ExportDependencyGraphOptions = {}
  ): Promise<ExportDependencyGraph> {
    const includeCodeSystems = options.includeCodeSystems !== false;
    const terminologyCapability = options.terminologyCapability ?? 'computable';
    const optionsKey = exportGraphOptionsKey(options);

    const librariesByKey = new Map<string, Library>();
    const valueSetsByKey = new Map<string, ValueSet>();
    const codeSystemsByKey = new Map<string, CodeSystem>();
    const flat: ExportDependencyNode[] = [];
    const seenFlat = new Set<string>();

    const roots: ExportDependencyNode[] = [];
    for (const root of rootLibraries) {
      const node = await this.walkLibrary(
        root,
        new Set<string>(),
        includeCodeSystems,
        terminologyCapability,
        librariesByKey,
        valueSetsByKey,
        codeSystemsByKey,
        flat,
        seenFlat
      );
      roots.push(node);
    }

    const missingCount = flat.filter((n) => n.status === 'missing').length;
    return {
      roots,
      libraries: [...librariesByKey.values()],
      valueSets: [...valueSetsByKey.values()],
      codeSystems: [...codeSystemsByKey.values()],
      flat,
      missingCount,
      hasBlockingMissing: missingCount > 0,
      optionsKey
    };
  }

  collectResources(graph: ExportDependencyGraph): Resource[] {
    return [...graph.libraries, ...graph.valueSets, ...graph.codeSystems];
  }

  private async walkLibrary(
    library: Library,
    ancestry: Set<string>,
    includeCodeSystems: boolean,
    terminologyCapability: 'computable' | 'expanded',
    librariesByKey: Map<string, Library>,
    valueSetsByKey: Map<string, ValueSet>,
    codeSystemsByKey: Map<string, CodeSystem>,
    flat: ExportDependencyNode[],
    seenFlat: Set<string>
  ): Promise<ExportDependencyNode> {
    const key = this.libraryKey(library);
    if (ancestry.has(key)) {
      return {
        key,
        kind: 'library',
        status: 'cycle',
        label: this.libraryLabel(library),
        detail: 'Circular library include',
        children: []
      };
    }

    // Already fully walked as a dependency of another root — reuse without re-walking.
    if (librariesByKey.has(key) && seenFlat.has(key)) {
      return {
        key,
        kind: 'library',
        status: 'resolved',
        label: this.libraryLabel(library),
        detail: library.url,
        resource: librariesByKey.get(key),
        children: []
      };
    }

    librariesByKey.set(key, library);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(key);

    let cqlContent = '';
    try {
      const cql = await firstValueFrom(this.libraryService.getCqlContent(library));
      cqlContent = cql.cqlContent ?? '';
    } catch {
      cqlContent = '';
    }

    const { elmXml, elmJson } = await this.resolveElmForLibrary(library, cqlContent, key);

    const children: ExportDependencyNode[] = [];

    const includeRefs = elmXml ? this.elmIncludeParser.extractIncludes(elmXml) : [];
    for (const ref of includeRefs) {
      if (this.elmIncludeParser.isBundledLibraryPath(ref.path)) {
        continue;
      }

      if (!this.elmIncludeParser.isFhirResolvable(ref)) {
        continue;
      }

      const childLib = await this.resolveLibrary(ref.path, ref.version);
      if (!childLib) {
        const missing: ExportDependencyNode = {
          key: `library|${ref.path}|${ref.version ?? ''}`,
          kind: 'library',
          status: 'missing',
          label: `${ref.path}${ref.version ? ` ${ref.version}` : ''}`,
          detail: 'Library include could not be resolved on the FHIR server',
          children: []
        };
        children.push(missing);
        this.pushFlat(flat, seenFlat, missing);
        continue;
      }

      const childNode = await this.walkLibrary(
        childLib,
        nextAncestry,
        includeCodeSystems,
        terminologyCapability,
        librariesByKey,
        valueSetsByKey,
        codeSystemsByKey,
        flat,
        seenFlat
      );
      children.push(childNode);
    }

    if (elmJson) {
      const wrapper = parseElmJsonForValueSets(elmJson);
      if (wrapper) {
        const vsRefs = extractElmValueSets(wrapper);
        for (const vsRef of vsRefs) {
          const vsNode = await this.walkValueSet(
            vsRef.url,
            vsRef.version,
            nextAncestry,
            includeCodeSystems,
            terminologyCapability,
            valueSetsByKey,
            codeSystemsByKey,
            flat,
            seenFlat
          );
          children.push(vsNode);
        }
      }
    }

    const node: ExportDependencyNode = {
      key,
      kind: 'library',
      status: 'resolved',
      label: this.libraryLabel(library),
      detail: cqlContent.trim()
        ? library.url
        : `${library.url ?? ''} (no CQL content)`.trim(),
      resource: library,
      cqlContent,
      children
    };
    this.pushFlat(flat, seenFlat, node);
    return node;
  }

  private async walkValueSet(
    url: string,
    version: string | undefined,
    ancestry: Set<string>,
    includeCodeSystems: boolean,
    terminologyCapability: 'computable' | 'expanded',
    valueSetsByKey: Map<string, ValueSet>,
    codeSystemsByKey: Map<string, CodeSystem>,
    flat: ExportDependencyNode[],
    seenFlat: Set<string>
  ): Promise<ExportDependencyNode> {
    const key = `valueset|${normalizeCanonicalKey(url)}|${version ?? ''}`;
    if (ancestry.has(key)) {
      return {
        key,
        kind: 'valueset',
        status: 'cycle',
        label: url,
        detail: 'Circular ValueSet compose reference',
        children: []
      };
    }

    if (valueSetsByKey.has(key) && seenFlat.has(key)) {
      return {
        key,
        kind: 'valueset',
        status: 'resolved',
        label: url,
        resource: valueSetsByKey.get(key),
        children: []
      };
    }

    const vs = await this.resolveValueSet(url, version);
    if (!vs) {
      const missing: ExportDependencyNode = {
        key,
        kind: 'valueset',
        status: 'missing',
        label: url,
        detail: 'ValueSet could not be resolved on the terminology server',
        children: []
      };
      this.pushFlat(flat, seenFlat, missing);
      return missing;
    }

    const prepared = prepareValueSetForCapability(vs, terminologyCapability);
    valueSetsByKey.set(key, prepared);

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(key);
    const children: ExportDependencyNode[] = [];

    for (const ref of extractComposeValueSetReferences(vs)) {
      children.push(
        await this.walkValueSet(
          ref.reference,
          undefined,
          nextAncestry,
          includeCodeSystems,
          terminologyCapability,
          valueSetsByKey,
          codeSystemsByKey,
          flat,
          seenFlat
        )
      );
    }

    if (includeCodeSystems) {
      for (const system of extractComposeCodeSystemUrls(vs)) {
        children.push(
          await this.walkCodeSystem(system, codeSystemsByKey, flat, seenFlat)
        );
      }
    }

    const node: ExportDependencyNode = {
      key,
      kind: 'valueset',
      status: 'resolved',
      label: vs.title || vs.name || vs.id || url,
      detail: vs.url || url,
      resource: prepared,
      children
    };
    this.pushFlat(flat, seenFlat, node);
    return node;
  }

  private async walkCodeSystem(
    systemUrl: string,
    codeSystemsByKey: Map<string, CodeSystem>,
    flat: ExportDependencyNode[],
    seenFlat: Set<string>
  ): Promise<ExportDependencyNode> {
    const key = `codesystem|${normalizeCanonicalKey(systemUrl)}`;
    if (codeSystemsByKey.has(key) && seenFlat.has(key)) {
      return {
        key,
        kind: 'codesystem',
        status: 'resolved',
        label: systemUrl,
        resource: codeSystemsByKey.get(key),
        children: []
      };
    }

    const cs = await this.resolveCodeSystem(systemUrl);
    if (!cs) {
      const external: ExportDependencyNode = {
        key,
        kind: 'codesystem',
        status: 'external',
        label: systemUrl,
        detail: 'CodeSystem not found on terminology server (treated as external)',
        children: []
      };
      this.pushFlat(flat, seenFlat, external);
      return external;
    }

    codeSystemsByKey.set(key, cs);
    const node: ExportDependencyNode = {
      key,
      kind: 'codesystem',
      status: 'resolved',
      label: cs.title || cs.name || cs.id || systemUrl,
      detail: cs.url || systemUrl,
      resource: cs,
      children: []
    };
    this.pushFlat(flat, seenFlat, node);
    return node;
  }

  /**
   * Prefer stored elm+xml; if absent, translate CQL once for both XML (includes) and JSON (valueSets).
   */
  private async resolveElmForLibrary(
    library: Library,
    cqlContent: string,
    cacheKey: string
  ): Promise<{ elmXml: string | null; elmJson: string | null }> {
    if (this.elmXmlCache.has(cacheKey) && this.elmJsonCache.has(cacheKey)) {
      return {
        elmXml: this.elmXmlCache.get(cacheKey) ?? null,
        elmJson: this.elmJsonCache.get(cacheKey) ?? null
      };
    }

    let elmXml: string | null = null;
    try {
      elmXml = (await firstValueFrom(this.libraryService.getElmXml(library))) || null;
    } catch {
      elmXml = null;
    }

    let elmJson: string | null = this.elmJsonCache.has(cacheKey)
      ? (this.elmJsonCache.get(cacheKey) ?? null)
      : null;

    if ((!elmXml || !elmJson) && cqlContent.trim()) {
      try {
        const result = await this.translationService.translateCqlToElmAsync(cqlContent, {
          fhirLibraryId: library.id ?? null,
          isDirty: false
        });
        if (!elmXml) {
          elmXml = result.elmXml;
        }
        if (!elmJson) {
          elmJson = result.elmJson;
        }
      } catch {
        // leave nulls
      }
    }

    this.elmXmlCache.set(cacheKey, elmXml);
    this.elmJsonCache.set(cacheKey, elmJson);
    return { elmXml, elmJson };
  }

  private async resolveLibrary(name: string, version: string | null): Promise<Library | null> {
    const cacheKey = `lib|${name}|${version ?? ''}`;
    if (this.libraryCache.has(cacheKey)) {
      return this.libraryCache.get(cacheKey) ?? null;
    }
    let lib: Library | null = null;
    try {
      lib = await firstValueFrom(
        this.libraryService.findByNameAndVersion(name, version ?? undefined, true)
      );
      if (!lib) {
        lib = await firstValueFrom(
          this.libraryService.findByNameAndVersion(name, version ?? undefined, false)
        );
      }
    } catch {
      lib = null;
    }
    this.libraryCache.set(cacheKey, lib);
    return lib;
  }

  private async resolveValueSet(url: string, version?: string): Promise<ValueSet | null> {
    const cacheKey = `vs|${normalizeCanonicalKey(url)}|${version ?? ''}`;
    if (this.valueSetCache.has(cacheKey)) {
      return this.valueSetCache.get(cacheKey) ?? null;
    }
    try {
      const bundle = await firstValueFrom(
        this.terminologyService.searchValueSets({
          url,
          _count: 5
        })
      );
      const entries = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is ValueSet => resourceTypeOf(r) === 'ValueSet');
      let match = entries[0] ?? null;
      if (version) {
        match = entries.find((v) => v.version === version) ?? match;
      }
      this.valueSetCache.set(cacheKey, match);
      return match;
    } catch {
      this.valueSetCache.set(cacheKey, null);
      return null;
    }
  }

  private async resolveCodeSystem(systemUrl: string): Promise<CodeSystem | null> {
    const cacheKey = `cs|${normalizeCanonicalKey(systemUrl)}`;
    if (this.codeSystemCache.has(cacheKey)) {
      return this.codeSystemCache.get(cacheKey) ?? null;
    }
    try {
      const cs = await firstValueFrom(this.terminologyService.getCodeSystemByUrl(systemUrl));
      this.codeSystemCache.set(cacheKey, cs);
      return cs;
    } catch {
      this.codeSystemCache.set(cacheKey, null);
      return null;
    }
  }

  private libraryKey(library: Library): string {
    const name = library.name || library.id || 'unknown';
    const version = library.version || '';
    const url = library.url || '';
    return `library|${name}|${version}|${normalizeCanonicalKey(url)}`;
  }

  private libraryLabel(library: Library): string {
    const name = library.title || library.name || library.id || 'Library';
    return library.version ? `${name} ${library.version}` : name;
  }

  private pushFlat(
    flat: ExportDependencyNode[],
    seenFlat: Set<string>,
    node: ExportDependencyNode
  ): void {
    if (seenFlat.has(node.key)) {
      return;
    }
    seenFlat.add(node.key);
    flat.push(node);
  }
}
