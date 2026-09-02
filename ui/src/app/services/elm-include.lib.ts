// Author: Preston Lee

import { Injectable } from '@angular/core';

export interface ElmIncludeRef {
  path: string;
  version: string | null;
  localIdentifier: string | null;
  system: string | null;
}

/**
 * Parses ELM XML for library include references used by the FHIR library source loader.
 */
@Injectable({
  providedIn: 'root'
})
export class ElmIncludeParser {
  private static readonly bundledLibraryPaths = new Set(['FHIRHelpers']);

  cacheKey(path: string, system: string | null | undefined, version: string | null | undefined): string {
    return `${system ?? ''}|${path}|${version ?? ''}`;
  }

  isBundledLibraryPath(path: string): boolean {
    return ElmIncludeParser.bundledLibraryPaths.has(path);
  }

  isFhirResolvable(ref: ElmIncludeRef): boolean {
    return !!ref.path && !this.isBundledLibraryPath(ref.path);
  }

  /**
   * Extract library include references from ELM XML.
   * Reads structured `includes/def` elements and `CqlToElmError` include annotations only.
   */
  extractIncludes(elmXml: string): ElmIncludeRef[] {
    if (!elmXml?.trim()) {
      return [];
    }

    const doc = new DOMParser().parseFromString(elmXml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return [];
    }

    const refs: ElmIncludeRef[] = [];
    const seen = new Set<string>();

    const addRef = (
      path: string | null,
      version: string | null,
      localIdentifier: string | null,
      system: string | null
    ): void => {
      if (!path) {
        return;
      }
      const ref: ElmIncludeRef = {
        path,
        version: version || null,
        localIdentifier: localIdentifier || null,
        system: system || null
      };
      const key = this.cacheKey(ref.path, ref.system, ref.version);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      refs.push(ref);
    };

    for (const def of doc.querySelectorAll('includes > def')) {
      addRef(
        def.getAttribute('path'),
        def.getAttribute('version'),
        def.getAttribute('localIdentifier'),
        def.getAttribute('system')
      );
    }

    for (const error of doc.querySelectorAll('annotation')) {
      const typeAttr =
        error.getAttribute('xsi:type') ??
        error.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type');
      if (typeAttr !== 'a:CqlToElmError' && !typeAttr?.endsWith(':CqlToElmError')) {
        continue;
      }
      if (error.getAttribute('errorType') !== 'include') {
        continue;
      }
      addRef(
        error.getAttribute('targetIncludeLibraryId'),
        error.getAttribute('targetIncludeLibraryVersionId'),
        null,
        error.getAttribute('targetIncludeLibrarySystem')
      );
    }

    return refs;
  }

  /** Include refs that should be fetched from the FHIR server (excludes bundled libraries). */
  extractFhirIncludes(elmXml: string): ElmIncludeRef[] {
    return this.extractIncludes(elmXml).filter(ref => this.isFhirResolvable(ref));
  }
}
