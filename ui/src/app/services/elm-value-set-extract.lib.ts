// Author: Preston Lee

/** Minimal ELM shapes needed to read `valueSets.def`. */
export interface ElmValueSetDefRef {
  name: string;
  id: string;
  version?: string;
}

export interface ElmLibraryForValueSets {
  valueSets?: { def?: ElmValueSetDefRef[] };
  statements?: unknown;
}

export interface ElmLibraryWrapperForValueSets {
  library: ElmLibraryForValueSets;
}

/** A single value set reference as declared in a CQL/ELM library. */
export interface ElmValueSetReference {
  name: string;
  url: string;
  version?: string;
}

function resolveLibrary(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmLibraryForValueSets {
  return 'library' in input ? input.library : input;
}

/**
 * Extract all value set references declared in an ELM library (`valueSets.def`).
 */
export function extractElmValueSets(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmValueSetReference[] {
  const lib = resolveLibrary(input);
  const defs = lib.valueSets?.def ?? [];
  return defs.map((d) => ({
    name: d.name,
    url: d.id,
    ...(d.version ? { version: d.version } : {})
  }));
}

function collectValueSetRefNames(node: unknown, names: Set<string>): void {
  if (node == null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectValueSetRefNames(item, names);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  if (obj['type'] === 'ValueSetRef' && typeof obj['name'] === 'string') {
    names.add(obj['name']);
  }
  for (const value of Object.values(obj)) {
    collectValueSetRefNames(value, names);
  }
}

/**
 * Returns only value set references used via `ValueSetRef` in statements.
 */
export function extractUsedElmValueSets(
  input: ElmLibraryWrapperForValueSets | ElmLibraryForValueSets
): ElmValueSetReference[] {
  const all = extractElmValueSets(input);
  if (all.length === 0) {
    return [];
  }

  const lib = resolveLibrary(input);
  const usedNames = new Set<string>();
  collectValueSetRefNames(lib.statements ?? {}, usedNames);

  return all.filter((ref) => usedNames.has(ref.name));
}

export function parseElmJsonForValueSets(elmJson: string): ElmLibraryWrapperForValueSets | null {
  try {
    const parsed = JSON.parse(elmJson) as ElmLibraryWrapperForValueSets | ElmLibraryForValueSets;
    if (parsed && typeof parsed === 'object') {
      if ('library' in parsed) {
        return parsed;
      }
      return { library: parsed };
    }
  } catch {
    return null;
  }
  return null;
}
