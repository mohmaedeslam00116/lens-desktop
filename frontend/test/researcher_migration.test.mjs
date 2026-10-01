import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

// Default-import the compiled CJS modules so the #146 seams can be probed
// honestly: a missing seam is `undefined`, pinned red-first below — not a
// module-load crash that hides the other reds.
import parityHarnessDefault from '../dist-electron/engine/parityHarness.js';
import parentAgentDefault from '../dist-electron/engine/parentAgent.js';
import researcherAgentDefault from '../dist-electron/engine/researcherAgent.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';
import {
  makeFixture,
  makeFauxProvider,
  makeAgenticFixture,
  freshAgentDir,
} from './parity_fixture_builders.mjs';
const {
  runResearcherLeg,
  checkFixtureResearcher,
  makeResearcherLegTransport,
} = parityHarnessDefault;
const { runRehostedResearcher } = researcherAgentDefault;
if (typeof runRehostedResearcher !== 'function') {
  throw new Error('researcherAgent must export runRehostedResearcher (#146 re-hosted path)');
}
import {
  resetSearchPlane,
} from '../dist-electron/engine/searchPlane.js';
import {
  resetScrapePlane,
  __testSeams as scrapeTestSeams,
} from '../dist-electron/engine/scrapePlane.js';
import { createResearchSession, RESEARCH_TOOL_ALLOW_LIST, FORBIDDEN_CODING_TOOLS } from '../dist-electron/engine/agentSessionHost.js';
import { createAgenticToolSurface } from '../dist-electron/engine/agenticSearch.js';

const realFetch = globalThis.fetch;

beforeEach(() => {
  scrapeTestSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
  resetSearchPlane();
  resetScrapePlane();
  scrapeTestSeams.setLookupOverride(null);
});

// #146 red-first pins. The parity leg lives in parentAgent.ts next to its
// seam; `makeFixture`/`makeFauxProvider` are the #94 harness builders newly
// shared from parityHarness.ts (behavior identical to the existing
// file-local builders — proven by the #94 suite staying green).

describe('Researcher re-hosting (ticket #146 — parity-gated expand-contract)', () => {
  it('the #146 seams exist (red-first pins: runResearcherLeg + checkFixtureResearcher)', async () => {
    assert.equal(typeof runResearcherLeg, 'function', 'parityHarness exposes runResearcherLeg');
    assert.equal(typeof checkFixtureResearcher, 'function', 'parityHarness exposes checkFixtureResearcher');
  });

  it('golden fixture through the re-hosted researcher: ADR-0011 four-stage parity (coverage, grounding, admissions, sequence)', async () => {
    const fixture = makeFixture('researcher-parity-en', 'Fusion energy', ['fusion reactor basics', 'tokamak plasma scaling'], 2);
    const golden = makeAgenticFixture(fixture);
    const faux = await makeFauxProvider([golden]);

    const report = await checkFixtureResearcher(fixture, { provider: faux.provider });
    if (!report.ok) {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(join(process.cwd(), 'test', 'artifacts'), { recursive: true });
      const artifactPath = join(process.cwd(), 'test', 'artifacts', 'researcher-parity-report.json');
      writeFileSync(artifactPath, JSON.stringify(report, null, 2));
    }
    assert.equal(
      report.ok, true,
      `researcher parity diverged — artifact at test/artifacts/researcher-parity-report.json\n${JSON.stringify(report.results?.[0]?.summary ?? report, null, 2)}`
    );

    const stages = Object.fromEntries(report.results[0].stages.map((s) => [s.stage, s]));
    assert.match(stages.coverage.detail, /re-hosted coverage=/);
    assert.match(stages.grounding.detail, /grounding holds/);
    assert.match(stages.admissions.detail, /identical admissions/);
    assert.match(stages.sequence.detail, /anchored/);

    // D5: the leg must exercise the vendored planes for real (not degrading
    // to silent fallbacks) — nonzero ledgered admissions on both planes,
    // proven by the snapshots the leg captured before its own reset.
    const leg = await runResearcherLeg(fixture, { provider: faux.provider });
    assert.ok(leg.planeLedger, 'the leg records its plane ledger evidence');
    assert.ok(leg.planeLedger.search.ledgered > 0, 'fixture must exercise the vendored search plane');
    assert.ok(leg.planeLedger.scrape.ledgered > 0, 'fixture must exercise the vendored scrape plane');
  });

  it('parent orchestration unchanged under the re-hosted default: briefs/roles, fan-out caps, concurrency, admission budget (Event Faithfulness)', async () => {
    const fixture = makeFixture('researcher-parent-fanout', 'Renewable grids', ['solar grid integration', 'wind storage systems'], 2);
    const golden = makeAgenticFixture(fixture);
    const faux = await makeFauxProvider([golden]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    // Session-level scripted transport (the #142 scripted-transport
    // precedent): the re-hosted researchers run REAL hosted sessions whose
    // model transport is scripted — injected through the PARENT's own
    // researcher factory seam (the #90 DI point), via the runtime's session
    // decorator. The construction contract itself stays exercised by the
    // real seam in the constructor test.
    const scriptedSessions = [];
    const scriptedFactory = (sessionId, emit, options) => {
      const brief = [
        `You are a specialized research subagent.`,
        `Your assigned research facet (topic ${options.facetIndex + 1}/${options.facetCount}): "${options.facet}".`,
      ].join('\n');
      const pages = fixturePageUrls(brief, fixture);
      const decorate = (session) => {
        // The brief the researcher prompts with embeds the facet query in
        // quotes; the transport matches by containment, so scripting by
        // facet needs no text coupling with the brief builder.
        session.agent.streamFunction = makeResearcherLegTransport(
          fixture.report,
          pages,
          options.facet,
          []
        );
        scriptedSessions.push(session);
      };
      return {
        run: (request, signal) =>
          runRehostedResearcher(
            sessionId,
            emit,
            { ...options, agentDir: freshAgentDir() },
            request,
            signal,
            decorate
          ),
      };
    };

    const emitted = [];
    globalThis.fetch = makeFixtureFetchFor(fixture);
    const { ParentResearchAgent } = await import('../dist-electron/engine/parentAgent.js');
    await new ParentResearchAgent('researcher-parent-fanout', (e) => emitted.push(e), undefined, scriptedFactory, { respecialization: false })
      .run({
        query: fixture.query, report_type: 'quick', language: 'en',
        llm_provider: 'openai', model_name: 'test-model',
        api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
        embedding_enabled: false, plan: fixture.plan,
        agency_mode: true, researcher_mode: true,
      });

    const fanout = emitted.find((e) => e.type === 'fanout_telemetry')?.fanoutTelemetry;
    assert.ok(fanout, 'fan-out telemetry emitted');
    assert.equal(fanout.researchersLaunched, 2, 'one researcher per facet under the re-hosted default');
    assert.equal(fanout.researchersFailed, 0, 're-hosted researchers complete');
    assert.ok(fanout.researchersLaunched <= 4, 'concurrency cap surface intact');
    assert.ok(fanout.budgetFindingsAdmitted > 0, 'single session budget still gates admission');
    assert.equal(scriptedSessions.length, 2, 'two REAL hosted sessions were constructed for the two facets');

    const lifecycle = emitted.filter((e) => e.type === 'researcher_telemetry').map((e) => e.researcherTelemetry.phase);
    assert.ok(lifecycle.includes('role_selected'), 'closed-catalog role assignment unchanged');
    assert.ok(lifecycle.includes('started') && lifecycle.includes('completed'), 'parent lifecycle unchanged');
    assert.ok(
      !lifecycle.includes('run_started') && !lifecycle.includes('run_completed'),
      'execution phases are the runtime bridge vocabulary now (no double lifecycle)'
    );

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished?.report, 'the parent run completes with its synthesis');
    assert.ok(finished.sources.some((s) => String(s.url).includes('example')), 're-hosted findings reached the delegated pool');
  });

  it('the runtime hosts the brief session: plane-backed tools only, no coding tools, no answer-mode (ADR-0014 + ADR-0013 D3, construction contract)', async () => {
    const { buildResearchPackageTools, resetPackageToolCache } = await import('../dist-electron/engine/piResearchTools.js');
    resetPackageToolCache();
    const sessionId = 'researcher-construction-probe';
    const built = await buildResearchPackageTools({ sessionId, cwd: process.cwd(), language: 'en' });

    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 4,
      emit: () => {},
      search: async () => [],
      fetchPage: async () => null,
    });
    const { session, tools: granted } = await createResearchSession(
      { sessionId, agentDir: freshAgentDir() },
      surface
    );

    const names = granted.map((t) => (typeof t === 'string' ? t : t?.name ?? String(t)));
    assert.deepEqual(
      names.filter((n) => FORBIDDEN_CODING_TOOLS.includes(n)),
      [],
      'no coding tool may ever be granted to a researcher session'
    );
    for (const required of ['web_search', 'fetch_content']) {
      assert.ok(names.includes(required), `${required} granted to the researcher session`);
    }
    assert.deepEqual(RESEARCH_TOOL_ALLOW_LIST.slice().sort(), [...RESEARCH_TOOL_ALLOW_LIST].sort());

    // D3 holds on the researcher path: answer-mode fetch_content refuses
    // before any retrieval with the graceful guidance (no model injection).
    const outcome = await surface.handler({ name: 'fetch_content', arguments: { url: 'https://example.com/a', mode: 'answer' } });
    assert.equal(outcome.success, false);
    assert.match(outcome.error, /mode 'answer' is unsupported/);
    assert.equal(state.fetchesUsed, 0, 'no retrieval spent on a refused answer-mode call');

    // SSRF stays enforced inside the wrapper: a public-looking URL resolving
    // to a private address is refused by the scrape plane's vendored
    // validator, even when DNS is overridden for the fixture run.
    scrapeTestSeams.setLookupOverride(async () => [{ address: '10.0.0.5', family: 4 }]);
    globalThis.fetch = realFetch;
    const ssrf = await surface.handler({ name: 'fetch_content', arguments: { url: 'https://internal.example.local/secret' } });
    assert.equal(ssrf.success, false, 'SSRF validation refuses private addresses inside the researcher wrapper');
  });
});

/** Minimal offline fetch stub routing the fixture's search + page URLs (the
 * parent-fanout pin drives real retrieval through the vendored planes). */
function makeFixtureFetchFor(fixture) {
  return (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('html.duckduckgo.com')) {
      const decoded = (() => { try { return decodeURIComponent(url).replace(/\+/g, ' ').toLowerCase(); } catch { return url.toLowerCase(); } })();
      for (const [query, html] of Object.entries(fixture.searchHtml)) {
        if (decoded.includes(query.toLowerCase())) return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
    }
    for (const [pageUrl, html] of Object.entries(fixture.pageHtml)) {
      try {
        const requested = new URL(url);
        const fixtureUrl = new URL(pageUrl);
        if (requested.origin === fixtureUrl.origin && requested.pathname === fixtureUrl.pathname) {
          return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        }
      } catch { /* fall through */ }
    }
    return new Response(`no route for ${url}`, { status: 404 });
  });
}

/** Page URLs of the facet a brief belongs to (host = facet-query slug). */
function fixturePageUrls(brief, fixture) {
  const facet = facetQueryOf(brief, fixture);
  const slug = facet.replace(/[^a-z0-9]+/gi, '');
  return Object.keys(fixture.pageHtml).filter((u) => {
    try { return new URL(u).hostname.startsWith(slug); } catch { return false; }
  });
}

/** The facet query a brief carries ("topic i/n: \"facet\""). */
function facetQueryOf(brief, fixture) {
  for (const m of fixture.plan.milestones) {
    if (brief.includes(m.query)) return m.query;
  }
  return fixture.plan.milestones[0]?.query ?? fixture.query;
}
