// Author: Preston Lee

import { Library } from 'fhir/r4';
import { ExportDependencyNode } from '../../services/export-dependency-graph.service';

export function libraryIdentityKey(lib: Library): string {
  return `${lib.id ?? ''}|${lib.name ?? ''}|${lib.version ?? ''}|${lib.url ?? ''}`;
}

export function sameLibrary(a: Library, b: Library): boolean {
  if (a.id && b.id && a.id === b.id) {
    return true;
  }
  return a.name === b.name && a.version === b.version && a.url === b.url;
}

export function isLogicLibrary(lib: Library): boolean {
  const codings = lib.type?.coding ?? [];
  if (codings.length === 0) {
    return true;
  }
  return codings.some((c) => c.code === 'logic-library' || c.code === 'asset-collection');
}

export function rootsFingerprint(libraries: readonly Library[]): string {
  return libraries
    .map((l) => libraryIdentityKey(l))
    .sort()
    .join(';');
}

export function statusBadgeClass(status: ExportDependencyNode['status']): string {
  switch (status) {
    case 'resolved':
      return 'text-bg-success';
    case 'missing':
      return 'text-bg-danger';
    case 'external':
      return 'text-bg-secondary';
    case 'cycle':
      return 'text-bg-warning';
    default:
      return 'text-bg-light';
  }
}
