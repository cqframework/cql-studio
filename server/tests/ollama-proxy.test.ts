/**
 * Regression tests for the Ollama proxy (allowlisted GET/POST endpoints).
 * Mocks upstream fetch so no real Ollama instance is required.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { ollamaProxyRouter } from '../src/ollama/proxy.js';

const OLLAMA_BASE = 'http://localhost:11434';
const BASE_HEADER = 'x-ollama-base-url';

/** Real fetch; mocks delegate to this when URL is not the Ollama upstream. */
const realFetch = globalThis.fetch;

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/ollama', ollamaProxyRouter);
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

test('GET /api/ollama/tags returns 400 without base URL', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ollama/tags`);
    assert.strictEqual(res.status, 400);
    const data = (await res.json()) as { error?: string };
    assert.match(data.error ?? '', /Missing or invalid/i);
  });
});

test('GET /api/ollama/tags returns 400 for invalid URL', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ollama/tags`, {
      headers: { [BASE_HEADER]: 'not-a-url' }
    });
    assert.strictEqual(res.status, 400);
  });
});

function restoreFetch(): void {
  const f = globalThis.fetch as unknown as { mock?: { restore: () => void } };
  if (f?.mock?.restore) f.mock.restore();
}

test('GET /api/ollama/tags proxies to upstream and returns JSON', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/tags`) {
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/tags`, {
        headers: { [BASE_HEADER]: OLLAMA_BASE }
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { models?: { name: string }[] };
      assert.ok(Array.isArray(data.models));
      assert.strictEqual(data.models![0].name, 'llama3.2');
      const ollamaCalls = mockFetch.mock.calls.filter((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/tags`;
      });
      assert.strictEqual(ollamaCalls.length, 1);
    });
  } finally {
    restoreFetch();
  }
});

test('Ollama API key is forwarded as a bearer credential when supplied', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : input.href;
    if (url === `${OLLAMA_BASE}/api/version`) {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ollama-secret');
      return new Response(JSON.stringify({ version: '0.17.7' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/version`, {
        headers: { [BASE_HEADER]: OLLAMA_BASE, 'x-ollama-api-key': 'ollama-secret' }
      });
      assert.equal(res.status, 200);
    });
  } finally {
    restoreFetch();
  }
});

test('GET /api/ollama/version proxies to upstream', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/version`) {
      return new Response(JSON.stringify({ version: '0.17.7' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/version`, {
        headers: { [BASE_HEADER]: OLLAMA_BASE }
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { version?: string };
      assert.strictEqual(data.version, '0.17.7');
      const ollamaCalls = mockFetch.mock.calls.filter((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/version`;
      });
      assert.strictEqual(ollamaCalls.length, 1);
    });
  } finally {
    restoreFetch();
  }
});

test('GET /api/ollama/version accepts base URL via query ollamaBaseUrl', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/version`) {
      return new Response(JSON.stringify({ version: '0.17.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/version?ollamaBaseUrl=${encodeURIComponent(OLLAMA_BASE)}`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { version?: string };
      assert.strictEqual(data.version, '0.17.0');
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/show proxies body and returns JSON', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/show`) {
      const body = init?.body as string;
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.model === 'llama3.2') {
        return new Response(
          JSON.stringify({
            model_info: {},
            parameters: 'num_ctx 4096',
            capabilities: ['completion']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Bad Request', { status: 400 });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/show`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'llama3.2' })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { capabilities?: string[] };
      assert.ok(Array.isArray(data.capabilities));
      const showCall = mockFetch.mock.calls.find((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/show`;
      });
      assert.ok(showCall);
      assert.strictEqual(JSON.parse((showCall as { arguments: unknown[] }).arguments[1]?.body as string).model, 'llama3.2');
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/chat non-streaming returns JSON', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/chat`) {
      return new Response(
        JSON.stringify({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'Hello' },
          done: true
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/chat`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: false
        })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { message?: { content?: string }; done?: boolean };
      assert.strictEqual(data.message?.content, 'Hello');
      assert.strictEqual(data.done, true);
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/chat streaming pipes response body', async () => {
  const chunks = ['{"message":{"content":"A"}}\n', '{"message":{"content":"B"},"done":true}\n'];
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/chat`) {
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(new TextEncoder().encode(c)));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/chat`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true
        })
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/x-ndjson');
      const text = await res.text();
      assert.ok(text.includes('"content":"A"'));
      assert.ok(text.includes('"content":"B"'));
      assert.ok(text.includes('"done":true'));
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/generate proxies and returns JSON when stream is false', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/generate`) {
      return new Response(
        JSON.stringify({ response: 'Generated text', done: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/generate`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'llama3.2', prompt: 'Say hi', stream: false })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { response?: string; done?: boolean };
      assert.strictEqual(data.response, 'Generated text');
      const genCall = mockFetch.mock.calls.find((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/generate`;
      });
      assert.strictEqual(genCall != null, true);
    });
  } finally {
    restoreFetch();
  }
});

test('GET /api/ollama/ps proxies to upstream', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/ps`) {
      return new Response(
        JSON.stringify({
          models: [
            {
              name: 'llama3.2',
              model: 'llama3.2',
              size: 1000,
              digest: 'abc',
              expires_at: '2026-06-10T12:00:00Z',
              size_vram: 500,
              context_length: 4096
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/ps`, {
        headers: { [BASE_HEADER]: OLLAMA_BASE }
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { models?: { name: string; context_length?: number }[] };
      assert.strictEqual(data.models?.[0]?.name, 'llama3.2');
      assert.strictEqual(data.models?.[0]?.context_length, 4096);
      const psCall = mockFetch.mock.calls.find((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/ps`;
      });
      assert.ok(psCall);
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/embed proxies body with input and returns JSON', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/embed`) {
      const body = init?.body as string;
      const parsed = body ? JSON.parse(body) : {};
      if (parsed.model === 'nomic-embed-text' && parsed.input === 'hello') {
        return new Response(
          JSON.stringify({
            model: 'nomic-embed-text',
            embeddings: [[0.1, 0.2, 0.3]]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Bad Request', { status: 400 });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/embed`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'nomic-embed-text', input: 'hello' })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { embeddings?: number[][]; model?: string };
      assert.strictEqual(data.model, 'nomic-embed-text');
      assert.deepStrictEqual(data.embeddings, [[0.1, 0.2, 0.3]]);
      const embedCall = mockFetch.mock.calls.find((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/embed`;
      });
      assert.ok(embedCall);
      assert.strictEqual(
        JSON.parse((embedCall as { arguments: unknown[] }).arguments[1]?.body as string).input,
        'hello'
      );
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/embeddings proxies and returns JSON', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/embeddings`) {
      return new Response(
        JSON.stringify({
          embeddings: [[0.1, 0.2]],
          model: 'nomic-embed-text'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/embeddings`, {
        method: 'POST',
        headers: {
          [BASE_HEADER]: OLLAMA_BASE,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'hello' })
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { embeddings?: number[][]; model?: string };
      assert.ok(Array.isArray(data.embeddings));
      assert.strictEqual(data.model, 'nomic-embed-text');
      const embCall = mockFetch.mock.calls.find((c: { arguments: unknown[] }) => {
        const u = c.arguments[0];
        return (typeof u === 'string' ? u : (u as URL)?.href) === `${OLLAMA_BASE}/api/embeddings`;
      });
      assert.strictEqual(embCall != null, true);
    });
  } finally {
    restoreFetch();
  }
});

test('POST /api/ollama/* returns 400 without valid base URL', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const bodies: Record<string, string> = {
      show: '{"model":"x"}',
      chat: '{"model":"x","messages":[]}',
      generate: '{"model":"x","prompt":"x"}',
      embed: '{"model":"x","input":"x"}',
      embeddings: '{"model":"x","prompt":"x"}'
    };
    for (const path of ['show', 'chat', 'generate', 'embed', 'embeddings'] as const) {
      const res = await fetch(`${baseUrl}/api/ollama/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodies[path]
      });
      assert.strictEqual(res.status, 400, `POST /api/ollama/${path} should 400 without base URL`);
    }
  });
});

test('GET /api/ollama/unknown returns 404', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ollama/unknown`, {
      headers: { [BASE_HEADER]: OLLAMA_BASE }
    });
    assert.strictEqual(res.status, 404);
    const data = (await res.json()) as { error?: string };
    assert.strictEqual(data.error, 'Not found');
  });
});

test('POST /api/ollama/unknown returns 404', async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/ollama/unknown`, {
      method: 'POST',
      headers: {
        [BASE_HEADER]: OLLAMA_BASE,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'x' })
    });
    assert.strictEqual(res.status, 404);
    const data = (await res.json()) as { error?: string };
    assert.strictEqual(data.error, 'Not found');
  });
});

test('Upstream error status and body are forwarded', async () => {
  const mockFetch = mock.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input as URL).href;
    if (url === `${OLLAMA_BASE}/api/tags`) {
      return new Response(JSON.stringify({ error: 'model not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(input as RequestInfo | URL, init);
  });
  mock.method(globalThis, 'fetch', mockFetch as typeof fetch);

  try {
    const app = createApp();
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ollama/tags`, {
        headers: { [BASE_HEADER]: OLLAMA_BASE }
      });
      assert.strictEqual(res.status, 404);
      const data = (await res.json()) as { error?: string };
      assert.strictEqual(data.error, 'model not found');
    });
  } finally {
    restoreFetch();
  }
});
