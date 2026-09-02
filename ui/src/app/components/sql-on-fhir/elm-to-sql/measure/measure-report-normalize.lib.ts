// Author: Preston Lee

import type { Library, MeasureReport } from 'fhir/r4';

/** Known demo/library name → eCQM Measure canonical URL. */
const LIBRARY_MEASURE_URLS: Record<string, string> = {
  BreastCancerScreening: 'http://ecqi.healthit.gov/ecqms/Measure/BreastCancerScreening',
};

export type MeasureReportServerMode = 'create' | 'update';

export function inferMeasureUrlFromLibrary(library: Library | null): string {
  if (library?.name && LIBRARY_MEASURE_URLS[library.name]) {
    return LIBRARY_MEASURE_URLS[library.name];
  }
  const measureRelated = library?.relatedArtifact?.find(
    a => a.type === 'depends-on' && a.resource?.includes('Measure/')
  );
  if (measureRelated?.resource) {
    const url = measureRelated.resource.split('|')[0];
    if (url.includes('/Measure/')) {
      return url;
    }
  }
  if (library?.url?.includes('/Measure/')) {
    return library.url;
  }
  const baseName = library?.name ?? library?.id ?? 'unknown';
  return `http://cqlstudio.com/Measure/${baseName}`;
}

export function validateMeasureReportRequiredFields(report: MeasureReport): void {
  if (report.resourceType !== 'MeasureReport') {
    throw new Error('Resource must be a MeasureReport.');
  }
  if (!report.status?.trim()) {
    throw new Error('MeasureReport.status is required.');
  }
  if (!report.type?.trim()) {
    throw new Error('MeasureReport.type is required.');
  }
  if (!report.measure?.trim()) {
    throw new Error('MeasureReport.measure is required.');
  }
  if (!report.period?.start?.trim() || !report.period?.end?.trim()) {
    throw new Error('MeasureReport.period.start and period.end are required.');
  }
}

export function normalizeMeasureReportForServer(
  report: MeasureReport,
  mode: MeasureReportServerMode,
  persistedId?: string | null,
  persistedMeta?: MeasureReport['meta'] | null,
): MeasureReport {
  validateMeasureReportRequiredFields(report);
  const normalized = JSON.parse(JSON.stringify(report)) as MeasureReport;

  if (normalized.group?.length) {
    normalized.group = normalized.group.map((g, gi) => {
      const group = { ...g, id: g.id ?? `group-${gi + 1}` };
      if (group.population?.length) {
        group.population = group.population.map((p, pi) => ({
          ...p,
          id: p.id ?? `population-${gi + 1}-${pi + 1}`,
          count: p.count != null ? Math.trunc(p.count) : p.count,
        }));
      }
      if (group.stratifier?.length) {
        group.stratifier = group.stratifier.map((s, si) => ({
          ...s,
          id: s.id ?? `stratifier-${gi + 1}-${si + 1}`,
        }));
      }
      return group;
    });
  }

  if (mode === 'create') {
    delete normalized.id;
    delete normalized.meta;
    return normalized;
  }

  if (persistedId) {
    normalized.id = persistedId;
  }
  if (persistedMeta) {
    normalized.meta = persistedMeta;
  }
  return normalized;
}
