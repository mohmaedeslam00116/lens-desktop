import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Tracer P2 — Pi owns chat auth + defaults. Keys persist into Pi's
 * `auth.json` via the native `login` path (never request envelopes or
 * localStorage); defaults persist into Pi's file-backed `settings.json`.
 * The HTTP routes serve the same shapes the Settings UI saves through.
 */

const engineRoot = fileURLToPath(new URL('../dist-electron/engine/', import.meta.url));
const { __testSeams: authSeams } = await import(pathToFileURL(join(engineRoot, 'piAuth.js')).href);
const { startEmbeddedServer, stopEmbeddedServer } = await import(
  pathToFileURL(join(engineRoot, 'server.js')).href
);

async function post(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe('Pi auth + defaults (P2 Pi-only backend)', () => {
  it('persists a chat key through Pi login and reports stored standing', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-auth-'));
    const saved = await authSeams.savePiChatKey('openai', 'test-key-sentinel', agentDir);
    assert.equal(saved.provider, 'openai');
    assert.equal(saved.configured, true);

    const { getPiCatalogSnapshot } = await import(pathToFileURL(join(engineRoot, 'piCatalog.js')).href);
    const snapshot = await getPiCatalogSnapshot(agentDir);
    const entry = snapshot.providers.find((p) => p.id === 'openai');
    assert.ok(entry, 'the catalog lists the provider');
    assert.equal(entry.auth.configured, true, 'Pi standing reflects the stored key');
  });

  it('rejects the LENS `gemini` id and the keyless Ollama save', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-auth-'));
    await assert.rejects(() => authSeams.savePiChatKey('gemini', 'x', agentDir), /Pi id is "google"/);
    await assert.rejects(() => authSeams.savePiChatKey('ollama', 'x', agentDir), /no API key/i);
  });

  it('logs out on an empty key (delete the entry)', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-auth-'));
    await authSeams.savePiChatKey('openai', 'test-key-sentinel', agentDir);
    const cleared = await authSeams.savePiChatKey('openai', '', agentDir);
    assert.equal(cleared.configured, false);

    const { getPiCatalogSnapshot } = await import(pathToFileURL(join(engineRoot, 'piCatalog.js')).href);
    const snapshot = await getPiCatalogSnapshot(agentDir);
    const entry = snapshot.providers.find((p) => p.id === 'openai');
    if (entry) assert.equal(entry.auth.configured, false);
  });

  it('persists defaults through the file-backed Pi settings', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-defaults-'));
    const saved = await authSeams.savePiDefaults('google', 'gemini-2.5-flash', agentDir);
    assert.equal(saved.provider, 'google');
    assert.equal(saved.model, 'gemini-2.5-flash');

    const read = await authSeams.getPiDefaults(agentDir);
    assert.equal(read.provider, 'google');
    assert.equal(read.model, 'gemini-2.5-flash');

    await assert.rejects(() => authSeams.savePiDefaults('gemini', 'x', agentDir), /Pi id is "google"/);
  });

  it('serves auth + defaults over HTTP with the same shapes', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const saved = await post(port, '/api/pi/auth', { provider: 'openai', apiKey: 'test-key-sentinel' });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.success, true);
      assert.equal(saved.json.provider, 'openai');

      const bad = await post(port, '/api/pi/auth', { provider: 'gemini', apiKey: 'x' });
      assert.equal(bad.status, 400);

      const def = await post(port, '/api/pi/defaults', { provider: 'google', model: 'gemini-2.5-flash' });
      assert.equal(def.status, 200);
      assert.equal(def.json.success, true);

      const read = await (await fetch(`http://127.0.0.1:${port}/api/pi/defaults`)).json();
      assert.equal(read.provider, 'google');

      // The chat branch of the legacy route is gone (410) — embeddings stay.
      const legacy = await fetch(`http://127.0.0.1:${port}/api/models?provider=openai`);
      assert.equal(legacy.status, 410);
    } finally {
      // Leave the shared default store clean: later suites probe no-key
      // shapes against providers they assume are unconfigured.
      await post(port, '/api/pi/auth', { provider: 'openai', apiKey: '' }).catch(() => {});
      await stopEmbeddedServer();
    }
  });

  it('the admission guard reads Pi standing, never request keys', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      // No stored key for a fresh provider → 422 without any key in the body.
      const res = await fetch(`http://127.0.0.1:${port}/api/research/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'pi standing probe', llm_provider: 'mistral' }),
      });
      assert.equal(res.status, 422);
      const gemini = await fetch(`http://127.0.0.1:${port}/api/research/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'pi standing probe', llm_provider: 'gemini' }),
      });
      assert.equal(gemini.status, 422);
    } finally {
      await stopEmbeddedServer();
    }
  });
});
