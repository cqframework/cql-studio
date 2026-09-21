// Author: Preston Lee

import { formatValueSetCqlDeclaration } from '@cql-studio/core';

const FHIR_JSON = 'application/fhir+json';

export interface RemoteTerminologyConfig {
  fhirBaseUrl: string;
  allowedHosts: ReadonlySet<string>;
  /** Optional HTTP Authorization header value (e.g. `Basic …`). */
  authorizationHeader?: string;
  /** Label for error messages (e.g. VSAC, Cartos). */
  label: string;
}

export interface ValueSetSummary {
  resourceType: 'ValueSet';
  id?: string;
  url?: string;
  name?: string;
  title?: string;
  version?: string;
  status?: string;
  publisher?: string;
  date?: string;
  description?: string;
  expansionTotal?: number;
}

export function normalizeRemoteFhirBaseUrl(
  raw: string | undefined,
  defaultBaseUrl: string,
  allowedHosts: ReadonlySet<string>,
  label: string
): string {
  const fhirBaseRaw = typeof raw === 'string' && raw.trim() ? raw.trim() : defaultBaseUrl;
  const base = new URL(fhirBaseRaw.replace(/\/+$/, ''));
  if (base.protocol !== 'https:' || !allowedHosts.has(base.hostname)) {
    throw new Error(`Invalid ${label} FHIR base URL. Host must be allowlisted.`);
  }
  return base.toString().replace(/\/+$/, '');
}

export async function fetchRemoteFhirJson<T>(
  config: RemoteTerminologyConfig,
  pathAndQuery: string
): Promise<T> {
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const headers: Record<string, string> = {
    Accept: FHIR_JSON,
    'Content-Type': FHIR_JSON,
  };
  if (config.authorizationHeader) {
    headers.Authorization = config.authorizationHeader;
  }
  const response = await fetch(`${config.fhirBaseUrl}${path}`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.text();
      if (body) detail = body.substring(0, 500);
    } catch {
      // Keep status text.
    }
    throw new Error(`${config.label} request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as T;
}

export async function fetchRemoteFhirJsonOrNull<T>(
  config: RemoteTerminologyConfig,
  pathAndQuery: string
): Promise<T | null> {
  try {
    return await fetchRemoteFhirJson<T>(config, pathAndQuery);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${config.label} request failed (404):`)) {
      return null;
    }
    throw error;
  }
}

export function summarizeValueSet(vs: any): ValueSetSummary {
  return {
    resourceType: 'ValueSet',
    id: typeof vs?.id === 'string' ? vs.id : undefined,
    url: typeof vs?.url === 'string' ? vs.url : undefined,
    name: typeof vs?.name === 'string' ? vs.name : undefined,
    title: typeof vs?.title === 'string' ? vs.title : undefined,
    version: typeof vs?.version === 'string' ? vs.version : undefined,
    status: typeof vs?.status === 'string' ? vs.status : undefined,
    publisher: typeof vs?.publisher === 'string' ? vs.publisher : undefined,
    date: typeof vs?.date === 'string' ? vs.date : undefined,
    description: typeof vs?.description === 'string' ? vs.description : undefined,
    expansionTotal: typeof vs?.expansion?.total === 'number' ? vs.expansion.total : undefined,
  };
}

export async function fetchValueSetByIdOrUrl(
  config: RemoteTerminologyConfig,
  params: { url?: string; id?: string }
): Promise<any | null> {
  const url = typeof params?.url === 'string' ? params.url.trim() : '';
  const idRaw = typeof params?.id === 'string' ? params.id.trim() : '';
  if (url) {
    const q = new URLSearchParams();
    q.set('url', url);
    q.set('_count', '1');
    const bundle = await fetchRemoteFhirJson<any>(config, `/ValueSet?${q.toString()}`);
    const first = bundle?.entry?.[0]?.resource;
    return first?.resourceType === 'ValueSet' ? first : null;
  }
  if (idRaw) {
    const id = idRaw.replace(/^urn:oid:/i, '');
    return await fetchRemoteFhirJsonOrNull<any>(config, `/ValueSet/${encodeURIComponent(id)}`);
  }
  throw new Error('Either url or id is required.');
}

export interface RemoteValueSetSearchParams {
  query?: string;
  title?: string;
  name?: string;
  url?: string;
  identifier?: string;
  status?: string;
  count?: number;
}

export async function searchRemoteValueSets(
  config: RemoteTerminologyConfig,
  params: RemoteValueSetSearchParams,
  options: {
    toolName: string;
    validateToolName: string;
    fallbackLabel: string;
    codeGenerationInstruction: string;
  }
): Promise<any> {
  const q = new URLSearchParams();
  const query = typeof params?.query === 'string' ? params.query.trim() : '';
  const title = typeof params?.title === 'string' ? params.title.trim() : '';
  const name = typeof params?.name === 'string' ? params.name.trim() : '';
  const url = typeof params?.url === 'string' ? params.url.trim() : '';
  const identifier = typeof params?.identifier === 'string' ? params.identifier.trim() : '';
  const status = typeof params?.status === 'string' ? params.status.trim() : 'active';
  const count = Math.min(50, Math.max(1, Number(params?.count) || 10));

  if (!query && !title && !name && !url && !identifier) {
    throw new Error(`${options.toolName} requires query, title, name, url, or identifier.`);
  }

  if (title || query) q.set('title:contains', title || query);
  if (name) q.set('name:contains', name);
  if (url) q.set('url', url);
  if (identifier) q.set('identifier', identifier);
  if (status) q.set('status', status);
  q.set('_count', String(count));

  const bundle = await fetchRemoteFhirJson<any>(config, `/ValueSet?${q.toString()}`);
  const valueSets = Array.isArray(bundle?.entry)
    ? bundle.entry.map((entry: any) => entry?.resource).filter((resource: any) => resource?.resourceType === 'ValueSet')
    : [];
  return {
    query: { query, title, name, url, identifier, status, count },
    total: typeof bundle?.total === 'number' ? bundle.total : undefined,
    resultsCount: valueSets.length,
    results: valueSets.map((vs: any) => {
      const cql = formatValueSetCqlDeclaration(vs, options.fallbackLabel);
      return {
        ...summarizeValueSet(vs),
        canonicalUrl: typeof vs?.url === 'string' ? vs.url : undefined,
        cqlDeclaration: cql,
        cqlSnippet: cql,
      };
    }),
    codeGenerationInstruction: options.codeGenerationInstruction,
  };
}

export async function validateRemoteValueSet(
  config: RemoteTerminologyConfig,
  params: { url?: string; id?: string },
  options: {
    notFoundMessage: string;
    fallbackLabel: string;
    codeGenerationInstruction: string;
  }
): Promise<any> {
  const valueSet = await fetchValueSetByIdOrUrl(config, params);
  if (!valueSet) {
    return {
      valid: false,
      message: options.notFoundMessage,
    };
  }
  const cql = formatValueSetCqlDeclaration(valueSet, options.fallbackLabel);
  return {
    valid: true,
    valueSet: summarizeValueSet(valueSet),
    canonicalUrl: valueSet.url,
    cqlDeclaration: cql,
    cqlSnippet: cql,
    codeGenerationInstruction: options.codeGenerationInstruction,
  };
}
