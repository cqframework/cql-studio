// Author: Preston Lee

import { describe, expect, test, vi } from 'vitest';
import type { ValueSet } from 'fhir/r4';
import mammography from '../../../../public/fhir/sql-on-fhir/valuesets/mammography.json';
import {
  indexBundledValueSets,
  lookupBundledValueSet,
  normalizeValueSetUrl,
  prepareValueSetRowsForExecution,
  resolveValueSetReferences,
  resourceTypesInBundle,
  summarizeBundleResources,
  validateCms125DemoBundle,
} from './sql-on-fhir-execution-data.lib';
import cms125Bundle from '../../../../public/fhir/sql-on-fhir/cms125-bundle.json';
import type { Bundle } from 'fhir/r4';

describe('sql-on-fhir-execution-data.lib value sets', () => {
  test('normalizeValueSetUrl trims trailing slashes', () => {
    expect(normalizeValueSetUrl('http://example.org/ValueSet/a/')).toBe('http://example.org/ValueSet/a');
  });

  test('resolveValueSetReferences falls back to declared sets covered by bundled expansions', () => {
    const elmJson = JSON.stringify({
      library: {
        valueSets: {
          def: [
            {
              name: 'Mammography',
              id: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
            },
          ],
        },
        statements: { def: [{ name: 'Initial Population', context: 'Patient', expression: { type: 'Null' } }] },
      },
    });
    const refs = resolveValueSetReferences(elmJson, [mammography as ValueSet]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe('Mammography');
  });

  test('prepareValueSetRowsForExecution errors when referenced set is missing from bundle and fetch', async () => {
    const elmJson = JSON.stringify({
      library: {
        valueSets: {
          def: [
            {
              name: 'Mammography',
              id: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
            },
          ],
        },
        statements: {
          def: [
            {
              name: 'Numerator',
              context: 'Patient',
              expression: {
                type: 'Retrieve',
                codes: { type: 'ValueSetRef', name: 'Mammography' },
              },
            },
          ],
        },
      },
    });
    const result = await prepareValueSetRowsForExecution(elmJson, []);
    expect(result.rows).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.unresolvedRefs).toContain('Mammography');
  });

  test('prepareValueSetRowsForExecution matches bundled sets when ELM uses urn:oid ids', async () => {
    const elmJson = JSON.stringify({
      library: {
        valueSets: {
          def: [
            {
              name: 'Mammography',
              id: 'urn:oid:2.16.840.1.113883.3.464.1003.108.12.1018',
            },
          ],
        },
        statements: {
          def: [
            {
              name: 'Numerator',
              context: 'Patient',
              expression: {
                type: 'Retrieve',
                codes: { type: 'ValueSetRef', name: 'Mammography' },
              },
            },
          ],
        },
      },
    });
    const fetch = vi.fn();
    const result = await prepareValueSetRowsForExecution(elmJson, [mammography as ValueSet], fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.rows.some(r => r['value_set_id'] === 'urn:oid:2.16.840.1.113883.3.464.1003.108.12.1018')).toBe(
      true,
    );
  });

  test('indexBundledValueSets indexes by normalized url', () => {
    const indexes = indexBundledValueSets([{ ...mammography, url: `${mammography.url}/` } as ValueSet]);
    expect(
      lookupBundledValueSet(
        {
          name: 'Mammography',
          url: mammography.url!,
        },
        indexes,
      )?.id,
    ).toBe('vs-mammography');
  });
});

describe('sql-on-fhir-execution-data.lib CMS125 demo bundle', () => {
  test('validateCms125DemoBundle accepts cms125-bundle.json', () => {
    expect(() => validateCms125DemoBundle(cms125Bundle as Bundle)).not.toThrow();
  });

  test('validateCms125DemoBundle rejects an empty bundle', () => {
    expect(() =>
      validateCms125DemoBundle({ resourceType: 'Bundle', type: 'collection', entry: [] }),
    ).toThrow(/cms125-bundle\.json/);
  });

  test('resourceTypesInBundle includes all resource types in cms125-bundle.json', () => {
    expect(resourceTypesInBundle(cms125Bundle as Bundle)).toEqual([
      'Encounter',
      'Observation',
      'Patient',
      'Procedure',
    ]);
  });

  test('summarizeBundleResources reports five demo patients', () => {
    const summary = summarizeBundleResources(cms125Bundle as Bundle);
    expect(summary.patientIds).toEqual([
      'pat-denom-only-mary',
      'pat-excluded-linda',
      'pat-not-female-bob',
      'pat-numerator-jane',
      'pat-too-young-amy',
    ]);
  });
});
