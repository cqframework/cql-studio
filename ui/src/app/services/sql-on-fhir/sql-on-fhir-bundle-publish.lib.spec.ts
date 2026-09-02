// Author: Preston Lee

import { describe, expect, test } from 'vitest';
import cms125Bundle from '../../../../public/fhir/sql-on-fhir/cms125-bundle.json';
import type { Bundle } from 'fhir/r4';
import {
  buildTransactionBundleForServerPublish,
  resourcesFromExecutionBundle,
} from './sql-on-fhir-bundle-publish.lib';

describe('sql-on-fhir-bundle-publish.lib', () => {
  test('resourcesFromExecutionBundle extracts all cms125 demo resources', () => {
    const resources = resourcesFromExecutionBundle(cms125Bundle as Bundle);
    expect(resources).toHaveLength(12);
    expect(resources.map(r => `${r.resourceType}/${r.id}`)).toContain('Patient/pat-numerator-jane');
    expect(resources.map(r => `${r.resourceType}/${r.id}`)).toContain('Procedure/proc-linda-mastectomy');
  });

  test('buildTransactionBundleForServerPublish emits PUT requests for resources with ids', () => {
    const resources = resourcesFromExecutionBundle(cms125Bundle as Bundle);
    const tx = buildTransactionBundleForServerPublish(resources);
    expect(tx.type).toBe('transaction');
    expect(tx.entry).toHaveLength(12);
    for (const entry of tx.entry ?? []) {
      expect(entry.request?.method).toBe('PUT');
      expect(entry.request?.url).toMatch(/^(Patient|Encounter|Observation|Procedure)\/.+/);
    }
  });

  test('resourcesFromExecutionBundle deduplicates repeated entries', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'p1' } },
        { resource: { resourceType: 'Patient', id: 'p1' } },
        { resource: { resourceType: 'Observation', id: 'o1' } },
      ],
    };
    expect(resourcesFromExecutionBundle(bundle)).toHaveLength(2);
  });
});
