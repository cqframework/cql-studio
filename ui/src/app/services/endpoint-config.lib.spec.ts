// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  buildFhirEndpoint,
  buildHttpHeaders,
  compileEndpointHeaders,
  getEffectiveAddress,
  normalizeEndpointAddress,
  normalizeEndpointConfiguration
} from './endpoint-config.lib';

describe('endpoint-config.lib', () => {
  it('normalizes endpoint addresses', () => {
    expect(normalizeEndpointAddress('http://localhost:8080/fhir/')).toBe('http://localhost:8080/fhir');
    expect(normalizeEndpointAddress('  ')).toBe('');
  });

  it('resolves effective address with fallback', () => {
    expect(getEffectiveAddress({ address: '' }, 'http://fallback/fhir')).toBe('http://fallback/fhir');
    expect(getEffectiveAddress({ address: 'http://primary/fhir' }, 'http://fallback/fhir')).toBe(
      'http://primary/fhir'
    );
  });

  it('normalizes basic auth into Authorization header', () => {
    const normalized = normalizeEndpointConfiguration({
      address: 'http://localhost:8080/fhir',
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass'
    });
    expect(normalized.basicAuthUsername).toBe('');
    expect(normalized.basicAuthPassword).toBe('');
    expect(normalized.headers).toContain(`Authorization: Basic ${btoa('user:pass')}`);
  });

  it('compiles basic auth into Authorization header', () => {
    const headers = compileEndpointHeaders({
      address: 'http://localhost:8080/fhir',
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass'
    });
    expect(headers).toHaveLength(1);
    expect(headers[0]).toBe(`Authorization: Basic ${btoa('user:pass')}`);
  });

  it('builds FHIR Endpoint with required fields', () => {
    const endpoint = buildFhirEndpoint(
      { address: 'http://localhost:8080/fhir', basicAuthUsername: 'u', basicAuthPassword: 'p' },
      { name: 'Test' }
    );
    expect(endpoint?.resourceType).toBe('Endpoint');
    expect(endpoint?.status).toBe('active');
    expect(endpoint?.connectionType?.code).toBe('hl7-fhir-rest');
    expect(endpoint?.payloadType?.length).toBeGreaterThan(0);
    expect(endpoint?.address).toBe('http://localhost:8080/fhir');
    expect(endpoint?.name).toBe('Test');
    expect(endpoint?.header?.[0]).toContain('Authorization: Basic');
  });

  it('builds HttpHeaders from endpoint config', () => {
    const headers = buildHttpHeaders(
      { address: 'http://x', basicAuthUsername: 'u', basicAuthPassword: 'p' },
      { Accept: 'application/fhir+json' }
    );
    expect(headers.get('Accept')).toBe('application/fhir+json');
    expect(headers.get('Authorization')).toBe(`Basic ${btoa('u:p')}`);
  });
});
