import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { MultiSearchProvider } from '../dist-electron/engine/search.js';
import {
  primarySearchPlane,
  searchPlaneLedgerSnapshot,
  resetSearchPlane,
  __testSeams,
} from '../dist-electron/engine/searchPlane.js';
import {
  buildResearchPackageTools,
  resetPackageToolCache,
} from '../dist-electron/engine/piResearchTools.js';
import { ANSWER_MODE_UNSUPPORTED_MESSAGE } from '../dist-electron/engine/piPackages.js';

const realFetch = globalThis.fetch;

/** One-result DDG HTML — satisfies the vendored parser's ≥1-parseable contract. */
const DDG_ONE_RESULT = `
<html><body>
<div class="result">
  <h2 class="result__a" href="https://fusion.example/tokamak">Tokamak benchmark</h2>
  <a class="result__snippet" href="https://fusion.example/tokamak">Steady-state Q&gt;1 sustained.</a>
</div>
</body></html>`;

function stubFixtureFetch() {
  const seen = [];
  globalThis.fetch = (async (url) => {
    seen.push(String(url));
    return new Response(DDG_ONE_RESULT, { status: 200, headers: { 'content-type': 'text/html' } });
  });
  return seen;
}

/** Deadline-bounded poll: a regression must fail the test, not stall the worker. */
async function waitFor(cond, { timeoutMs = 5000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** One microtask flush: acquire() registers its waiter synchronously in the
 * promise executor, so a single flush guarantees queue registration. */
const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSearchPlane();
  resetPackageToolCache();
});

describe('primary search plane (ADR-0013 seam swap, #109)', () => {
  it('serves DDG queries through the vendored pi-web-access provider behind the seam', async () => {
    const seen = stubFixtureFetch();
    const results = await primarySearchPlane('tokamak benchmarks', 'duckduckgo', {}, 6);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Tokamak benchmark');
    assert.equal(results[0].url, 'https://fusion.example/tokamak');
    assert.ok(results[0].snippet.includes('Steady-state'), 'snippet parsed by the vendored module');
    assert.ok(
      seen.some((u) => u.startsWith('https://html.duckduckgo.com/html/')),
      `vendored DDG endpoint hit — seen: ${JSON.stringify(seen)}`
    );
    // Vendored-path discriminator: the vendored module builds the URL with
    // URL.searchParams (spaces → '+') and serves it in exactly one fetch —
    // a native fallback would fetch a second time with %20 encoding.
    assert.equal(seen.length, 1, `single fetch: vendored plane served, no native fallback — seen: ${JSON.stringify(seen)}`);
    assert.ok(
      seen[0].includes('q=tokamak+benchmarks'),
      'vendored URL construction (native parser encodes spaces as %20)'
    );
  });

  it('ledgers every vendored-plane call through the bounded gate (no unledgered retrieval)', async () => {
    stubFixtureFetch();
    const before = searchPlaneLedgerSnapshot();
    await primarySearchPlane('ledgered query', 'duckduckgo', {}, 3);
    const after = searchPlaneLedgerSnapshot();
    assert.equal(after.ledgered, before.ledgered + 1, 'the call was admitted through the gate');
    assert.equal(after.active, 0, 'gate released after the call');
  });

  it('propagates vendored-plane failures when no keyed provider is available (post-contract, #110)', async () => {
    // Post-contract the plane IS the keyless path (native DDG retired) — a
    // plane failure with no keys is terminal: the error propagates to the
    // caller's per-query handling. A re-entry into native search() would
    // cycle (search() → plane → search()); assert it never happens.
    globalThis.fetch = (async () =>
      new Response('no parseable results here', { status: 200 }));
    await assert.rejects(
      primarySearchPlane('fallback query', 'duckduckgo', {}, 3),
      /no parseable results/,
      'terminal: the vendored-plane error propagates (no re-entry cycle)'
    );
  });

  it('serves a keyed provider through the vendored keyed module with a one-call key override (D2, #112)', async () => {
    const seenKeys = [];
    let originalTavily = null;
    __testSeams.setKeyedOverride({
      tavily: async (_q, options) => {
        // The key rides the env override for exactly this call.
        seenKeys.push(process.env.TAVILY_API_KEY);
        assert.equal(options.numResults, 3);
        return { results: [{ title: 'keyed', url: 'https://keyed.example/', content: 's' }] };
      },
    });
    try {
      const results = await primarySearchPlane('keyed query', 'tavily', { tavily: 'k-test' }, 3);
      assert.equal(results[0].url, 'https://keyed.example/');
      assert.deepEqual(seenKeys, ['k-test'], 'the caller key was visible during the call');
      assert.equal(process.env.TAVILY_API_KEY, undefined, 'key override restored after the call (no leak)');
    } finally {
      __testSeams.setKeyedOverride(null);
    }
  });

  it('serializes the keyed env override: concurrent calls with different keys never cross or leak (#112 race)', async () => {
    // process.env is process-global, so keyed calls with DIFFERENT keys must
    // never overlap on the env override: each call sees exactly its own key,
    // and env is clean after both complete (the pre-fix race captured the
    // other caller's key as the "prior value" and leaked the override).
    const observed = [];
    let inFlight = 0;
    let maxConcurrent = 0;
    __testSeams.setKeyedOverride({
      tavily: async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        observed.push(process.env.TAVILY_API_KEY);
        await new Promise((r) => setTimeout(r, 20));
        observed.push(process.env.TAVILY_API_KEY);
        inFlight -= 1;
        return { results: [{ title: 'k', url: 'https://keyed.example/', content: 's' }] };
      },
    });
    try {
      const results = await Promise.all([
        primarySearchPlane('q1', 'tavily', { tavily: 'key-A' }, 3),
        primarySearchPlane('q2', 'tavily', { tavily: 'key-B' }, 3),
      ]);
      assert.equal(results.length, 2);
      for (const seen of observed) {
        assert.ok(seen === 'key-A' || seen === 'key-B', `no crossed/leaked key observed: ${seen}`);
      }
      assert.ok(observed.includes('key-A') && observed.includes('key-B'), 'both keys served their own calls');
      assert.equal(process.env.TAVILY_API_KEY, undefined, 'env clean after both calls');
    } finally {
      __testSeams.setKeyedOverride(null);
    }
  });

  it('degrades a keyed failure to the keyless plane; keyless never re-enters the keyed path (terminal)', async () => {
    let tavilyCalls = 0;
    __testSeams.setKeyedOverride({
      tavily: async () => { tavilyCalls++; throw new Error('Tavily API error 401: down'); },
    });
    try {
      globalThis.fetch = (async () =>
        new Response(DDG_ONE_RESULT, { status: 200 }));
      const results = await primarySearchPlane('fallback query', 'tavily', { tavily: 'k-test' }, 3);
      assert.equal(tavilyCalls, 1, 'keyed provider attempted once');
      assert.ok(results.length > 0, 'keyless plane served the query after the keyed failure');
      assert.equal(process.env.TAVILY_API_KEY, undefined, 'no env leak on the failure path');
    } finally {
      __testSeams.setKeyedOverride(null);
    }
  });

  it('removes an aborted caller from the admission queue — no post-cancel execution', async () => {
    stubFixtureFetch();
    // Saturate all 3 slots with long-lived calls.
    const hold = new AbortController();
    const seen = [];
    let releaseGate;
    const blockUntilReleased = new Promise((r) => { releaseGate = r; });
    globalThis.fetch = (async (url) => {
      seen.push(String(url));
      await blockUntilReleased;
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const inFlight = [];
    for (let i = 0; i < 3; i++) {
      inFlight.push(primarySearchPlane(`slot-${i}`, 'duckduckgo', {}, 3, hold.signal));
    }
    try {
      await waitFor(() => searchPlaneLedgerSnapshot().ledgered >= 3, { what: 'slot admission' });
      // Queue a fourth caller, then abort it while queued. acquire() registers
      // its waiter synchronously, so one flush guarantees queue membership.
      const queuedSignal = new AbortController();
      const queued = primarySearchPlane('queued-but-aborted', 'duckduckgo', {}, 3, queuedSignal.signal);
      await flush();
      const queuedBefore = searchPlaneLedgerSnapshot().ledgered;
      queuedSignal.abort();
      await assert.rejects(queued, /abort/i, 'aborted waiter rejected, never executed');
      // Release the gate; the held calls complete. The aborted caller must NOT
      // have executed (seen only ever holds the 3 slot queries).
      releaseGate();
      const settled = await Promise.allSettled(inFlight);
      assert.ok(settled.every((s) => s.status === 'fulfilled'));
      assert.equal(seen.length, 3, `no post-cancel execution — seen: ${JSON.stringify(seen)}`);
      assert.equal(searchPlaneLedgerSnapshot().ledgered, queuedBefore, 'aborted caller never admitted');
      assert.equal(searchPlaneLedgerSnapshot().active, 0, 'gate fully released');
    } finally {
      releaseGate();
      hold.abort();
      await Promise.allSettled(inFlight).catch(() => {});
    }
  });

  it('caps the admission queue: saturation fails loudly instead of degrading silently', async () => {
    stubFixtureFetch();
    const hold = new AbortController();
    let releaseGate;
    const blockUntilReleased = new Promise((r) => { releaseGate = r; });
    globalThis.fetch = (async () => {
      await blockUntilReleased;
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const inFlight = [];
    for (let i = 0; i < 3; i++) {
      inFlight.push(primarySearchPlane(`slot-${i}`, 'duckduckgo', {}, 3, hold.signal));
    }
    const queued = [];
    try {
      await waitFor(() => searchPlaneLedgerSnapshot().ledgered >= 3, { what: 'slot admission' });
      // Fill the queue to its cap (32). Registration is synchronous per call.
      for (let i = 0; i < 32; i++) {
        queued.push(primarySearchPlane(`q-${i}`, 'duckduckgo', {}, 3, hold.signal));
      }
      await flush();
      // The next caller must fail loudly with the saturation error (no silent
      // native fallback for excess work).
      await assert.rejects(
        primarySearchPlane('over-cap', 'duckduckgo', {}, 3, hold.signal),
        (err) => err.name === 'SearchPlaneQueueSaturated'
      );
    } finally {
      releaseGate();
      hold.abort();
      await Promise.allSettled([...inFlight, ...queued]).catch(() => {});
    }
  });

  it('rejects fetch_content answer-mode with graceful guidance (boundary D3)', async () => {
    stubFixtureFetch();
    const { tools, handler } = await buildResearchPackageTools({
      sessionId: 'test-session-109',
      cwd: process.cwd(),
    });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes('fetch_content'), 'tool surface unchanged');

    const guarded = await handler({ name: 'fetch_content', arguments: { url: 'https://x.example/', mode: 'answer' } });
    assert.equal(guarded.success, false);
    assert.equal(guarded.error, ANSWER_MODE_UNSUPPORTED_MESSAGE);

    const readable = await handler({ name: 'fetch_content', arguments: { url: 'https://fusion.example/tokamak' } });
    assert.notEqual(readable.error, ANSWER_MODE_UNSUPPORTED_MESSAGE, 'readable mode not intercepted');
  });
});
