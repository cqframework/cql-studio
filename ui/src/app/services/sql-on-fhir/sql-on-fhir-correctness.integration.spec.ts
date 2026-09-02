// Author: Eugene Vestel
//
// End-to-end correctness test: transpiled CMS125 ELM executed through real
// PGlite against an ADVERSARIAL cohort — data deliberately shaped so that
// population-wide (uncorrelated) evaluation gives wrong answers:
//
//   - Mary has NO office visit → must NOT be in the Initial Population.
//     (Uncorrelated `exists "Qualifying Encounters"` admits her as long as
//     ANY patient has a visit.)
//   - TWO patients have mastectomies → Denominator Exclusion must be 2.
//     (A single-boolean-row CTE makes COUNT(*) always 1.)
//   - A second seed with ZERO mastectomies → Exclusion must be 0, not 1.
//   - Jane has TWO mammograms → Numerator must still count her once.
//
// This is the test for Preston's report on #24 that "the actual execution
// step does not seem to be generating the correct output."

import { describe, it, expect, beforeAll } from 'vitest';
import { SqlOnFhirPgliteService } from './sql-on-fhir-pglite.service';
import { emptyFlatTables, type FlatTables } from './sql-on-fhir-bundle-flattener.lib';
import { ElmToSqlTranspiler } from '../../components/sql-on-fhir/elm-to-sql';
import type { ElmLibraryWrapper } from '../../components/sql-on-fhir/elm-to-sql';
import cms125Fixture from '../../components/sql-on-fhir/elm-to-sql/fixtures/cms125-breast-cancer-screening.elm.json';

const VS = {
  officeVisit: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.101.12.1001',
  mammography: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.108.12.1018',
  mastectomy: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1005',
};

function patient(id: string, gender: string, birthdate: string) {
  return {
    id, gender, birthdate, active: true,
    name_family: id, name_given: id, deceased: null, deceased_datetime: null,
    race_code: null, ethnicity_code: null,
  };
}

function encounter(id: string, subjectId: string, start: string) {
  return {
    id, subject_id: subjectId, status: 'finished', class_code: 'AMB',
    type_code: '99213', type_system: 'http://www.ama-assn.org/go/cpt', type_display: 'Office visit',
    period_start: start, period_end: start, service_provider_id: null,
  };
}

function mammogram(id: string, subjectId: string, effective: string) {
  return {
    id, subject_id: subjectId, status: 'final',
    code: '24605-8', code_system: 'http://loinc.org', code_display: 'MG Breast Screening', code_text: null,
    effective_datetime: effective, effective_start: null, effective_end: null,
    value_quantity: null, value_unit: null, value_code: null, value_string: null,
    encounter_id: null, category_code: null,
  };
}

function mastectomy(id: string, subjectId: string) {
  return {
    id, subject_id: subjectId, status: 'completed',
    code: '173425001', code_system: 'http://snomed.info/sct', code_display: 'Bilateral mastectomy', code_text: null,
    performed_datetime: '2018-08-14T08:00:00Z', performed_start: null, performed_end: null,
    encounter_id: null, category_code: null,
  };
}

function valueSetRows(): FlatTables['value_set_expansion'] {
  return [
    { value_set_id: VS.officeVisit, code: '99213', system: 'http://www.ama-assn.org/go/cpt', display: 'Office visit' },
    { value_set_id: VS.mammography, code: '24605-8', system: 'http://loinc.org', display: 'MG Breast Screening' },
    { value_set_id: VS.mastectomy, code: '173425001', system: 'http://snomed.info/sct', display: 'Bilateral mastectomy' },
  ];
}

/**
 * Adversarial cohort:
 *   jane  F 1964 — office visit 2024, TWO mammograms 2024 → Numer must count her ONCE
 *   mary  F 1968 — NO encounter                            → out of IP when IP requires visits
 *   linda F 1960 — office visit, TWO mastectomy procedures → Excl must count her ONCE
 *   rita  F 1969 — office visit, one mastectomy            → Excl (2nd distinct patient)
 *   bob   M 1962 — office visit                            → excluded (male)
 */
function adversarialTables(): FlatTables {
  const t = emptyFlatTables();
  t.patient_view.push(
    patient('jane', 'female', '1964-04-15'),
    patient('mary', 'female', '1968-09-30'),
    patient('linda', 'female', '1960-01-12'),
    patient('rita', 'female', '1969-03-03'),
    patient('bob', 'male', '1962-11-04'),
  );
  t.encounter_view.push(
    encounter('e-jane', 'jane', '2024-03-12T09:00:00Z'),
    encounter('e-linda', 'linda', '2024-02-22T11:00:00Z'),
    encounter('e-rita', 'rita', '2024-05-01T10:00:00Z'),
    encounter('e-bob', 'bob', '2024-05-10T15:00:00Z'),
    // mary: none
  );
  t.observation_view.push(
    mammogram('o-jane-1', 'jane', '2024-04-20T10:15:00Z'),
    mammogram('o-jane-2', 'jane', '2024-09-02T10:15:00Z'),
  );
  t.procedure_view.push(
    mastectomy('p-linda-1', 'linda'),
    mastectomy('p-linda-2', 'linda'),
    mastectomy('p-rita', 'rita'),
  );
  t.value_set_expansion.push(...valueSetRows());
  return t;
}

/**
 * ELM mirroring the LIVE demo CQL's shape (what @cqframework/cql emits for the
 * shipped cms125.cql): bare-boolean Patient-context defines with
 * `exists "Qualifying Encounters"` — the pattern where uncorrelated evaluation
 * admits Mary (no visit) into the Initial Population as long as ANYONE has one.
 */
function liveShapeElm(): ElmLibraryWrapper {
  const mp = { type: 'ParameterRef', name: 'Measurement Period' };
  return {
    library: {
      identifier: { id: 'LiveShape', version: '0.0.1' },
      schemaIdentifier: { id: 'urn:hl7-org:elm', version: 'r1' },
      valueSets: {
        def: [
          { name: 'Office Visit', id: VS.officeVisit },
          { name: 'Mammography', id: VS.mammography },
          { name: 'Bilateral Mastectomy', id: VS.mastectomy },
        ],
      },
      statements: {
        def: [
          {
            name: 'Patient', context: 'Patient',
            expression: { type: 'SingletonFrom', operand: { type: 'Retrieve', dataType: '{http://hl7.org/fhir}Patient' } },
          },
          {
            name: 'Qualifying Encounters', context: 'Patient',
            expression: {
              type: 'Query',
              source: [{ alias: 'E', expression: { type: 'Retrieve', dataType: '{http://hl7.org/fhir}Encounter', codes: { type: 'ValueSetRef', name: 'Office Visit' } } }],
              where: { type: 'During', operand: [{ type: 'Property', path: 'period_start', scope: 'E' }, mp] },
            },
          },
          {
            name: 'Initial Population', context: 'Patient',
            expression: {
              type: 'And',
              operand: [
                {
                  type: 'And',
                  operand: [
                    { type: 'Equal', operand: [{ type: 'Property', path: 'gender', source: { type: 'ExpressionRef', name: 'Patient' } }, { type: 'Literal', valueType: '{urn:hl7-org:elm-types:r1}String', value: 'female' }] },
                    { type: 'GreaterOrEqual', operand: [{ type: 'FunctionRef', name: 'AgeInYearsAt', operand: [mp] }, { type: 'Literal', valueType: '{urn:hl7-org:elm-types:r1}Integer', value: '51' }] },
                  ],
                },
                { type: 'Exists', operand: { type: 'ExpressionRef', name: 'Qualifying Encounters' } },
              ],
            },
          },
          { name: 'Denominator', context: 'Patient', expression: { type: 'ExpressionRef', name: 'Initial Population' } },
          {
            name: 'Denominator Exclusion', context: 'Patient',
            expression: { type: 'Exists', operand: { type: 'Retrieve', dataType: '{http://hl7.org/fhir}Procedure', codes: { type: 'ValueSetRef', name: 'Bilateral Mastectomy' } } },
          },
          {
            name: 'Numerator', context: 'Patient',
            expression: {
              type: 'Exists',
              operand: {
                type: 'Query',
                source: [{ alias: 'O', expression: { type: 'Retrieve', dataType: '{http://hl7.org/fhir}Observation', codes: { type: 'ValueSetRef', name: 'Mammography' } } }],
                where: { type: 'During', operand: [{ type: 'Property', path: 'effective_datetime', scope: 'O' }, mp] },
              },
            },
          },
        ],
      },
    },
  } as unknown as ElmLibraryWrapper;
}

/** Same cohort but with NO mastectomies at all → Exclusion must be 0. */
function zeroExclusionTables(): FlatTables {
  const t = adversarialTables();
  t.procedure_view = [];
  return t;
}

describe('CMS125 end-to-end correctness (transpiled SQL on PGlite)', () => {
  let pg: SqlOnFhirPgliteService;
  let sql: string;

  beforeAll(() => {
    // No injected dependencies — instantiate directly so this spec runs without TestBed.
    pg = new SqlOnFhirPgliteService();
    pg.reset();
    const t = new ElmToSqlTranspiler({
      measurementPeriodStart: '2024-01-01T00:00:00Z',
      measurementPeriodEnd: '2024-12-31T23:59:59Z',
    });
    sql = t.transpile(cms125Fixture as unknown as ElmLibraryWrapper).sql;
  });

  // The fixture's Initial Population requires a qualifying encounter, so mary
  // (no visit) is out: jane, linda, rita (3 females 51–74 with office visits).
  it('computes correct patient counts on the adversarial cohort (fixture ELM)', async () => {
    await pg.seed('adversarial-v1', adversarialTables());
    const { rows } = await pg.execute(sql);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      initial_population_count: 3,
      denominator_count: 3,
      denominator_exclusion_count: 2,    // linda + rita as PATIENTS — linda's 2 procedures count once
      numerator_count: 1,                // jane counted once despite 2 mammograms
    });
  });

  it('counts zero exclusions when no patient has the exclusion procedure', async () => {
    await pg.seed('zero-exclusion-v1', zeroExclusionTables());
    const { rows } = await pg.execute(sql);
    expect(rows[0]).toMatchObject({
      initial_population_count: 3,
      denominator_exclusion_count: 0,    // the old single-boolean-row shape said 1
    });
  });
});

describe('live-demo-shaped ELM (bare-boolean defines with exists) on PGlite', () => {
  let pg: SqlOnFhirPgliteService;
  let sql: string;

  beforeAll(() => {
    pg = new SqlOnFhirPgliteService();
    pg.reset();
    const t = new ElmToSqlTranspiler({
      measurementPeriodStart: '2024-01-01T00:00:00Z',
      measurementPeriodEnd: '2024-12-31T23:59:59Z',
    });
    sql = t.transpile(liveShapeElm()).sql;
  });

  it('evaluates exists-defines per patient, not population-wide', async () => {
    await pg.seed('live-shape-v1', adversarialTables());
    const { rows } = await pg.execute(sql);
    expect(rows[0]).toMatchObject({
      initial_population_count: 3,       // mary has NO visit — uncorrelated exists would admit her (4)
      denominator_count: 3,
      denominator_exclusion_count: 2,    // linda + rita; single-boolean-row shape said 1
      numerator_count: 1,                // jane once, despite 2 mammograms
    });
  });

  it('exclusion is 0 (not 1) when nobody has the procedure', async () => {
    await pg.seed('live-shape-zero-v1', zeroExclusionTables());
    const { rows } = await pg.execute(sql);
    expect(rows[0]).toMatchObject({
      initial_population_count: 3,
      denominator_exclusion_count: 0,
    });
  });
});
