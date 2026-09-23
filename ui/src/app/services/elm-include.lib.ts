// Author: Preston Lee

import { Injectable } from '@angular/core';

export interface ElmIncludeRef {
  path: string;
  version: string | null;
  localIdentifier: string | null;
  system: string | null;
}

const LIBRARY_NAME_PART = /^[A-Za-z_][\w]*$/;

/**
 * The translator resolves `include hl7.fhir.uv.cql.FHIRHelpers` as a namespace,
 * and that namespace is not registered. Keep the local library name so lookup
 * uses `FHIRHelpers` with no system.
 */
export function unqualifyCqlLibraryIncludes(cql: string): string {
  return cql.replace(
    /^([ \t]*include[ \t]+)(?:[A-Za-z_][\w]*\.)+([A-Za-z_][\w]*)\b/gm,
    '$1$2',
  );
}

/**
 * `include hl7.fhir.uv.cql.FHIRHelpers` is a namespace plus a local name.
 * Unqualified names and quoted names that are not dotted identifiers stay as-is.
 */
export function splitQualifiedLibraryName(name: string): { path: string; system: string | null } {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot >= trimmed.length - 1) {
    return { path: trimmed, system: null };
  }
  const local = trimmed.slice(dot + 1);
  const namespace = trimmed.slice(0, dot);
  if (!LIBRARY_NAME_PART.test(local) || !namespace.split('.').every((part) => LIBRARY_NAME_PART.test(part))) {
    return { path: trimmed, system: null };
  }
  return { path: local, system: namespace };
}

/**
 * Parses ELM XML for library include references used by the FHIR library source loader.
 */
@Injectable({
  providedIn: 'root'
})
export class ElmIncludeParser {
  /** Bundled asset version under `ui/public/cql/FHIRHelpers-4.0.1.cql`. */
  static readonly BUNDLED_FHIR_HELPERS_VERSION = '4.0.1';

  cacheKey(path: string, system: string | null | undefined, version: string | null | undefined): string {
    return `${system ?? ''}|${path}|${version ?? ''}`;
  }

  /** True for FHIRHelpers regardless of version (export / UI skips). */
  isBundledLibraryPath(path: string): boolean {
    return path === 'FHIRHelpers';
  }

  /**
   * Only the Studio-bundled FHIRHelpers 4.0.1 is treated as local.
   * Other FHIRHelpers versions are fetched from content/evaluation FHIR.
   */
  isBundledLibrary(ref: Pick<ElmIncludeRef, 'path' | 'version'>): boolean {
    if (ref.path !== 'FHIRHelpers') {
      return false;
    }
    const version = ref.version?.trim() || ElmIncludeParser.BUNDLED_FHIR_HELPERS_VERSION;
    return version === ElmIncludeParser.BUNDLED_FHIR_HELPERS_VERSION;
  }

  isFhirResolvable(ref: ElmIncludeRef): boolean {
    return !!ref.path && !this.isBundledLibrary(ref);
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

  /**
   * Parse `include` directives from CQL text. Used when FHIR Library resources have no
   * stored ELM (common for imported packages) so transitive deps like BMI under
   * OpenCVDRisk can still be discovered.
   */
  extractIncludesFromCql(cql: string): ElmIncludeRef[] {
    if (!cql?.trim()) {
      return [];
    }

    // Strip comments so commented-out includes are ignored.
    const stripped = cql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const refs: ElmIncludeRef[] = [];
    const seen = new Set<string>();
    const re =
      /\binclude\s+(?:"([^"]+)"|([A-Za-z_][\w.]*))(?:\s+version\s+'([^']*)')?(?:\s+called\s+[A-Za-z_][\w.]*)?/gi;

    let match: RegExpExecArray | null;
    while ((match = re.exec(stripped))) {
      const raw = (match[1] ?? match[2] ?? '').trim();
      if (!raw) {
        continue;
      }
      const version = match[3] || null;
      const split = splitQualifiedLibraryName(raw);
      const key = this.cacheKey(split.path, split.system, version);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push({
        path: split.path,
        version,
        localIdentifier: null,
        system: split.system,
      });
    }

    return refs;
  }

  extractFhirIncludesFromCql(cql: string): ElmIncludeRef[] {
    return this.extractIncludesFromCql(cql).filter(ref => this.isFhirResolvable(ref));
  }
}
