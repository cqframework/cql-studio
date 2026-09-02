// Author: Preston Lee

import { Bundle, Patient, Resource } from 'fhir/r4';
import {
  buildPutTransactionBundle,
  buildTransactionBundle,
  collectionBundleToTransaction,
  normalizeBundleForBasePost
} from './fhir-bundle-transaction.lib';

describe('fhir-bundle-transaction.lib', () => {
  it('collectionBundleToTransaction adds PUT request when resource has id', () => {
    const patient: Patient = { resourceType: 'Patient', id: 'p1' };
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: patient }]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.type).toBe('transaction');
    expect(tx.entry?.[0]?.request?.method).toBe('PUT');
    expect(tx.entry?.[0]?.request?.url).toBe('Patient/p1');
  });

  it('collectionBundleToTransaction adds POST request when resource has no id', () => {
    const patient: Patient = { resourceType: 'Patient' };
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: patient }]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.entry?.[0]?.request?.method).toBe('POST');
    expect(tx.entry?.[0]?.request?.url).toBe('Patient');
  });

  it('normalizeBundleForBasePost leaves transaction bundles unchanged', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: []
    };
    expect(normalizeBundleForBasePost(bundle)).toBe(bundle);
  });

  it('collectionBundleToTransaction maps multiple resources with ids to PUT entries', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        { resource: { resourceType: 'Patient', id: 'a' } as Resource },
        { resource: { resourceType: 'Observation', id: 'b' } as Resource }
      ]
    };
    const tx = collectionBundleToTransaction(bundle);
    expect(tx.entry?.map((e) => e.request?.url)).toEqual(['Patient/a', 'Observation/b']);
  });

  it('buildTransactionBundle uses PUT when id present and POST when missing', () => {
    const tx = buildTransactionBundle([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Observation' } as Resource
    ]);
    expect(tx.type).toBe('transaction');
    expect(tx.entry?.[0].request?.method).toBe('PUT');
    expect(tx.entry?.[0].request?.url).toBe('Patient/p1');
    expect(tx.entry?.[1].request?.method).toBe('POST');
    expect(tx.entry?.[1].request?.url).toBe('Observation');
  });

  it('buildPutTransactionBundle uses PUT for every resource with an id', () => {
    const tx = buildPutTransactionBundle([
      { resourceType: 'Library', id: 'lib-1' } as Resource,
      { resourceType: 'ValueSet', id: 'vs-1' } as Resource
    ]);
    expect(tx.type).toBe('transaction');
    expect(tx.entry?.map((e) => e.request)).toEqual([
      { method: 'PUT', url: 'Library/lib-1' },
      { method: 'PUT', url: 'ValueSet/vs-1' }
    ]);
  });

  it('buildPutTransactionBundle throws when a resource has no id', () => {
    expect(() =>
      buildPutTransactionBundle([{ resourceType: 'ValueSet', name: 'Office Visit' } as Resource])
    ).toThrow(/without resourceType and id/);
  });
});
