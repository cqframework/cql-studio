// Author: Preston Lee

export interface TextSearchParamRef {
  name: string;
  type?: string;
}

export interface ResolvedTextSearch {
  /** FHIR search query key, e.g. `_content` or `title:contains`. */
  param: string;
  /** Label for placeholders / helper text. */
  label: string;
}

const FULL_TEXT_PARAMS = ['_content', '_text'] as const;

/** Preferred string/token fields when full-text params are unavailable. */
const PREFERRED_FIELDS: Record<string, string[]> = {
  Patient: ['name'],
  Practitioner: ['name'],
  Person: ['name'],
  RelatedPerson: ['name'],
  Organization: ['name'],
  Group: ['name', 'identifier'],
  Library: ['title', 'name', 'description'],
  Measure: ['title', 'name', 'description'],
  PlanDefinition: ['title', 'name', 'description'],
  ActivityDefinition: ['title', 'name', 'description'],
  Questionnaire: ['title', 'name', 'description'],
  ValueSet: ['title', 'name', 'description'],
  CodeSystem: ['title', 'name', 'description'],
  StructureDefinition: ['title', 'name', 'description'],
  Bundle: ['identifier', 'type'],
};

const DEFAULT_PREFERRED_FIELDS = ['title', 'name', 'description'];

const CONTAINS_FIELDS = new Set(['name', 'title', 'description', 'identifier']);

function withContains(field: string, paramType: string | undefined): string {
  if (paramType === 'token' || paramType === 'reference' || paramType === 'uri') {
    return field;
  }
  if (CONTAINS_FIELDS.has(field) || paramType === 'string' || paramType == null) {
    return `${field}:contains`;
  }
  return field;
}

/**
 * Picks the best text-oriented search parameter for a resource type.
 * Prefer server-advertised `_content`, then `_text`, then type-specific
 * string fields (with `:contains` when appropriate). When CapabilityStatement
 * params are unknown, falls back to conventional field params per type.
 * Library always uses `title:contains` (matches LibraryService).
 */
export function resolveBestTextSearchParam(
  resourceType: string,
  availableParams: readonly TextSearchParamRef[] | null | undefined
): ResolvedTextSearch | null {
  if (resourceType === 'Library') {
    return { param: 'title:contains', label: 'title:contains' };
  }

  const available = availableParams ?? [];
  const byName = new Map(available.map((p) => [p.name, p]));
  const hasCapability = byName.size > 0;

  if (hasCapability) {
    for (const ft of FULL_TEXT_PARAMS) {
      if (byName.has(ft)) {
        return { param: ft, label: ft };
      }
    }
  }

  const preferred = PREFERRED_FIELDS[resourceType] ?? DEFAULT_PREFERRED_FIELDS;
  for (const field of preferred) {
    if (hasCapability && !byName.has(field)) {
      continue;
    }
    const paramType = byName.get(field)?.type;
    const param = withContains(field, paramType);
    return { param, label: param };
  }

  if (hasCapability) {
    const firstString = available.find((p) => (p.type ?? 'string') === 'string');
    if (firstString?.name) {
      const param = withContains(firstString.name, firstString.type);
      return { param, label: param };
    }
    return null;
  }

  return { param: '_text', label: '_text' };
}

export function buildTextSearchParams(
  resourceType: string,
  query: string,
  availableParams: readonly TextSearchParamRef[] | null | undefined
): Record<string, string> {
  const q = query.trim();
  if (!q) {
    return {};
  }
  const resolved = resolveBestTextSearchParam(resourceType, availableParams);
  if (!resolved) {
    return {};
  }
  return { [resolved.param]: q };
}
