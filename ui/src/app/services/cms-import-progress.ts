// Author: Preston Lee

import { canonicalLibraryName, CmsMeasureSummary } from './cms-measure-catalog.lib';

export interface CmsImportProgress {
  /** `${sourceId}:${path}` when one measure is in scope. */
  measureKey: string | null;
  measure: string;
  /** 1-based index among the selected measures when one measure is in scope. */
  index: number | null;
  total: number;
  stage: string;
  detail: string;
}

export type CmsImportProgressReporter = (progress: CmsImportProgress) => void;

export function cmsMeasureKey(measure: { sourceId: string; path: string }): string {
  return `${measure.sourceId}:${measure.path}`;
}

export function formatCmsMeasureLabel(measure: { cmsId: string; title: string }): string {
  const id = measure.cmsId.trim();
  const title = measure.title.trim();
  if (id && title && id !== title) {
    return `${id} · ${title}`;
  }
  return title || id || 'Measure';
}

export function compactMeasureList(
  measures: readonly { cmsId: string; title: string }[],
  limit = 3
): string {
  const labels = measures.map((measure) => measure.cmsId.trim() || measure.title.trim() || 'Measure');
  if (labels.length === 0) {
    return 'Shared setup';
  }
  if (labels.length <= limit) {
    return labels.join(', ');
  }
  return `${labels.slice(0, limit).join(', ')} and ${labels.length - limit} more`;
}

export function libraryReferenceMatches(
  library: { name?: string; url?: string },
  reference: string
): boolean {
  const name = library.name?.trim() ?? '';
  const refName = canonicalLibraryName(reference);
  if (name && refName === name) {
    return true;
  }
  const url = library.url?.trim() ?? '';
  if (!url) {
    return false;
  }
  const refUrl = reference.split('|')[0]?.trim() ?? '';
  return refUrl === url;
}

/** One measure names that measure. Several measures stay a short shared list. */
export function importProgressForMeasures(
  scope: readonly CmsMeasureSummary[],
  all: readonly CmsMeasureSummary[],
  stage: string,
  detail: string
): CmsImportProgress {
  const total = all.length;
  if (scope.length === 1) {
    const measure = scope[0];
    const found = all.findIndex((item) => cmsMeasureKey(item) === cmsMeasureKey(measure));
    return {
      measureKey: cmsMeasureKey(measure),
      measure: formatCmsMeasureLabel(measure),
      index: (found >= 0 ? found : 0) + 1,
      total: total || 1,
      stage,
      detail,
    };
  }
  return {
    measureKey: null,
    measure: compactMeasureList(scope),
    index: null,
    total,
    stage,
    detail,
  };
}

export function importProgressForLibrary(
  library: { name?: string; url?: string },
  all: readonly CmsMeasureSummary[],
  stage: string,
  detail: string
): CmsImportProgress {
  const owners = all.filter((measure) =>
    measure.libraries.some((reference) => libraryReferenceMatches(library, reference))
  );
  return importProgressForMeasures(owners.length > 0 ? owners : all, all, stage, detail);
}

export function vsacValueSetLabel(canonicalUrl: string): string {
  const path = canonicalUrl.split(/[?#]/)[0] ?? canonicalUrl;
  const segment = path.split('/').filter((part) => part.length > 0).pop() ?? canonicalUrl;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function describeVsacImportActivity(progress: {
  phase: 'check' | 'expand' | 'post';
  canonicalUrl: string;
  index: number;
  total: number;
  count: number;
}): string {
  if (progress.phase === 'post') {
    return `Posting ${progress.count} value sets (batch ${progress.index} of ${progress.total})`;
  }
  const action = progress.phase === 'check' ? 'Checking' : 'Expanding';
  return `${action} ${vsacValueSetLabel(progress.canonicalUrl)} (${progress.index} of ${progress.total})`;
}
