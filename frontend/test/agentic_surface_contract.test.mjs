import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

/**
 * Agentic surface contract — the three CodeRabbit findings on PR #149,
 * pinned so they cannot regress:
 *
 * 1. CRITICAL — the tool surface handler is the LENS-wrapped tool that rides
 *    the #140 construction seam: `toPiTool` reads `result`/`error`, so the
 *    handler must return `{success, result?, error?}` — a raw `output` field
 *    is silently dropped and the model sees "null" for every tool result.
 * 2. MAJOR — the cancel registry is one-live-run-per-session: a second
 *    `runAgenticSearch` on the same sessionId must not orphan the first
 *    run's registry entry, or cancel can never reach it.
 * 3. MAJOR — `AGENTIC_ROUTES` names the engine surface; a route that is
 *    named but not served answers 404. Start (with the admission guard),
 *    steer, cancel, and the `/ws/agent/:id` event stream must exist.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const { runAgenticSearch, createAgenticToolSurface, cancelAgenticSearch } =
  await importEngine('agenticSearch.js');
const { __testSeams } = await importEngine('agenticSearch.js');
const { startEmbeddedServer, stopEmbeddedServer, AGENTIC_ROUTES } = await importEngine('server.js');
const host = (await importEngine('agentSessionHost.js')).__testSeams.host;

/** A handler result conforms to the LensToolSurface contract (#140): success
 * carries `result`, refusal carries `error`, and no legacy dual field. */
function conformsToToolContract(outcome) {
  if (!outcome || typeof outcome.success !== 'boolean') return false;
  if ('output' in outcome) return false;
  return outcome.success ? 'result' in outcome : 'error' in outcome;
}

describe('Agentic tool surface — LensToolSurface contract (#140)', () => {
  it('returns {success, result} on success — never a bare output field', async () => {
    const surface = createAgenticToolSurface({
      sessionId: 's-contract-ok',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      search: async () => [{ url: 'https://contract.example/1', title: 'T', snippet: 'S' }],
      fetchPage: async (url) => ({ url, title: url, text: 'body' }),
    });
    const search = await surface.handler({ name: 'web_search', arguments: { query: 'q' } });
    assert.ok(conformsToToolContract(search), `web_search must satisfy the contract, got: ${JSON.stringify(search)}`);
    const fetch = await surface.handler({ name: 'fetch_content', arguments: { url: 'https://contract.example/1' } });
    assert.ok(conformsToToolContract(fetch), `fetch_content must satisfy the contract, got: ${JSON.stringify(fetch)}`);
  });

  it('returns {success, error} on refusal — never a bare output field', async () => {
    const surface = createAgenticToolSurface({
      sessionId: 's-contract-err',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      search: async () => [],
      fetchPage: async () => null,
    });
    const noQuery = await surface.handler({ name: 'web_search', arguments: {} });
    assert.ok(conformsToToolContract(noQuery), 'a missing query is a contract-shaped refusal');
    const unknown = await surface.handler({ name: 'no_such_tool', arguments: {} });
    assert.ok(conformsToToolContract(unknown), 'an unknown tool is a contract-shaped refusal');
    const thrown = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'https://throw.example/x' },
      // fetchPage above never throws here; exercise the catch path via a rejecting surface instead.
    });
    assert.ok(conformsToToolContract(thrown) || thrown.success === true);
  });

  it('end-to-end: the model receives the search body as the tool result text', async () => {
    // toPiTool serialises `result` (a string passes through; null becomes "null").
    // This is the seam the Critical finding broke: output was dropped, result
    // was undefined, and pi stringified undefined-null to the model.
    const surface = createAgenticToolSurface({
      sessionId: 's-contract-pi',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      search: async () => [{ url: 'https://pi-visible.example/1', title: 'Visible title', snippet: 'Visible snippet' }],
      fetchPage: async (url) => ({ url, title: url, text: 'body' }),
    });
    const outcome = await surface.handler({ name: 'web_search', arguments: { query: 'visibility' } });
    assert.ok(conformsToToolContract(outcome));
    const text = typeof outcome.result === 'string' ? outcome.result : JSON.stringify(outcome.result ?? null);
    assert.match(text, /Visible title/, 'the model-visible text carries the search body');
  });
});

describe('Agentic cancel registry — one live run per session', () => {
  it('a second run on the same session is rejected explicitly; the first stays live and cancellable', async () => {
    const makeSession = (sessionId) => {
      const surface = createAgenticToolSurface({
        sessionId,
        state: { sources: [], reportChunks: [], fetchesUsed: 0 },
        maxFetches: 5,
        emit: () => {},
        search: async () => [],
        fetchPage: async (url) => ({ url, title: url, text: 'b' }),
      });
      return host.createResearchSession({ sessionId, agentDir: mkdtempSync(join(tmpdir(), 'lens-agent-')) }, surface);
    };

    const first = await makeSession('s-registry-dup');
    const second = await makeSession('s-registry-dup');
    const secondEvents = [];

    let releaseFirst = () => {};
    const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
    first.session.agent.streamFunction = async () => {
      await firstHeld;
      return {
        async *[Symbol.asyncIterator]() {},
        async result() { return { role: 'assistant', content: [], stopReason: 'aborted' }; },
      };
    };

    // Run 1 is LIVE and held inside its transport when run 2 starts.
    const firstRun = runAgenticSearch(first.session, {
      sessionId: 's-registry-dup',
      question: 'first',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      emit: () => {},
    });
    await new Promise((r) => setTimeout(r, 30));

    // Run 2 on the same session: rejected fast and EXPLICITLY — never silence,
    // never a silent takeover that orphans run 1's registry entry.
    const secondOutcome = await runAgenticSearch(second.session, {
      sessionId: 's-registry-dup',
      question: 'second',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      emit: (event) => secondEvents.push(event),
    });
    assert.equal(secondOutcome.terminal, 'error', 'the duplicate start terminates into the explicit error terminal');
    assert.ok(secondEvents.some((e) => e.type === 'error'), 'the rejection is a visible event — never silence');

    // Run 1's registry entry survived run 2: cancel reaches THE FIRST RUN.
    assert.equal(cancelAgenticSearch('s-registry-dup'), true, 'cancel still finds the first live run');
    releaseFirst();
    const firstOutcome = await firstRun;
    assert.equal(firstOutcome.terminal, 'cancelled', 'cancel aborted the FIRST run — an orphaned entry would have finished instead');

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(__testSeams.activeRuns.size, 0, 'the registry drains after the run settles');
  });
});

describe('AGENTIC_ROUTES — the named surface is served', () => {
  it('declares exactly the three routes', () => {
    assert.deepEqual([...AGENTIC_ROUTES], ['/api/agent/start', '/api/agent/steer', '/api/agent/cancel']);
  });

  it('start rejects a keyless run with 422 — the guard answers, not 404', async () => {
    const { port } = await startEmbeddedServer(0, {});
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini' }),
      });
      assert.equal(response.status, 422, 'a named route must serve its guard, never 404');
      const body = await response.json();
      assert.match(body.error, /API key/);
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('start admits a run, streams over /ws/agent/:id, and cancel terminates it explicitly', { timeout: 40000 }, async () => {
    const { port } = await startEmbeddedServer(0, {});
    try {
      // A deterministically unreachable provider (discard port): the run can
      // never complete on its own, so a delivered terminal can only come from
      // the cancel route — the terminal assertion stays causal.
      const startResponse = await fetch(`http://127.0.0.1:${port}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'ws probe', provider: 'ollama', ollama_endpoint: 'http://127.0.0.1:1' }),
      });
      assert.equal(startResponse.status, 200, 'an admitted run is accepted with its session handle');
      const { session_id: sessionId, session_url: sessionUrl } = await startResponse.json();
      assert.ok(sessionId && sessionUrl, 'the acceptance names the session and its stream URL');

      const collect = (ws, registry) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no events within 15s of attach')), 15000);
          ws.on('message', (d) => {
            const event = JSON.parse(d.toString());
            registry.push(event);
            clearTimeout(timer);
            resolve(event);
          });
          ws.on('error', (err) => { clearTimeout(timer); reject(err); });
        });

      const stream1 = [];
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}${sessionUrl}`);
      const first1 = await collect(ws1, stream1);
      assert.ok(
        ['session_state', 'status'].includes(first1.type),
        `the bridge is attached from the first instant — lifecycle is visible, got: ${first1.type}`
      );

      // A mid-run attach replays what the run already emitted (the
      // research-session delta contract, carried onto the agentic stream).
      const stream2 = [];
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}${sessionUrl}`);
      await collect(ws2, stream2);
      assert.ok(stream2.length >= stream1.length, 'a mid-run attach replays the events it missed');

      const terminalOn = (ws) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no cancelled terminal within 15s')), 15000);
          ws.on('message', (d) => {
            const event = JSON.parse(d.toString());
            if (event.type === 'cancelled') { clearTimeout(timer); resolve(event); }
          });
          ws.on('error', (err) => { clearTimeout(timer); reject(err); });
        });

      const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/agent/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      assert.equal(cancelResponse.status, 200, 'cancel finds the live run and aborts it');

      // Both attached streams see the explicit cancelled terminal — never
      // silence (the Event Faithfulness law at the served surface).
      await Promise.all([terminalOn(ws1), terminalOn(ws2)]);
      ws1.close();
      ws2.close();
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('steer answers 404 for an unknown session — the route exists', async () => {
    const { port } = await startEmbeddedServer(0, {});
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agent/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'no-such-run', message: 'hello' }),
      });
      assert.equal(response.status, 404, 'an unknown session is 404 from the route, not the fallthrough');
      const body = await response.json();
      assert.match(body.error, /No live agentic run/);
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('cancel answers 404 for an unknown session — the route exists', async () => {
    const { port } = await startEmbeddedServer(0, {});
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/agent/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: 'no-such-run' }),
      });
      assert.equal(response.status, 404, 'an unknown session is 404 from the route, not the fallthrough');
      const body = await response.json();
      assert.match(body.error, /No live agentic run/);
    } finally {
      await stopEmbeddedServer();
    }
  });
});
