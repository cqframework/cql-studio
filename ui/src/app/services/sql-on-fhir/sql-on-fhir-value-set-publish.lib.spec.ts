// Author: Preston Lee

import { describe, expect, test } from 'vitest';
import mammography from '../../../../public/fhir/sql-on-fhir/valuesets/mammography.json';
import bilateralMastectomy from '../../../../public/fhir/sql-on-fhir/valuesets/bilateral-mastectomy.json';
import officeVisit from '../../../../public/fhir/sql-on-fhir/valuesets/office-visit.json';
import cms125Elm from '../../components/sql-on-fhir/elm-to-sql/fixtures/cms125-breast-cancer-screening.elm.json';
import { extractUsedValueSets } from '../../components/sql-on-fhir/elm-to-sql';
import {
  bundledValueSetsForServerPublish,
  expandValueSetsForServerPublish,
  mergeBundledValueSetForElmRef,
  valueSetComposeFromExpansion,
  valueSetForServerPut,
} from './sql-on-fhir-value-set-publish.lib';
import { asValueSet, asValueSets } from '../../../testing/spec-helpers';

describe('sql-on-fhir-value-set-publish.lib', () => {
  const bundled = asValueSets([mammography, bilateralMastectomy, officeVisit]);
  const refs = extractUsedValueSets(cms125Elm);

  test('mergeBundledValueSetForElmRef uses ELM canonical url', () => {
    const ref = refs[0];
    const merged = mergeBundledValueSetForElmRef(asValueSet(mammography), ref);
    expect(merged.url).toBe(ref.url);
    expect(merged.id).toBe('vs-mammography');
    expect(merged.compose?.include?.length).toBeGreaterThan(0);
  });

  test('expandValueSetsForServerPublish includes urn:oid aliases', () => {
    const published = expandValueSetsForServerPublish(refs, bundled);
    const urls = published.map(vs => vs.url);
    expect(urls).toContain(
      'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
    );
    expect(urls).toContain('urn:oid:2.16.840.1.113883.3.464.1003.108.12.1018');
    expect(published.length).toBeGreaterThan(refs.length);
  });

  test('bundledValueSetsForServerPublish validates for PUT', () => {
    const published = bundledValueSetsForServerPublish(bundled);
    for (const vs of published) {
      const payload = valueSetForServerPut(vs);
      expect(payload.compose?.include?.length).toBeGreaterThan(0);
      expect(payload.expansion).toBeUndefined();
    }
  });

  test('valueSetComposeFromExpansion groups codes by system', () => {
    const compose = valueSetComposeFromExpansion({
      resourceType: 'ValueSet',
      status: 'active',
      expansion: {
        timestamp: '2024-01-01T00:00:00Z',
        contains: [
          { system: 'http://www.ama-assn.org/go/cpt', code: '99213', display: 'Visit' },
          { system: 'http://www.ama-assn.org/go/cpt', code: '99214', display: 'Visit 2' },
        ],
      },
    });
    expect(compose?.include).toHaveLength(1);
    expect(compose?.include?.[0]?.system).toBe('http://www.ama-assn.org/go/cpt');
    expect(compose?.include?.[0]?.concept).toHaveLength(2);
  });
});
