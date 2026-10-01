import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { runRehostedResearcher } from '../dist-electron/engine/researcherAgent.js';
import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { makeFixtureFetch, makeResearcherLegTransport } from '../dist-electron/engine/parityHarness.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';
import { __testSeams as scrapeSeams, resetScrapePlane } from '../dist-electron/engine/scrapePlane.js';
import { resetSearchPlane } from '../dist-electron/engine/searchPlane.js';
import { resetFetchLedger } from '../dist-electron/engine/fetchLedger.js';

/**
 * Ticket #146 — the researcher re-hosting tests. The native researcher loop
 * (ticket #89's scoped pi-core generate loop) is RETIRED: expand-contract
 * with the parity gate green (test/researcher_migration.test.mjs carries the
 * ADR-0011 four-stage diff). The construction contract below throws with the
 * migration pointer — no dual maintenance, and the dead seam is honest.
 *
 * The PROCEDURAL contracts #89 established survive the swap and are pinned
 * here against the re-hosted path:
 *   - findings are provenance-stamped with the facet's milestone;
 *   - the researcher searches ONLY its facet;
 *   - findings flow into the delegated loop's evidence pool with provenance;
 *   - lifecycle stays single-owner: `started`/`completed` are the parent's
 *     (the runtime bridge owns the execution-window vocabulary now).
 */

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
  resetSearchPlane();
  resetScrapePlane();
  scrapeSeams.setLookupOverride(null);
});

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

async function pi() {
  return await import('@earendil-works/pi-ai');
}

describe('Researcher re-hosting contracts (ticket #146 — the #89 contracts survive the swap)', () => {
  it('the native researcher loop is retired: constructing it throws with the migration pointer', async () => {
    const { ResearcherAgent } = await import('../dist-electron/engine/researcherAgent.js');
    assert.throws(
      () => new ResearcherAgent(),
      /retired \(ticket #146\)/,
      'the retired class must refuse construction — no dual maintenance'
    );
  });

  it('one facet executes on a hosted AgentSession: findings provenance-stamped, facet-scoped retrieval, ledgered admission', async () => {
    // Golden fixture facet: DDG results + substantive pages served to the
    // REAL vendored planes by the routing fetch (the offline contract).
    const facet = 'fusion energy basics';
    const entries = [1, 2].map((i) => ({
      url: `https://fusionenergybasics-src${i}.example/article`,
      title: `${facet} source ${i}`,
      snippet: `${facet} overview`,
    }));
    const fixture = {
      name: 'rehost-contract',
      query: 'Fusion energy',
      language: 'en',
      plan: approvedPlan,
      report: REPORT,
      searchHtml: {
        [facet]:
          '<html><body>' + entries
            .map((e) => `<div class="result"><h2 class="result__a" href="${e.url}">${e.title}</h2><a class="result__snippet" href="${e.url}">${e.snippet}</a></div>`)
            .join('') + '</body></html>',
      },
      pageHtml: Object.fromEntries(entries.map((e) => [
        e.url,
        `<html><head><title>${e.title}</title></head><body><article>` +
        [
          `The Fusion energy investigation reports on ${facet}: detailed evidence shows measurable progress and reproducible results across independent measurements, with the framework and its protocol holding under controlled conditions.`,
          `Additional analysis of ${facet} confirms the reported trends: the architecture, its implementation, and the algorithm each hold under controlled comparison, with performance metrics recorded per run and reproducible results across independent measurements.`,
          `Further findings on ${facet}: benchmark evaluation shows precision at 88.8%, duplicate fetches dropped by 45%, and average audit time of 12 seconds across the comparison suite, documented under controlled conditions.`,
          `The benchmark suite also documents the known limitations and risks of ${facet}: bypass attempts are a real challenge, the bottleneck is the single enforcement point, and the trade-off favors one enforcement point, with the vulnerability surface staying minimal.`,
          `Evaluation metrics for ${facet}: throughput reaches 120 Mbps, latency drops by 42%, accuracy stands at 99.9%, the comparison score improves by 15%, and the noise margin is 7 dB under controlled conditions, with reproducible results across every independent run.`,
        ].map((p) => `<p>${p}</p>`).join('') +
        '</article></body></html>',
      ])),
    };

    scrapeSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    const emitted = [];
    const previousFetch = globalThis.fetch;
    try {
      globalThis.fetch = makeFixtureFetch(fixture);
      // Offline determinism: the session's model transport is scripted (the
      // runtime's own session-level seam — the #142 precedent) to run one
      // tool round: search the facet → fetch its pages → report.
      const decorate = (session) => {
        session.agent.streamFunction = makeResearcherLegTransport(
          REPORT,
          Object.keys(fixture.pageHtml),
          facet,
          []
        );
      };
      const result = await runRehostedResearcher(
        'rehost-contract-session',
        (e) => emitted.push(e),
        {
          researcherId: 'researcher_rehost_1',
          facetIndex: 0,
          facet,
          facetCount: 2,
          milestoneId: 'm1',
          milestoneTitle: facet,
          toolPackages: true,
        },
        baseRequest(),
        undefined,
        decorate
      );

      assert.equal(result.researcherId, 'researcher_rehost_1');
      assert.ok(result.findings.length >= 1, `facet findings admitted (got ${result.findings.length})`);
      for (const f of result.findings) {
        assert.equal(f.milestoneId, 'm1', 'findings carry the facet milestone id');
        assert.equal(f.milestoneTitle, facet, 'findings carry the facet milestone title');
        assert.ok(f.content.length > 0, 'findings carry the full page, not a snippet');
      }
      // Facet-scoped retrieval: only this facet's fixture pages admitted.
      for (const f of result.findings) {
        assert.ok(f.url.includes('fusionenergybasics'), 'the researcher searched ONLY its facet');
      }
      const sourceEvents = emitted.filter((e) => e.type === 'source');
      assert.ok(sourceEvents.length >= 1, 'provenance-tagged source events stream while harvesting');
      assert.ok(result.toolCalls >= 1, 'ledgered fetches counted');
    } finally {
      globalThis.fetch = previousFetch;
      resetFetchLedger('rehost-contract-session');
    }
  });

  it('researcher findings flow into the delegated loop and appear in the report sources with provenance (offline via the parent factory seam)', async () => {
    // The scripted-decoration path is exercised fully in
    // test/researcher_migration.test.mjs; this pin keeps the delegated-pool
    // contract fully offline via a deterministic factory.
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const parent = new ParentResearchAgent('s-89', (e) => emitted.push(e), undefined, (_sessionId, _emit, options) => ({
      // Fully offline: no retrieval at all — the seeded findings prove the
      // delegated-pool contract without any hosted session work.
      run: async () => ({
        researcherId: options.researcherId,
        facetIndex: options.facetIndex,
        facet: options.facet,
        findings: [
          {
            url: `https://seeded-${options.facetIndex + 1}.example/facet`,
            title: `Seeded ${options.facetIndex + 1}`,
            domain: `seeded-${options.facetIndex + 1}.example`,
            content: `Seeded facet evidence. `.repeat(20),
            credibilityScore: 84,
            milestoneId: options.milestoneId,
            milestoneTitle: options.milestoneTitle,
          },
        ],
        toolCalls: 1,
        dedupeShared: 0,
      }),
    }));
    await parent.run(baseRequest({ researcher_mode: true }));

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'run completes');
    assert.ok(finished.report.startsWith(REPORT), 'delegated synthesis unchanged (parity contract)');
    assert.match(finished.report, /## Evidence Audit/);

    const seeded = (finished.sources || []).filter((s) => String(s.url).includes('seeded-'));
    assert.ok(seeded.length >= 2, `seeded researcher findings appear in report sources (got ${seeded.length})`);
    for (const s of seeded) {
      assert.ok(s.milestoneId, 'report sources carry facet provenance');
    }

    // Lifecycle single-ownership: only the parent's lifecycle phases flow —
    // the retired execution phases never reappear (Event Faithfulness).
    const phases = emitted.filter((e) => e.type === 'researcher_telemetry').map((e) => e.researcherTelemetry.phase);
    assert.ok(phases.includes('started') && phases.includes('completed'));
    assert.ok(!phases.includes('run_started') && !phases.includes('run_completed'));
  });
});

describe('Renderer contract tolerance (#146 additions)', () => {
  it('mirrors the researcher session vocabulary in renderer types (additive)', async () => {
    const { readFile } = await import('node:fs/promises');
    const rendererTypes = await readFile(new URL('../src/types/index.ts', import.meta.url), 'utf8');
    assert.match(rendererTypes, /milestoneId\?: string;/);
    assert.match(rendererTypes, /'retrieval' \| 'tool_activity'/);
  });
});
