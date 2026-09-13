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

async function makeFaux(reportText, { withSubqueries = false } = {}) {
  const ai = await pi();
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  // Approved plan → subqueries come from milestones, so exactly one LLM call
  // (final synthesis) happens per run. Plan-less runs make a subqueries call
  // first.
  const queued = [];
  if (withSubqueries) {
    queued.push(ai.fauxAssistantMessage('["fusion energy basics", "tokamak benchmarks 2026"]'));
  }
  queued.push(ai.fauxAssistantMessage(reportText));
  faux.setResponses(queued);
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
      { facetIndex: 0, facet: 'fusion energy basics', role: 'primary' },
      { facetIndex: 1, facet: 'tokamak benchmarks 2026', role: 'technical' },
    ]);
  });

  it('executes agency mode end-to-end: facets derived, todo plan tracked, lifecycle streamed (faux providers, no network)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new ParentResearchAgent('s-agency', (e) => emitted.push(e));
    await agent.run(baseRequest());

    // Lifecycle: one role_selected + one started + one completed per facet
    // (role selection precedes the assignment lifecycle, #93).
    const telemetry = emitted.filter((e) => e.type === 'researcher_telemetry');
    assert.equal(telemetry.length, 6);
    assert.deepEqual(telemetry.map((e) => e.researcherTelemetry.phase), ['role_selected', 'role_selected', 'started', 'started', 'completed', 'completed']);
    assert.deepEqual(telemetry.map((e) => e.researcherTelemetry.facet), ['fusion energy basics', 'tokamak benchmarks 2026', 'fusion energy basics', 'tokamak benchmarks 2026', 'fusion energy basics', 'tokamak benchmarks 2026']);
    for (const e of telemetry) {
      const expectedRole = e.researcherTelemetry.facet === 'tokamak benchmarks 2026' ? 'technical' : 'primary';
      assert.equal(e.researcherTelemetry.role, expectedRole);
      assert.equal(e.researcherTelemetry.counts.facetCount, 2);
      assert.match(e.researcherTelemetry.researcherId, /^researcher_s-agency_[12]$/);
    }

    // Todo plan is parent-owned engine truth surfaced as read-only projection:
    // tasks progress create(pending) → in_progress → completed.
    const startedProjection = telemetry.find((e) => e.researcherTelemetry.phase === 'started')
      .researcherTelemetry.todoProjection;
    assert.ok(Array.isArray(startedProjection) && startedProjection.length === 2, 'expected a two-task todo projection');
    assert.deepEqual(startedProjection.map((t) => t.status), ['in_progress', 'in_progress']);
    const completedProjection = telemetry.at(-1).researcherTelemetry.todoProjection;
    assert.deepEqual(completedProjection.map((t) => t.status), ['completed', 'completed']);

    // Completion lifecycle must land BEFORE the terminal finished event:
    // consumers that close the stream on finished must still see it.
    const finishedIndex = emitted.findIndex((e) => e.type === 'finished');
    const lastCompletedIndex = emitted.map((e) => e.type).lastIndexOf('researcher_telemetry');
    assert.ok(lastCompletedIndex < finishedIndex, 'completed telemetry must precede finished');

    // The run completes with the synthesized report (plus the advisory audit
    // section — ticket #91 makes it part of the report contract).
    const finished = emitted.filter((e) => e.type === 'finished');
    assert.equal(finished.length, 1);
    assert.ok(finished[0].report.startsWith(REPORT));
    assert.match(finished[0].report, /## Evidence Audit/);
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
    //    final report (streaming integrity) in both paths (the advisory audit
    //    section is part of the report in both — ticket #91).
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

  it('requires an approved plan with milestones (explicit agency request)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    const agent = new ParentResearchAgent('s-noplan', () => {});
    await assert.rejects(
      agent.run(baseRequest({ plan: undefined, agency_mode: true })),
      /approved research plan/i,
    );
  });

  it('rejects plans whose status is not approved (pending/rejected plans never drive agency execution)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    const emitted = [];
    const agent = new ParentResearchAgent('s-unapproved', (e) => emitted.push(e));
    await assert.rejects(
      agent.run(baseRequest({ plan: { ...approvedPlan, status: 'pending' }, agency_mode: true })),
      /approved research plan/i,
    );
    await assert.rejects(
      agent.run(baseRequest({ plan: { ...approvedPlan, status: 'rejected' }, agency_mode: true })),
      /approved research plan/i,
    );
    assert.equal(emitted.length, 0, 'no events may be emitted for an unapproved plan');
  });

  it('returns abandoned facet tasks to pending when the run is aborted (no stale in_progress)', async () => {
    stubFetchEmpty();
    const controller = new AbortController();
    const emitted = [];
    const agent = new ParentResearchAgent('s-abort-cleanup', (e) => {
      emitted.push(e);
      // Abort synchronously on the first started telemetry: the delegated run
      // observes the aborted signal and never executes.
      if (e.type === 'researcher_telemetry' && e.researcherTelemetry.phase === 'started') {
        controller.abort();
      }
    });
    await agent.run(baseRequest(), controller.signal);

    // The delegated loop must not have produced a report stream, and the
    // lifecycle must stop at the first started event (no telemetry for the
    // remaining facets after the callback aborted the signal). Ticket #93:
    // the role_selected events for the plan's facets precede the started
    // lifecycle, so they are part of the pre-abort telemetry.
    assert.equal(emitted.filter((e) => e.type === 'report_chunk').length, 0);
    assert.equal(emitted.filter((e) => e.type === 'researcher_telemetry').length, 3);
    // Store-level truth: abandoned tasks are back to pending — no stale
    // in_progress survives the cancellation.
    const { loadTodoPlanStore } = await import('../dist-electron/engine/piPackages.js');
    const store = await loadTodoPlanStore('s-abort-cleanup');
    const projection = store.projection();
    assert.equal(projection.length, 2);
    assert.ok(projection.every((t) => t.status === 'pending'), `expected all pending, got ${JSON.stringify(projection.map((t) => t.status))}`);
  });
});

describe('Agency default flip (ADR-0012, ticket #95 — server routing)', () => {
  it('routes the standard loop to the agency path by default; legacy_mode is the escape hatch; wide is never rerouted', () => {
    // Default standard run → agency path (the flip).
    const standard = { query: 'Q', mode: 'standard' };
    assert.ok(createResearchAgent(standard, 's1', () => {}) instanceof ParentResearchAgent);

    // Escape hatch: request flag restores the legacy single-loop.
    const legacy = { query: 'Q', mode: 'standard', legacy_mode: true };
    assert.ok(createResearchAgent(legacy, 's2', () => {}) instanceof DeepResearchAgent);

    // Wide is never rerouted — default or not.
    const wide = { query: 'Q', mode: 'wide' };
    assert.ok(createResearchAgent(wide, 's3', () => {}) instanceof WideResearchAgent);
    const wideLegacy = { query: 'Q', mode: 'wide', agency_mode: true };
    assert.ok(createResearchAgent(wideLegacy, 's3b', () => {}) instanceof WideResearchAgent);

    // Explicit agency opt-in still routes to the parent.
    const agency = { query: 'Q', mode: 'standard', agency_mode: true };
    assert.ok(createResearchAgent(agency, 's4', () => {}) instanceof ParentResearchAgent);
  });

  it('resolves the escape flag: request flag wins over the settings default', () => {
    // Settings alone can restore the legacy loop.
    const fromSettings = { query: 'Q', mode: 'standard' };
    assert.ok(
      createResearchAgent(fromSettings, 's5', () => {}, undefined, { legacyMode: true })
        instanceof DeepResearchAgent
    );
    // An explicit request flag beats settings (false → agency despite settings).
    const requestWins = { query: 'Q', mode: 'standard', legacy_mode: false };
    assert.ok(
      createResearchAgent(requestWins, 's6', () => {}, undefined, { legacyMode: true })
        instanceof ParentResearchAgent
    );
    // Settings true + request true → legacy.
    const both = { query: 'Q', mode: 'standard', legacy_mode: true };
    assert.ok(
      createResearchAgent(both, 's7', () => {}, undefined, { legacyMode: true })
        instanceof DeepResearchAgent
    );
  });

  it('forwards the skill activation manager into the parent so the delegated loop keeps skill activation', () => {
    const manager = { getPromptContext: () => '', getToolDefinition: () => ({}) };
    const standard = { query: 'Q', mode: 'standard' };
    const parent = createResearchAgent(standard, 's8', () => {}, manager);
    assert.equal(parent.activationManager, manager);
  });

  it('plan-less default run degrades to delegated legacy execution (ADR-0012 fallback, not an error)', async () => {
    stubFetchEmpty();
    // Plan-less legacy runs make a subqueries call first, then the report.
    const faux = await makeFaux(REPORT, { withSubqueries: true });
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new ParentResearchAgent('s-default-planless', (e) => emitted.push(e));
    const request = baseRequest({ agency_mode: undefined, plan: undefined });
    delete request.agency_mode;
    delete request.plan;
    await agent.run(request);

    const notice = emitted.find(
      (e) => e.type === 'status' && typeof e.message === 'string' && e.message.includes('No approved research plan')
    );
    assert.ok(notice, 'degraded delegation is observable in telemetry');
    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'run completes through the delegated legacy loop');
    assert.ok(finished.report.startsWith(REPORT));
  });

  it('explicit agency_mode with an unapproved plan still fails loudly (contract violation)', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    const emitted = [];
    const agent = new ParentResearchAgent('s-explicit-unapproved', (e) => emitted.push(e));
    await assert.rejects(
      agent.run(baseRequest({ plan: { ...approvedPlan, status: 'pending' }, agency_mode: true })),
      /approved research plan/i,
    );
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
