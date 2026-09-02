// Author: Preston Lee

import { HttpHeaders } from '@angular/common/http';
import { Endpoint } from 'fhir/r4';
import { EndpointConfiguration } from '../models/environment.model';

const FHIR_REST_CONNECTION_TYPE = {
  system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
  code: 'hl7-fhir-rest'
} as const;

export function normalizeEndpointAddress(url: string | undefined | null): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

export function getEffectiveAddress(
  config: EndpointConfiguration | undefined,
  fallback?: string
): string {
  const address = normalizeEndpointAddress(config?.address);
  if (address) {
    return address;
  }
  return normalizeEndpointAddress(fallback);
}

export function compileEndpointHeaders(config: EndpointConfiguration | undefined): string[] {
  const headers: string[] = [];
  const username = config?.basicAuthUsername?.trim() ?? '';
  const password = config?.basicAuthPassword ?? '';
  if (username && password) {
    headers.push(`Authorization: Basic ${btoa(`${username}:${password}`)}`);
  }
  for (const header of config?.headers ?? []) {
    const trimmed = header?.trim();
    if (trimmed) {
      headers.push(trimmed);
    }
  }
  return headers;
}

export function parseEndpointHeader(header: string): { name: string; value: string } | null {
  const idx = header.indexOf(':');
  if (idx <= 0) {
    return null;
  }
  const name = header.slice(0, idx).trim();
  const value = header.slice(idx + 1).trim();
  if (!name) {
    return null;
  }
  return { name, value };
}

export function buildHttpHeaders(
  config: EndpointConfiguration | undefined,
  baseHeaders?: Record<string, string>
): HttpHeaders {
  let headers = new HttpHeaders(baseHeaders ?? {});
  for (const header of compileEndpointHeaders(config)) {
    const parsed = parseEndpointHeader(header);
    if (parsed) {
      headers = headers.set(parsed.name, parsed.value);
    }
  }
  return headers;
}

export function buildFhirEndpoint(
  config: EndpointConfiguration,
  options?: { name?: string }
): Endpoint | null {
  const address = normalizeEndpointAddress(config.address);
  if (!address) {
    return null;
  }
  const endpoint: Endpoint = {
    resourceType: 'Endpoint',
    status: 'active',
    connectionType: { ...FHIR_REST_CONNECTION_TYPE },
    payloadType: [{ text: 'FHIR resource' }],
    address,
    header: compileEndpointHeaders(config)
  };
  if (options?.name?.trim()) {
    endpoint.name = options.name.trim();
  }
  if (!endpoint.header?.length) {
    delete endpoint.header;
  }
  return endpoint;
}

export function cloneEndpointConfiguration(config: EndpointConfiguration): EndpointConfiguration {
  return {
    address: config.address ?? '',
    basicAuthUsername: config.basicAuthUsername ?? '',
    basicAuthPassword: config.basicAuthPassword ?? '',
    headers: [...(config.headers ?? [])]
  };
}

function hasAuthorizationHeader(headers: string[]): boolean {
  return headers.some(header => {
    const parsed = parseEndpointHeader(header);
    return parsed?.name.toLowerCase() === 'authorization';
  });
}

/** Move basicAuth credentials into Authorization custom header; clear basicAuth fields. */
export function normalizeEndpointConfiguration(config: EndpointConfiguration): EndpointConfiguration {
  const cloned = cloneEndpointConfiguration(config);
  const username = cloned.basicAuthUsername?.trim() ?? '';
  const password = cloned.basicAuthPassword ?? '';
  const headers = [...(cloned.headers ?? [])];
  if (username && password && !hasAuthorizationHeader(headers)) {
    headers.push(`Authorization: Basic ${btoa(`${username}:${password}`)}`);
  }
  return {
    address: cloned.address ?? '',
    basicAuthUsername: '',
    basicAuthPassword: '',
    headers
  };
}

export function emptyEndpointConfiguration(): EndpointConfiguration {
  return { address: '', basicAuthUsername: '', basicAuthPassword: '', headers: [] };
}
