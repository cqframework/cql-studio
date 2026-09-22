// Author: Preston Lee

import { normalizeBase, splitCanonical, type FhirBundle, type FhirResource } from './fhir.js';

export interface FhirRepository {
  read(type: string, id: string): Promise<FhirResource | null>;
  searchCanonical(type: string | undefined, url: string, version?: string): Promise<FhirResource | null>;
  searchLibraryName(name: string, version?: string): Promise<FhirResource | null>;
  write(resource: FhirResource, method: 'POST' | 'PUT'): Promise<FhirResource>;
  transact(bundle: FhirBundle): Promise<FhirResource>;
}

export class MemoryRepository implements FhirRepository {
  constructor(private readonly resources: FhirResource[]) {}

  async read(type: string, id: string): Promise<FhirResource | null> {
    return this.resources.find((r) => r.resourceType === type && r.id === id) ?? null;
  }

  async searchCanonical(type: string | undefined, url: string, version?: string): Promise<FhirResource | null> {
    const parsed = splitCanonical(url);
    const targetUrl = parsed.url;
    const targetVersion = version ?? parsed.version;
    const candidates = this.resources.filter((r) => {
      if (type && r.resourceType !== type && !isLibraryName(r, targetUrl)) {
        return false;
      }
      if (r.url === targetUrl) {
        return true;
      }
      if (r.resourceType === 'Library' && (r.name === targetUrl || r.id === targetUrl)) {
        return true;
      }
      return false;
    });
    if (targetVersion) {
      const versionMatch = candidates.find((r) => r.version === targetVersion);
      if (versionMatch) {
        return versionMatch;
      }
    }
    return candidates[0] ?? null;
  }

  async searchLibraryName(name: string, version?: string): Promise<FhirResource | null> {
    return (
      this.resources.find(
        (r) => r.resourceType === 'Library' && r.name === name && (!version || r.version === version)
      ) ?? null
    );
  }

  async write(resource: FhirResource, method: 'POST' | 'PUT'): Promise<FhirResource> {
    const copy = structuredClone(resource);
    if (method === 'POST' || !copy.id) {
      copy.id = copy.id || `gen-${this.resources.length + 1}`;
    }
    const index = this.resources.findIndex((r) => r.resourceType === copy.resourceType && r.id === copy.id);
    if (index >= 0 && method === 'PUT') {
      this.resources[index] = copy;
    } else {
      this.resources.push(copy);
    }
    return copy;
  }

  async transact(bundle: FhirBundle): Promise<FhirResource> {
    const responseEntries = [];
    for (const entry of bundle.entry ?? []) {
      if (!entry.resource) {
        continue;
      }
      const method = entry.request?.method === 'PUT' ? 'PUT' : 'POST';
      const saved = await this.write(entry.resource, method);
      responseEntries.push({ resource: saved, response: { status: method === 'PUT' ? '200' : '201' } });
    }
    return { resourceType: 'Bundle', type: 'transaction-response', entry: responseEntries };
  }
}

function isLibraryName(resource: FhirResource, url: string): boolean {
  return resource.resourceType === 'Library' && (resource.name === url || resource.id === url);
}

export interface HttpEndpoint {
  base: string;
  headers: Record<string, string>;
}

export class HttpRepository implements FhirRepository {
  constructor(private readonly endpoint: HttpEndpoint) {}

  async read(type: string, id: string): Promise<FhirResource | null> {
    const response = await this.fetch(`/${type}/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`FHIR read failed (${response.status})`);
    }
    return (await response.json()) as FhirResource;
  }

  async searchCanonical(type: string | undefined, url: string, version?: string): Promise<FhirResource | null> {
    const parsed = splitCanonical(url);
    if (!parsed.url.startsWith('http://') && !parsed.url.startsWith('https://')) {
      if (!type || type === 'Library') {
        return this.searchLibraryName(parsed.url, version ?? parsed.version);
      }
      return null;
    }
    const resourceType = type ?? 'Library';
    const targetVersion = version ?? parsed.version;
    // Search by url only (same as the UI export graph). Including version in the query
    // often returns empty on HAPI/VSAC even when the ValueSet exists without that version tag.
    const params = new URLSearchParams({ url: parsed.url, _count: '20' });
    try {
      const bundle = await this.search(resourceType, params);
      return firstMatch(bundle, parsed.url, targetVersion);
    } catch {
      return null;
    }
  }

  async searchLibraryName(name: string, version?: string): Promise<FhirResource | null> {
    const params = new URLSearchParams({ name });
    if (version) {
      params.set('version', version);
    }
    const bundle = await this.search('Library', params);
    const match = firstMatch(bundle, undefined, version);
    if (match) {
      return match;
    }
    return (bundle.entry ?? [])
      .map((e) => e.resource)
      .find((r) => r?.resourceType === 'Library' && (r.name === name || r.id === name) && (!version || r.version === version)) ?? null;
  }

  async write(resource: FhirResource, method: 'POST' | 'PUT'): Promise<FhirResource> {
    const type = resource.resourceType;
    const path = method === 'PUT' && resource.id ? `/${type}/${encodeURIComponent(resource.id)}` : `/${type}`;
    const response = await this.fetch(path, {
      method,
      body: JSON.stringify(resource),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`FHIR ${method} ${type} failed (${response.status}): ${text.slice(0, 400)}`);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as FhirResource) : resource;
  }

  async transact(bundle: FhirBundle): Promise<FhirResource> {
    const response = await this.fetch('', { method: 'POST', body: JSON.stringify(bundle) });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`FHIR transaction failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return (await response.json()) as FhirResource;
  }

  private async search(type: string, params: URLSearchParams): Promise<FhirBundle> {
    const response = await this.fetch(`/${type}?${params.toString()}`);
    if (response.status === 404) {
      return { resourceType: 'Bundle', type: 'searchset', entry: [] };
    }
    if (!response.ok) {
      throw new Error(`FHIR search ${type} failed (${response.status})`);
    }
    return (await response.json()) as FhirBundle;
  }

  private fetch(path: string, init?: { method?: string; body?: string }): Promise<Response> {
    const base = normalizeBase(this.endpoint.base);
    return fetch(`${base}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/fhir+json',
        ...(init?.body ? { 'Content-Type': 'application/fhir+json' } : {}),
        ...this.endpoint.headers,
      },
      body: init?.body,
    });
  }
}

function firstMatch(bundle: FhirBundle, url?: string, version?: string): FhirResource | null {
  const candidates = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is FhirResource => !!resource)
    .filter((resource) => !url || !resource.url || resource.url === url);
  if (version) {
    const versionMatch = candidates.find((resource) => resource.version === version);
    if (versionMatch) {
      return versionMatch;
    }
  }
  return candidates[0] ?? null;
}
