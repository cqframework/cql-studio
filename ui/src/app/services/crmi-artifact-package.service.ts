// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Bundle, BundleEntry, Library, Resource } from 'fhir/r4';
import { resourceTypeOf } from './fhir-resource-type.lib';

export type CrmiBundleType = 'transaction' | 'collection';

export interface CrmiArtifactPackageOptions {
  bundleType?: CrmiBundleType;
  conditionalCreate?: boolean;
  /** When multiple primary libraries are selected, wrap them under an asset-collection Library. */
  packageName?: string;
  packageVersion?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CrmiArtifactPackageService {
  buildArtifactBundle(
    primaryLibraries: Library[],
    dependencyResources: Resource[],
    options: CrmiArtifactPackageOptions = {}
  ): Bundle {
    const bundleType = options.bundleType ?? 'transaction';
    const conditionalCreate = options.conditionalCreate !== false;

    const primary =
      primaryLibraries.length === 1
        ? primaryLibraries[0]
        : this.buildAssetCollectionLibrary(
            primaryLibraries,
            options.packageName ?? 'export.asset-collection',
            options.packageVersion ?? '0.1.0'
          );

    const seen = new Set<string>();
    const ordered: Resource[] = [];
    const push = (r: Resource) => {
      const key = this.resourceKey(r);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      ordered.push(r);
    };

    push(primary);
    for (const lib of primaryLibraries) {
      if (lib !== primary) {
        push(lib);
      }
    }
    for (const dep of dependencyResources) {
      // Skip if already primary
      push(dep);
    }

    const entry: BundleEntry[] = ordered.map((resource) =>
      this.toEntry(resource, bundleType, conditionalCreate)
    );

    return {
      resourceType: 'Bundle',
      type: bundleType,
      timestamp: new Date().toISOString(),
      entry
    };
  }

  buildAssetCollectionLibrary(
    libraries: Library[],
    name: string,
    version: string
  ): Library {
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '_');
    return {
      resourceType: 'Library',
      id: safeName,
      name: safeName,
      version,
      status: 'active',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'asset-collection',
            display: 'Asset Collection'
          }
        ]
      },
      relatedArtifact: libraries.map((lib) => ({
        type: 'composed-of' as const,
        display: lib.title || lib.name || lib.id,
        resource: lib.url
          ? lib.version
            ? `${lib.url}|${lib.version}`
            : lib.url
          : undefined
      }))
    };
  }

  private toEntry(
    resource: Resource,
    bundleType: CrmiBundleType,
    conditionalCreate: boolean
  ): BundleEntry {
    const entry: BundleEntry = { resource };
    // Collection bundles are for packaging/download — do not attach HTTP request metadata.
    if (bundleType === 'collection') {
      return entry;
    }

    const rt = resourceTypeOf(resource);
    if (!rt) {
      return entry;
    }

    const meta = resource as unknown as { url?: string; version?: string; id?: string };
    const url = typeof meta.url === 'string' ? meta.url.trim() : '';
    const version = typeof meta.version === 'string' ? meta.version.trim() : '';

    // CRMI recommends conditional create on canonical url (+ version). Encode values since
    // ifNoneExist is parsed as a query string; unencoded '&'/'#'/'=' in a canonical would otherwise
    // be misread as extra search parameters.
    if (conditionalCreate && url) {
      let ifNoneExist = `url=${encodeURIComponent(url)}`;
      if (version) {
        ifNoneExist += `&version=${encodeURIComponent(version)}`;
      }
      entry.request = {
        method: 'POST',
        url: rt,
        ifNoneExist
      };
      return entry;
    }

    const id = typeof meta.id === 'string' ? meta.id.trim() : '';
    if (id) {
      entry.request = {
        method: 'PUT',
        url: `${rt}/${encodeURIComponent(id)}`
      };
    } else {
      entry.request = {
        method: 'POST',
        url: rt
      };
    }
    return entry;
  }

  private resourceKey(resource: Resource): string {
    const rt = resourceTypeOf(resource) ?? 'Resource';
    const meta = resource as unknown as { url?: string; version?: string; id?: string };
    const id = typeof meta.id === 'string' ? meta.id : '';
    const url = typeof meta.url === 'string' ? meta.url : '';
    const version = typeof meta.version === 'string' ? meta.version : '';
    return `${rt}|${id}|${url}|${version}`;
  }
}
