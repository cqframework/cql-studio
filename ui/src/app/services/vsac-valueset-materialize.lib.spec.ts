// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import type { ValueSet } from 'fhir/r4';
import {
  composeFromExpandedValueSet,
  peekCodesFromStoredExpansion,
} from './vsac-valueset-materialize.lib';

describe('vsac value set materialization', () => {
  it('replaces included ValueSet references with expanded concepts', () => {
    const compose = composeFromExpandedValueSet({
      resourceType: 'ValueSet',
      status: 'active',
      compose: {
        include: [{ valueSet: ['http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.117.1.7.1.201'] }],
      },
      expansion: {
        timestamp: '2026-09-22T00:00:00Z',
        total: 3,
        contains: [
          { system: 'http://snomed.info/sct', code: '1', display: 'One' },
          { system: 'http://snomed.info/sct', code: '1', display: 'Duplicate' },
          {
            system: 'http://snomed.info/sct',
            code: 'parent',
            contains: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '2', display: 'Two' }],
          },
        ],
      },
    });

    expect(compose?.include?.some(include => include.valueSet?.length)).toBe(false);
    expect(compose?.include).toEqual([
      {
        system: 'http://snomed.info/sct',
        concept: [
          { code: '1', display: 'One' },
          { code: 'parent' },
        ],
      },
      {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        concept: [{ code: '2', display: 'Two' }],
      },
    ]);
  });

  it('builds an empty extensional compose when the expansion has no codes', () => {
    const compose = composeFromExpandedValueSet({
      resourceType: 'ValueSet',
      status: 'active',
      expansion: { timestamp: '2026-09-22T00:00:00Z', total: 0, contains: [] },
    });
    expect(compose?.include?.[0]?.concept?.[0]?.code).toBe('empty');
    expect(compose?.exclude?.[0]?.concept?.[0]?.code).toBe('empty');
  });

  it('reads a stored expansion for peek when the server cannot expand includes', () => {
    const valueSet: ValueSet = {
      resourceType: 'ValueSet',
      status: 'active',
      expansion: {
        timestamp: '2026-09-22T00:00:00Z',
        total: 3,
        contains: [
          { system: 'http://snomed.info/sct', code: '1', display: 'One' },
          { system: 'http://snomed.info/sct', code: '2', display: 'Two' },
          { system: 'http://snomed.info/sct', code: '3', display: 'Three' },
        ],
      },
    };
    expect(peekCodesFromStoredExpansion(valueSet, 2)).toEqual({
      codes: [
        { system: 'http://snomed.info/sct', code: '1', display: 'One' },
        { system: 'http://snomed.info/sct', code: '2', display: 'Two' },
      ],
      truncated: true,
    });
  });
});
