// Author: Preston Lee

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { OpenCodeToolExecutor } from '../src/opencode/tools.js';

test('OpenCode exposes the complete tool catalog including draft creation without model-controlled SearXNG origins', async () => {
  const tools = new OpenCodeToolExecutor();
  const definitions = await tools.definitions();
  assert.equal(definitions.length, 23);
  assert.equal(new Set(definitions.map(tool => tool.name)).size, 23);
  for (const expected of ['fetch_content', 'searxng_search_then_fetch', 'vsac_search', 'fhir_read', 'cql_validate', 'cql_library_search', 'cql_library_read', 'cql_library_create_draft']) {
    assert.ok(definitions.some(tool => tool.name === expected), `missing ${expected}`);
  }
  const createDraft = definitions.find(tool => tool.name === 'cql_library_create_draft');
  assert.equal(createDraft?.allowedInPlanMode, false);
  const searxng = definitions.find(tool => tool.name === 'searxng_search');
  assert.ok(searxng);
  assert.equal('searxng_base_url' in searxng.parameters.properties, false);
  assert.equal(searxng.parameters.required?.includes('searxng_base_url'), false);
});

test('OpenCode CQL validation uses FHIR R4 assets and returns located diagnostics', async () => {
  const tools = new OpenCodeToolExecutor({
    cqlAssetsDirectory: new URL('../../ui/public/cql', import.meta.url).pathname,
  });
  const result = await tools.execute('cql_validate', {
    __workspace: {
      activeFile: 'libraries/Broken.cql',
      files: [{
        path: 'libraries/Broken.cql',
        writable: true,
        content: "library Broken version '1.0.0'\nusing FHIR version '4.0.1'\ncontext Patient\ndefine Broken: ???\n",
      }],
    },
  }, {}) as { valid: boolean; diagnostics: Array<{ severity: string; line?: number }> };
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(item => item.severity === 'error'));
  assert.ok(result.diagnostics.some(item => item.line != null));
});

test('OpenCode FHIR tools use session-only endpoint auth and bound search results', async t => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/fhir+json');
    res.end(JSON.stringify({
      resourceType: 'Bundle',
      type: 'searchset',
      entry: Array.from({ length: 30 }, (_, index) => ({ resource: { resourceType: 'Patient', id: String(index) } })),
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const tools = new OpenCodeToolExecutor();
  const environment = {
    id: 'test',
    name: 'Private test environment',
    dataEndpoint: {
      address: `http://127.0.0.1:${address.port}/fhir`,
      basicAuthUsername: 'alice',
      basicAuthPassword: 'secret',
      headers: ['X-Tenant: cql-studio'],
    },
  };
  const result = await tools.execute('fhir_search', {
    resourceType: 'Patient',
    query: { family: 'Smith' },
    count: 3,
  }, { environment }) as { entry: unknown[] };

  assert.equal(result.entry.length, 3);
  assert.equal(requests[0].url, '/fhir/Patient?family=Smith&_count=3');
  assert.equal(requests[0].authorization, `Basic ${Buffer.from('alice:secret').toString('base64')}`);

  const summary = await tools.execute('cql_studio_context', {}, { environment }) as Record<string, any>;
  assert.equal(summary.endpoints.data, `http://127.0.0.1:${address.port}/fhir`);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
});

test('OpenCode FHIR tools reject path injection', async () => {
  const tools = new OpenCodeToolExecutor();
  await assert.rejects(
    tools.execute('fhir_read', { resourceType: 'Patient', id: '../metadata' }, {
      environment: { contentEndpoint: { address: 'http://localhost:8080/fhir' } },
    }),
    /valid FHIR logical id/
  );
});
