import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { WideResearchAgent } from '../dist-electron/engine/wideAgent.js';
import { ParentResearchAgent, deriveFacetAssignments } from '../dist-electron/engine/parentAgent.js';
import { createResearchAgent } from '../dist-electron/engine/server.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const approvedPlan = {
  id: 'plan-88',
  version: 2,
  objective: 'Fusion energy',
  milestones: [
    { id: 'm1', query: 'fusion energy basics', rationale: 'core physics', status: 'pending' },
    { id: 'm2', query: 'tokamak benchmarks 2026', rationale: 'current state', status: 'pending' },
  ],
  suggestedSkills: [],
  status: 'approved',
};

function baseRequest(overrides = {}) {
  return {
    query: 'Fusion energy',
    report_type: 'quick',
    language: 'en',
    llm_provider: 'openai',
    model_name: 'test-model',
    api_keys: { openai: 'test-key' },
    search_provider: 'duckduckgo',
    embedding_enabled: false,
    plan: approvedPlan,
    ...overrides,
  };
}

async function makeFaux(reportText) {
  const ai = await pi();
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  // Approved plan → subqueries come from milestones, so exactly one LLM call
  // (final synthesis) happens per run.
  faux.setResponses([ai.fauxAssistantMessage(reportText)]);
  return faux;
}

const REPORT = '# Fusion Energy Report\n\nKey findings summarized.';

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
});

describe('ParentResearchAgent (ticket #88 — agency orchestrator seam)', () => {
  it('derives facet assignments 1:1 from the approved plan in plan order', () => {
    const assignments = deriveFacetAssignments(approvedPlan);
    assert.deepEqual(assignments, [
      { facetIndex: 0, facet: 'fusion energy basics' },
      { facetIndex: 1, facet: 'tokamak benchmarks 2026' },
    ]);
  });

  it('executes agency mode end-to-end: facets derived, todo plan tracked, lifecycle streamed (faux providers, no network)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new ParentResearchAgent('s-agency', (e) => emitted.push(e));
    await agent.run(baseRequest());

    // Lifecycle: one started + one completed telemetry event per facet.
    const telemetry = emitted.filter((e) => e.type === 'researcher_telemetry');
    assert.equal(telemetry.length, 4);
    assert.deepEqual(telemetry.map((e) => e.researcherTelemetry.phase), ['started', 'started', 'completed', 'completed']);
    assert.deepEqual(telemetry.map((e) => e.researcherTelemetry.facet), ['fusion energy basics', 'tokamak benchmarks 2026', 'fusion energy basics', 'tokamak benchmarks 2026']);
    for (const e of telemetry) {
      assert.equal(e.researcherTelemetry.role, 'primary');
      assert.equal(e.researcherTelemetry.counts.facetCount, 2);
      assert.match(e.researcherTelemetry.researcherId, /^researcher_s-agency_[12]$/);
    }

    // Todo plan is parent-owned engine truth surfaced as read-only projection:
    // tasks progress create(pending) → in_progress → completed.
    const startedProjection = telemetry[0].researcherTelemetry.todoProjection;
    assert.ok(Array.isArray(startedProjection) && startedProjection.length === 2, 'expected a two-task todo projection');
    assert.deepEqual(startedProjection.map((t) => t.status), ['in_progress', 'in_progress']);
    const completedProjection = telemetry.at(-1).researcherTelemetry.todoProjection;
    assert.deepEqual(completedProjection.map((t) => t.status), ['completed', 'completed']);

    // The run completes with the synthesized report.
    const finished = emitted.filter((e) => e.type === 'finished');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].report, REPORT);
    assert.equal(faux.state.callCount, 1, 'no replanning LLM call expected');
  });

  it('is byte-equivalent to the legacy loop on identical fixtures (final report + shared event backbone)', async () => {
    stubFetchEmpty();
    const emittedLegacy = [];
    const legacyFaux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => legacyFaux.provider });
    await new DeepResearchAgent('s-parity', (e) => emittedLegacy.push(e)).run(baseRequest());

    resetActiveCore();
    const emittedAgency = [];
    const agencyFaux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => agencyFaux.provider });
    await new ParentResearchAgent('s-parity', (e) => emittedAgency.push(e)).run(baseRequest());

    // 1. The final report event is byte-equivalent.
    const legacyFinished = emittedLegacy.find((e) => e.type === 'finished');
    const agencyFinished = emittedAgency.find((e) => e.type === 'finished');
    assert.ok(legacyFinished && agencyFinished);
    assert.equal(
      JSON.stringify(legacyFinished),
      JSON.stringify(agencyFinished),
      'finished event (report, sources, costs, reflections) must be byte-identical'
    );

    // 2. The assembled streamed report is byte-equivalent and matches the
    //    final report (streaming integrity) in both paths.
    const joinedOf = (events) => events.filter((e) => e.type === 'report_chunk').map((e) => e.chunk).join('');
    const legacyJoined = joinedOf(emittedLegacy);
    const agencyJoined = joinedOf(emittedAgency);
    assert.equal(agencyJoined, legacyJoined);
    assert.equal(legacyJoined, legacyFinished.report);
    assert.equal(agencyJoined, agencyFinished.report);

    // 3. The shared event backbone is identical after removing the additive
    //    agency-only orchestration events (researcher_telemetry + assignment
    //    status) and collapsing consecutive report_chunk runs — chunk
    //    boundaries are arrival-timing dependent, not part of the contract
    //    (the legacy loop itself is non-deterministic run-to-run).
    const backbone = (events) => events
      .filter(
        (e) => e.type !== 'researcher_telemetry'
          && !(e.type === 'status' && typeof e.message === 'string' && e.message.includes('agency mode'))
      )
      .map((e) => e.type)
      .reduce(
        (acc, t) => (acc.length > 0 && acc[acc.length - 1] === 'report_chunk' && t === 'report_chunk') ? acc : [...acc, t],
        []
      );
    assert.deepEqual(backbone(emittedAgency), backbone(emittedLegacy));
    assert.deepEqual(
      emittedAgency.filter((e) => e.type === 'subqueries').map((e) => e.subqueries),
      emittedLegacy.filter((e) => e.type === 'subqueries').map((e) => e.subqueries),
    );
  });

  it('requires an approved plan with milestones', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    const agent = new ParentResearchAgent('s-noplan', () => {});
    await assert.rejects(
      agent.run(baseRequest({ plan: undefined })),
      /approved research plan/i,
    );
  });
});

describe('Agency flag dormancy (server routing)', () => {
  it('defaults to the legacy agents; agency_mode only reroutes the standard loop; wide is never rerouted', () => {
    const standard = { query: 'Q', mode: 'standard' };
    assert.ok(createResearchAgent(standard, 's1', () => {}) instanceof DeepResearchAgent);

    const agency = { query: 'Q', mode: 'standard', agency_mode: true };
    assert.ok(createResearchAgent(agency, 's2', () => {}) instanceof ParentResearchAgent);

    const wide = { query: 'Q', mode: 'wide', agency_mode: true };
    assert.ok(createResearchAgent(wide, 's3', () => {}) instanceof WideResearchAgent);
  });

  it('forwards the skill activation manager into the parent so the delegated loop keeps skill activation', () => {
    const manager = { getPromptContext: () => '', getToolDefinition: () => ({}) };
    const agency = { query: 'Q', mode: 'standard', agency_mode: true };
    const parent = createResearchAgent(agency, 's4', () => {}, manager);
    assert.equal(parent.activationManager, manager);
  });
});

describe('Renderer contract tolerance (additive researcher_telemetry)', () => {
  it('mirrors the additive event in renderer types and keeps the App handler fall-through safe', async () => {
    const rendererTypes = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
    assert.match(rendererTypes, /'researcher_telemetry'/);
    assert.match(rendererTypes, /researcherTelemetry\?/);

    // The App consumes LiveEvents through an if/else chain (unknown types fall
    // through harmlessly), not an exhaustive switch — so an additive event
    // type cannot break the existing renderer.
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /switch\s*\(\s*payload\.type\s*\)/);
    assert.match(app, /payload\.type === 'finished'/);
  });
});
