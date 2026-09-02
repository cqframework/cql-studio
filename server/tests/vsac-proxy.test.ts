/**
 * VSAC proxy: validates URL building and host allowlist (fetch mocked).
 */

import { test, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { vsacFhirProxyRouter, vsacSiteProxyRouter } from '../src/vsac/proxy.js';
import { ToolExecutor } from '../src/mcp/tools.js';

const FHIR_BASE_HEADER = 'x-vsac-fhir-base-url';

const realFetch = globalThis.fetch;

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/vsac/fhir', vsacFhirProxyRouter);
  app.use('/api/vsac/site', vsacSiteProxyRouter);
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

test('FHIR proxy rejects disallowed X-VSAC-FHIR-Base-URL host', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/vsac/fhir/metadata`, {
      headers: { [FHIR_BASE_HEADER]: 'https://evil.example/fhir' }
    });
    assert.strictEqual(res.status, 400);
  });
});

test('FHIR proxy forwards to CTS metadata URL', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return realFetch(input, init);
    }
    assert.strictEqual(url, 'https://cts.nlm.nih.gov/fhir/metadata');
    return new Response('{"resourceType":"CapabilityStatement"}', {
      status: 200,
      headers: { 'Content-Type': 'application/fhir+json' }
    });
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/vsac/fhir/metadata`, {
      headers: { [FHIR_BASE_HEADER]: 'https://cts.nlm.nih.gov/fhir' }
    });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('CapabilityStatement'));
  });

  mockFetch.mock.restore();
});

test('Site proxy rejects path not under /vsac/', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/vsac/site/evil`);
    assert.strictEqual(res.status, 400);
  });
});

test('Site proxy forwards vsac programs path', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return realFetch(input, init);
    }
    assert.strictEqual(url, 'https://vsac.nlm.nih.gov/vsac/programs');
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/vsac/site/vsac/programs`);
    assert.strictEqual(res.status, 200);
  });

  mockFetch.mock.restore();
});

test('vsac_search MCP tool searches CTS ValueSet endpoint', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    const parsed = new URL(url);
    assert.strictEqual(`${parsed.origin}${parsed.pathname}`, 'https://cts.nlm.nih.gov/fhir/ValueSet');
    assert.strictEqual(parsed.searchParams.get('title:contains'), 'Diabetes');
    assert.strictEqual(parsed.searchParams.get('status'), 'active');
    assert.strictEqual(parsed.searchParams.get('_count'), '10');
    assert.strictEqual((init?.headers as Record<string, string>)?.Authorization, 'Basic YXBpa2V5OnNlY3JldA==');
    return new Response(
      JSON.stringify({
        resourceType: 'Bundle',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'ValueSet',
              id: '1.2.3',
              url: 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3',
              title: 'Diabetes',
              status: 'active'
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const result = await new ToolExecutor().executeTool('vsac_search', {
    query: 'Diabetes',
    vsac_api_password: 'secret'
  });

  assert.strictEqual(result.resultsCount, 1);
  assert.strictEqual(result.results[0].canonicalUrl, 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3');
  assert.match(result.results[0].cqlDeclaration, /valueset "Diabetes"/);
  assert.match(result.codeGenerationInstruction, /do not call validate_vsac/i);
  mockFetch.mock.restore();
});

test('validate_vsac MCP tool resolves canonical URL', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('url'), 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3');
    return new Response(
      JSON.stringify({
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'ValueSet',
              id: '1.2.3',
              url: 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3',
              title: 'Diabetes'
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/fhir+json' } }
    );
  });
  globalThis.fetch = mockFetch as typeof fetch;

  const result = await new ToolExecutor().executeTool('validate_vsac', {
    url: 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3',
    vsac_api_password: 'secret'
  });

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.valueSet.id, '1.2.3');
  assert.strictEqual(result.canonicalUrl, 'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3');
  assert.strictEqual(result.cqlDeclaration, 'valueset "Diabetes": \'http://cts.nlm.nih.gov/fhir/ValueSet/1.2.3\'');
  mockFetch.mock.restore();
});

test('validate_vsac MCP tool returns invalid when an id is not found', async () => {
  const mockFetch = mock.fn(async () =>
    new Response(JSON.stringify({ resourceType: 'OperationOutcome' }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/fhir+json' }
    })
  );
  globalThis.fetch = mockFetch as typeof fetch;

  const result = await new ToolExecutor().executeTool('validate_vsac', {
    id: '9.9.9',
    vsac_api_password: 'secret'
  });

  assert.strictEqual(result.valid, false);
  mockFetch.mock.restore();
});

test('vsac_search MCP tool requires a search criterion', async () => {
  await assert.rejects(
    () => new ToolExecutor().executeTool('vsac_search', { vsac_api_password: 'secret' }),
    /requires query, title, name, url, or identifier/
  );
});

test('MCP metadata directs VSAC work away from general web search', async () => {
  const tools = await new ToolExecutor().getAvailableTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.match(byName.get('vsac_search')?.description ?? '', /MANDATORY for VSAC ValueSet discovery/);
  assert.match(byName.get('validate_vsac')?.description ?? '', /Use only for checking an exact VSAC canonical URL/);
  for (const name of [
    'searxng_search',
    'searxng_search_formatted',
    'searxng_search_then_fetch',
    'searxng_search_then_fetch_formatted'
  ]) {
    assert.match(byName.get(name)?.description ?? '', /Do NOT use this tool .*VSAC/i);
  }
});
