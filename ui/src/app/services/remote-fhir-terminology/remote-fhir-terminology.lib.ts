// Author: Preston Lee

import type { CapabilityStatement } from 'fhir/r4';

/**
 * True when the CapabilityStatement lists `_sort` for ValueSet search (REST-wide or on the ValueSet type).
 */
export function capabilityStatementSupportsValueSetSort(cap: CapabilityStatement | null | undefined): boolean {
  if (!cap?.rest?.length) return false;
  for (const rest of cap.rest) {
    for (const sp of rest.searchParam ?? []) {
      if (sp.name === '_sort') return true;
    }
    for (const r of rest.resource ?? []) {
      if (r.type !== 'ValueSet') continue;
      for (const sp of r.searchParam ?? []) {
        if (sp.name === '_sort') return true;
      }
    }
  }
  return false;
}

/**
 * ValueSet `searchParam` names suitable as `_sort` keys (no chained/modifier syntax).
 */
export function valueSetSortFieldChoicesFromCapability(cap: CapabilityStatement | null | undefined): string[] {
  if (!cap?.rest?.length) return [];
  const names = new Set<string>();
  for (const rest of cap.rest) {
    for (const r of rest.resource ?? []) {
      if (r.type !== 'ValueSet') continue;
      for (const sp of r.searchParam ?? []) {
        const n = sp.name;
        if (typeof n === 'string' && n.length > 0 && !n.includes(':')) {
          names.add(n);
        }
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Maps an absolute Bundle.link URL to a path+query relative to a configured FHIR base,
 * when the link host is allowlisted and matches the base host.
 */
export function fhirPathAndQueryFromBundleLink(
  linkUrl: string,
  fhirBaseUrl: string,
  allowedHosts: ReadonlySet<string>
): string | null {
  const baseStr = fhirBaseUrl.replace(/\/+$/, '');
  let link: URL;
  let base: URL;
  try {
    link = new URL(linkUrl.trim());
    base = new URL(baseStr);
  } catch {
    return null;
  }
  if (!allowedHosts.has(link.hostname) || link.hostname !== base.hostname) {
    return null;
  }
  const basePath = base.pathname.replace(/\/+$/, '') || '/';
  if (!link.pathname.startsWith(basePath)) {
    return null;
  }
  let rest = link.pathname.slice(basePath.length);
  if (rest === '') {
    rest = '/';
  } else if (!rest.startsWith('/')) {
    rest = `/${rest}`;
  }
  return `${rest}${link.search}`;
}

/** Standard FHIR ValueSet search parameters shared across remote terminology clients. */
export interface StandardValueSetSearchParams {
  nameContains?: string;
  titleContains?: string;
  url?: string;
  identifier?: string;
  version?: string;
  status?: string;
  publisherContains?: string;
  descriptionContains?: string;
  date?: string;
  _id?: string;
  _lastUpdated?: string;
  _sort?: string;
  _count?: number;
}

export function appendStandardValueSetSearchParams(
  q: URLSearchParams,
  params: StandardValueSetSearchParams,
  options?: { maxCount?: number; defaultCount?: number }
): void {
  const maxCount = options?.maxCount ?? 200;
  const defaultCount = options?.defaultCount ?? 50;
  const t = (s: string | undefined) => (s == null ? '' : String(s).trim());
  const set = (key: string, value: string | undefined) => {
    const v = t(value);
    if (v) q.set(key, v);
  };
  const nameC = t(params.nameContains);
  if (nameC) q.set('name:contains', nameC);
  const titleC = t(params.titleContains);
  if (titleC) q.set('title:contains', titleC);
  const pubC = t(params.publisherContains);
  if (pubC) q.set('publisher:contains', pubC);
  const descC = t(params.descriptionContains);
  if (descC) q.set('description:contains', descC);
  set('url', params.url);
  set('identifier', params.identifier);
  set('version', params.version);
  set('status', params.status);
  set('date', params.date);
  set('_id', params._id);
  set('_lastUpdated', params._lastUpdated);
  set('_sort', params._sort);
  const count = params._count ?? defaultCount;
  q.set('_count', String(Math.min(maxCount, Math.max(1, count))));
}

export interface ExpansionPageInfoInput {
  rowCount: number;
  offset: number;
  count: number;
  total?: number;
}

export function computeExpansionCanNext(input: ExpansionPageInfoInput): boolean {
  const { rowCount, offset, count, total } = input;
  if (rowCount <= 0) return false;
  if (typeof total === 'number') {
    return offset + rowCount < total;
  }
  return rowCount >= Math.max(1, count);
}
