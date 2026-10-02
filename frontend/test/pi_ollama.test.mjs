import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Tracer P4 — Ollama persists as a Pi `models.json` overlay. The local server
 * (endpoint + probed models) is saved once via `/api/pi/ollama`; every Pi
 * runtime in the engine loads it through `modelsPath`, so sessions,
 * embeddings, listings, guards, and transports resolve Ollama from the file
 * — requests carry Pi ids only, never endpoints.
 */

const engineRoot = fileURLToPath(new URL('../dist-electron/engine/', import.meta.url));
const { __testSeams: ollamaSeams } = await import(pathToFileURL(join(engineRoot, 'piOllama.js')).href);
const { __testSeams: hostSeams } = await import(pathToFileURL(join(engineRoot, 'agentSessionHost.js')).href);
const { startEmbeddedServer, stopEmbeddedServer } = await import(
  pathToFileURL(join(engineRoot, 'server.js')).href
);

const host = hostSeams.host;

/** The shared default store file — backed up and restored around tests that touch it. */
function defaultModelsPath() {
  return join(host.resolveAgentDir(), 'models.json');
}

function backupSharedStore() {
  const path = defaultModelsPath();
  const existed = existsSync(path);
  const content = existed ? readFileSync(path, 'utf-8') : null;
  return () => {
    try {
      if (content === null) {
        if (existsSync(path)) rmSync(path);
      } else {
        writeFileSync(path, content, 'utf-8');
      }
    } catch {
      // Best-effort restore; the assertions already ran.
    }
  };
}

describe('Ollama models.json overlay (P4 Pi-only backend)', () => {
  it('rejects non-http endpoints without writing anything', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-ollama-'));
    await assert.rejects(ollamaSeams.saveOllamaEndpoint('not-a-url', agentDir), /http\(s\)/);
    await assert.rejects(ollamaSeams.saveOllamaEndpoint('', agentDir), /http\(s\)/);
    assert.equal(existsSync(join(agentDir, 'models.json')), false);
  });

  it('refuses to invent models: an unreachable server throws and writes nothing', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-ollama-'));
    // Discard port: connection refusal is instant and requires no network.
    await assert.rejects(ollamaSeams.saveOllamaEndpoint('http://127.0.0.1:9', agentDir), /unreachable/i);
    assert.equal(existsSync(join(agentDir, 'models.json')), false);
  });

  it('writes the overlay merge-safely and reads it back verbatim', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-ollama-'));
    // A pre-existing foreign entry must survive the Ollama write.
    writeFileSync(
      join(agentDir, 'models.json'),
      JSON.stringify({ providers: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1' } } }),
      'utf-8'
    );
    const written = ollamaSeams.writeOllamaOverlay('http://127.0.0.1:11434/', [{ id: 'llama3.1', name: 'llama3.1' }], agentDir);
    assert.equal(written.endpoint, 'http://127.0.0.1:11434');
    assert.deepEqual(written.models, [{ id: 'llama3.1', name: 'llama3.1' }]);
    assert.equal(written.configured, true);

    const doc = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'));
    assert.equal(doc.providers.openrouter.baseUrl, 'https://openrouter.ai/api/v1', 'foreign entries survive');
    assert.equal(doc.providers.ollama.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(doc.providers.ollama.api, 'openai-completions');

    const read = ollamaSeams.readOllamaOverlay(agentDir);
    assert.deepEqual(read, written);
    assert.equal(ollamaSeams.resolveOllamaEndpoint(agentDir), 'http://127.0.0.1:11434');
  });

  it('clears only the Ollama entry and defaults the endpoint when never saved', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-ollama-'));
    assert.deepEqual(ollamaSeams.readOllamaOverlay(agentDir), { endpoint: null, models: [], configured: false });
    assert.equal(ollamaSeams.resolveOllamaEndpoint(agentDir), 'http://localhost:11434');

    writeFileSync(
      join(agentDir, 'models.json'),
      JSON.stringify({ providers: { ollama: { baseUrl: 'http://x/v1', models: [] }, openrouter: {} } }),
      'utf-8'
    );
    const cleared = ollamaSeams.clearOllamaEndpoint(agentDir);
    assert.equal(cleared.configured, false);
    const doc = JSON.parse(readFileSync(join(agentDir, 'models.json'), 'utf-8'));
    assert.equal('ollama' in doc.providers, false);
    assert.ok('openrouter' in doc.providers, 'foreign entries survive the clear');
  });

  it('sessions pin the file-persisted Ollama provider with no per-request endpoint', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-pi-ollama-'));
    ollamaSeams.writeOllamaOverlay('http://127.0.0.1:11434', [{ id: 'llama3.1', name: 'llama3.1' }], agentDir);
    const hosted = await host.createResearchSession({ sessionId: 'p4-ollama-pin', agentDir, provider: 'ollama', modelName: 'llama3.1' });
    const model = hosted.session?.model ?? hosted.session?.agent?.state?.model;
    assert.ok(model, 'the live session carries a model');
    assert.equal(model.provider, 'ollama', 'the session runs the persisted overlay provider');
    assert.equal(model.id, 'llama3.1');
  });

  it('serves the overlay over HTTP: GET status, POST persist, invalid rejected', async () => {
    const restore = backupSharedStore();
    const { port } = await startEmbeddedServer(0);
    try {
      const get = async () => (await fetch(`http://127.0.0.1:${port}/api/pi/ollama`)).json();
      const post = (body) =>
        fetch(`http://127.0.0.1:${port}/api/pi/ollama`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, json: await r.json() }));

      ollamaSeams.clearOllamaEndpoint(undefined);
      assert.equal((await get()).configured, false);

      const bad = await post({ endpoint: 'not-a-url' });
      assert.equal(bad.status, 400);
      assert.equal((await get()).configured, false, 'invalid endpoints are never written');

      // Unreachable but well-formed: remembered with an empty model list and
      // a warning — never invented models, never a blocked save.
      const down = await post({ endpoint: 'http://127.0.0.1:9' });
      assert.equal(down.status, 200);
      assert.equal(down.json.success, true);
      assert.deepEqual(down.json.models, []);
      assert.match(down.json.warning ?? '', /unreachable/i);
      const status = await get();
      assert.equal(status.endpoint, 'http://127.0.0.1:9');
      assert.deepEqual(status.models, []);
      assert.equal(status.configured, true);
    } finally {
      await stopEmbeddedServer();
      restore();
    }
  });

  it('admits Ollama runs from the file with Pi ids only — no endpoint in the body', async () => {
    const restore = backupSharedStore();
    const { port } = await startEmbeddedServer(0);
    try {
      // No overlay → 422 without any endpoint anywhere in the request.
      ollamaSeams.clearOllamaEndpoint(undefined);
      const missing = await fetch(`http://127.0.0.1:${port}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'p4 probe', provider: 'ollama' }),
      });
      assert.equal(missing.status, 422);
      assert.match((await missing.json()).error ?? '', /Ollama/);

      // Hand-written overlay (probe-equivalent shape): the guard admits on
      // file truth alone — the body carries Pi ids only.
      ollamaSeams.writeOllamaOverlay('http://127.0.0.1:1', [{ id: 'probe-model', name: 'probe-model' }], undefined);
      const admitted = await fetch(`http://127.0.0.1:${port}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'p4 probe', provider: 'ollama', model_name: 'probe-model' }),
      });
      assert.equal(admitted.status, 200, 'file truth admits the run with no endpoint in the body');
      const accept = await admitted.json();
      await fetch(`http://127.0.0.1:${port}/api/agent/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: accept.session_id }),
      });
    } finally {
      await stopEmbeddedServer();
      restore();
    }
  });
});
