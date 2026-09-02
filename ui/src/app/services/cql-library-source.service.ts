// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Library } from 'fhir/r4';
import { LibraryService } from './library.service';
import {
  ElmIncludeParser,
  ElmIncludeRef
} from './elm-include.lib';

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
    const elmXml = await firstValueFrom(this.libraryService.getElmXml(library));
    if (!elmXml.trim()) {
      return false;
    }
    return this.prefetchIncludesFromElmXml(elmXml);
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

  private async ensureLibraryCached(ref: ElmIncludeRef, visiting: Set<string>): Promise<boolean> {
    const key = this.elmIncludeParser.cacheKey(ref.path, ref.system, ref.version);
    if (this.cqlCache.has(key)) {
      return false;
    }
    if (visiting.has(key)) {
      return false;
    }
    visiting.add(key);

    const library = await firstValueFrom(
      this.libraryService.findByNameAndVersion(ref.path, ref.version ?? undefined, true)
    );
    if (!library) {
      visiting.delete(key);
      return false;
    }

    const { cqlContent } = await firstValueFrom(this.libraryService.getCqlContent(library));
    if (!cqlContent.trim()) {
      visiting.delete(key);
      return false;
    }

    this.cqlCache.set(key, cqlContent);

    const elmXml = await firstValueFrom(this.libraryService.getElmXml(library));
    if (elmXml.trim()) {
      this.elmCache.set(key, elmXml);
      await this.prefetchIncludesFromElmXml(elmXml, visiting);
    }

    visiting.delete(key);
    return true;
  }
}
