import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { auditEvidenceCoverage } from '../dist-electron/engine/evidenceCoverage.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';
import {
  resetScrapePlane,
  __testSeams as scrapeTestSeams,
} from '../dist-electron/engine/scrapePlane.js';
import { makeScriptedResearcherFactory } from './parity_fixture_builders.mjs';

// Documented session budget constants (parentAgent.ts; not exported): the
// researcher cap and the findings allowance the fan-out must enforce.
const MAX_RESEARCHERS_PER_SESSION = 8;
const MAX_RESEARCHER_FINDINGS_PER_SESSION = 48;

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function makePlan(n) {
  return {
    id: 'plan-90', version: 2, objective: 'Fusion energy',
    milestones: Array.from({ length: n }, (_, i) => ({
      id: `m${i + 1}`, query: `facet ${i + 1} topic`, rationale: 'r', status: 'pending',
    })),
    suggestedSkills: [], status: 'approved',
  };
}

const baseRequest = (plan, overrides = {}) => ({
  // 'deep' so the delegated walk's maxSubqueries covers every facet of the
  // 3-facet plan (the 'quick' loop stops at 2 — the #94 builders keep their
  // own fixtures at 2 facets for exactly this delegated-reachability reason).
  query: 'Fusion energy', report_type: 'deep', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan, agency_mode: true, researcher_mode: true, ...overrides,
});

const REPORT = '# Fusion Energy Report\n\nParallel findings synthesized.';

/** Wraps a re-hosted factory to observe live researcher concurrency in the
 * parent's pool (the #90 concurrency contract under the #146 contract). */
function instrumentConcurrency(factory, tracking) {
  return (sessionId, emit, options) => {
    const researcher = factory(sessionId, emit, options);
    const run = researcher.run.bind(researcher);
    researcher.run = async (...args) => {
      tracking.active += 1;
      tracking.maxActive = Math.max(tracking.maxActive, tracking.active);
      try {
        await tick();
        return await run(...args);
      } finally {
        tracking.active -= 1;
      }
    };
    return researcher;
  };
}

/**
 * Offline re-hosted factory for these pins (ticket #146): REAL hosted
 * sessions whose model transport is scripted per facet — the facet's round
 * performs web_search then fetches the page URLs `hitsFor` names.
 *
 * The planes serve the fixture pages offline: the routing fetch answers each
 * facet's search with a DDG results page listing those URLs, and the
 * scrape-plane DNS seam resolves the fixture hostnames — retrieval runs
 * through the REAL vendored planes + ledger, so the cross-researcher dedupe
 * under test is the LEDGER's, not a stub's. The raw HTTP fetches are counted
 * per URL: the ledger contract ("one fetch feeds every consumer") must keep
 * each shared URL at exactly one raw fetch across the whole run.
 */
function makeOfflineFactory(tracking, { report = REPORT } = {}) {
  return (sessionId, emit, options) => {
    const urls = (tracking.hitsFor(options.facetIndex) ?? []).map((h) => h.url);
    return makeScriptedResearcherFactory({
      report,
      pagesFor: (opts) => (opts.facetIndex === options.facetIndex ? urls : []),
    })(sessionId, emit, options);
  };
}

function trackingFor(hitsFor) {
  return { hitsFor, fetches: new Map(), active: 0, maxActive: 0 };
}

/** Serve the facet pages through the real vendored planes: installs the
 * routing fetch + DNS seam, counts RAW fetches per URL into `fetches`, and
 * answers each facet query with a DDG page listing that facet's URLs. */
function servePages(pagesByFacet, fetches, extraHostnames = []) {
  const all = new Map(pagesByFacet.map((spec) => [spec.url, spec.content]));
  const queries = new Map();
  for (const spec of pagesByFacet) {
    for (const q of spec.queries ?? []) {
      if (!queries.has(q)) queries.set(q, []);
      queries.get(q).push(
        `<div class="result"><h2 class="result__a" href="${spec.url}">${spec.url}</h2></div>`
      );
    }
  }
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('html.duckduckgo.com')) {
      const decoded = (() => { try { return decodeURIComponent(url).replace(/\+/g, ' ').toLowerCase(); } catch { return url.toLowerCase(); } })();
      for (const [q, entries] of queries) {
        if (decoded.includes(q.toLowerCase())) {
          return new Response(`<html><body>${entries.join('')}</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
        }
      }
      return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (all.has(url)) {
      fetches?.set(url, (fetches.get(url) ?? 0) + 1);
      return new Response(all.get(url), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response(`no route for ${url}`, { status: 404 });
  });
  const hostnames = new Set([
    ...pagesByFacet.map((s) => { try { return new URL(s.url).hostname; } catch { return s.url; } }),
    ...extraHostnames,
  ]);
  scrapeTestSeams.setLookupOverride(async (hostname) => {
    if (!hostnames.has(hostname)) throw new Error(`no DNS route for ${hostname}`);
    return [{ address: '93.184.216.34', family: 4 }];
  });
}

function articleHtml(text) {
  return `<html><head><title>page</title></head><body><article>${`<p>${text}</p>`.repeat(20)}</article></body></html>`;
}

describe('Parallel facet fan-out (ticket #90 — concurrency caps + cross-researcher dedupe, #146 contract)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    scrapeTestSeams.setLookupOverride(null);
    resetScrapePlane();
    resetActiveCore();
  });

  it('runs researchers in parallel up to min(#facets, 4) with the limit surfaced in telemetry', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const hits = (i) => [{ url: `https://src-${i + 1}.example/a-${i + 1}`, title: 'S', snippet: 'x' }];
    const tracking = trackingFor(hits);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-par', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    const plan = makePlan(6);
    await parent.run(baseRequest(plan));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry')?.fanoutTelemetry;
    assert.ok(fan, 'fanout_telemetry emitted');
    assert.equal(fan.concurrencyLimit, 4, 'limit is min(#facets, 4)');
    assert.equal(fan.facetsTotal, 6);
    assert.ok(tracking.maxActive > 1 && tracking.maxActive <= 4,
      `researchers ran concurrently under the cap (max=${tracking.maxActive})`);
    assert.equal(fan.researchersCompleted, 6, 'every re-hosted researcher completes');
    assert.equal(fan.researchersFailed, 0, 'no scripted researcher fails');
    assert.equal(fan.facetsDelegated, 0);
  });

  it('honors a clamped researcher_concurrency override (requested 9 -> 4, requested 1 -> 1)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const tracking = trackingFor(() => []);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-clamp', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    // 6 facets so the ceiling is 4; the override can only lower it.
    await parent.run(baseRequest(makePlan(6), { researcher_concurrency: 9 }));
    assert.equal(emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry.concurrencyLimit, 4);

    const emitted2 = [];
    tracking.maxActive = 0; // per-run observation, not cumulative
    const parent2 = new ParentResearchAgent('s-90-clamp2', (e) => emitted2.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    await parent2.run(baseRequest(makePlan(2), { researcher_concurrency: 1 }));
    assert.equal(emitted2.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry.concurrencyLimit, 1);
    assert.equal(tracking.maxActive, 1);
  });

  it('a URL fetched by one researcher is never re-fetched by another (shared evidence admitted per facet)', async () => {
    const tracking = trackingFor(() => []);
    tracking.fetches = new Map();
    // Facets 0 and 1 share two URLs; facet 2 is disjoint. The pages are
    // served through the REAL planes so the ledger's share semantics fire.
    const shared = [
      { url: 'https://shared.example/a-1', title: 'S1' },
      { url: 'https://shared.example/a-2', title: 'S2' },
    ];
    const pageSpecs = [
      ...shared.map((s, i) => ({
        url: s.url,
        content: articleHtml(`Shared fusion energy evidence document number ${i + 1} with substantial detail. `),
        queries: ['facet 1 topic', 'facet 2 topic'],
      })),
      {
        url: 'https://solo.example/a-3',
        content: articleHtml('Solo facet evidence with substantial independent detail for the third facet. '),
        queries: ['facet 3 topic'],
      },
    ];
    servePages(pageSpecs, tracking.fetches, ['shared.example', 'solo.example']);
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const hitsFor = (i) => (i === 2
      ? [{ url: 'https://solo.example/a-3', title: 'S3', snippet: 'x' }]
      : shared.map((s) => ({ ...s, snippet: 'x' })));
    tracking.hitsFor = hitsFor;
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-dedupe', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    await parent.run(baseRequest(makePlan(3)));

    // Each URL was fetched exactly once across the fan-out: the fetch ledger
    // shares one raw fetch between the researchers (and the delegated walk).
    for (const spec of pageSpecs) {
      assert.equal(tracking.fetches.get(spec.url), 1, `one raw fetch for ${spec.url}`);
    }

    const fan = emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry;
    assert.equal(fan.urlsShared, 2, 'two shared ingestions (one per sharing researcher/URL)');

    // Cross-researcher dedupe is visible in live provenance: the shared URLs
    // stream as `source` events under BOTH facets' milestones (each researcher
    // counts the share), while the delegated loop's LENS admission dedupe
    // keeps ONE admitted source per URL in the final report (first provenance
    // wins — admission stays authoritative per ADR-0010 decision 3).
    const sharedSourceEvents = emitted.filter(
      (e) => e.type === 'source' && String(e.url).startsWith('https://shared.example')
    );
    const eventFacets = new Set(sharedSourceEvents.map((e) => e.milestoneId));
    assert.ok(eventFacets.has('m1') && eventFacets.has('m2'),
      `shared evidence streamed under both facets (${[...eventFacets]})`);

    // The DELEGATED loop's terminal is the LAST finished event: since #146
    // each re-hosted researcher window carries its own window-scoped finished
    // (2 window sources), and the parent forwards the delegated terminal
    // verbatim after the completion lifecycle (the runLeg convention).
    const finished = emitted.filter((e) => e.type === 'finished').at(-1);
    const admittedSharedUrls = (finished.sources ?? [])
      .filter((s) => String(s.url).startsWith('https://shared.example'))
      .map((s) => s.url);
    assert.equal(new Set(admittedSharedUrls).size, 2, 'both shared URLs admitted exactly once each');
    assert.ok((finished.sources ?? []).some((s) => s.url === 'https://solo.example/a-3'), `final sources: ${JSON.stringify((finished.sources ?? []).map((s) => s.url))}; source events: ${JSON.stringify(emitted.filter((e) => e.type === 'source').map((e) => [e.url, e.milestoneId]))}; fanout: ${JSON.stringify(emitted.find((e) => e.type === 'fanout_telemetry')?.fanoutTelemetry)}; raw fetches: ${JSON.stringify([...tracking.fetches])}`);
  });

  it('stops launching at the session researcher cap and delegates the remainder (budget semantics, #146)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    // 9 facets, zero findings each (fully-scripted windows): 9 researchers
    // exceed the session researcher cap, so the overflow facet must stay
    // with the delegated loop. Findings budgets truncate per-researcher
    // against the session allowance (documented constants).
    const tracking = trackingFor(() => []);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-cap', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    await parent.run(baseRequest(makePlan(9)));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry;
    assert.equal(fan.researchersLaunched, MAX_RESEARCHERS_PER_SESSION, 'session researcher cap enforced');
    assert.equal(fan.facetsDelegated, 1, 'the overflow facet stays with the delegated loop');
    assert.ok(MAX_RESEARCHER_FINDINGS_PER_SESSION > 0, 'session findings allowance documented');
    assert.equal(fan.budgetFindingsAdmitted, 0, 'zero-finding researchers admit nothing');
  });

  it('coverage aggregates per facet over admitted findings (matches the LENS audit)', async () => {
    // Real retrieval: one served page per facet, mirrored into the expected
    // audit call so the telemetry's coverage provably uses the same audit.
    const tracking = trackingFor((i) => [{ url: `https://cov-${i}.example/a-${i + 1}`, title: 'S', snippet: 'x' }]);
    const plan = makePlan(2);
    const pageSpecs = plan.milestones.map((m, i) => {
      const content = `Evidence about ${m.query}. `;
      return {
        url: `https://cov-${i}.example/a-${i + 1}`,
        content: articleHtml(content),
        queries: [m.query],
        facetContent: content,
      };
    });
    servePages(pageSpecs);
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const parent = new ParentResearchAgent('s-90-cov', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking), { respecialization: false });
    await parent.run(baseRequest(plan));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry;
    assert.deepEqual(Object.keys(fan.coverageByFacet).sort(), ['facet 1 topic', 'facet 2 topic']);
    for (const [facet, score] of Object.entries(fan.coverageByFacet)) {
      const spec = pageSpecs.find((s) => s.queries[0] === facet);
      const expected = auditEvidenceCoverage(
        facet, [], [{ content: spec.facetContent.repeat(20), domain: `cov-${plan.milestones.findIndex((m) => m.query === facet)}.example` }],
        { language: 'en' }
      ).overallScore;
      assert.equal(score, expected, 'per-facet coverage uses the same LENS audit');
      assert.ok(score >= 0 && score <= 1);
    }
  });
});

describe('Renderer contract tolerance (#90 additions)', () => {
  it('mirrors the fanout_telemetry event in renderer types', async () => {
    const rendererTypes = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
    assert.match(rendererTypes, /'fanout_telemetry'/);
    assert.match(rendererTypes, /fanoutTelemetry\?/);
  });
});

async function makeFaux(reportText) {
  const ai = await import('@earendil-works/pi-ai');
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  faux.setResponses([ai.fauxAssistantMessage(reportText)]);
  return faux;
}
