// Author: Preston Lee

import {
  RegistryImportResultRow,
  RegistryImportResultSortColumn
} from '../../models/fhir-package-import.types';

export type ImportResultOutcomeFilter = 'all' | 'errors' | 'success';

export function importResultSortValue(
  row: RegistryImportResultRow,
  col: Exclude<RegistryImportResultSortColumn, 'ok'>
): string {
  switch (col) {
    case 'packageName':
      return row.packageName;
    case 'channel':
      return row.channel;
    case 'resourceType':
      return row.resourceType;
    case 'resourceId':
      return row.resourceId;
    case 'filename':
      return row.filename;
    case 'message':
      return row.message;
    default:
      return '';
  }
}

export function filterAndSortImportResults(
  rows: readonly RegistryImportResultRow[],
  outcomeFilter: ImportResultOutcomeFilter,
  search: string,
  sortColumn: RegistryImportResultSortColumn,
  sortAsc: boolean
): RegistryImportResultRow[] {
  let filtered = [...rows];
  if (outcomeFilter === 'errors') {
    filtered = filtered.filter((r) => !r.ok);
  } else if (outcomeFilter === 'success') {
    filtered = filtered.filter((r) => r.ok);
  }
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((r) =>
      [
        r.packageName,
        r.channel,
        r.resourceType,
        r.resourceId,
        r.filename,
        r.message,
        r.ok ? 'ok' : 'error'
      ].some((s) => s.toLowerCase().includes(q))
    );
  }
  const dir = sortAsc ? 1 : -1;
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortColumn === 'ok') {
      cmp = (a.ok ? 1 : 0) - (b.ok ? 1 : 0);
    } else {
      const sa = importResultSortValue(a, sortColumn);
      const sb = importResultSortValue(b, sortColumn);
      cmp = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
    }
    return cmp * dir;
  });
  return filtered;
}

export function importResultCounts(rows: readonly RegistryImportResultRow[]): {
  total: number;
  ok: number;
  errors: number;
} {
  const ok = rows.filter((r) => r.ok).length;
  const bad = rows.length - ok;
  return { total: rows.length, ok, errors: bad };
}
