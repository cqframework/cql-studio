// Author: Eugene Vestel
//
// Flattens a FHIR R4 Bundle into rows for the SQL-on-FHIR flat-table schema
// expected by the elm-to-sql library's STANDARD_VIEW_DEFINITIONS.
//
// Pure functions only — no HTTP, no Node APIs, no DB drivers. Output rows are
// consumed by sql-on-fhir-pglite.service.ts to seed an in-browser Postgres.

import type {
  Bundle,
  ValueSet,
  Patient,
  Encounter,
  Observation,
  Procedure,
  Condition,
  CodeableConcept,
  Period,
  Reference,
} from 'fhir/r4';
import { resourceTypeOf } from '../fhir-resource-type.lib';

/** A single flat row keyed by column name. Values are JSON-safe primitives. */
export type FlatRow = Record<string, string | number | boolean | null>;

/** Rows grouped by target table name (matches STANDARD_VIEW_DEFINITIONS names). */
export interface FlatTables {
  patient_view: FlatRow[];
  encounter_view: FlatRow[];
  observation_view: FlatRow[];
  procedure_view: FlatRow[];
  condition_view: FlatRow[];
  /** value_set_id is the canonical URL of the ValueSet; code is one expansion entry's code. */
  value_set_expansion: FlatRow[];
}

export function emptyFlatTables(): FlatTables {
  return {
    patient_view: [],
    encounter_view: [],
    observation_view: [],
    procedure_view: [],
    condition_view: [],
    value_set_expansion: [],
  };
}

export function flattenBundle(bundle: Bundle): FlatTables {
  const out = emptyFlatTables();
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (!r) continue;
    switch (resourceTypeOf(r)) {
      case 'Patient':
        out.patient_view.push(flattenPatient(r as Patient));
        break;
      case 'Encounter':
        out.encounter_view.push(flattenEncounter(r as Encounter));
        break;
      case 'Observation':
        out.observation_view.push(flattenObservation(r as Observation));
        break;
      case 'Procedure':
        out.procedure_view.push(flattenProcedure(r as Procedure));
        break;
      case 'Condition':
        out.condition_view.push(flattenCondition(r as Condition));
        break;
      case 'ValueSet':
        out.value_set_expansion.push(...flattenValueSetExpansion(r as ValueSet));
        break;
    }
  }
  return out;
}

export function flattenValueSets(valueSets: ValueSet[]): FlatRow[] {
  return valueSets.flatMap(flattenValueSetExpansion);
}

export function flattenValueSetExpansion(vs: ValueSet): FlatRow[] {
  const url = vs.url ?? null;
  const contains = vs.expansion?.contains ?? [];
  if (contains.length > 0) {
    return contains
      .filter(c => !!c.code)
      .map(c => ({
        value_set_id: url,
        code: c.code ?? null,
        system: c.system ?? null,
        display: c.display ?? null,
        version: c.version ?? null,
      }));
  }
  const rows: FlatRow[] = [];
  for (const include of vs.compose?.include ?? []) {
    const system = include.system ?? null;
    for (const concept of include.concept ?? []) {
      if (!concept.code) {
        continue;
      }
      rows.push({
        value_set_id: url,
        code: concept.code,
        system,
        display: concept.display ?? null,
        version: null,
      });
    }
  }
  return rows;
}

export function flattenPatient(p: Patient): FlatRow {
  const officialName = p.name?.find(n => n.use === 'official') ?? p.name?.[0];
  return {
    id: p.id ?? null,
    gender: p.gender ?? null,
    birthdate: p.birthDate ?? null,
    active: typeof p.active === 'boolean' ? p.active : null,
    name_family: officialName?.family ?? null,
    name_given: officialName?.given?.[0] ?? null,
    deceased: typeof p.deceasedBoolean === 'boolean' ? p.deceasedBoolean : null,
    deceased_datetime: p.deceasedDateTime ?? null,
    race_code: extractUsCoreOmbCategory(p, 'us-core-race') ?? null,
    ethnicity_code: extractUsCoreOmbCategory(p, 'us-core-ethnicity') ?? null,
  };
}

export function flattenEncounter(e: Encounter): FlatRow {
  const firstType = e.type?.[0];
  const firstTypeCoding = firstType?.coding?.[0];
  return {
    id: e.id ?? null,
    subject_id: extractReferenceId(e.subject) ?? null,
    status: e.status ?? null,
    class_code: e.class?.code ?? null,
    type_code: firstTypeCoding?.code ?? null,
    type_system: firstTypeCoding?.system ?? null,
    type_display: firstTypeCoding?.display ?? null,
    period_start: e.period?.start ?? null,
    period_end: e.period?.end ?? null,
    service_provider_id: extractReferenceId(e.serviceProvider) ?? null,
  };
}

export function flattenObservation(o: Observation): FlatRow {
  const firstCoding = o.code?.coding?.[0];
  const valueQuantity = o.valueQuantity;
  const valueCC = o.valueCodeableConcept?.coding?.[0];
  const effectivePeriod = (o as Observation & { effectivePeriod?: Period }).effectivePeriod;
  return {
    id: o.id ?? null,
    subject_id: extractReferenceId(o.subject) ?? null,
    status: o.status ?? null,
    code: firstCoding?.code ?? null,
    code_system: firstCoding?.system ?? null,
    code_display: firstCoding?.display ?? null,
    code_text: o.code?.text ?? null,
    effective_datetime: o.effectiveDateTime ?? null,
    effective_start: effectivePeriod?.start ?? null,
    effective_end: effectivePeriod?.end ?? null,
    value_quantity: typeof valueQuantity?.value === 'number' ? valueQuantity.value : null,
    value_unit: valueQuantity?.unit ?? null,
    value_code: valueCC?.code ?? null,
    value_string: o.valueString ?? null,
    encounter_id: extractReferenceId(o.encounter) ?? null,
    category_code: firstCategoryCode(o.category) ?? null,
  };
}

export function flattenProcedure(p: Procedure): FlatRow {
  const firstCoding = p.code?.coding?.[0];
  const performedPeriod = (p as Procedure & { performedPeriod?: Period }).performedPeriod;
  return {
    id: p.id ?? null,
    subject_id: extractReferenceId(p.subject) ?? null,
    status: p.status ?? null,
    code: firstCoding?.code ?? null,
    code_system: firstCoding?.system ?? null,
    code_display: firstCoding?.display ?? null,
    code_text: p.code?.text ?? null,
    performed_datetime: p.performedDateTime ?? null,
    performed_start: performedPeriod?.start ?? null,
    performed_end: performedPeriod?.end ?? null,
    encounter_id: extractReferenceId(p.encounter) ?? null,
    category_code: p.category?.coding?.[0]?.code ?? null,
  };
}

export function flattenCondition(c: Condition): FlatRow {
  const firstCoding = c.code?.coding?.[0];
  const onsetPeriod = (c as Condition & { onsetPeriod?: Period }).onsetPeriod;
  return {
    id: c.id ?? null,
    subject_id: extractReferenceId(c.subject) ?? null,
    code: firstCoding?.code ?? null,
    code_system: firstCoding?.system ?? null,
    code_display: firstCoding?.display ?? null,
    code_text: c.code?.text ?? null,
    clinical_status: c.clinicalStatus?.coding?.[0]?.code ?? null,
    verification_status: c.verificationStatus?.coding?.[0]?.code ?? null,
    onset_datetime: c.onsetDateTime ?? null,
    onset_start: onsetPeriod?.start ?? null,
    abatement_datetime: c.abatementDateTime ?? null,
    recorded_date: c.recordedDate ?? null,
    encounter_id: extractReferenceId(c.encounter) ?? null,
    category_code: firstCategoryCode(c.category) ?? null,
  };
}

function extractReferenceId(ref: Reference | undefined): string | null {
  const r = ref?.reference;
  if (!r) return null;
  const idx = r.lastIndexOf('/');
  return idx >= 0 ? r.slice(idx + 1) : r;
}

function firstCategoryCode(category: CodeableConcept[] | CodeableConcept | undefined): string | null {
  const cc = Array.isArray(category) ? category[0] : category;
  return cc?.coding?.[0]?.code ?? null;
}

const US_CORE_OMB_URLS: Record<string, string> = {
  'us-core-race': 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
  'us-core-ethnicity': 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
};

function extractUsCoreOmbCategory(p: Patient, kind: 'us-core-race' | 'us-core-ethnicity'): string | null {
  const url = US_CORE_OMB_URLS[kind];
  const outer = p.extension?.find(e => e.url === url);
  const ombCat = outer?.extension?.find(e => e.url === 'ombCategory');
  return ombCat?.valueCoding?.code ?? null;
}
