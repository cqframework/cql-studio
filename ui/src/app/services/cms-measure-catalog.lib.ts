// Author: Preston Lee

import { Library, Measure } from 'fhir/r4';
import { CmsContentSource } from './cms-content-sources';
import { decodeUtf8Base64 } from './utf8-encoding.lib';

export interface GithubContentEntry {
  name: string;
  path: string;
  type: string;
}

export interface CmsMeasureSummary {
  sourceId: string;
  sourceLabel: string;
  path: string;
  id: string;
  url: string;
  title: string;
  name: string;
  cmsId: string;
  version: string;
  description: string;
  status: string;
  publisher: string;
  libraries: string[];
}

export interface CmsMeasureFilter {
  text: string;
  sourceId: string;
  status: string;
}

const INCLUDE_NAME = /(?:"[^"]+"|[A-Za-z_][\w]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w]*))*/;
const INCLUDE_LINE = new RegExp(String.raw`^\s*include\s+(${INCLUDE_NAME.source})\s+version\s+'[^']+'`, 'gm');

export function isMeasureContentFile(entry: GithubContentEntry): boolean {
  return entry.type === 'file' && entry.name.endsWith('.json') && entry.name !== '.gitkeep';
}

export function canonicalLibraryName(canonical: string): string {
  const withoutVersion = canonical.split('|')[0]?.trim() ?? '';
  const parts = withoutVersion.split('/').filter((part) => part.length > 0);
  const tail = parts[parts.length - 1] ?? '';
  try {
    return decodeURIComponent(tail).trim();
  } catch {
    return tail.trim();
  }
}

export function matchLibraryPath(
  nameOrCanonical: string,
  files: readonly GithubContentEntry[]
): string | null {
  const name = nameOrCanonical.includes('/') || nameOrCanonical.includes('|')
    ? canonicalLibraryName(nameOrCanonical)
    : nameOrCanonical.trim();
  if (!name) {
    return null;
  }
  const byStem = new Map<string, string>();
  for (const file of files) {
    if (!isMeasureContentFile(file)) {
      continue;
    }
    byStem.set(file.name.replace(/\.json$/i, ''), file.path);
  }
  const direct = byStem.get(name) ?? byStem.get(`Library-${name}`);
  return direct ?? null;
}

function cmsIdentifier(measure: Measure): string {
  const identifiers = measure.identifier ?? [];
  const cmsId = identifiers.find((identifier) =>
    (identifier.system ?? '').toLowerCase().endsWith('/cmsid')
  );
  const publisher = identifiers.find((identifier) =>
    identifier.type?.coding?.some((coding) => coding.code === 'publisher')
  );
  const chosen = cmsId ?? publisher ?? identifiers[0];
  return chosen?.value?.trim() ?? '';
}

export function parseCmsMeasureSummary(
  resource: Measure,
  source: CmsContentSource,
  path: string
): CmsMeasureSummary | null {
  if (resource.resourceType !== 'Measure') {
    return null;
  }
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    path,
    id: resource.id?.trim() ?? '',
    url: resource.url?.trim() ?? '',
    title: resource.title?.trim() || resource.name?.trim() || resource.id?.trim() || path,
    name: resource.name?.trim() ?? '',
    cmsId: cmsIdentifier(resource),
    version: resource.version?.trim() ?? '',
    description: (resource.description ?? '').replace(/\s+/g, ' ').trim(),
    status: resource.status ?? '',
    publisher: resource.publisher?.trim() ?? '',
    libraries: (resource.library ?? []).map((library) => library.trim()).filter(Boolean),
  };
}

export function filterCmsMeasures(
  rows: readonly CmsMeasureSummary[],
  filter: CmsMeasureFilter
): CmsMeasureSummary[] {
  const text = filter.text.trim().toLowerCase();
  const sourceId = filter.sourceId.trim();
  const status = filter.status.trim();
  return rows.filter((row) => {
    if (sourceId && row.sourceId !== sourceId) {
      return false;
    }
    if (status && row.status !== status) {
      return false;
    }
    if (!text) {
      return true;
    }
    const haystack = [row.title, row.cmsId, row.description, row.name, row.id]
      .join('\n')
      .toLowerCase();
    return haystack.includes(text);
  });
}

function cqlIncludeNames(library: Library): string[] {
  const names: string[] = [];
  for (const attachment of library.content ?? []) {
    const contentType = attachment.contentType ?? '';
    if (!contentType.includes('cql') || typeof attachment.data !== 'string' || !attachment.data) {
      continue;
    }
    let text = '';
    try {
      text = decodeUtf8Base64(attachment.data);
    } catch {
      continue;
    }
    INCLUDE_LINE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INCLUDE_LINE.exec(text)) !== null) {
      const qualified = match[1] ?? '';
      const tail = qualified.split('.').pop()?.replace(/^"|"$/g, '').trim() ?? '';
      if (tail) {
        names.push(tail);
      }
    }
  }
  return names;
}

/**
 * Canonicals and library names this Library depends on inside the same content repo.
 * External models (FHIRHelpers and similar) are included only when a file stem matches.
 */
export function libraryDependencyRefs(
  library: Library,
  libraryFiles: readonly GithubContentEntry[]
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const add = (ref: string) => {
    const trimmed = ref.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    refs.push(trimmed);
  };

  for (const artifact of library.relatedArtifact ?? []) {
    if (artifact.type !== 'depends-on' || typeof artifact.resource !== 'string') {
      continue;
    }
    if (matchLibraryPath(artifact.resource, libraryFiles)) {
      add(artifact.resource);
    }
  }

  for (const name of cqlIncludeNames(library)) {
    if (matchLibraryPath(name, libraryFiles)) {
      add(name);
    }
  }

  return refs;
}

export function resourceDedupeKey(resource: { resourceType?: string; id?: string; url?: string }): string {
  const type = resource.resourceType ?? '';
  const id = resource.id?.trim() ?? '';
  if (type && id) {
    return `${type}/${id}`;
  }
  const url = resource.url?.trim() ?? '';
  return url || `${type}/`;
}
