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
import { ResearcherAgent } from '../dist-electron/engine/researcherAgent.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;
function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const REPORT = '# Fusion Energy Report\n\nFindings synthesized.';

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

describe('Role flow through the agency run (offline e2e)', () => {
  afterEach(() => {
    resetActiveCore();
    globalThis.fetch = realFetch;
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
    const parent = new ParentResearchAgent('s-93', (e) => emitted.push(e), undefined,
      (sessionId, emit, options) => {
        rolesSeen.push([options.facetIndex, options.role]);
        return new ResearcherAgent(sessionId, emit, {
          ...options,
          toolPackages: false,
          searchFn: async () => [],
        });
      });
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
    const parent = new ParentResearchAgent('s-93-rs', (e) => emitted.push(e), undefined,
      (sessionId, emit, options) => {
        runsByRole.push(options.role);
        return new ResearcherAgent(sessionId, emit, {
          ...options,
          toolPackages: false,
          // Facet 0's first pass finds nothing (deficit); the re-specialized
          // follow-up (role mapped by deficit kind) finds two sources.
          searchFn: async () => (options.role === 'technical'
            ? [
                { url: 'https://rs-1.example/a', title: 'RS1', snippet: 'x' },
                { url: 'https://rs-2.example/b', title: 'RS2', snippet: 'x' },
              ]
            : []),
          scrapeFn: async (url) => ({
            url,
            title: url,
            domain: new URL(url).hostname,
            content: `Respecialized evidence for the facet with poor coverage. `.repeat(10),
            credibilityScore: 80,
          }),
        });
      });
    await parent.run(baseRequest(plan, { researcher_mode: true }));

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
    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'run completes');
    const rsSources = (finished.sources ?? []).filter((s) => String(s.url).includes('rs-'));
    assert.ok(rsSources.length >= 2, `respecialized findings in report sources (got ${rsSources.length})`);
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
    const parent = new ParentResearchAgent('s-93-cap', (e) => emitted.push(e), undefined,
      (sessionId, emit, options) => {
        launched.push(options.researcherId);
        return new ResearcherAgent(sessionId, emit, {
          ...options,
          toolPackages: false,
          searchFn: async () => [], // everyone finds nothing -> all deficits
        });
      });
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
