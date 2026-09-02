/**
 * SQL-on-FHIR ViewDefinition builders.
 *
 * These generate both:
 *   1. FHIR ViewDefinition resources (JSON) — the HL7 SQL-on-FHIR spec contract
 *   2. CREATE VIEW SQL statements — for direct PostgreSQL deployment
 *
 * The SQL targets the standard SQL-on-FHIR flat-table schema, NOT the raw
 * HAPI FHIR JPA internal schema. HAPI views are in Issue #21 (separate script).
 *
 * Spec: https://build.fhir.org/ig/FHIR/sql-on-fhir-v2/
 */

// ─── FHIR ViewDefinition types (SQL-on-FHIR v2) ──────────────────────────────

export interface ViewDefinition {
  resourceType: 'ViewDefinition';
  url?: string;
  name: string;
  title?: string;
  status: 'active' | 'draft' | 'retired';
  description?: string;
  resource: string;
  select: ViewDefinitionSelect[];
  where?: ViewDefinitionWhere[];
}

export interface ViewDefinitionSelect {
  column?: ViewDefinitionColumn[];
  select?: ViewDefinitionSelect[];
  forEach?: string;
  forEachOrNull?: string;
  unionAll?: ViewDefinitionSelect[];
}

export interface ViewDefinitionColumn {
  name: string;
  path: string;
  description?: string;
  type?: string;
  collection?: boolean;
}

export interface ViewDefinitionWhere {
  path: string;
  description?: string;
}

// ─── SQL CREATE VIEW statements ───────────────────────────────────────────────

export interface SqlViewDefinition {
  viewName: string;
  sql: string;
  description: string;
}

// ─── Standard SQL-on-FHIR view definitions ────────────────────────────────────

/**
 * Standard SQL-on-FHIR view definitions aligned with US Core 6.1 / US CDI v3.
 *
 * Includes only the resource elements used in CQL measure logic — avoids
 * surfacing nested FHIR structures not needed for eCQM evaluation.
 * Resources without clinical measure use (Organization, Practitioner, etc.)
 * are excluded since they are referenced but not directly queried in eCQM CTEs.
 */
export const STANDARD_VIEW_DEFINITIONS: ViewDefinition[] = [
  patientViewDefinition(),
  observationViewDefinition(),
  conditionViewDefinition(),
  procedureViewDefinition(),
  encounterViewDefinition(),
  medicationRequestViewDefinition(),
  diagnosticReportViewDefinition(),
  coverageViewDefinition(),
  allergyIntoleranceViewDefinition(),
  immunizationViewDefinition(),
  serviceRequestViewDefinition(),
];

// ─── ViewDefinition factories ─────────────────────────────────────────────────

function patientViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'patient_view',
    title: 'Patient demographic view',
    status: 'active',
    description: 'Flattened Patient resource — demographics, identifiers, active status.',
    resource: 'Patient',
    select: [{
      column: [
        { name: 'id',           path: 'id',          type: 'id' },
        { name: 'gender',       path: 'gender',       type: 'code' },
        { name: 'birthdate',    path: 'birthDate',    type: 'date' },
        { name: 'active',       path: 'active',       type: 'boolean' },
        { name: 'name_family',  path: "name.where(use='official').family",  type: 'string' },
        { name: 'name_given',   path: "name.where(use='official').given.first()", type: 'string' },
        { name: 'deceased',     path: 'deceased.ofType(boolean)', type: 'boolean' },
        { name: 'deceased_datetime', path: 'deceased.ofType(dateTime)', type: 'dateTime' },
        { name: 'race_code',    path: "extension.where(url='http://hl7.org/fhir/us/core/StructureDefinition/us-core-race').extension.where(url='ombCategory').value.ofType(Coding).code", type: 'code' },
        { name: 'ethnicity_code', path: "extension.where(url='http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity').extension.where(url='ombCategory').value.ofType(Coding).code", type: 'code' },
      ]
    }]
  };
}

function observationViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'observation_view',
    title: 'Observation clinical view',
    status: 'active',
    description: 'Flattened Observation — clinical measurements, labs, vital signs.',
    resource: 'Observation',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                           type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',              type: 'id' },
        { name: 'status',               path: 'status',                       type: 'code' },
        { name: 'code',                 path: 'code.coding.first().code',     type: 'code' },
        { name: 'code_system',          path: 'code.coding.first().system',   type: 'uri' },
        { name: 'code_display',         path: 'code.coding.first().display',  type: 'string' },
        { name: 'code_text',            path: 'code.text',                    type: 'string' },
        { name: 'effective_datetime',   path: 'effective.ofType(dateTime)',   type: 'dateTime' },
        { name: 'effective_start',      path: 'effective.ofType(Period).start', type: 'dateTime' },
        { name: 'effective_end',        path: 'effective.ofType(Period).end',   type: 'dateTime' },
        { name: 'value_quantity',       path: 'value.ofType(Quantity).value', type: 'decimal' },
        { name: 'value_unit',           path: 'value.ofType(Quantity).unit',  type: 'string' },
        { name: 'value_code',           path: 'value.ofType(CodeableConcept).coding.first().code', type: 'code' },
        { name: 'value_string',         path: 'value.ofType(string)',         type: 'string' },
        { name: 'encounter_id',         path: 'encounter.getId()',            type: 'id' },
        { name: 'category_code',        path: 'category.first().coding.first().code', type: 'code' },
      ]
    }]
  };
}

function conditionViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'condition_view',
    title: 'Condition / problem list view',
    status: 'active',
    description: 'Flattened Condition resource — diagnoses, problems, health concerns.',
    resource: 'Condition',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',                      type: 'id' },
        { name: 'code',                 path: 'code.coding.first().code',             type: 'code' },
        { name: 'code_system',          path: 'code.coding.first().system',           type: 'uri' },
        { name: 'code_display',         path: 'code.coding.first().display',          type: 'string' },
        { name: 'code_text',            path: 'code.text',                            type: 'string' },
        { name: 'clinical_status',      path: 'clinicalStatus.coding.first().code',   type: 'code' },
        { name: 'verification_status',  path: 'verificationStatus.coding.first().code', type: 'code' },
        { name: 'onset_datetime',       path: 'onset.ofType(dateTime)',               type: 'dateTime' },
        { name: 'onset_start',          path: 'onset.ofType(Period).start',           type: 'dateTime' },
        { name: 'abatement_datetime',   path: 'abatement.ofType(dateTime)',           type: 'dateTime' },
        { name: 'recorded_date',        path: 'recordedDate',                         type: 'dateTime' },
        { name: 'encounter_id',         path: 'encounter.getId()',                    type: 'id' },
        { name: 'category_code',        path: 'category.first().coding.first().code', type: 'code' },
      ]
    }]
  };
}

function procedureViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'procedure_view',
    title: 'Procedure view',
    status: 'active',
    description: 'Flattened Procedure resource.',
    resource: 'Procedure',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',                      type: 'id' },
        { name: 'status',               path: 'status',                               type: 'code' },
        { name: 'code',                 path: 'code.coding.first().code',             type: 'code' },
        { name: 'code_system',          path: 'code.coding.first().system',           type: 'uri' },
        { name: 'code_display',         path: 'code.coding.first().display',          type: 'string' },
        { name: 'code_text',            path: 'code.text',                            type: 'string' },
        { name: 'performed_datetime',   path: 'performed.ofType(dateTime)',           type: 'dateTime' },
        { name: 'performed_start',      path: 'performed.ofType(Period).start',       type: 'dateTime' },
        { name: 'performed_end',        path: 'performed.ofType(Period).end',         type: 'dateTime' },
        { name: 'encounter_id',         path: 'encounter.getId()',                    type: 'id' },
        { name: 'category_code',        path: 'category.coding.first().code',         type: 'code' },
      ]
    }]
  };
}

function encounterViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'encounter_view',
    title: 'Encounter view',
    status: 'active',
    description: 'Flattened Encounter resource — visits and service delivery.',
    resource: 'Encounter',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',                      type: 'id' },
        { name: 'status',               path: 'status',                               type: 'code' },
        { name: 'class_code',           path: 'class.code',                           type: 'code' },
        { name: 'type_code',            path: 'type.first().coding.first().code',     type: 'code' },
        { name: 'type_system',          path: 'type.first().coding.first().system',   type: 'uri' },
        { name: 'type_display',         path: 'type.first().coding.first().display',  type: 'string' },
        { name: 'period_start',         path: 'period.start',                         type: 'dateTime' },
        { name: 'period_end',           path: 'period.end',                           type: 'dateTime' },
        { name: 'service_provider_id',  path: 'serviceProvider.getId()',              type: 'id' },
      ]
    }]
  };
}

function medicationRequestViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'medication_request_view',
    title: 'MedicationRequest view',
    status: 'active',
    description: 'Flattened MedicationRequest — prescriptions and medication orders.',
    resource: 'MedicationRequest',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                           type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',                              type: 'id' },
        { name: 'status',               path: 'status',                                       type: 'code' },
        { name: 'intent',               path: 'intent',                                       type: 'code' },
        { name: 'medication_code',      path: 'medication.ofType(CodeableConcept).coding.first().code', type: 'code' },
        { name: 'medication_system',    path: 'medication.ofType(CodeableConcept).coding.first().system', type: 'uri' },
        { name: 'medication_display',   path: 'medication.ofType(CodeableConcept).coding.first().display', type: 'string' },
        { name: 'authored_on',          path: 'authoredOn',                                   type: 'dateTime' },
        { name: 'encounter_id',         path: 'encounter.getId()',                            type: 'id' },
        { name: 'requester_id',         path: 'requester.getId()',                            type: 'id' },
      ]
    }]
  };
}

function diagnosticReportViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'diagnostic_report_view',
    title: 'DiagnosticReport view',
    status: 'active',
    description: 'Flattened DiagnosticReport.',
    resource: 'DiagnosticReport',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'subject_id',           path: 'subject.getId()',                      type: 'id' },
        { name: 'status',               path: 'status',                               type: 'code' },
        { name: 'code',                 path: 'code.coding.first().code',             type: 'code' },
        { name: 'code_system',          path: 'code.coding.first().system',           type: 'uri' },
        { name: 'effective_datetime',   path: 'effective.ofType(dateTime)',           type: 'dateTime' },
        { name: 'issued',               path: 'issued',                               type: 'dateTime' },
        { name: 'encounter_id',         path: 'encounter.getId()',                    type: 'id' },
        { name: 'category_code',        path: 'category.first().coding.first().code', type: 'code' },
      ]
    }]
  };
}

function coverageViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'coverage_view',
    title: 'Coverage / insurance view',
    status: 'active',
    description: 'Flattened Coverage resource — payer and insurance information.',
    resource: 'Coverage',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'beneficiary_id',       path: 'beneficiary.getId()',                  type: 'id' },
        { name: 'status',               path: 'status',                               type: 'code' },
        { name: 'type_code',            path: 'type.coding.first().code',             type: 'code' },
        { name: 'payer_id',             path: 'payor.first().getId()',                type: 'id' },
        { name: 'period_start',         path: 'period.start',                         type: 'dateTime' },
        { name: 'period_end',           path: 'period.end',                           type: 'dateTime' },
      ]
    }]
  };
}

function allergyIntoleranceViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'allergy_intolerance_view',
    title: 'AllergyIntolerance view',
    status: 'active',
    description: 'Flattened AllergyIntolerance resource.',
    resource: 'AllergyIntolerance',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'patient_id',           path: 'patient.getId()',                      type: 'id' },
        { name: 'clinical_status',      path: 'clinicalStatus.coding.first().code',   type: 'code' },
        { name: 'verification_status',  path: 'verificationStatus.coding.first().code', type: 'code' },
        { name: 'code',                 path: 'code.coding.first().code',             type: 'code' },
        { name: 'code_system',          path: 'code.coding.first().system',           type: 'uri' },
        { name: 'onset_datetime',       path: 'onset.ofType(dateTime)',               type: 'dateTime' },
        { name: 'recorded_date',        path: 'recordedDate',                         type: 'dateTime' },
      ]
    }]
  };
}

function immunizationViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'immunization_view',
    title: 'Immunization view',
    status: 'active',
    description: 'Flattened Immunization resource.',
    resource: 'Immunization',
    select: [{
      column: [
        { name: 'id',                   path: 'id',                                   type: 'id' },
        { name: 'patient_id',           path: 'patient.getId()',                      type: 'id' },
        { name: 'status',               path: 'status',                               type: 'code' },
        { name: 'vaccine_code',         path: 'vaccineCode.coding.first().code',      type: 'code' },
        { name: 'vaccine_system',       path: 'vaccineCode.coding.first().system',    type: 'uri' },
        { name: 'occurrence_datetime',  path: 'occurrence.ofType(dateTime)',          type: 'dateTime' },
        { name: 'primary_source',       path: 'primarySource',                        type: 'boolean' },
        { name: 'encounter_id',         path: 'encounter.getId()',                    type: 'id' },
      ]
    }]
  };
}

function serviceRequestViewDefinition(): ViewDefinition {
  return {
    resourceType: 'ViewDefinition',
    name: 'service_request_view',
    title: 'ServiceRequest view (US Core 6.1)',
    status: 'active',
    description: 'Flattened ServiceRequest — referrals, diagnostic orders, and care orders. New in US Core 6.1.',
    resource: 'ServiceRequest',
    select: [{
      column: [
        { name: 'id',                 path: 'id',                                           type: 'id' },
        { name: 'subject_id',         path: 'subject.getId()',                              type: 'id' },
        { name: 'status',             path: 'status',                                       type: 'code' },
        { name: 'intent',             path: 'intent',                                       type: 'code' },
        { name: 'category_code',      path: 'category.first().coding.first().code',         type: 'code' },
        { name: 'category_system',    path: 'category.first().coding.first().system',       type: 'uri' },
        { name: 'code',               path: 'code.coding.first().code',                     type: 'code' },
        { name: 'code_system',        path: 'code.coding.first().system',                   type: 'uri' },
        { name: 'code_display',       path: 'code.coding.first().display',                  type: 'string' },
        { name: 'code_text',          path: 'code.text',                                    type: 'string' },
        { name: 'occurrence_datetime', path: 'occurrence.ofType(dateTime)',                 type: 'dateTime' },
        { name: 'occurrence_start',   path: 'occurrence.ofType(Period).start',              type: 'dateTime' },
        { name: 'occurrence_end',     path: 'occurrence.ofType(Period).end',                type: 'dateTime' },
        { name: 'authored_on',        path: 'authoredOn',                                   type: 'dateTime' },
        { name: 'requester_id',       path: 'requester.getId()',                            type: 'id' },
        { name: 'performer_id',       path: 'performer.first().getId()',                    type: 'id' },
        { name: 'reason_code',        path: 'reasonCode.first().coding.first().code',       type: 'code' },
        { name: 'do_not_perform',     path: 'doNotPerform',                                 type: 'boolean' },
        { name: 'priority',           path: 'priority',                                     type: 'code' },
        { name: 'encounter_id',       path: 'encounter.getId()',                            type: 'id' },
        { name: 'insurance_id',       path: 'insurance.first().getId()',                    type: 'id' },
      ]
    }]
  };
}

// ─── SQL DDL generator ────────────────────────────────────────────────────────

/**
 * Generate PostgreSQL CREATE OR REPLACE VIEW statements from ViewDefinitions.
 * These target a FHIR-sourced flat table (e.g. produced by a FHIR-to-parquet ETL
 * or the HAPI FHIR JPA views from Issue #21).
 */
export function viewDefinitionToSql(vd: ViewDefinition): SqlViewDefinition {
  const cols = extractColumns(vd.select);
  const sourcePaths = cols.map(c => `  ${pathToSqlExpr(c.path, vd.resource.toLowerCase())} AS ${c.name}`).join(',\n');

  const sql =
    `-- ViewDefinition: ${vd.name}\n` +
    `-- Resource: ${vd.resource}\n` +
    (vd.description ? `-- ${vd.description}\n` : '') +
    `CREATE OR REPLACE VIEW ${vd.name} AS\nSELECT\n${sourcePaths}\nFROM fhir_${vd.resource.toLowerCase()};`;

  return { viewName: vd.name, sql, description: vd.description ?? vd.title ?? vd.name };
}

function extractColumns(selects: ViewDefinitionSelect[]): ViewDefinitionColumn[] {
  const cols: ViewDefinitionColumn[] = [];
  for (const sel of selects) {
    if (sel.column) cols.push(...sel.column);
    if (sel.select) cols.push(...extractColumns(sel.select));
  }
  return cols;
}

/** Converts a FHIRPath expression to a rough SQL expression for the DDL. */
function pathToSqlExpr(path: string, _resource: string): string {
  // Simple cases — delegate complex FHIRPath to the runtime (e.g. pg_fhirpath)
  if (!path.includes('.') && !path.includes('(')) return path;
  // Use jsonb extraction for structured paths — implementation depends on storage
  const jsonPath = path
    .replace(/\.getId\(\)/, " ->> 'reference'")
    .replace(/\.first\(\)/, '[0]')
    .replace(/\.ofType\(\w+\)/, '')
    .replace(/\.\w+\(\)/g, '');
  return `fhir_extract('${jsonPath}')`;
}

/**
 * Generate all standard SQL view DDL statements as a single script.
 * Safe for repeated execution (CREATE OR REPLACE).
 */
export function generateAllViewsSql(): string {
  const header =
    `-- SQL-on-FHIR Standard Views\n` +
    `-- Generated by @cqframework/elm-to-sql\n` +
    `-- Safe to re-run: uses CREATE OR REPLACE VIEW\n\n`;

  const views = STANDARD_VIEW_DEFINITIONS.map(vd => viewDefinitionToSql(vd).sql).join('\n\n');
  return header + views;
}
