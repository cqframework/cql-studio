// Author: Preston Lee

import { Bundle, Resource } from 'fhir/r4';
import { resourceTypeOf } from './fhir-resource-type.lib';

/**
 * Map a collection entry to a transaction entry when `request` is absent.
 * Used so POST to `[base]` sends `Bundle.type` `transaction` with `entry.request`
 * (`PUT {type}/{id}` or `POST {type}`), which HAPI and similar servers require
 * (e.g. HAPI-0527 rejects `collection` at the base URL).
 */
export function collectionEntryToTransactionEntry(
  e: NonNullable<Bundle['entry']>[number]
): NonNullable<Bundle['entry']>[number] {
  if (e.request) {
    return e;
  }
  const res = e.resource;
  const rt = resourceTypeOf(res);
  if (!rt) {
    return e;
  }
  const rid = typeof (res as { id?: string }).id === 'string' ? (res as { id: string }).id.trim() : '';
  if (rid) {
    return {
      ...e,
      request: {
        method: 'PUT' as const,
        url: `${rt}/${encodeURIComponent(rid)}`
      }
    };
  }
  return {
    ...e,
    request: {
      method: 'POST' as const,
      url: rt
    }
  };
}

export function collectionBundleToTransaction(bundle: Bundle): Bundle {
  const entries = bundle.entry ?? [];
  return {
    ...bundle,
    type: 'transaction',
    entry: entries.map((entry) => collectionEntryToTransactionEntry(entry))
  };
}

/**
 * Build a transaction Bundle that uses HTTP PUT when the resource has an id, otherwise POST.
 * Prefer this for export complete-bundles that may include id-less clinical/data resources.
 */
export function buildTransactionBundle(resources: Resource[]): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => collectionEntryToTransactionEntry({ resource }))
  };
}

/**
 * Build a transaction Bundle that uses HTTP PUT for every resource.
 * Callers must pass resources that already have an `id` (as export-resolved FHIR resources do).
 */
export function buildPutTransactionBundle(resources: Resource[]): Bundle {
  const entry = resources.map((resource) => {
    const rt = resourceTypeOf(resource);
    const id =
      typeof (resource as { id?: string }).id === 'string'
        ? (resource as { id: string }).id.trim()
        : '';
    if (!rt || !id) {
      throw new Error(
        `Cannot build PUT transaction entry without resourceType and id (got ${rt ?? 'unknown'}/${id || 'missing'}).`
      );
    }
    return {
      resource,
      request: {
        method: 'PUT' as const,
        url: `${rt}/${encodeURIComponent(id)}`
      }
    };
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    timestamp: new Date().toISOString(),
    entry
  };
}

/** Prepare a bundle for HTTP POST to the FHIR service root (`[base]`). */
export function normalizeBundleForBasePost(bundle: Bundle): Bundle {
  if (bundle.type === 'collection') {
    return collectionBundleToTransaction(bundle);
  }
  return bundle;
}
