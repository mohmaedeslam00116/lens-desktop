import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { PageScraper } from '../dist-electron/engine/scraper.js';
import {
  scrapePlaneLedgerSnapshot,
  resetScrapePlane,
  CONTENT_UNAVAILABLE_PREFIX,
  __testSeams,
} from '../dist-electron/engine/scrapePlane.js';

const realFetch = globalThis.fetch;

const GOLDEN_BODY = 'Dense evidence content. '.repeat(60); // ≥ vendored completeness threshold
function articlePage(title, body = GOLDEN_BODY) {
  return `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
}

const OK_HEADERS = { 'content-type': 'text/html; charset=utf-8' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic pending fetch: requests queue FIFO; each entry owns its
 * abort listener (rejects only itself — never another request), so no
 * promise is ever orphaned or cross-wired. */
function makeGatedFetch() {
  const calls = [];
  const pendingQueue = [];
  const fetchImpl = (input, init) => {
    calls.push(String(input));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, init, onAbort: null };
      if (init?.signal) {
        entry.onAbort = () => {
          const i = pendingQueue.indexOf(entry);
          if (i !== -1) pendingQueue.splice(i, 1);
          entry.reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
        };
        init.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      pendingQueue.push(entry);
    });
  };
  const detach = (entry) => {
    if (entry.init?.signal && entry.onAbort) {
      entry.init.signal.removeEventListener('abort', entry.onAbort);
    }
  };
  return {
    fetchImpl,
    calls,
    pending: () => pendingQueue.length > 0,
    /** Resolves the oldest pending request. */
    resolveNext(html, headers = OK_HEADERS) {
      const entry = pendingQueue.shift();
      if (!entry) throw new Error('no pending request to resolve');
      detach(entry);
      entry.resolve(new Response(html, { status: 200, headers }));
    },
    /** Rejects the oldest pending request. */
    rejectNext(err) {
      const entry = pendingQueue.shift();
      if (!entry) throw new Error('no pending request to reject');
      detach(entry);
      entry.reject(err);
    },
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  __testSeams.setLookupOverride(null);
  resetScrapePlane();
});

describe('Primary scrape plane (ticket #111 — ADR-0013 D1/D4/D5)', () => {
  it('serves scrapes through vendored fetch_content and returns the LENS page shape (conversion)', async () => {
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    let seenUrl = null;
    globalThis.fetch = (input) => {
      seenUrl = String(input);
      return Promise.resolve(new Response(articlePage('Plane Probe'), { status: 200, headers: OK_HEADERS }));
    };
    const page = await PageScraper.scrape('https://plane-probe.example/article', 5000);
    assert.equal(seenUrl, 'https://plane-probe.example/article');
    assert.equal(page.url, 'https://plane-probe.example/article');
    assert.equal(page.domain, 'plane-probe.example');
    assert.ok(page.title.length > 0, 'title extracted from content');
    assert.ok(page.content.length > 500, 'content extracted');
    assert.equal(page.credibilityScore, 80, 'LENS-owned credibility score preserved');

    const ledger = scrapePlaneLedgerSnapshot();
    assert.equal(ledger.ledgered, 1, 'the scrape was admitted through the plane ledger');
    assert.equal(ledger.active, 0, 'gate fully released after the scrape');
  });

  it('applies the LENS content budget after vendored extraction', async () => {
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    globalThis.fetch = () => Promise.resolve(new Response(articlePage('Big Page', 'Overflowing content. '.repeat(1200)), {
      status: 200,
      headers: OK_HEADERS,
    }));
    const page = await PageScraper.scrape('https://plane-budget.example/article', 5000);
    assert.ok(page.content.length <= 6000 + '... [content trimmed]'.length, 'content capped to the LENS budget');
    assert.ok(page.content.endsWith('... [content trimmed]'), 'trim marker present');
  });

  it('maps origin HTTP errors to the native unavailable-content sentinel (pool backoff contract)', async () => {
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    globalThis.fetch = () => Promise.resolve(new Response('rate limited', { status: 429 }));
    const page = await PageScraper.scrape('https://sentinel.example/article', 5000);
    assert.ok(page.content.startsWith(CONTENT_UNAVAILABLE_PREFIX), 'sentinel text present');
    assert.ok(page.content.includes('(HTTP 429)'), 'status recorded in the sentinel');
    assert.equal(page.domain, 'sentinel.example');
  });

  it('throws transport-style failures (SSRF block proves vendored validation stays ON)', async () => {
    // Resolver returns a private address: the vendored SSRF validator must
    // block it — the plane does not weaken security when adopting the plane.
    __testSeams.setLookupOverride(async () => [{ address: '10.0.0.5', family: 4 }]);
    let fetched = false;
    globalThis.fetch = () => { fetched = true; return Promise.resolve(new Response('nope', { status: 200 })); };
    await assert.rejects(
      PageScraper.scrape('https://private-range.example/article', 5000),
      /Failed to scrape .*Blocked internal address/
    );
    assert.equal(fetched, false, 'no fetch issued for SSRF-blocked hosts');
  });

  it('maps vendored timeout (abort without caller abort) to the native timeout error', async () => {
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')), { once: true });
    });
    await assert.rejects(
      PageScraper.scrape('https://slow.example/article', 60),
      /Failed to scrape .*Request timed out/
    );
  });

  it('propagates caller aborts as AbortError — before admission and mid-flight', async () => {
    // Pre-aborted: rejected before admission, ledger untouched.
    const ledgerBefore = scrapePlaneLedgerSnapshot().ledgered;
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(
      PageScraper.scrape('https://aborted.example/article', 5000, preAborted.signal),
      (err) => err.name === 'AbortError'
    );
    assert.equal(scrapePlaneLedgerSnapshot().ledgered, ledgerBefore, 'pre-aborted call never admitted');

    // Mid-flight: the caller aborts while the vendored fetch is pending.
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    const gated = makeGatedFetch();
    globalThis.fetch = gated.fetchImpl;
    const controller = new AbortController();
    const pending = PageScraper.scrape('https://mid-abort.example/article', 5000, controller.signal);
    const deadline = Date.now() + 3000;
    while (!gated.pending() && Date.now() < deadline) await sleep(5);
    assert.ok(gated.pending(), 'vendored fetch is in flight');
    controller.abort();
    await assert.rejects(pending, (err) => err.name === 'AbortError', 'mid-flight abort surfaces as AbortError');
  });

  it('admits every fetch through the bounded gate: saturation fails loudly (D5)', async () => {
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    const gated = makeGatedFetch();
    globalThis.fetch = gated.fetchImpl;
    const CALL_TIMEOUT = 30000; // keep vendored per-call timers far from firing mid-test

    // Warm the vendored module cache (afterEach cleared it) so the concurrent
    // admissions below don't race three parallel jiti loads.
    const warm = PageScraper.scrape('https://warm.example/article', CALL_TIMEOUT);
    const warmDeadline = Date.now() + 10000;
    while (!gated.pending() && Date.now() < warmDeadline) await sleep(5);
    assert.ok(gated.pending(), 'warm-up scrape reached the vendored fetch');
    gated.resolveNext(articlePage('Warm'));
    await warm;

    // Three in-flight (PLANE_CONCURRENCY)…
    const inFlight = [];
    for (let i = 0; i < 3; i++) {
      inFlight.push(PageScraper.scrape(`https://gate-${i}.example/article`, CALL_TIMEOUT).catch((e) => e));
    }
    const fillDeadline = Date.now() + 10000;
    while (gated.calls.length < 4 && Date.now() < fillDeadline) await sleep(5);
    assert.equal(gated.calls.length, 4, 'three scrapes admitted concurrently (plus the warm-up)');

    // …then fill the queue to capacity (PLANE_MAX_QUEUE).
    const queued = [];
    for (let i = 0; i < 32; i++) {
      queued.push(PageScraper.scrape(`https://gate-q${i}.example/article`, CALL_TIMEOUT).catch((e) => e));
    }
    await sleep(50); // let waiters register
    const saturated = PageScraper.scrape('https://gate-overflow.example/article', CALL_TIMEOUT);
    await assert.rejects(saturated, (err) => err.name === 'ScrapePlaneQueueSaturated', 'queue overflow fails loudly');

    // Drain FIFO: resolve one request at a time (one gate slot each); every
    // queued caller eventually completes.
    const all = [...inFlight, ...queued];
    for (let round = 0; round < all.length; round++) {
      const drainDeadline = Date.now() + 10000;
      while (!gated.pending() && Date.now() < drainDeadline) await sleep(5);
      if (!gated.pending()) break;
      gated.resolveNext(articlePage('Gate'));
      await Promise.allSettled([all[round]]);
    }
    const settled = await Promise.all(all);
    for (const r of settled) {
      assert.ok(!(r instanceof Error), `no unexpected failures during drain: ${r?.message}`);
    }
    const ledger = scrapePlaneLedgerSnapshot();
    assert.equal(ledger.active, 0, 'gate fully released after drain');
    assert.ok(ledger.ledgered >= 36, `every admitted scrape ledgered (got ${ledger.ledgered})`);
  });
});
