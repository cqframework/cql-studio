// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Library } from 'fhir/r4';
import { LibraryService } from './library.service';
import {
  ElmIncludeParser,
  ElmIncludeRef
} from './elm-include.lib';
import { LOGIC_LIBRARY_TYPE_CODE } from './cql-model-info.lib';
import { rewriteFhirHelpersCql } from './cql-model-info.lib';

export interface LibraryTranslationContext {
  fhirLibraryId?: string | null;
  isDirty?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CqlLibrarySourceService {
  private readonly libraryService = inject(LibraryService);
  private readonly elmIncludeParser = inject(ElmIncludeParser);
  private readonly cqlCache = new Map<string, string>();
  private readonly elmCache = new Map<string, string>();

  getCachedCql(path: string, system: string | null | undefined, version: string | null | undefined): string | null {
    const key = this.elmIncludeParser.cacheKey(path, system, version);
    return this.cqlCache.get(key) ?? null;
  }

  hasCachedCql(path: string, system: string | null | undefined, version: string | null | undefined): boolean {
    return this.cqlCache.has(this.elmIncludeParser.cacheKey(path, system, version));
  }

  setCachedCql(
    path: string,
    system: string | null | undefined,
    version: string | null | undefined,
    cqlContent: string
  ): void {
    if (!cqlContent.trim()) {
      return;
    }
    this.cqlCache.set(this.elmIncludeParser.cacheKey(path, system ?? null, version ?? null), cqlContent);
  }

  getCachedElm(path: string, system: string | null | undefined, version: string | null | undefined): string | null {
    const key = this.elmIncludeParser.cacheKey(path, system, version);
    return this.elmCache.get(key) ?? null;
  }

  setCachedElm(
    path: string,
    system: string | null | undefined,
    version: string | null | undefined,
    elmXml: string
  ): void {
    if (!elmXml.trim()) {
      return;
    }
    this.elmCache.set(this.elmIncludeParser.cacheKey(path, system ?? null, version ?? null), elmXml);
  }

  invalidate(path?: string, version?: string | null, system?: string | null): void {
    if (!path) {
      this.cqlCache.clear();
      this.elmCache.clear();
      return;
    }
    const key = this.elmIncludeParser.cacheKey(path, system ?? null, version ?? null);
    this.cqlCache.delete(key);
    this.elmCache.delete(key);
  }

  /**
   * Prefetch transitive library dependencies from stored FHIR ELM and/or compiler output ELM.
   * Returns true when at least one new library was fetched into the cache.
   */
  async prefetchIncludesFromElmXml(elmXml: string, visiting: Set<string> = new Set()): Promise<boolean> {
    const refs = this.elmIncludeParser.extractFhirIncludes(elmXml);
    let fetchedAny = false;

    for (const ref of refs) {
      const fetched = await this.ensureLibraryCached(ref, visiting);
      if (fetched) {
        fetchedAny = true;
      }
    }

    return fetchedAny;
  }

  async prefetchFromStoredLibrary(fhirLibraryId: string): Promise<boolean> {
    const library = await firstValueFrom(this.libraryService.get(fhirLibraryId));
    const { cqlContent } = await firstValueFrom(this.libraryService.getCqlContent(library));
    if (cqlContent.trim()) {
      return this.prefetchIncludesFromCql(cqlContent);
    }

    // No CQL attachment — fall back to stored ELM include refs.
    const elmXml = await firstValueFrom(this.libraryService.getElmXml(library));
    if (!elmXml.trim()) {
      return false;
    }
    return this.prefetchIncludesFromElmXml(elmXml);
  }

  /** Prefetch transitive includes discovered from CQL `include` directives. */
  async prefetchIncludesFromCql(cql: string, visiting: Set<string> = new Set()): Promise<boolean> {
    return this.fetchMissingIncludes(this.elmIncludeParser.extractFhirIncludesFromCql(cql), visiting);
  }

  async fetchMissingIncludes(refs: ElmIncludeRef[], visiting: Set<string> = new Set()): Promise<boolean> {
    let fetchedAny = false;
    for (const ref of refs.filter(ref => this.elmIncludeParser.isFhirResolvable(ref))) {
      const fetched = await this.ensureLibraryCached(ref, visiting);
      if (fetched) {
        fetchedAny = true;
      }
    }
    return fetchedAny;
  }

  /**
   * Collect every FHIR-resolvable include whose CQL is already in cache, walking the
   * transitive graph via CQL `include` directives when CQL is present (ELM only when
   * CQL is not). Used by the debug worker payload for chains like
   * LipidManagement → OpenCVDRisk → BMI.
   */
  collectTransitiveCachedSources(
    elmXml: string,
    rootCql?: string | null
  ): Array<{ id: string; version?: string | null; system?: string | null; cql: string }> {
    const out: Array<{ id: string; version?: string | null; system?: string | null; cql: string }> = [];
    const seen = new Set<string>();

    const childRefsFor = (cql: string, path: string, system: string | null, version: string | null): ElmIncludeRef[] => {
      if (cql.trim()) {
        return this.elmIncludeParser.extractFhirIncludesFromCql(cql);
      }
      const childElm = this.getCachedElm(path, system, version);
      return childElm?.trim() ? this.elmIncludeParser.extractFhirIncludes(childElm) : [];
    };

    const visitRefs = (refs: ElmIncludeRef[]): void => {
      for (const include of refs) {
        const key = this.elmIncludeParser.cacheKey(include.path, include.system, include.version);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const cached = this.getCachedCql(include.path, include.system, include.version);
        if (!cached) {
          continue;
        }
        out.push({
          id: include.path,
          version: include.version,
          system: include.system,
          cql: cached,
        });

        visitRefs(childRefsFor(cached, include.path, include.system, include.version));
      }
    };

    if (rootCql?.trim()) {
      visitRefs(this.elmIncludeParser.extractFhirIncludesFromCql(rootCql));
    } else if (elmXml?.trim()) {
      visitRefs(this.elmIncludeParser.extractFhirIncludes(elmXml));
    }

    return out;
  }

  private async ensureLibraryCached(ref: ElmIncludeRef, visiting: Set<string>): Promise<boolean> {
    const key = this.elmIncludeParser.cacheKey(ref.path, ref.system, ref.version);
    if (visiting.has(key)) {
      return false;
    }
    visiting.add(key);

    let fetchedAny = false;
    let library: Library | null = null;

    if (!this.cqlCache.has(key)) {
      library = await this.findLogicLibrary(ref.path, ref.version);
      if (!library) {
        visiting.delete(key);
        return false;
      }

      const { cqlContent } = await firstValueFrom(this.libraryService.getCqlContent(library));
      if (!cqlContent.trim()) {
        visiting.delete(key);
        return false;
      }

      const aligned =
        ref.path === 'FHIRHelpers' && ref.version
          ? rewriteFhirHelpersCql(cqlContent, ref.version, ref.version)
          : cqlContent;
      this.cqlCache.set(key, aligned);
      fetchedAny = true;
    }

    // Cache ELM when available (definition index / other consumers), but always walk
    // children from CQL when present so grandchild includes are not missed.
    if (!this.elmCache.has(key)) {
      if (!library) {
        library = await this.findLogicLibrary(ref.path, ref.version);
      }
      if (library) {
        const elmXml = await firstValueFrom(this.libraryService.getElmXml(library));
        if (elmXml.trim()) {
          this.elmCache.set(key, elmXml);
        }
      }
    }

    const cql = this.cqlCache.get(key);
    if (cql?.trim()) {
      const childFetched = await this.prefetchIncludesFromCql(cql, visiting);
      if (childFetched) {
        fetchedAny = true;
      }
    } else {
      const elmXml = this.elmCache.get(key);
      if (elmXml?.trim()) {
        const childFetched = await this.prefetchIncludesFromElmXml(elmXml, visiting);
        if (childFetched) {
          fetchedAny = true;
        }
      }
    }

    visiting.delete(key);
    return fetchedAny;
  }

  /** Resolve logic-library includes: content first, then evaluation. */
  private async findLogicLibrary(
    name: string,
    version: string | null | undefined
  ): Promise<Library | null> {
    const ver = version ?? undefined;
    const fromContent = await firstValueFrom(
      this.libraryService.findByNameAndVersion(name, ver, true, LOGIC_LIBRARY_TYPE_CODE)
    );
    if (fromContent) {
      return fromContent;
    }
    return firstValueFrom(
      this.libraryService.findByNameAndVersion(name, ver, false, LOGIC_LIBRARY_TYPE_CODE)
    );
  }
}
