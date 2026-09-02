/**
 * Value Set Loader
 *
 * Fetches pre-expanded (or expandable) ValueSet resources from a FHIR R4
 * server and flattens them into rows that match the `value_set_expansion`
 * view schema used by the elm-to-sql transpiler.
 *
 * Design principles:
 *  - Zero Node.js runtime dependencies — accepts a fetch-compatible function
 *    so the same code works in browsers, Deno, Bun, and Node 18+.
 *  - Non-throwing per value set — individual failures are captured in
 *    `ValueSetLoadResult.error` rather than rejecting the whole batch.
 *  - Tries the FHIR $expand operation first; falls back to reading the stored
 *    resource directly (works when the ValueSet is already pre-expanded).
 */

import type { ValueSetReference } from './value-set-extractor';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single row in the `value_set_expansion` table/view.
 * Schema matches `scripts/hapi-fhir-sql-on-fhir/views/008_value_set_expansion_view.sql`.
 */
export interface ValueSetExpansionRow {
  /** Canonical URL of the ValueSet — matches `value_set_id` in the view. */
  value_set_id: string;
  /** FHIR concept code, e.g. "73761001" */
  code: string;
  /** Code system URI, e.g. "http://snomed.info/sct" */
  system: string;
  /** Human-readable display label (may be undefined for codes without display). */
  display?: string;
  /** Code system version (may be undefined). */
  version?: string;
}

/** Result of loading one value set from the FHIR server. */
export interface ValueSetLoadResult {
  /** CQL local name, e.g. "Office Visit" */
  name: string;
  /** Canonical URL used to fetch the value set. */
  url: string;
  /** Flattened expansion rows — empty if loading failed. */
  rows: ValueSetExpansionRow[];
  /** Set when loading or parsing failed. The result is still returned (not thrown). */
  error?: string;
}

// ─── Minimal FHIR ValueSet shape (expansion only) ────────────────────────────

interface FhirValueSetContains {
  system?: string;
  code?: string;
  display?: string;
  version?: string;
  contains?: FhirValueSetContains[]; // nested hierarchy — flattened recursively
}

interface FhirValueSetExpansion {
  total?: number;
  contains?: FhirValueSetContains[];
}

interface FhirValueSet {
  resourceType: 'ValueSet';
  url?: string;
  expansion?: FhirValueSetExpansion;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Recursively flatten `expansion.contains[]`, including nested hierarchies.
 * Only entries that have both `code` and `system` are included.
 */
function flattenContains(
  items: FhirValueSetContains[],
  valueSetId: string,
): ValueSetExpansionRow[] {
  const rows: ValueSetExpansionRow[] = [];
  for (const item of items) {
    if (item.code && item.system) {
      rows.push({
        value_set_id: valueSetId,
        code: item.code,
        system: item.system,
        ...(item.display ? { display: item.display } : {}),
        ...(item.version ? { version: item.version } : {}),
      });
    }
    if (item.contains?.length) {
      rows.push(...flattenContains(item.contains, valueSetId));
    }
  }
  return rows;
}

async function fetchValueSetByUrl(
  base: string,
  encodedUrl: string,
  fetchFn: typeof fetch,
): Promise<FhirValueSet | null> {
  const searchEndpoint = `${base}/ValueSet?url=${encodedUrl}&_format=json`;
  try {
    const resp = await fetchFn(searchEndpoint, {
      headers: { Accept: 'application/fhir+json, application/json' },
    });
    if (!resp.ok) {
      return null;
    }
    const bundle = (await resp.json()) as {
      resourceType: string;
      entry?: Array<{ resource: FhirValueSet }>;
    };
    if (bundle.resourceType === 'Bundle' && bundle.entry?.[0]?.resource) {
      return bundle.entry[0].resource;
    }
  } catch {
    return null;
  }
  return null;
}

function valueSetHasExpansionRows(body: FhirValueSet | null): body is FhirValueSet & {
  expansion: { contains: FhirValueSetContains[] };
} {
  return (body?.expansion?.contains?.length ?? 0) > 0;
}

/**
 * Attempt to load a single value set from the FHIR server.
 *
 * Strategy:
 *  1. `GET {base}/ValueSet/$expand?url={encodedUrl}` — asks the server to expand
 *  2. If that fails or returns no codes, fall back to
 *     `GET {base}/ValueSet?url={encodedUrl}&_format=json` and read the stored
 *     expansion from the resource body.
 */
async function loadOne(
  fhirBaseUrl: string,
  ref: ValueSetReference,
  fetchFn: typeof fetch,
): Promise<ValueSetLoadResult> {
  const base = fhirBaseUrl.replace(/\/+$/, '');
  const encodedUrl = encodeURIComponent(ref.url);

  let body: FhirValueSet | null = null;

  const expandEndpoint = `${base}/ValueSet/$expand?url=${encodedUrl}&_format=json`;
  try {
    const resp = await fetchFn(expandEndpoint, {
      headers: { Accept: 'application/fhir+json, application/json' },
    });
    if (resp.ok) {
      body = (await resp.json()) as FhirValueSet;
    }
  } catch {
    // network error — fall through to the search fallback
  }

  if (!valueSetHasExpansionRows(body)) {
    const stored = await fetchValueSetByUrl(base, encodedUrl, fetchFn);
    if (valueSetHasExpansionRows(stored)) {
      body = stored;
    } else if (!body && stored) {
      body = stored;
    }
  }

  if (!body) {
    return { name: ref.name, url: ref.url, rows: [], error: 'Not found on FHIR server' };
  }

  if (!valueSetHasExpansionRows(body)) {
    return {
      name: ref.name,
      url: ref.url,
      rows: [],
      error: 'ValueSet found but has no expansion.contains — ensure it is pre-expanded',
    };
  }

  const resolvedId = body.url ?? ref.url;
  const rows = flattenContains(body.expansion.contains, resolvedId);
  return { name: ref.name, url: ref.url, rows };
}

/**
 * Load expansions for all value sets referenced by an ELM library.
 *
 * @param fhirBaseUrl  Base URL of the FHIR server, e.g. "http://localhost:8080/fhir"
 * @param valueSets    References from `extractValueSets()` or `extractUsedValueSets()`
 * @param fetchFn      Fetch implementation (defaults to `globalThis.fetch`).
 *                     Pass a custom implementation for testing or environments
 *                     without a global fetch.
 * @param concurrency  Max parallel requests. Default: 5.
 *
 * @example
 * const refs = extractValueSets(elmJson);
 * const results = await loadValueSetExpansions('http://localhost:8080/fhir', refs);
 * const allRows = results.flatMap(r => r.rows);
 */
export async function loadValueSetExpansions(
  fhirBaseUrl: string,
  valueSets: ValueSetReference[],
  fetchFn: typeof fetch = globalThis.fetch,
  concurrency = 5,
): Promise<ValueSetLoadResult[]> {
  const results: ValueSetLoadResult[] = [];

  // Process in batches to avoid overwhelming the server
  for (let i = 0; i < valueSets.length; i += concurrency) {
    const batch = valueSets.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(ref => loadOne(fhirBaseUrl, ref, fetchFn)),
    );
    results.push(...batchResults);
  }

  return results;
}
