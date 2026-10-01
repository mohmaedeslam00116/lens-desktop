import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  RESEARCHER_ROLES,
  selectRoleForFacet,
  assignRoles,
  roleBrief,
  planRespecialization,
  ROLE_LABELS,
} from '../dist-electron/engine/researcherRoles.js';
import { tokenizeBilingual } from '../dist-electron/engine/bm25.js';
import { deriveFacetAssignments, ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';
import {
  resetScrapePlane,
  __testSeams as scrapeTestSeams,
} from '../dist-electron/engine/scrapePlane.js';
import { makeScriptedResearcherFactory } from './parity_fixture_builders.mjs';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;
function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const REPORT = '# Fusion Energy Report\n\nFindings synthesized.';

/** Serve the respecialization pages through the real vendored planes (the
 * re-hosted researchers retrieve through them; DNS seam included). */
function servePages(pages) {
  const all = new Map(pages.map((s) => [s.url, s.content]));
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('html.duckduckgo.com')) {
      const decoded = (() => { try { return decodeURIComponent(url).replace(/\+/g, ' ').toLowerCase(); } catch { return url.toLowerCase(); } })();
      for (const s of pages) {
        if (s.queries.some((q) => decoded.includes(q.toLowerCase()))) {
          const entries = pages
            .filter((p) => p.queries.some((q) => decoded.includes(q.toLowerCase())))
            .map((p) => `<div class="result"><h2 class="result__a" href="${p.url}">${p.url}</h2></div>`);
          return new Response(`<html><body>${entries.join('')}</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
        }
      }
      return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (all.has(url)) return new Response(all.get(url), { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(`no route for ${url}`, { status: 404 });
  });
  const hostnames = new Set(pages.map((s) => { try { return new URL(s.url).hostname; } catch { return s.url; } }));
  scrapeTestSeams.setLookupOverride(async (hostname) => {
    if (!hostnames.has(hostname)) throw new Error(`no DNS route for ${hostname}`);
    return [{ address: '93.184.216.34', family: 4 }];
  });
}

function articleHtml(text) {
  return `<html><head><title>page</title></head><body><article>${`<p>${text}</p>`.repeat(20)}</article></body></html>`;
}

function planWith(milestones) {
  return {
    id: 'plan-93', version: 2, objective: 'Fusion energy',
    milestones: milestones.map(([id, query]) => ({ id, query, rationale: 'r', status: 'pending' })),
    suggestedSkills: [], status: 'approved',
  };
}

const baseRequest = (plan, overrides = {}) => ({
  query: 'Fusion energy', report_type: 'quick', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan, agency_mode: true, ...overrides,
});

describe('Closed 5-role catalog (ticket #93 — ADR-0010 decision 5)', () => {
  it('exposes exactly the ADR catalog roles in stable order', () => {
    assert.deepEqual([...RESEARCHER_ROLES], ['primary', 'technical', 'opposing', 'recent_news', 'source_verifier']);
    for (const role of RESEARCHER_ROLES) {
      assert.ok(ROLE_LABELS[role].en && ROLE_LABELS[role].ar, `bilingual labels for ${role}`);
    }
  });

  it('selects roles deterministically from facet keywords (same input, same role)', () => {
    const cases = [
      ['transformer architecture and algorithm performance benchmarks', 'technical'],
      ['criticism risks limitations and drawbacks of fusion', 'opposing'],
      ['latest news updates and 2026 announcements', 'recent_news'],
      ['verify credibility and validate source accuracy', 'source_verifier'],
      ['fusion energy overview', 'primary'],
    ];
    for (const [facet, expected] of cases) {
      assert.equal(selectRoleForFacet(facet, tokenizeBilingual), expected, facet);
      // Determinism: same facet, same role on a repeat call.
      assert.equal(selectRoleForFacet(facet, tokenizeBilingual), expected);
    }
  });

  it('is bilingual: Arabic facets select the same roles as their English equivalents', () => {
    assert.equal(selectRoleForFacet('نقد المخاطر والقيود', tokenizeBilingual), 'opposing');
    assert.equal(selectRoleForFacet('أحدث التطورات والمستجدات', tokenizeBilingual), 'recent_news');
    assert.equal(selectRoleForFacet('معايير الأداء والخوارزميات', tokenizeBilingual), 'technical');
    assert.equal(selectRoleForFacet('التحقق من مصداقية المصادر', tokenizeBilingual), 'source_verifier');
  });

  it('assignRoles covers every plan facet in plan order', () => {
    const plan = planWith([
      ['m1', 'fusion energy overview'],
      ['m2', 'reactor architecture benchmarks'],
      ['m3', 'criticism and risks'],
    ]);
    const roles = assignRoles(plan, tokenizeBilingual);
    assert.equal(roles.length, 3);
    assert.deepEqual(roles, ['primary', 'technical', 'opposing']);
    // deriveFacetAssignments tags each assignment with its role.
    const assignments = deriveFacetAssignments(plan);
    assert.deepEqual(assignments.map((a) => a.role), roles);
  });

  it('roleBrief parameterizes prompts bilingually', () => {
    assert.match(roleBrief('technical', 'en'), /Technical deep-dive specialist/);
    assert.match(roleBrief('opposing', 'ar'), /الآراء المستقلة والمضادة/);
  });

  it('planRespecialization maps deficit kind to follow-up roles, bounded by the cap', () => {
    const facetRoles = [
      { facetIndex: 0, facet: 'f0', role: 'technical' },
      { facetIndex: 1, facet: 'f1', role: 'source_verifier' },
      { facetIndex: 2, facet: 'f2', role: 'primary' },
      { facetIndex: 3, facet: 'f3', role: 'opposing' },
      { facetIndex: 4, facet: 'f4', role: 'recent_news' },
      { facetIndex: 5, facet: 'f5', role: 'primary' },
    ];
    const coverageByFacet = {
      f0: 0.3, // technical deficit -> source_verifier
      f1: 0.0, // verifier deficit -> primary retry
      f2: 0.2, // primary deficit -> technical deep-dive
      f3: 0.8, // covered — skipped
      f4: 0.4, // deficit -> technical
      f5: 0.1, // deficit -> technical
    };
    const proposals = planRespecialization({ coverageByFacet, facetRoles, existingRoleCounts: {}, maxRespecializations: 4 });
    assert.equal(proposals.length, 4, 'capped at maxRespecializations');
    // Facet 3 (0.8) is covered and skipped; the cap stops before facet 5.
    assert.deepEqual(proposals.map((p) => [p.facetIndex, p.role]), [
      [0, 'source_verifier'],
      [1, 'primary'],
      [2, 'technical'],
      [4, 'technical'],
    ]);
    for (const p of proposals) assert.match(p.reason, /coverage deficit/);
  });

  it('planRespecialization skips fully covered facets and yields nothing when coverage is healthy', () => {
    const facetRoles = [{ facetIndex: 0, facet: 'f0', role: 'primary' }];
    assert.deepEqual(
      planRespecialization({ coverageByFacet: { f0: 0.9 }, facetRoles, existingRoleCounts: {} }),
      []
    );
  });
});

describe('Role flow through the agency run (offline e2e, #146 re-hosted contract)', () => {
  afterEach(() => {
    resetActiveCore();
    globalThis.fetch = realFetch;
    scrapeTestSeams.setLookupOverride(null);
    resetScrapePlane();
  });

  it('role_selected telemetry precedes lifecycle; researchers receive their roles; identical plans select identically', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const rolesSeen = [];
    const emitted = [];
    const plan = planWith([
      ['m1', 'fusion energy overview'],
      ['m2', 'reactor architecture benchmarks'],
      ['m3', 'criticism and risks'],
    ]);
    // Re-hosted scripted researchers (ticket #146): REAL hosted sessions with
    // scripted transports and no retrieval — the role ASSIGNMENT flow is the
    // contract under test, and respecialization stays enabled so the
    // zero-coverage facets earn their bounded follow-ups.
    const factory = (sessionId, emit, options) => {
      rolesSeen.push([options.facetIndex, options.role]);
      return makeScriptedResearcherFactory({ report: REPORT, pagesFor: () => [] })(sessionId, emit, options);
    };
    const parent = new ParentResearchAgent('s-93', (e) => emitted.push(e), undefined, factory);
    await parent.run(baseRequest(plan, { researcher_mode: true }));

    // Deterministic selection surfaced in telemetry before lifecycle events.
    // (All facets find nothing in this fixture, so each also earns a
    // respecialization follow-up role_selected event — filtered here.)
    const roleEvents = emitted.filter(
      (e) => e.type === 'researcher_telemetry' && e.researcherTelemetry.phase === 'role_selected'
    );
    const initialRoles = roleEvents.filter((e) => !e.researcherTelemetry.counts?.respecialization);
    assert.equal(initialRoles.length, 3);
    assert.deepEqual(initialRoles.map((e) => e.researcherTelemetry.role), ['primary', 'technical', 'opposing']);
    const respecialized = roleEvents.filter((e) => e.researcherTelemetry.counts?.respecialization);
    assert.equal(respecialized.length, 3, 'zero-coverage facets earn bounded follow-ups');
    const firstLifecycle = emitted.findIndex(
      (e) => e.type === 'researcher_telemetry' && e.researcherTelemetry.phase === 'started'
    );
    assert.ok(firstLifecycle > emitted.findIndex((e) => e.researcherTelemetry?.phase === 'role_selected'));

    // Researchers were parameterized with their roles: the initial three
    // launches in plan order, then the three re-specialization follow-ups
    // (zero-coverage deficits) with their mapped roles.
    assert.deepEqual(rolesSeen.slice(0, 3), [[0, 'primary'], [1, 'technical'], [2, 'opposing']]);
    assert.deepEqual(rolesSeen.slice(3), [[0, 'technical'], [1, 'primary'], [2, 'primary']]);

    // Identical plan -> identical selection (deterministic).
    const again = deriveFacetAssignments(plan);
    assert.deepEqual(again.map((a) => a.role), ['primary', 'technical', 'opposing']);
  });

  it('respecialization runs for deficit facets within budget; findings merge into the facet pool', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    // 1 synthesis response; researchers run fully offline.
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const runsByRole = [];
    const plan = planWith([['m1', 'a facet with poor coverage']]);
    // Re-hosted scripted researchers (ticket #146): the first pass searches
    // a query with no served results (deficit); the re-specialized follow-up
    // (role mapped by deficit kind: primary -> technical) searches a query
    // whose DDG page lists the two rs-* URLs — served through the REAL
    // planes, fetched through the session ledger.
    const pageSpecs = [
      { url: 'https://rs-1.example/a', content: articleHtml('Respecialized evidence for the facet with poor coverage. '), queries: ['respecialization retrieval query'] },
      { url: 'https://rs-2.example/b', content: articleHtml('Respecialized evidence for the facet with poor coverage. '), queries: ['respecialization retrieval query'] },
    ];
    servePages(pageSpecs);
    const factory = (sessionId, emit, options) => {
      runsByRole.push(options.role);
      return makeScriptedResearcherFactory({
        report: REPORT,
        pagesFor: (opts) => (opts.role === 'technical' ? pageSpecs.map((s) => s.url) : []),
        searchQueryFor: (opts) => (opts.role === 'technical' ? 'respecialization retrieval query' : 'a query with no served results'),
      })(sessionId, emit, options);
    };
    // The engine hands each decorator the researcher's OWN brief, so the
    // scripted transport recognizes the window's opening turn verbatim and a
    // custom `searchQueryFor` never couples to the brief's wording (#146).
    const parent = new ParentResearchAgent('s-93-rs', (e) => emitted.push(e), undefined, factory);
    await parent.run(baseRequest(plan, { researcher_mode: true }));
    console.log('RS-TRACE:', emitted.map((e) => e.type).join(','));

    // First pass: primary (no hits). Re-specialization: primary deficit ->
    // technical follow-up, which returns two merged findings.
    assert.deepEqual(runsByRole, ['primary', 'technical']);
    const respecializationEvents = emitted.filter(
      (e) => e.type === 'researcher_telemetry' && e.researcherTelemetry.counts?.respecialization
    );
    assert.equal(respecializationEvents.length, 1);
    assert.equal(respecializationEvents[0].researcherTelemetry.role, 'technical');
    assert.match(respecializationEvents[0].researcherTelemetry.counts.rationale, /coverage deficit/);

    // Merged findings entered the delegated pool with the facet's provenance.
    // The delegated terminal is the LAST finished event (since #146 each
    // re-hosted researcher window carries its own window-scoped finished).
    const finished = emitted.filter((e) => e.type === 'finished').at(-1);
    assert.ok(finished, 'run completes');
    const finishedSources = finished.sources ?? [];
    // Both respecialized pages merged (the fixture serves two hosts).
    const rsSources = finishedSources.filter(
      (s) => String(s.url).startsWith('https://rs-1.example') || String(s.url).startsWith('https://rs-2.example')
    );
    assert.ok(
      rsSources.length >= 2,
      `respecialized findings missing from the final pool: ${JSON.stringify(finishedSources.map((s) => s.url))}`
    );
    for (const s of rsSources) assert.ok(s.milestoneId, 'provenance preserved');
  });

  it('respecialization is bounded by the session researcher budget', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const launched = [];
    const plan = planWith(Array.from({ length: 8 }, (_, i) => [`m${i + 1}`, `deficit facet ${i + 1} overview`]));
    // Re-hosted scripted researchers (ticket #146): fully-scripted windows
    // that find nothing -> every facet is a deficit -> the budget binds.
    const factory = (sessionId, emit, options) => {
      launched.push(options.researcherId);
      return makeScriptedResearcherFactory({ report: REPORT, pagesFor: () => [] })(sessionId, emit, options);
    };
    const parent = new ParentResearchAgent('s-93-cap', (e) => emitted.push(e), undefined, factory);
    await parent.run(baseRequest(plan, { researcher_mode: true }));

    // 8 facets reach the session cap of 8 researchers; no re-specialization
    // researcher may exceed it.
    const initialPasses = 8;
    assert.ok(launched.length <= 8 + 0, `budget bounds total launches (${launched.length})`);
    assert.equal(launched.filter((id) => id.includes('_rs')).length, 0, 'no rs researcher when the budget is exhausted by the first pass');
    void initialPasses;
  });
});

describe('Renderer contract tolerance (#93 additions)', () => {
  it('mirrors role_selected phase and respecialization fields in renderer types', async () => {
    const rendererTypes = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
    assert.match(rendererTypes, /'role_selected'/);
    assert.match(rendererTypes, /respecialization\?: boolean/);
  });
});
