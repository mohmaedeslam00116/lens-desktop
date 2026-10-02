import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startEmbeddedServer, stopEmbeddedServer } from '../dist-electron/engine/server.js';
import { __testSeams as catalogSeams } from '../dist-electron/engine/piCatalog.js';

/**
 * Tracer P0 — read-only Pi truth (Pi-only backend migration).
 *
 * The Pi ModelRuntime is the single source of truth for providers, models,
 * and auth standing. These routes expose that truth for the Settings UI to
 * render (tracer P1) instead of the LENS-owned provider lists, catalog
 * fetchers, and key inspection. Nothing here writes, and no key material may
 * ever be serialized — auth standing only.
 */

const get = async (port, path) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.status, 200, `${path} must answer 200`);
  return response.json();
};

describe('Pi catalog routes - read-only Pi truth', () => {
  it('lists Pi providers with their cataloged models and no key material', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const body = await get(port, '/api/pi/providers');
      assert.ok(Array.isArray(body.providers), 'providers is a list');
      assert.ok(body.providers.length > 0, 'the Pi catalog is non-empty');

      const ids = body.providers.map((p) => p.id);
      assert.deepEqual(ids, [...ids].sort(), 'providers are sorted for determinism');
      assert.ok(ids.includes('google'), 'Pi registers google (the LENS "gemini" id maps here)');
      assert.ok(ids.includes('openrouter'), 'Pi registers openrouter natively');

      for (const provider of body.providers) {
        assert.equal(typeof provider.id, 'string');
        assert.ok(provider.id.length > 0);
        assert.equal(typeof provider.name, 'string');
        assert.ok(Array.isArray(provider.models), `${provider.id} carries a model list`);
        for (const model of provider.models) {
          assert.equal(typeof model.id, 'string');
          assert.equal(typeof model.name, 'string');
        }
        assert.ok(!('apiKey' in provider) && !('api_key' in provider), `${provider.id} serializes no key material`);
        assert.ok(!('auth' in provider), 'the catalog carries no auth standing (that is the auth-status route)');
      }

      const google = body.providers.find((p) => p.id === 'google');
      assert.ok(google.models.length > 0, 'the google catalog is non-empty offline');
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('reports per-provider auth standing as booleans, never credentials', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const body = await get(port, '/api/pi/auth-status');
      assert.ok(Array.isArray(body.providers), 'providers is a list');
      assert.ok(body.providers.length > 0);
      for (const entry of body.providers) {
        assert.equal(typeof entry.id, 'string');
        assert.equal(typeof entry.configured, 'boolean', `${entry.id} reports a boolean standing`);
        assert.ok(
          entry.source === null || typeof entry.source === 'string',
          `${entry.id} source is a label or null`
        );
        assert.ok(!('apiKey' in entry) && !('api_key' in entry) && !('key' in entry), `${entry.id} leaks no credential`);
      }
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('the seam snapshot matches what the routes serve', async () => {
    const snapshot = await catalogSeams.getPiCatalogSnapshot();
    assert.ok(Array.isArray(snapshot.providers) && snapshot.providers.length > 0);
    const google = snapshot.providers.find((p) => p.id === 'google');
    assert.ok(google && google.models.length > 0);
    assert.equal(typeof google.auth.configured, 'boolean');
  });

  it('lists Ollama from the persisted overlay: saved means listed, absent means absent', async () => {
    // Tracer P4: no probe parameter — the `models.json` overlay is the truth.
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { __testSeams: ollamaSeams } = await import('../dist-electron/engine/piOllama.js');

    const emptyDir = mkdtempSync(join(tmpdir(), 'lens-pi-catalog-'));
    const plain = await catalogSeams.getPiCatalogSnapshot(emptyDir);
    assert.equal(
      plain.providers.some((p) => p.id === 'ollama'),
      false,
      'no overlay means no Ollama entry at all'
    );

    const savedDir = mkdtempSync(join(tmpdir(), 'lens-pi-catalog-'));
    ollamaSeams.writeOllamaOverlay('http://127.0.0.1:11434', [{ id: 'llama3.1', name: 'llama3.1' }], savedDir);
    const snapshot = await catalogSeams.getPiCatalogSnapshot(savedDir);
    const ollama = snapshot.providers.find((p) => p.id === 'ollama');
    assert.ok(ollama, 'the saved overlay lists as an ordinary Pi provider');
    assert.deepEqual(ollama.models, [{ id: 'llama3.1', name: 'llama3.1' }], 'persisted models list verbatim');

    // A saved-but-unreachable server persists with an empty model list:
    // listed honestly, never invented.
    const downDir = mkdtempSync(join(tmpdir(), 'lens-pi-catalog-'));
    ollamaSeams.writeOllamaOverlay('http://127.0.0.1:9', [], downDir);
    const down = await catalogSeams.getPiCatalogSnapshot(downDir);
    const downEntry = down.providers.find((p) => p.id === 'ollama');
    assert.ok(downEntry, 'the unreachable save still lists');
    assert.deepEqual(downEntry.models, [], 'unreachable means no models — never invented');
  });

  it('the transient Pi connection test fails loudly without touching the network', async () => {
    // Isolated agent dir: the shared default store may hold Pi keys from
    // other suites (P2 persists auth) — isolation keeps this a no-key probe.
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-catalog-'));
    const noProvider = await catalogSeams.testPiProvider({ provider: '' }, agentDir);
    assert.equal(noProvider.success, false);

    const noKey = await catalogSeams.testPiProvider({ provider: 'openai' }, agentDir);
    assert.equal(noKey.success, false);
    assert.match(noKey.error ?? '', /API key/i);

    const gemini = await catalogSeams.testPiProvider({ provider: 'gemini' }, agentDir);
    assert.equal(gemini.success, false);
    assert.match(gemini.error ?? '', /Pi id is "google"/);

    const unknown = await catalogSeams.testPiProvider({ provider: 'no-such-pi-provider', apiKey: 'x' }, agentDir);
    assert.equal(unknown.success, false);
    assert.match(unknown.error ?? '', /no models/i);

    const ollamaDown = await catalogSeams.testPiProvider({ provider: 'ollama', endpoint: 'http://127.0.0.1:9' }, agentDir);
    assert.equal(ollamaDown.success, false);
    assert.match(ollamaDown.error ?? '', /unreachable/i);

    // Tracer P4: without an explicit endpoint the persisted overlay serves —
    // absent both, the honest no-endpoint failure (never invented, never a
    // guessed server).
    const { __testSeams: ollamaSeams } = await import('../dist-electron/engine/piOllama.js');
    const noOverlay = await catalogSeams.testPiProvider({ provider: 'ollama' }, agentDir);
    assert.equal(noOverlay.success, false);
    assert.match(noOverlay.error ?? '', /No Ollama endpoint configured/);
    ollamaSeams.writeOllamaOverlay('http://127.0.0.1:9', [], agentDir);
    const emptyOverlay = await catalogSeams.testPiProvider({ provider: 'ollama' }, agentDir);
    assert.equal(emptyOverlay.success, false);
    assert.match(emptyOverlay.error ?? '', /No Ollama endpoint configured/);
  });

  it('serves the Pi connection test over HTTP with the same shapes', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const post = async (body) =>
        (
          await fetch(`http://127.0.0.1:${port}/api/pi/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).json();
      // `mistral` holds no stored key in CI (and the suite never saves one
      // to the shared store) — the no-key shape stays deterministic.
      const noKey = await post({ provider: 'mistral' });
      assert.equal(noKey.success, false);
      assert.equal(typeof noKey.latency_ms, 'number');

      // Tracer P4: the providers route takes no probe parameter — Ollama
      // lists if (and only if) the persisted overlay says so.
      const listed = await get(port, '/api/pi/providers');
      assert.ok(Array.isArray(listed.providers));
    } finally {
      await stopEmbeddedServer();
    }
  });
});
