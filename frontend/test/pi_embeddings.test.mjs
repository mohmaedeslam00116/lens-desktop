import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Tracer P3 — embeddings on Pi truth. The embedding transport stays
 * LENS-implemented (Pi catalogs no embedding models), but credentials resolve
 * exclusively from Pi (`auth.json` / Pi ambient env): request envelopes,
 * query strings, and localStorage carry no embedding keys, and the provider
 * vocabulary speaks Pi ids (`google`, never legacy `gemini`).
 */

const engineRoot = fileURLToPath(new URL('../dist-electron/engine/', import.meta.url));
const embeddings = await import(pathToFileURL(join(engineRoot, 'embeddings.js')).href);
const { __testSeams: authSeams } = await import(pathToFileURL(join(engineRoot, 'piAuth.js')).href);
const { startEmbeddedServer, stopEmbeddedServer } = await import(
  pathToFileURL(join(engineRoot, 'server.js')).href
);

const ENV_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv(snap) {
  for (const k of ENV_KEYS) {
    if (snap[k] !== undefined) process.env[k] = snap[k];
    else delete process.env[k];
  }
}

describe('Embeddings on Pi truth (P3 Pi-only backend)', () => {
  it('resolves the embedding key from Pi auth, canonicalizing legacy `gemini`', async () => {
    const snap = snapshotEnv();
    clearEnv();
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-embed-'));
    try {
      assert.equal(embeddings.resolveEmbeddingApiKey('openai', agentDir), '');
      await authSeams.savePiChatKey('openai', 'test-embed-key', agentDir);
      assert.equal(embeddings.resolveEmbeddingApiKey('openai', agentDir), 'test-embed-key');

      await authSeams.savePiChatKey('google', 'test-google-key', agentDir);
      assert.equal(embeddings.resolveEmbeddingApiKey('google', agentDir), 'test-google-key');
      // Stored settings from before P3 may still say `gemini`: the boundary
      // tolerates it exactly once — the Pi `google` entry arms it.
      assert.equal(embeddings.resolveEmbeddingApiKey('gemini', agentDir), 'test-google-key');

      assert.equal(embeddings.resolveEmbeddingApiKey('ollama', agentDir), '');
      assert.equal(embeddings.resolveEmbeddingApiKey('none', agentDir), '');
    } finally {
      restoreEnv(snap);
    }
  });

  it('the factory throws Pi-actionably without a key and embeds with a Pi-stored key', async () => {
    const snap = snapshotEnv();
    clearEnv();
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-embed-'));
    const realFetch = globalThis.fetch;
    try {
      assert.throws(
        () => embeddings.createEmbeddingModel({ provider: 'openai', model: 'text-embedding-3-small', agentDir }),
        /No API key configured for "openai"/
      );

      await authSeams.savePiChatKey('openai', 'test-embed-key', agentDir);
      let authorization = '';
      globalThis.fetch = async (_url, options) => {
        authorization = options?.headers?.Authorization ?? '';
        return {
          ok: true,
          status: 200,
          json: async () => ({ object: 'list', data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
        };
      };
      const model = embeddings.createEmbeddingModel({
        provider: 'openai',
        model: 'text-embedding-3-small',
        agentDir,
        // Bypass the disk-persistent vector cache: the assertion is about the
        // transport carrying the Pi key, not about cache hits.
        disableCache: true,
      });
      const vectors = await model.embedText(['p3 pi-keyed probe']);
      assert.deepEqual(vectors, [[0.1, 0.2, 0.3]]);
      assert.equal(authorization, 'Bearer test-embed-key', 'the transport carries the Pi-stored key');
    } finally {
      globalThis.fetch = realFetch;
      restoreEnv(snap);
    }
  });

  it('lists embedding models keylessly: static defaults without Pi auth', async () => {
    const snap = snapshotEnv();
    clearEnv();
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-embed-'));
    try {
      const models = await embeddings.fetchEmbeddingModels('google', agentDir);
      assert.ok(models.some((m) => m.id === 'text-embedding-004'), 'Google defaults list without any key');
      const openai = await embeddings.fetchEmbeddingModels('openai', agentDir);
      assert.ok(openai.some((m) => m.id === 'text-embedding-3-small'));
    } finally {
      restoreEnv(snap);
    }
  });

  it('serves keyless embedding listing over HTTP with no key material in the query', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/models?type=embedding&provider=google`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.models) && body.models.length > 0);
      assert.ok(body.models.some((m) => m.id === 'text-embedding-004'));
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('tests embeddings through Pi-stored auth: no key in the body, ever', async () => {
    const { port } = await startEmbeddedServer(0);
    const realFetch = globalThis.fetch;
    const post = (body) =>
      fetch(`http://127.0.0.1:${port}/api/models/test-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    try {
      await authSeams.savePiChatKey('openai', 'test-embed-key', undefined).catch(() => {});
      globalThis.fetch = async (url, options) => {
        if (String(url).includes('api.openai.com/v1/embeddings')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ object: 'list', data: [{ index: 0, embedding: [0.5, 0.6] }] }),
          };
        }
        return realFetch(url, options);
      };
      const ok = await post({ provider: 'openai', model_name: 'text-embedding-3-small' });
      assert.equal(ok.success, true);
      assert.equal(ok.dimensions, 2);

      await authSeams.savePiChatKey('openai', '', undefined).catch(() => {});
      const snap = snapshotEnv();
      clearEnv();
      try {
        const missing = await post({ provider: 'openai', model_name: 'text-embedding-3-small' });
        assert.equal(missing.success, false);
        assert.match(missing.error ?? '', /No API key configured/);
      } finally {
        restoreEnv(snap);
      }
    } finally {
      globalThis.fetch = realFetch;
      await authSeams.savePiChatKey('openai', '', undefined).catch(() => {});
      await stopEmbeddedServer();
    }
  });
});
