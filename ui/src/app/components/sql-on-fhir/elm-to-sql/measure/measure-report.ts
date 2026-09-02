/**
 * FHIR MeasureReport generator.
 *
 * Converts SQL population count results into a valid FHIR R4 MeasureReport resource.
 * The caller is responsible for saving the report to the FHIR server via the API.
 *
 * Spec: https://www.hl7.org/fhir/measurereport.html
 */

import type { MeasureReport } from 'fhir/r4';

export interface PopulationCounts {
  /** key: define name (e.g. "Initial Population"), value: patient count */
  [defineName: string]: number;
}

export interface MeasureReportOptions {
  /** FHIR canonical URL of the Measure resource. Required. */
  measureUrl: string;
  /** Measurement period start (ISO 8601 date or dateTime). */
  periodStart: string;
  /** Measurement period end (ISO 8601 date or dateTime). */
  periodEnd: string;
  /** MeasureReport.type. Default: 'summary'. */
  type?: 'individual' | 'subject-list' | 'summary' | 'data-collection';
  /** MeasureReport.subject — reference to a Group or Patient. */
  subject?: { reference: string; display?: string };
  /** Optional reporter reference (Organization etc.). */
  reporter?: { reference: string; display?: string };
  /** Optional: ISO date when the report was generated. Default: now. */
  date?: string;
  /** Optional: group identifier for the main population group. */
  groupId?: string;
}

const POPULATION_CODES: Record<string, { code: string; display: string }> = {
  'Initial Population': { code: 'initial-population', display: 'Initial Population' },
  'Denominator': { code: 'denominator', display: 'Denominator' },
  'Denominator Exclusion': { code: 'denominator-exclusion', display: 'Denominator Exclusion' },
  'Denominator Exception': { code: 'denominator-exception', display: 'Denominator Exception' },
  'Numerator': { code: 'numerator', display: 'Numerator' },
  'Numerator Exclusion': { code: 'numerator-exclusion', display: 'Numerator Exclusion' },
  'Measure Population': { code: 'measure-population', display: 'Measure Population' },
  'Measure Population Exclusion': { code: 'measure-population-exclusion', display: 'Measure Population Exclusion' },
};

const MEASURE_POPULATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/measure-population';
const SUMMARY_MEASURE_REPORT_PROFILE =
  'http://hl7.org/fhir/us/cqfmeasures/StructureDefinition/summary-measure-report-cqfm';

/**
 * Generate a FHIR R4 MeasureReport from SQL population counts.
 */
export function generateMeasureReport(
  counts: PopulationCounts,
  options: MeasureReportOptions,
): MeasureReport {
  const date = options.date ?? new Date().toISOString();
  const type = options.type ?? 'summary';

  const populations: NonNullable<MeasureReport['group']>[number]['population'] = [];
  for (const [name, count] of Object.entries(counts)) {
    const popCode = POPULATION_CODES[name];
    if (!popCode) {
      continue;
    }

    populations.push({
      code: {
        coding: [{ system: MEASURE_POPULATION_SYSTEM, code: popCode.code, display: popCode.display }],
        text: name,
      },
      count: Math.trunc(count),
    });
  }

  const measureScore = calculateMeasureScore(counts);

  const group: NonNullable<MeasureReport['group']>[number] = {
    ...(options.groupId ? { id: options.groupId } : { id: 'group-1' }),
    population: populations.length > 0 ? populations : undefined,
    ...(measureScore !== null
      ? { measureScore: { value: measureScore, unit: '{ratio}', system: 'http://unitsofmeasure.org', code: '{ratio}' } }
      : {}),
  };

  const report: MeasureReport = {
    resourceType: 'MeasureReport',
    meta: {
      profile: [SUMMARY_MEASURE_REPORT_PROFILE],
    },
    status: 'complete',
    type,
    measure: options.measureUrl,
    date,
    period: {
      start: options.periodStart,
      end: options.periodEnd,
    },
    group: [group],
  };

  if (options.subject) {
    report.subject = options.subject;
  }
  if (options.reporter) {
    report.reporter = options.reporter;
  }

  return report;
}

function calculateMeasureScore(counts: PopulationCounts): number | null {
  const numerator = counts['Numerator'] ?? 0;
  const denominator = counts['Denominator'] ?? 0;
  const denomExclusion = counts['Denominator Exclusion'] ?? 0;
  const denomException = counts['Denominator Exception'] ?? 0;

  const adjustedDenominator = denominator - denomExclusion - denomException;
  if (adjustedDenominator <= 0) {
    return null;
  }

  return Math.round((numerator / adjustedDenominator) * 10000) / 10000;
}

/**
 * Convert a flat SQL result row into a PopulationCounts map.
 */
export function sqlRowToPopulationCounts(row: Record<string, unknown>): PopulationCounts {
  const counts: PopulationCounts = {};
  for (const [col, val] of Object.entries(row)) {
    if (!col.endsWith('_count')) {
      continue;
    }
    const defineName = col
      .replace(/_count$/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    counts[defineName] = typeof val === 'number' ? val : Number(val ?? 0);
  }
  return counts;
}
