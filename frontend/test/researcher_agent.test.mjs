import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { ResearcherAgent } from '../dist-electron/engine/researcherAgent.js';
import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

function page(i, milestoneId = 'm1') {
  return {
    url: `https://src-${i}.example/a-${i}`,
    title: `Source ${i}`,
    domain: `src-${i}.example`,
    content: `Evidence ${i} for the assigned facet. `.repeat(20),
    credibilityScore: 85,
    milestoneId,
    milestoneTitle: 'fusion energy basics',
  };
}

const approvedPlan = {
  id: 'plan-89', version: 2, objective: 'Fusion energy',
  milestones: [
    { id: 'm1', query: 'fusion energy basics', rationale: 'core physics', status: 'pending' },
    { id: 'm2', query: 'tokamak benchmarks 2026', rationale: 'current state', status: 'pending' },
  ],
  suggestedSkills: [], status: 'approved',
};

const baseRequest = (overrides = {}) => ({
  query: 'Fusion energy', report_type: 'quick', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan: approvedPlan, agency_mode: true, ...overrides,
});

const REPORT = '# Fusion Energy Report\n\nFacet findings synthesized.';

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
});

describe('ResearcherAgent (ticket #89 — single in-process researcher)', () => {
  it('runs one facet in a researcher subagent; findings are tagged with facet provenance; activity streams additively', async () => {
    stubFetchEmpty();
    const emitted = [];
    const searchCalls = [];
    const researcher = new ResearcherAgent('s-r1', (e) => emitted.push(e), {
      researcherId: 'researcher_s-r1_1',
      facetIndex: 0, facet: 'fusion energy basics', facetCount: 2,
      milestoneId: 'm1', milestoneTitle: 'fusion energy basics',
      toolPackages: false,
      searchFn: async (q) => {
        searchCalls.push(q);
        return [
          { url: 'https://src-1.example/a-1', title: 'Source 1', snippet: 'x' },
          { url: 'https://src-2.example/a-2', title: 'Source 2', snippet: 'x' },
        ];
      },
      scrapeFn: async (url) => {
        const i = Number(url.match(/a-(\d+)/)?.[1] ?? 0);
        return page(i || 1);
      },
    });

    const result = await researcher.run({ query: 'Fusion energy', search_provider: 'duckduckgo', embedding_enabled: false });

    assert.equal(result.researcherId, 'researcher_s-r1_1');
    assert.equal(result.findings.length, 2, 'both search hits ingested');
    for (const f of result.findings) {
      assert.equal(f.milestoneId, 'm1');
      assert.equal(f.milestoneTitle, 'fusion energy basics');
    }
    assert.deepEqual(searchCalls, ['fusion energy basics'], 'researcher searches ONLY its facet');

    const phases = emitted
      .filter((e) => e.type === 'researcher_telemetry')
      .map((e) => e.researcherTelemetry.phase);
    assert.equal(phases[0], 'run_started');
    assert.equal(phases.at(-1), 'run_completed');
    assert.ok(phases.includes('retrieval'), 'retrieval progress streams per source');

    const sources = emitted.filter((e) => e.type === 'source');
    assert.equal(sources.length, 2);
    assert.equal(sources[0].milestoneId, 'm1', 'source events carry facet provenance');
  });

  it('tool-mode researcher harvests web_search URLs into the facet pool (injected faux toolset, no network)', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    // Round 1: model calls web_search then finishes; remaining rounds get DONE.
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('web_search', { query: 'tokamak Q>1 milestones' })]),
      ai.fauxAssistantMessage('DONE'),
      ai.fauxAssistantMessage('DONE'),
    ]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const toolCalls = [];
    const researcher = new ResearcherAgent('s-tool', (e) => emitted.push(e), {
      researcherId: 'researcher_s-tool_1',
      facetIndex: 1, facet: 'tokamak benchmarks 2026', facetCount: 2,
      milestoneId: 'm2', milestoneTitle: 'tokamak benchmarks 2026',
      toolPackages: true,
      maxToolRounds: 2,
      searchFn: async () => [],
      scrapeFn: async (url) => ({
        url,
        title: `Tool-found ${url}`,
        domain: new URL(url).hostname,
        content: `Tool-retrieved evidence from ${url}. `.repeat(10),
        credibilityScore: 82,
        milestoneId: 'm2',
        milestoneTitle: 'tokamak benchmarks 2026',
      }),
      packageToolsFactory: async () => ({
        tools: [{ name: 'web_search', description: 'search the web', parameters: { type: 'object', properties: {} } }],
        handler: async (call) => {
          toolCalls.push(call.name);
          return {
            success: true,
            result: 'Key result: https://found-1.example/tokamak-ignition and https://found-2.example/qistore',
          };
        },
      }),
    });

    const result = await researcher.run({
      query: 'Fusion energy', language: 'en', llm_provider: 'openai', model_name: 'test-model',
      api_keys: { openai: 'test-key' }, embedding_enabled: false,
    });

    assert.ok(toolCalls.includes('web_search'), 'the model drove the web_search tool');
    const toolUrls = result.findings.map((f) => f.url).filter((u) => u.includes('found-'));
    assert.equal(toolUrls.length, 2, 'URLs surfaced by web_search entered the facet pool');
    for (const f of result.findings) {
      assert.equal(f.milestoneId, 'm2', 'tool-harvested findings carry the facet provenance');
    }
    const phases = emitted.filter((e) => e.type === 'researcher_telemetry').map((e) => e.researcherTelemetry.phase);
    assert.ok(phases.includes('tool_activity'), 'tool activity streams additively');
  });
});

describe('Agency + researcher_mode end-to-end (offline via injected researcher factory)', () => {
  it('researcher findings flow into the delegated loop and appear in the report sources with provenance', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    // Synthesis call of the delegated loop only — researchers run fully offline.
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    // Offline researcher factory: no search hits, deterministic scrape — the
    // findings still enter the delegated pool with facet provenance.
    const parent = new ParentResearchAgent('s-89', (e) => emitted.push(e), undefined, (sessionId, emit, options) => {
      return new ResearcherAgent(sessionId, emit, {
        ...options,
        toolPackages: false,
        searchFn: async () => (options.facetIndex === 0
          ? [{ url: 'https://seeded-1.example/facet-0', title: 'Seeded 1', snippet: 'x' }]
          : [{ url: 'https://seeded-2.example/facet-1', title: 'Seeded 2', snippet: 'x' }]),
        scrapeFn: async (url) => ({
          url,
          title: `Seeded ${url}`,
          domain: new URL(url).hostname,
          content: `Seeded facet evidence from ${url}. `.repeat(10),
          credibilityScore: 84,
          milestoneId: options.milestoneId,
          milestoneTitle: options.milestoneTitle,
        }),
      });
    });
    await parent.run(baseRequest({ researcher_mode: true }));

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'run completes');
    assert.equal(finished.report, REPORT, 'delegated synthesis unchanged (parity contract)');

    const seeded = (finished.sources || []).filter((s) => String(s.url).includes('seeded-'));
    assert.ok(seeded.length >= 2, `seeded researcher findings appear in report sources (got ${seeded.length})`);
    for (const s of seeded) {
      assert.ok(s.milestoneId, 'report sources carry facet provenance');
    }

    // Researcher lifecycle streamed additively alongside the legacy backbone.
    const phases = emitted.filter((e) => e.type === 'researcher_telemetry').map((e) => e.researcherTelemetry.phase);
    assert.ok(phases.includes('run_started') && phases.includes('run_completed'));
  });
});

describe('Renderer contract tolerance (#89 additions)', () => {
  it('mirrors milestone provenance fields and widened phases in renderer types', async () => {
    const { readFile } = await import('node:fs/promises');
    const rendererTypes = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
    assert.match(rendererTypes, /milestoneId\?: string;/);
    assert.match(rendererTypes, /milestoneTitle\?: string;/);
    assert.match(rendererTypes, /'retrieval' \| 'tool_activity'/);
  });
});
