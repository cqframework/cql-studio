// Author: Preston Lee

import { describe, expect, test, vi } from 'vitest';
import type { ValueSet } from 'fhir/r4';
import cms125Elm from '../../components/sql-on-fhir/elm-to-sql/fixtures/cms125-breast-cancer-screening.elm.json';
import mammography from '../../../../public/fhir/sql-on-fhir/valuesets/mammography.json';
import bilateralMastectomy from '../../../../public/fhir/sql-on-fhir/valuesets/bilateral-mastectomy.json';
import officeVisit from '../../../../public/fhir/sql-on-fhir/valuesets/office-visit.json';
import { extractUsedValueSets } from '../../components/sql-on-fhir/elm-to-sql';
import { flattenValueSets } from './sql-on-fhir-bundle-flattener.lib';
import { prepareValueSetRowsForExecution } from './sql-on-fhir-execution-data.lib';
import { asValueSets } from '../../../testing/spec-helpers';

describe('CMS125 demo value sets', () => {
  const bundled = asValueSets([mammography, bilateralMastectomy, officeVisit]);
  const elmJson = JSON.stringify(cms125Elm);

  test('bundled JSON files have compose definitions', () => {
    for (const vs of bundled) {
      expect(vs.compose?.include?.length).toBeGreaterThan(0);
      expect(vs.expansion).toBeUndefined();
    }
  });

  test('bundled JSON files have canonical URLs matching ELM value set ids', () => {
    const refs = extractUsedValueSets(cms125Elm);
    expect(refs).toHaveLength(3);
    const bundledUrls = new Set(bundled.map(vs => vs.url));
    for (const ref of refs) {
      expect(bundledUrls.has(ref.url)).toBe(true);
    }
  });

  test('bundled expansions flatten to rows keyed by canonical URL', () => {
    const rows = flattenValueSets(bundled);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(r => r['value_set_id'] === mammography.url && r['code'] === '24605-8')).toBe(true);
    expect(rows.some(r => r['value_set_id'] === bilateralMastectomy.url && r['code'] === '173425001')).toBe(true);
    expect(rows.some(r => r['value_set_id'] === officeVisit.url && r['code'] === '99213')).toBe(true);
  });

  test('prepareValueSetRowsForExecution uses bundled sets without server fetch', async () => {
    const fetch = vi.fn();
    const result = await prepareValueSetRowsForExecution(elmJson, bundled, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBeGreaterThanOrEqual(14);
    expect(result.unresolvedRefs).toEqual([]);
    for (const ref of extractUsedValueSets(cms125Elm)) {
      expect(result.rows.some(r => r['value_set_id'] === ref.url)).toBe(true);
    }
  });

  test('prepareValueSetRowsForExecution uses bundled sets when ELM ids are urn:oid', async () => {
    const oidElm = JSON.parse(elmJson) as { library: Record<string, unknown> };
    const defs = (oidElm.library['valueSets'] as { def: { name: string; id: string }[] }).def;
    for (const def of defs) {
      const oid = def.id.split('/').pop();
      def.id = `urn:oid:${oid}`;
    }
    const fetch = vi.fn();
    const result = await prepareValueSetRowsForExecution(JSON.stringify(oidElm), bundled, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.unresolvedRefs).toEqual([]);
  });
});
