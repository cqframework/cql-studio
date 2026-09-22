// Author: Preston Lee

import {
  decodeBase64Utf8,
  hasOwnedExtension,
  splitCanonical,
  type FhirRelatedArtifact,
  type FhirResource,
} from './fhir.js';

export interface ArtifactRef {
  type?: string;
  url: string;
  version?: string;
  owned: boolean;
  role: 'dependency' | 'owned';
}

export function referencesOf(resource: FhirResource): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  const seen = new Set<string>();
  const add = (canonical: string | undefined, owned: boolean, type?: string) => {
    if (!canonical?.trim()) {
      return;
    }
    const parsed = splitCanonical(canonical.trim());
    if (!parsed.url) {
      return;
    }
    const key = `${type ?? ''}|${parsed.url}|${parsed.version ?? ''}|${owned}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push({
      type,
      url: parsed.url,
      version: parsed.version,
      owned,
      role: owned ? 'owned' : 'dependency',
    });
  };

  for (const artifact of resource.relatedArtifact ?? []) {
    add(artifact.resource, hasOwnedExtension(artifact), guessType(artifact));
  }
  for (const lib of resource.library ?? []) {
    add(lib, false, 'Library');
  }
  for (const include of resource.compose?.include ?? []) {
    if (include.system) {
      add(include.system, false, 'CodeSystem');
    }
    for (const vs of include.valueSet ?? []) {
      add(vs, false, 'ValueSet');
    }
  }
  for (const item of resource.definition?.resource ?? []) {
    const reference = typeof item.reference === 'string' ? item.reference : item.reference?.reference;
    if (reference?.startsWith('http://') || reference?.startsWith('https://')) {
      add(reference, false);
    }
  }

  const decoded = libraryContent(resource);
  if (decoded.elm) {
    for (const ref of elmValueSets(decoded.elm)) {
      add(ref.version ? `${ref.url}|${ref.version}` : ref.url, false, 'ValueSet');
    }
    for (const ref of elmIncludes(decoded.elm)) {
      add(ref.version ? `${ref.url}|${ref.version}` : ref.url, false, 'Library');
    }
  } else if (decoded.cql) {
    // Prefer ELM when present so CQL re-declarations do not double-queue the same refs.
    for (const ref of cqlDeclarations(decoded.cql)) {
      add(ref.version ? `${ref.url}|${ref.version}` : ref.url, false, ref.type);
    }
  }
  return refs;
}

export function ownedChildren(resource: FhirResource): ArtifactRef[] {
  return referencesOf(resource).filter((ref) => ref.owned);
}

function guessType(artifact: FhirRelatedArtifact): string | undefined {
  const resource = artifact.resource ?? '';
  const match = /\/(Library|Measure|ValueSet|CodeSystem|PlanDefinition|ActivityDefinition|Questionnaire|ConceptMap|NamingSystem|ImplementationGuide)\//.exec(
    resource
  );
  return match?.[1];
}

function libraryContent(resource: FhirResource): { elm?: unknown; cql?: string } {
  let elm: unknown;
  let cql: string | undefined;
  const parts = resource.content;
  for (const part of parts ?? []) {
    const data = typeof part === 'object' && part ? (part as { data?: string; contentType?: string }).data : undefined;
    const contentType =
      typeof part === 'object' && part
        ? (part as { data?: string; contentType?: string }).contentType
        : undefined;
    if (!data) {
      continue;
    }
    const type = (contentType ?? '').toLowerCase();
    let text = '';
    try {
      text = decodeBase64Utf8(data);
    } catch {
      continue;
    }
    if (type.includes('elm+json') || type.includes('elm.json')) {
      try {
        elm = JSON.parse(text) as unknown;
      } catch {
        elm = undefined;
      }
    } else if (type.includes('cql') && !type.includes('elm')) {
      cql = text;
    }
  }
  return { elm, cql };
}

interface NamedUrl {
  url: string;
  version?: string;
  type: string;
}

function elmLibrary(elm: unknown): Record<string, unknown> | undefined {
  if (!elm || typeof elm !== 'object') {
    return undefined;
  }
  const root = elm as Record<string, unknown>;
  const library = root.library;
  if (library && typeof library === 'object') {
    return library as Record<string, unknown>;
  }
  return root;
}

function elmValueSets(elm: unknown): Array<{ url: string; version?: string }> {
  const library = elmLibrary(elm);
  const valueSets = library?.valueSets as { def?: Array<{ id?: string; version?: string }> } | undefined;
  const defs = valueSets?.def ?? [];
  return defs
    .filter((def) => typeof def.id === 'string' && def.id.trim())
    .map((def) => ({ url: def.id!.trim(), version: def.version?.trim() || undefined }));
}

function elmIncludes(elm: unknown): Array<{ url: string; version?: string }> {
  const library = elmLibrary(elm);
  const includes = library?.includes as { def?: Array<{ path?: string; version?: string }> } | undefined;
  const defs = includes?.def ?? [];
  return defs
    .filter((def) => typeof def.path === 'string' && def.path.trim() && def.path !== 'FHIRHelpers')
    .map((def) => ({ url: def.path!.trim(), version: def.version?.trim() || undefined }));
}

function cqlDeclarations(cql: string): NamedUrl[] {
  // Do not treat the "//" in http(s):// as a line comment.
  const stripped = cql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
  const refs: NamedUrl[] = [];
  const include =
    /\binclude\s+(?:"([^"]+)"|([A-Za-z_][\w.]*))(?:\s+version\s+'([^']*)')?/gi;
  let match: RegExpExecArray | null;
  while ((match = include.exec(stripped))) {
    const path = match[1] ?? match[2];
    if (!path || path === 'FHIRHelpers') {
      continue;
    }
    refs.push({ url: path, version: match[3] || undefined, type: 'Library' });
  }
  const valueset = /\bvalueset\s+"[^"]+"\s*:\s*'([^']+)'(?:\s+version\s+'([^']*)')?/gi;
  while ((match = valueset.exec(stripped))) {
    refs.push({ url: match[1], version: match[2] || undefined, type: 'ValueSet' });
  }
  const codesystem = /\bcodesystem\s+"[^"]+"\s*:\s*'([^']+)'(?:\s+version\s+'([^']*)')?/gi;
  while ((match = codesystem.exec(stripped))) {
    refs.push({ url: match[1], version: match[2] || undefined, type: 'CodeSystem' });
  }
  return refs;
}
