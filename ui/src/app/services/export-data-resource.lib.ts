// Author: Preston Lee

import {
  Condition,
  ImplementationGuide,
  Measure,
  MeasureReport,
  Observation,
  Patient,
  Resource
} from 'fhir/r4';
import { exportDataResourceKey } from './implementation-guide.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';

export type ExportDataTab =
  | 'Patient'
  | 'Measure'
  | 'MeasureReport'
  | 'Condition'
  | 'Observation'
  | 'ImplementationGuide'
  | 'Other';

export type ExportDataSelectionSource = 'search' | 'patient-expansion' | 'ig-resolution';

export interface ExportDataSelection {
  key: string;
  resource: Resource;
  label: string;
  detail?: string;
  source?: ExportDataSelectionSource;
  igKey?: string;
}

export interface IgExportOptions {
  igKey: string;
  sanitize: boolean;
  syncPackageManifest: boolean;
  selectedEntryKeys: string[];
  selectedGlobalIndices: number[];
  resolveReferences: boolean;
}

export interface PatientExpansionOptions {
  enabled: boolean;
  resourceTypes: string[];
}

export function exportDataResourceLabel(resource: Resource): string {
  const rt = resourceTypeOf(resource) ?? 'Resource';
  switch (rt) {
    case 'Patient':
      return patientDisplayName(resource as Patient);
    case 'Measure':
      return (resource as Measure).title ?? (resource as Measure).name ?? (resource as Measure).id ?? 'Measure';
    case 'MeasureReport':
      return measureReportLabel(resource as MeasureReport);
    case 'Condition':
      return conditionLabel(resource as Condition);
    case 'Observation':
      return observationLabel(resource as Observation);
    case 'ImplementationGuide':
      return (
        (resource as ImplementationGuide).title ??
        (resource as ImplementationGuide).name ??
        (resource as ImplementationGuide).packageId ??
        (resource as ImplementationGuide).id ??
        'ImplementationGuide'
      );
    default: {
      const r = resource as { title?: string; name?: string; id?: string };
      return r.title ?? r.name ?? r.id ?? rt;
    }
  }
}

export function exportDataResourceDetail(resource: Resource): string {
  const rt = resourceTypeOf(resource) ?? 'Resource';
  const id = (resource as { id?: string }).id;
  const url = (resource as { url?: string }).url;
  const parts: string[] = [rt];
  if (id) {
    parts.push(id);
  }
  if (url) {
    parts.push(url);
  }
  const version = (resource as { version?: string }).version;
  if (version) {
    parts.push(`v${version}`);
  }
  return parts.join(' · ');
}

export function toExportDataSelection(
  resource: Resource,
  source?: ExportDataSelectionSource,
  detail?: string,
  igKey?: string
): ExportDataSelection {
  return {
    key: exportDataResourceKey(resource),
    resource,
    label: exportDataResourceLabel(resource),
    detail: detail ?? exportDataResourceDetail(resource),
    source,
    igKey
  };
}

export function mergeExportDataSelections(
  current: ExportDataSelection[],
  additions: ExportDataSelection[]
): ExportDataSelection[] {
  const map = new Map(current.map((s) => [s.key, s]));
  for (const a of additions) {
    map.set(a.key, a);
  }
  return [...map.values()];
}

export function groupSelectionsByType(
  selections: ExportDataSelection[]
): { resourceType: string; count: number; items: ExportDataSelection[] }[] {
  const map = new Map<string, ExportDataSelection[]>();
  for (const s of selections) {
    const rt = resourceTypeOf(s.resource) ?? 'Unknown';
    const list = map.get(rt) ?? [];
    list.push(s);
    map.set(rt, list);
  }
  return [...map.entries()]
    .map(([resourceType, items]) => ({ resourceType, count: items.length, items }))
    .sort((a, b) => a.resourceType.localeCompare(b.resourceType));
}

export function dataSelectionSummary(selections: ExportDataSelection[]): string {
  const groups = groupSelectionsByType(selections);
  if (groups.length === 0) {
    return 'None';
  }
  return groups.map((g) => `${g.count} ${g.resourceType}${g.count === 1 ? '' : 's'}`).join(' · ');
}

function patientDisplayName(patient: Patient): string {
  const name = patient.name?.[0];
  if (name) {
    const given = name.given?.join(' ') ?? '';
    const family = name.family ?? '';
    const full = `${given} ${family}`.trim();
    if (full) {
      return full;
    }
  }
  if (patient.identifier?.[0]?.value) {
    return patient.identifier[0].value!;
  }
  return patient.id ?? 'Patient';
}

function measureReportLabel(report: MeasureReport): string {
  const measure = report.measure ?? 'MeasureReport';
  const status = report.status ?? '';
  return status ? `${measure} (${status})` : measure;
}

function conditionLabel(condition: Condition): string {
  const code = condition.code?.text ?? condition.code?.coding?.[0]?.display ?? condition.code?.coding?.[0]?.code;
  return code ?? condition.id ?? 'Condition';
}

function observationLabel(observation: Observation): string {
  const code = observation.code?.text ?? observation.code?.coding?.[0]?.display ?? observation.code?.coding?.[0]?.code;
  const value =
    observation.valueQuantity?.value != null
      ? String(observation.valueQuantity.value)
      : observation.valueString ?? observation.valueCodeableConcept?.text;
  if (code && value) {
    return `${code}: ${value}`;
  }
  return code ?? observation.id ?? 'Observation';
}
