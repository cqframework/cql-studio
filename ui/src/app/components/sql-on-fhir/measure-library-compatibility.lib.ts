// Author: Preston Lee

import type { Library } from 'fhir/r4';
import type { ElmLibrary, ElmLibraryWrapper } from './elm-to-sql/types/elm';
import {
  buildLibraryParameterSpecs,
  extractReferencedParameterNames,
  isParameterValueSupported,
  type LibraryParameterSpec,
  type LibraryParameterValues,
} from './library-parameters.lib';
import { isStandardPopulationName, MEASURE_POPULATION_NAMES } from './measure-population.lib';

export interface GenerateSqlResultSummary {
  populations: string[];
  warnings: string[];
}

export interface MeasureCompatibilityInput {
  library: Library | null;
  cqlTranslationErrors: string[];
  elmJson: string | null;
  generateSqlResult: GenerateSqlResultSummary | null;
  generateSqlError: string | null;
  parameterSpecs: LibraryParameterSpec[];
  parameterValues: LibraryParameterValues;
  hasExecutionBundle: boolean;
  derivedResourceTypes?: string[];
  selectedResourceTypes?: string[];
  unsupportedResourceTypes?: string[];
  usesFhirPatientFetch?: boolean;
}

export interface CompatibilityIssue {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
}

function resolveElm(elmJson: string | null): ElmLibrary | null {
  if (!elmJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(elmJson) as ElmLibraryWrapper | ElmLibrary;
    return 'library' in parsed ? parsed.library : parsed;
  } catch {
    return null;
  }
}

function hasPatientContext(elm: ElmLibrary | null): boolean {
  return (elm?.statements?.def ?? []).some(d => d.context === 'Patient' || d.name === 'Patient');
}

export function assessMeasureLibraryCompatibility(input: MeasureCompatibilityInput): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const elm = resolveElm(input.elmJson);
  const referencedParams = extractReferencedParameterNames(input.elmJson);
  const specs = input.parameterSpecs.length
    ? input.parameterSpecs
    : buildLibraryParameterSpecs(input.library, input.elmJson);

  for (const err of input.cqlTranslationErrors) {
    issues.push({
      severity: 'blocking',
      code: 'cql-translation-error',
      message: `CQL could not be translated to ELM: ${err}`,
    });
  }

  if (input.cqlTranslationErrors.length === 0 && !input.elmJson?.trim()) {
    issues.push({
      severity: 'blocking',
      code: 'elm-missing',
      message: 'ELM JSON is not available — complete the ELM Translation step first.',
    });
  }

  if (input.generateSqlError) {
    issues.push({
      severity: 'blocking',
      code: 'sql-generation-failed',
      message: `SQL generation failed: ${input.generateSqlError}`,
    });
  }

  const populations = input.generateSqlResult?.populations ?? [];
  if (input.generateSqlResult && populations.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'no-populations',
      message:
        'No measure population defines (e.g. Initial Population, Denominator, Numerator) were detected in this library.',
    });
  }

  const hasInitialPopulation = populations.some(p => p.toLowerCase() === 'initial population');
  if (input.generateSqlResult && populations.length > 0 && !hasInitialPopulation) {
    issues.push({
      severity: 'blocking',
      code: 'missing-initial-population',
      message: 'Missing required define "Initial Population".',
    });
  }

  if (elm && !hasPatientContext(elm)) {
    issues.push({
      severity: 'blocking',
      code: 'no-patient-context',
      message: 'Library does not declare a Patient context — required for population-based measure evaluation.',
    });
  }

  if (referencedParams.has('Measurement Period')) {
    const mpSpec = specs.find(s => s.name === 'Measurement Period');
    const mpValue = input.parameterValues['Measurement Period'];
    if (!mpSpec || mpSpec.valueKind !== 'period' || !isParameterValueSupported(mpValue)) {
      issues.push({
        severity: 'blocking',
        code: 'measurement-period-unresolved',
        message: 'Parameter "Measurement Period" is referenced in CQL but not declared or not supported.',
      });
    }
  }

  for (const spec of specs) {
    if (!spec.referenced) {
      continue;
    }
    const value = input.parameterValues[spec.name];
    if (!isParameterValueSupported(value)) {
      issues.push({
        severity: 'blocking',
        code: 'unsupported-parameter',
        message: `Parameter "${spec.name}" is referenced but has no supported value for SQL execution.`,
      });
    }
  }

  const warnings = input.generateSqlResult?.warnings ?? [];
  for (const w of warnings) {
    const paramMatch = w.match(/Unresolved ParameterRef:\s*(.+)/i);
    if (paramMatch) {
      issues.push({
        severity: 'blocking',
        code: 'unresolved-parameter-ref',
        message: `Unresolved parameter reference: "${paramMatch[1].trim()}".`,
      });
      continue;
    }
    const defineMatch = w.match(/define "([^"]+)"/i);
    if (defineMatch && populations.some(p => p === defineMatch[1])) {
      issues.push({
        severity: 'blocking',
        code: 'population-transpile-warning',
        message: `Define "${defineMatch[1]}" uses unsupported ELM: ${w}`,
      });
      continue;
    }
    issues.push({
      severity: 'warning',
      code: 'transpiler-warning',
      message: w,
    });
  }

  for (const name of MEASURE_POPULATION_NAMES) {
    if (name === 'Initial Population') {
      continue;
    }
    if (!populations.some(p => p.toLowerCase() === name.toLowerCase())) {
      if (name === 'Denominator' || name === 'Numerator') {
        issues.push({
          severity: 'warning',
          code: `missing-${name.toLowerCase().replace(/\s+/g, '-')}`,
          message: `Define "${name}" not found — report may omit this population.`,
        });
      }
    }
  }

  for (const pop of populations) {
    if (!isStandardPopulationName(pop)) {
      issues.push({
        severity: 'warning',
        code: 'non-standard-population',
        message: `Non-standard population define "${pop}" detected — MeasureReport coding may not map correctly.`,
      });
    }
  }

  if (
    referencedParams.has('Measurement Period') &&
    !input.library?.parameter?.some(p => p.name === 'Measurement Period')
  ) {
    issues.push({
      severity: 'warning',
      code: 'measurement-period-no-fhir-metadata',
      message: 'Measurement Period has no FHIR Library parameter metadata; using default period.',
    });
  }

  const valueSetCount = elm?.valueSets?.def?.length ?? 0;
  if (valueSetCount > 0 && !input.elmJson?.includes('"ValueSetRef"')) {
    issues.push({
      severity: 'warning',
      code: 'no-referenced-valuesets',
      message: 'No value sets are referenced in measure logic.',
    });
  }

  if (!input.hasExecutionBundle && input.generateSqlResult) {
    issues.push({
      severity: 'blocking',
      code: 'no-execution-data',
      message: 'No clinical data selected — choose patients from the FHIR server or load the CMS125 preset bundle.',
    });
  }

  for (const type of input.unsupportedResourceTypes ?? []) {
    issues.push({
      severity: 'warning',
      code: 'unsupported-resource-type',
      message: `${type} is referenced by this measure but is not yet supported in in-browser SQL tables.`,
    });
  }

  if (input.usesFhirPatientFetch && (input.derivedResourceTypes?.length ?? 0) > 0) {
    const selected = new Set(input.selectedResourceTypes ?? []);
    for (const type of input.derivedResourceTypes ?? []) {
      if (!selected.has(type)) {
        issues.push({
          severity: 'blocking',
          code: 'missing-resource-type',
          message: `Resource type "${type}" is required by this measure but is not selected for FHIR fetch.`,
        });
      }
    }
  }

  return issues;
}

export function hasBlockingCompatibilityIssues(issues: CompatibilityIssue[]): boolean {
  return issues.some(i => i.severity === 'blocking');
}
