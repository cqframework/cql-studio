// Author: Preston Lee

import type { CodeableConcept, MeasureReport, Quantity } from 'fhir/r4';

export function getPopulationLabel(code: CodeableConcept | undefined): string {
  if (!code) {
    return '—';
  }
  const coding = code.coding?.[0];
  return coding?.display ?? code.text ?? coding?.code ?? '—';
}

export function formatMeasureScoreQuantity(q: Quantity | undefined): string {
  if (q == null || q.value == null) {
    return '—';
  }
  const v = q.value;
  const unit = q.unit ?? q.code ?? '';
  if (unit) {
    return `${v} ${unit}`;
  }
  if (v >= 0 && v <= 1) {
    return `${Math.round(v * 10000) / 100}%`;
  }
  return String(v);
}

export function formatReference(ref: { reference?: string; display?: string } | undefined): string {
  if (!ref) {
    return '—';
  }
  return ref.display ?? ref.reference ?? '—';
}

export function hasPopulations(report: MeasureReport | null | undefined): boolean {
  return (report?.group ?? []).some(g => (g.population?.length ?? 0) > 0);
}
