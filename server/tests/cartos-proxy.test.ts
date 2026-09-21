/**
 * Cartos FHIR proxy: host allowlist and forward (fetch mocked).
 */

import { test, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { cartosFhirProxyRouter, DEFAULT_CARTOS_FHIR_BASE } from '../src/cartos/proxy.js';

const FHIR_BASE_HEADER = 'x-cartos-fhir-base-url';
const realFetch = globalThis.fetch;

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/cartos/fhir', cartosFhirProxyRouter);
  return app;
}

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;
      fn(baseUrl)
        .then(() => {
          server.close();
          resolve();
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
    server.on('error', reject);
  });
}

test('Cartos FHIR proxy rejects disallowed X-Cartos-FHIR-Base-URL host', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cartos/fhir/metadata`, {
      headers: { [FHIR_BASE_HEADER]: 'https://evil.example/fhir' }
    });
    assert.strictEqual(res.status, 400);
  });
});

test('Cartos FHIR proxy forwards to Cartos metadata URL', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return realFetch(input, init);
    }
    assert.strictEqual(url, `${DEFAULT_CARTOS_FHIR_BASE}/metadata`);
    assert.equal((init?.headers as Record<string, string>)?.Authorization, undefined);
    return new Response('{"resourceType":"CapabilityStatement"}', {
      status: 200,
      headers: { 'Content-Type': 'application/fhir+json' }
    });
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cartos/fhir/metadata`, {
      headers: { [FHIR_BASE_HEADER]: DEFAULT_CARTOS_FHIR_BASE }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('CapabilityStatement'));
  });

  mockFetch.mock.restore();
});

test('cartos_search MCP tool searches Cartos ValueSet endpoint', async () => {
  const { ToolExecutor } = await import('../src/mcp/tools.js');
  const mockFetch = mock.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return realFetch(input);
    }
    const parsed = new URL(url);
    assert.strictEqual(`${parsed.origin}${parsed.pathname}`, `${DEFAULT_CARTOS_FHIR_BASE}/ValueSet`);
    assert.strictEqual(parsed.searchParams.get('title:contains'), 'smoking');
    return new Response(
      JSON.stringify({
        resourceType: 'Bundle',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'ValueSet',
              id: 'abc',
              url: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.11.20.9.38',
              title: 'SmokingStatus',
              status: 'active'
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const result = await new ToolExecutor().executeTool('cartos_search', {
    query: 'smoking'
  });

  assert.strictEqual(result.resultsCount, 1);
  assert.strictEqual(result.results[0].canonicalUrl, 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.11.20.9.38');
  assert.match(result.codeGenerationInstruction, /do not call validate_cartos/i);
  mockFetch.mock.restore();
});
