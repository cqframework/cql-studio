// Author: Preston Lee

import { referencesOf, type ArtifactRef } from './dependencies.js';
import { resourceKey, TERMINOLOGY_TYPES, type FhirIssue, type FhirResource } from './fhir.js';
import type { FhirRepository } from './repository.js';

export interface TracedResource {
  resource: FhirResource;
  role: 'root' | 'dependency' | 'owned';
}

export interface TraceResult {
  root: FhirResource;
  items: TracedResource[];
  issues: FhirIssue[];
}

export interface TraceOptions {
  errorBehavior?: 'loose' | 'strict';
  /** When set, unversioned references prefer this pin (url -> version). */
  pins?: Map<string, string>;
}

export async function traceArtifact(
  root: FhirResource,
  content: FhirRepository,
  terminology: FhirRepository,
  options: TraceOptions = {}
): Promise<TraceResult> {
  const items: TracedResource[] = [{ resource: root, role: 'root' }];
  const issues: FhirIssue[] = [];
  const seen = new Set<string>([resourceKey(root)]);
  const queue: ArtifactRef[] = referencesOf(root);

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const version = ref.version ?? options.pins?.get(ref.url);
    const repo = ref.type && TERMINOLOGY_TYPES.has(ref.type) ? terminology : content;
    const resolved = await resolveRef(repo, content, ref, version);
    if (!resolved) {
      issues.push({
        severity: 'error',
        code: 'not-found',
        details: { text: `Could not resolve ${ref.type ?? 'resource'} ${ref.url}${version ? `|${version}` : ''}.` },
        expression: [`${root.resourceType}.relatedArtifact`],
      });
      continue;
    }
    const key = resourceKey(resolved);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({ resource: resolved, role: ref.owned ? 'owned' : 'dependency' });
    for (const child of referencesOf(resolved)) {
      queue.push(child);
    }
  }

  return { root, items, issues };
}

async function resolveRef(
  primary: FhirRepository,
  content: FhirRepository,
  ref: ArtifactRef,
  version?: string
): Promise<FhirResource | null> {
  const looksLikeUrl = ref.url.startsWith('http://') || ref.url.startsWith('https://');
  if (!looksLikeUrl) {
    return content.searchLibraryName(ref.url, version);
  }
  try {
    const found = await primary.searchCanonical(ref.type, ref.url, version);
    if (found) {
      return found;
    }
    if (primary !== content) {
      return content.searchCanonical(ref.type, ref.url, version);
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadRoot(
  content: FhirRepository,
  type: string,
  id?: string,
  url?: string,
  version?: string
): Promise<FhirResource | null> {
  if (id) {
    return content.read(type, id);
  }
  if (url) {
    return content.searchCanonical(type, url, version);
  }
  return null;
}
