// Author: Preston Lee

import type { Bundle, Resource } from 'fhir/r4';
import { collectionBundleToTransaction } from '../fhir-bundle-transaction.lib';
import { cloneResourcesWithHapiSafeClientIds } from '../fhir-hapi-client-id.lib';
import { resourceTypeOf } from '../fhir-resource-type.lib';

/** Extract storable bundle entries in entry order, deduped by `{type}/{id}`. */
export function resourcesFromExecutionBundle(bundle: Bundle): Resource[] {
  const seen = new Set<string>();
  const resources: Resource[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    const resourceType = resourceTypeOf(resource);
    const id = typeof resource?.id === 'string' ? resource.id.trim() : '';
    if (!resource || !resourceType || !id) {
      continue;
    }
    const key = `${resourceType}/${id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resources.push(resource);
  }
  return resources;
}

/** Build a transaction Bundle suitable for POST to the FHIR server root. */
export function buildTransactionBundleForServerPublish(resources: Resource[]): Bundle {
  const safe = cloneResourcesWithHapiSafeClientIds(resources);
  return collectionBundleToTransaction({
    resourceType: 'Bundle',
    type: 'collection',
    entry: safe.map(resource => ({ resource })),
  });
}
