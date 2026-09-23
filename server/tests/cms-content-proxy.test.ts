/**
 * CMS content proxy: host, repo, and path allowlist (fetch mocked).
 */

import { test, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createCmsContentProxyRouter } from '../src/cms-content/proxy.js';
import {
  CMS_USQUALITYCORE_MODELINFO_URL,
  CmsContentUrlError,
  resolveCmsContentTarget,
} from '../src/cms-content/allowlist.js';

const realFetch = globalThis.fetch;

const CONTENTS =
  'https://api.github.com/repos/cqframework/dqm-content-cms-2025/contents/input/resources/measure?ref=main';
const RAW =
  'https://raw.githubusercontent.com/cqframework/dqm-content-cms-2026/main/input/resources/measure/Measure-BreastCancerScreeningDQMDraft.json';

function createApp(token?: string): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/cms-content', createCmsContentProxyRouter(token));
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
      fn(`http://127.0.0.1:${port}`)
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

test('resolveCmsContentTarget accepts contents and raw URLs for allowlisted repos', () => {
  const contents = resolveCmsContentTarget(CONTENTS);
  assert.strictEqual(contents.hostname, 'api.github.com');
  const raw = resolveCmsContentTarget(RAW);
  assert.strictEqual(raw.hostname, 'raw.githubusercontent.com');
});

test('resolveCmsContentTarget rejects other hosts, repos, methods surfaces, and traversal', () => {
  assert.throws(
    () => resolveCmsContentTarget('https://evil.example/repos/cqframework/dqm-content-cms-2025'),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://api.github.com/repos/cqframework/clinical_quality_language/contents/README.md'
      ),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://api.github.com/repos/cqframework/dqm-content-cms-2025/contents/input/../secrets'
      ),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://api.github.com/repos/cqframework/dqm-content-cms-2025/contents/input/%2e%2e/secrets'
      ),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://raw.githubusercontent.com/cqframework/dqm-content-cms-2025/main/input/../../etc/passwd'
      ),
    CmsContentUrlError
  );
  assert.throws(
    () => resolveCmsContentTarget('http://api.github.com/repos/cqframework/dqm-content-cms-2025/contents/'),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://api.github.com/repos/cqframework/dqm-content-cms-2025/zipball/main'
      ),
    CmsContentUrlError
  );
});

test('resolveCmsContentTarget allows pinned CMS dependency URLs and rejects other hosts', () => {
  const modelInfo = resolveCmsContentTarget(CMS_USQUALITYCORE_MODELINFO_URL);
  assert.strictEqual(modelInfo.hostname, 'raw.githubusercontent.com');
  const usCore = resolveCmsContentTarget('https://hl7.org/fhir/us/cql/Library-USCore-ModelInfo.json');
  assert.strictEqual(usCore.pathname, '/fhir/us/cql/Library-USCore-ModelInfo.json');
  const helpers = resolveCmsContentTarget('https://hl7.org/fhir/uv/cql/Library-FHIRHelpers.json');
  assert.strictEqual(helpers.pathname, '/fhir/uv/cql/Library-FHIRHelpers.json');
  assert.throws(
    () => resolveCmsContentTarget('https://hl7.org/fhir/us/cql/qa.html'),
    CmsContentUrlError
  );
  assert.throws(
    () =>
      resolveCmsContentTarget(
        'https://build.fhir.org/ig/FHIR/us-quality-core/Library-USQualityCore-ModelInfo.json'
      ),
    CmsContentUrlError
  );
  assert.throws(
    () => resolveCmsContentTarget(`${CMS_USQUALITYCORE_MODELINFO_URL}?raw=1`),
    CmsContentUrlError
  );
  assert.throws(
    () => resolveCmsContentTarget('https://evil.example/fhir/us/cql/Library-USCore-ModelInfo.json'),
    CmsContentUrlError
  );
});

test('proxy rejects a disallowed upstream URL', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/cms-content?url=${encodeURIComponent('https://evil.example/file.json')}`
    );
    assert.strictEqual(res.status, 400);
  });
});

test('proxy rejects POST', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cms-content?url=${encodeURIComponent(CONTENTS)}`, {
      method: 'POST',
    });
    assert.strictEqual(res.status, 405);
  });
});

test('proxy does not forward a browser token and attaches the server token', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return realFetch(input, init);
    }
    const headers = new Headers(init?.headers);
    assert.strictEqual(headers.get('authorization'), 'Bearer server-token');
    assert.strictEqual(headers.get('user-agent'), 'CQL-Studio-Server');
    assert.strictEqual(init?.method, 'GET');
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    await withServer(createApp('server-token'), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/cms-content?url=${encodeURIComponent(CONTENTS)}`, {
        headers: { Authorization: 'Bearer browser-token', Accept: 'application/json' },
      });
      assert.strictEqual(res.status, 200);
    });
  } finally {
    mockFetch.mock.restore();
    globalThis.fetch = realFetch;
  }
});
