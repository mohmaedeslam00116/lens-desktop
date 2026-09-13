import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { ResearcherAgent } from '../dist-electron/engine/researcherAgent.js';
import { auditEvidenceCoverage } from '../dist-electron/engine/evidenceCoverage.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function page(i, milestoneId, milestoneTitle) {
  return {
    url: `https://src-${i}.example/a-${i}`,
    title: `Source ${i}`,
    domain: `src-${i}.example`,
    content: `Evidence ${i} about ${milestoneTitle}. `.repeat(20),
    credibilityScore: 85,
    milestoneId,
    milestoneTitle,
  };
}

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
  query: 'Fusion energy', report_type: 'quick', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan, agency_mode: true, researcher_mode: true, ...overrides,
});

const REPORT = '# Fusion Energy Report\n\nParallel findings synthesized.';

/** Offline researcher factory: counts scrape fetches per URL and tracks
 * researcher concurrency through the parent's pool. */
function makeOfflineFactory(tracking) {
  return (sessionId, emit, options) => {
    return new ResearcherAgent(sessionId, emit, {
      ...options,
      toolPackages: false,
      searchFn: async (q) => (tracking.hitsFor(options.facetIndex) ?? []),
      scrapeFn: async (url) => {
        tracking.fetches.set(url, (tracking.fetches.get(url) ?? 0) + 1);
        await tick(); // keep the fetch in-flight so overlap is deterministic
        // Deterministic offline scrape: echoes the fetched URL so dedupe keys
        // are observable, with the facet's milestone provenance.
        return {
          url,
          title: `Source ${url}`,
          domain: new URL(url).hostname,
          content: `Evidence about ${options.milestoneTitle}. `.repeat(20),
          credibilityScore: 85,
          milestoneId: options.milestoneId,
          milestoneTitle: options.milestoneTitle,
        };
      },
    });
  };
}

function trackingFor(hitsFor) {
  return { hitsFor, fetches: new Map(), active: 0, maxActive: 0 };
}

/** Wraps a factory to observe live researcher concurrency in the pool. */
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

async function makeFaux(reportText) {
  const ai = await pi();
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  faux.setResponses([ai.fauxAssistantMessage(reportText)]);
  return faux;
}

describe('Parallel facet fan-out (ticket #90 — concurrency caps + cross-researcher dedupe)', () => {
  it('runs researchers in parallel up to min(#facets, 4) with the limit surfaced in telemetry', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const hits = (i) => [{ url: `https://src-${i + 1}.example/a-${i + 1}`, title: 'S', snippet: 'x' }];
    const tracking = trackingFor((i) => hits(i));
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-par', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    const plan = makePlan(6);
    await parent.run(baseRequest(plan));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry')?.fanoutTelemetry;
    assert.ok(fan, 'fanout_telemetry emitted');
    assert.equal(fan.concurrencyLimit, 4, 'limit is min(#facets, 4)');
    assert.equal(fan.facetsTotal, 6);
    assert.ok(tracking.maxActive > 1 && tracking.maxActive <= 4,
      `researchers ran concurrently under the cap (max=${tracking.maxActive})`);
    assert.equal(fan.researchersCompleted, 6);
    assert.equal(fan.facetsDelegated, 0);
  });

  it('honors a clamped researcher_concurrency override (requested 9 -> 4, requested 1 -> 1)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const tracking = trackingFor(() => []);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-clamp', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    // 6 facets so the ceiling is 4; the override can only lower it.
    await parent.run(baseRequest(makePlan(6), { researcher_concurrency: 9 }));
    assert.equal(emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry.concurrencyLimit, 4);

    const emitted2 = [];
    tracking.maxActive = 0; // per-run observation, not cumulative
    const parent2 = new ParentResearchAgent('s-90-clamp2', (e) => emitted2.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    await parent2.run(baseRequest(makePlan(2), { researcher_concurrency: 1 }));
    assert.equal(emitted2.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry.concurrencyLimit, 1);
    assert.equal(tracking.maxActive, 1);
  });

  it('a URL fetched by one researcher is never re-fetched by another (shared evidence admitted per facet)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    // Facets 0 and 1 share two URLs; facet 2 is disjoint.
    const shared = [
      { url: 'https://shared.example/a-1', title: 'S1', snippet: 'x' },
      { url: 'https://shared.example/a-2', title: 'S2', snippet: 'x' },
    ];
    const hitsFor = (i) => (i === 2 ? [{ url: 'https://solo.example/a-3', title: 'S3', snippet: 'x' }] : shared);
    const tracking = trackingFor(hitsFor);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-dedupe', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    await parent.run(baseRequest(makePlan(3)));

    // Each URL was fetched exactly once across the fan-out.
    assert.equal(tracking.fetches.get('https://shared.example/a-1'), 1);
    assert.equal(tracking.fetches.get('https://shared.example/a-2'), 1);
    assert.equal(tracking.fetches.get('https://solo.example/a-3'), 1);

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

    const finished = emitted.find((e) => e.type === 'finished');
    const admittedSharedUrls = (finished.sources ?? [])
      .filter((s) => String(s.url).startsWith('https://shared.example'))
      .map((s) => s.url);
    assert.equal(new Set(admittedSharedUrls).size, 2, 'both shared URLs admitted exactly once each');
    assert.ok((finished.sources ?? []).some((s) => s.url === 'https://solo.example/a-3'));
  });

  it('stops launching at the session researcher cap and delegates the remainder; findings truncate to the session allowance', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    // 9 facets, 8 findings each: 9 researchers exceed the session cap of 8,
    // and 8x8=64 findings exceed the 48-finding session allowance.
    const hitsFor = () => Array.from({ length: 8 }, (_, k) => ({
      url: `https://cap.example/a-${k + 1}`, title: `S${k + 1}`, snippet: 'x',
    }));
    const tracking = trackingFor(hitsFor);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-cap', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    await parent.run(baseRequest(makePlan(9)));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry;
    assert.equal(fan.researchersLaunched, 8, 'session researcher cap enforced');
    assert.equal(fan.facetsDelegated, 1, 'the overflow facet stays with the delegated loop');
    assert.equal(fan.budgetFindingsAdmitted, 48, 'session findings allowance enforced exactly');
  });

  it('coverage aggregates per facet over admitted findings (matches the LENS audit)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const tracking = trackingFor((i) => [{ url: `https://cov-${i}.example/a-${i + 1}`, title: 'S', snippet: 'x' }]);
    const emitted = [];
    const parent = new ParentResearchAgent('s-90-cov', (e) => emitted.push(e), undefined,
      instrumentConcurrency(makeOfflineFactory(tracking), tracking));
    const plan = makePlan(2);
    await parent.run(baseRequest(plan));

    const fan = emitted.find((e) => e.type === 'fanout_telemetry').fanoutTelemetry;
    assert.deepEqual(Object.keys(fan.coverageByFacet).sort(), ['facet 1 topic', 'facet 2 topic']);
    for (const [facet, score] of Object.entries(fan.coverageByFacet)) {
      const expected = auditEvidenceCoverage(
        facet, [], [{ content: `Evidence about ${facet}. `.repeat(20), domain: 'cov.example' }],
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
