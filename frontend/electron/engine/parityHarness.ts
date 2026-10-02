/**
 * parityHarness.ts — parity regression harness (ADR-0010 phase-3 gate, ticket #94;
 * two-leg contract since ticket #104's legacy-loop removal).
 *
 * Replays golden fixture runs through BOTH agency legs in the same process on
 * identical offline fixtures, and diffs the outcomes:
 *
 *   1. Coverage score           |Δ overallScore| ≤ 0.05 (rounded to 2 dp)
 *   2. Citation grounding audit identical (sanitized report + per-claim
 *      audit fields over the shared evidence pool)
 *   3. Admission counts         exact match as distinct URL sets
 *   4. LiveEvent sequence       identical delegated-loop backbone
 *                               (additive/researcher events excluded,
 *                               consecutive report_chunk runs collapsed)
 *
 * Equivalence thresholds (ADR-0011):
 *  - Coverage: |Δ| ≤ 0.05 — both legs ingest through the same admission
 *    pipeline; small numeric drift from MMR ordering is tolerated, semantic
 *    drift is not.
 *  - Grounding / admissions / sequence: EXACT — both legs must make
 *    identical admission and grounding decisions on identical evidence.
 *
 * Fixtures are offline: the harness injects a routing `fetchImpl` that serves
 * deterministic HTML for the fixtures' search + page URLs, so the REAL
 * MultiSearchProvider / PageScraper / DeduplicationEngine / BoundedScraperPool
 * stack runs in every leg. The faux LLM provider is supplied by the caller
 * (the same one for every leg → identical synthesis inputs).
 *
 * Per fixture the harness runs TWO legs (ticket #104 retired the legacy
 * DeepResearchAgent leg; legacy-vs-delegation byte-equivalence remains pinned
 * at the agent level by the #88 contract test in test/parent_agent.test.mjs):
 *   - delegation: ParentResearchAgent with researcher_mode OFF — the
 *                 BASELINE leg (pure parent-delegated loop) and the reference
 *                 for the strict sequence stage
 *   - fanout    : ParentResearchAgent with researcher_mode ON — the outcome
 *                 stages (coverage / grounding / admissions) pin this leg's
 *                 RESULTS to the baseline. Since #146 the researchers are the
 *                 RE-HOSTED hosted sessions on the scripted transport (one
 *                 AgentSession per facet, tool rounds inside the runtime
 *                 window); comparisons remain order-insensitive (admission
 *                 set semantics): researchers may admit the same pages in a
 *                 different order and emit extra per-facet `source` events
 *                 and window-vocabulary events; the SET of admitted
 *                 sources, the coverage score, and the grounding decisions
 *                 must still match exactly.
 *
 * Both legs run with `respecialization: false` for deterministic launch
 * counts (ADR-0011; #93's deficit follow-ups are exercised by their own
 * suite).
 */

import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ParentResearchAgent } from './parentAgent';
import { resetActiveCore, setActiveCore } from './modelGateway';
import { auditEvidenceCoverage } from './evidenceCoverage';
import { CitationGroundingContract } from './synthesis';
import { LiveEvent, ResearchPlan, ResearchRequest, SourceItem } from './types';
import { createAgenticToolSurface } from './agenticSearch';
import { AgenticTranscriptStore } from './agenticTranscript';

/** Documented equivalence thresholds (ADR-0011). */
export const PARITY_THRESHOLDS = {
  /** Max allowed |Δ| on the coverage audit's overallScore. */
  coverageDelta: 0.05,
} as const;

/** One golden fixture: plan + offline wire + the expected LLM report. */
export interface ParityFixture {
  name: string;
  query: string;
  language?: 'ar' | 'en';
  plan: ResearchPlan;
  /** The faux LLM response both legs must receive (identical synthesis). */
  report: string;
  /** Deterministic HTML served for search endpoints, keyed by milestone query. */
  searchHtml: Record<string, string>;
  /** Deterministic HTML served for page URLs. */
  pageHtml: Record<string, string>;
}

export interface ParityStageResult {
  stage: 'coverage' | 'grounding' | 'admissions' | 'sequence';
  ok: boolean;
  detail: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ParityFixtureResult {
  fixture: string;
  ok: boolean;
  stages: ParityStageResult[];
  /** Readable equivalence summary (one line per stage). */
  summary: string[];
}

export interface ParityReport {
  ok: boolean;
  results: ParityFixtureResult[];
  /** First failing fixture + stage, for the divergence artifact. */
  divergence: {
    fixture: string;
    stage: string;
    detail: string;
    expected?: unknown;
    actual?: unknown;
  } | null;
}

export interface ParityHarnessOptions {
  /** The pi-core faux provider every leg runs against (identical synthesis). */
  provider: unknown;
  /** Session id prefix (defaults to `parity-<fixture>`). */
  sessionIdPrefix?: string;
  /** Threshold overrides (e.g. a negative coverageDelta forces divergence —
   * used by tests to prove the artifact path). */
  thresholds?: Partial<{ coverageDelta: number }>;
}

interface LegOutcome {
  events: LiveEvent[];
  finished: { report?: string; sources?: SourceItem[] } | null;
}

/** Collapse consecutive report_chunk runs and strip additive/leg-specific
 * events — the delegated-loop backbone contract (#88 precedent, #104
 * two-leg form; #146 window-vocabulary extension). `source` events are
 * excluded: the fan-out leg emits per-researcher provenance copies the
 * admissions stage already covers as URL sets. Events carrying a `sessionId`
 * field are the re-hosted researcher windows' runtime-bridge vocabulary
 * (session_state / window status / window report_chunk / window finished) —
 * additive researcher events by the same rule: the delegated loop's own
 * events never carry the field. */
export function backboneOf(events: LiveEvent[]): string[] {
  const filtered = events.filter(
    (e) => e.type !== 'researcher_telemetry'
      && e.type !== 'fanout_telemetry'
      && e.type !== 'source'
      && (e as { sessionId?: unknown }).sessionId === undefined
      && !(e.type === 'status' && typeof e.message === 'string' && e.message.includes('agency mode'))
  );
  const backbone: string[] = [];
  for (const e of filtered) {
    if (e.type === 'report_chunk' && backbone[backbone.length - 1] === 'report_chunk') continue;
    backbone.push(e.type);
  }
  return backbone;
}

/** Build a routing fetch that serves the fixture's deterministic HTML to the
 * real search/scraper stack (offline). Non-fixture URLs 404 loudly so a
 * fixture gap surfaces as an error, not silent divergence. */
export function makeFixtureFetch(fixture: ParityFixture): typeof fetch {
  const route = (url: string): string | null => {
    if (url.includes('html.duckduckgo.com')) {
      // The vendored DDG plane encodes spaces as '+' (form encoding); the
      // native implementation used encodeURIComponent ('%20'). Decode and
      // normalize so both wire forms route to the fixture's results page.
      // (#111: the '+' form previously 404'd silently, leaving the parity
      // legs with empty search results — the scrape-plane gate exposed it.)
      const decoded = (() => {
        try { return decodeURIComponent(url).replace(/\+/g, ' ').toLowerCase(); } catch { return url.toLowerCase(); }
      })();
      for (const [query, html] of Object.entries(fixture.searchHtml)) {
        if (decoded.includes(query.toLowerCase())) return html;
      }
      return null;
    }
    for (const [pageUrl, html] of Object.entries(fixture.pageHtml)) {
      // Exact origin+pathname match: query/fragment variants of the same
      // fixture page are served; unrelated URLs sharing a prefix are not.
      try {
        const requested = new URL(url);
        const fixtureUrl = new URL(pageUrl);
        if (requested.origin === fixtureUrl.origin && requested.pathname === fixtureUrl.pathname) return html;
      } catch {
        // Malformed URL — fall through to the documented 404.
      }
    }
    return null;
  };
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Honor the caller's cancellation contract: abort exactly like a real
    // network fetch would when retrieval supplies an aborted signal.
    const signal =
      init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const html = route(url);
    if (html === null) {
      return new Response(`parity fixture "${fixture.name}" has no route for ${url}`, { status: 404 });
    }
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// The agentic leg (#143): ADR-0011 grows the agentic path. The golden fixture
// replays through the REAL agentic machinery — a hosted AgentSession (#140)
// on the #142 runner with the plane-backed tool surface — over the same
// routing fetch as the agency legs, and the SAME four-stage diff applies:
// coverage ≤ 0.05, grounding exact, admission sets exact, backbone exact.
// A zero-ledger run (no admissible retrieval behind the fixture) is a BROKEN
// run, never a vacuous pass (ADR-0013 D5): two empty admission sets are
// reported as divergence, not equivalence.
// ---------------------------------------------------------------------------

/** How the agent behaved in one leg run: the streamed answer text it
 * produced, per scripted turn (deterministic; must equal the fixture's
 * golden report). */
export interface AgenticLegOutcome {
  result: { terminal: string; report: string; sources: SourceItem[] } | null;
  events: LiveEvent[];
  /** The persisted transcript's final turn-group messages (#144 seam), read
   * back from the LENS-side store — plain JSON, exactly what was captured. */
  transcript: Array<Record<string, unknown>>;
}

/** Replay the fixture's golden retrieval through the real agentic path on
 * the routing fetch. Offline contract shared with the agency legs: the
 * fixture's search/page HTML is served by `makeFixtureFetch`, and fixture
 * hostnames resolve for the vendored SSRF validator (non-fixture hostnames
 * fail loudly). The scripted transport gives the agent its one-turn script:
 * search → fetch the fixture's entry page → emit the fixture's golden report
 * verbatim, so synthesis inputs are identical across paths by construction.
 * Reset in the SAME finally as the agency legs (planes, core, fetch seams).
 */
export async function runAgenticLeg(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<AgenticLegOutcome> {
  const { runAgenticSearch } = await import('./agenticSearch');
  const { resetFetchLedger } = await import('./fetchLedger');
  const { primarySearchPlane } = await import('./searchPlane');
  const { primaryScrapePlane, __testSeams: scrapeSeams, resetScrapePlane } = await import('./scrapePlane');
  const { resetSearchPlane } = await import('./searchPlane');

  const sessionId = `${options.sessionIdPrefix ?? 'parity-agentic'}-${fixture.name}`;
  const events: LiveEvent[] = [];
  let terminal: string | undefined;

  const previousFetch = globalThis.fetch;
  // Global state (fetch, DNS seam, planes, core) is only mutated INSIDE the
  // protected scope: any setup throw (temp dirs, store construction, session
  // creation) must still restore the process for the next leg/test, never
  // leak a patched fetch or DNS override into later tests.
  let lastError: unknown = undefined;
  let state: { sources: SourceItem[]; reportChunks: string[]; fetchesUsed: number } = {
    sources: [],
    reportChunks: [],
    fetchesUsed: 0,
  };
  let transcripts: AgenticTranscriptStore | undefined;
  try {
    globalThis.fetch = makeFixtureFetch(fixture) as typeof globalThis.fetch;
    const fixtureHostnames = new Set(
      Object.keys(fixture.pageHtml).map((u) => {
        try { return new URL(u).hostname; } catch { return u; }
      })
    );
    scrapeSeams.setLookupOverride(async (hostname) => {
      if (!fixtureHostnames.has(hostname)) {
        throw new Error(`parity fixture "${fixture.name}" has no DNS route for ${hostname}`);
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });
    resetScrapePlane();
    resetSearchPlane();
    resetActiveCore();
    // The #144 persistence seam rides along: the leg captures its turn-group
    // transcript at terminal time and the outcome reads the SAME bytes back.
    transcripts = new AgenticTranscriptStore(mkdtempSync(join(tmpdir(), 'lens-parity-transcripts-')));
    const { createResearchSession } = await import('./agentSessionHost');
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 8,
      emit: (event) => events.push(event),
      search: async (query) => {
        const hits = await primarySearchPlane(query);
        return hits.map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.snippet }));
      },
      fetchPage: async (url) => {
        const page = await primaryScrapePlane(url);
        if (!page.content || page.content.startsWith('Content unavailable from ')) return null;
        return { url: page.url, title: page.title, text: page.content };
      },
    });
    const { session } = await createResearchSession({ sessionId, agentDir: mkdtempSync(join(tmpdir(), 'lens-parity-agentic-')) }, surface);
    const question = fixture.query;
    const lastUserText = (context: any): string => {
      const messages = context?.messages ?? [];
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) return '';
      const content = lastUser.content ?? lastUser.text ?? '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
      return '';
    };
    const usage = { input: 1, output: 1, total: 2 };
    const finalize = (m: any) => ({ ...m, role: 'assistant', api: 'scripted', provider: 'scripted', model: 'scripted-1', usage });
    const streamOf = (m: any) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'done', reason: m.stopReason, message: m };
      },
      async result() {
        return m;
      },
    });
    const toolResultCount = (context: any): number =>
      (context?.messages ?? []).filter((m: any) => m.role === 'toolResult').length;
    const pageUrls = Object.keys(fixture.pageHtml);
    // One-turn script: search → fetch every fixture page → golden report
    // verbatim. The golden pages are the fixture's retrievable evidence; the
    // admissions stage requires ALL of them admitted (a zero-ledger run —
    // none admitted — is divergence, never a pass).
    session.agent.streamFunction = async (_model: unknown, context: any) => {
      if (lastUserText(context) !== question) {
        return streamOf(finalize({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }));
      }
      if (toolResultCount(context) === 0) {
        const message = finalize({
          content: [{ type: 'toolCall', id: 'call-search', name: 'web_search', arguments: { query: Object.keys(fixture.searchHtml)[0] } }],
          stopReason: 'toolUse',
        });
        return streamOf(message);
      }
      if (toolResultCount(context) <= pageUrls.length && pageUrls.length > 0) {
        const message = finalize({
          content: pageUrls.map((url, i) => ({
            type: 'toolCall', id: `call-fetch-${i}`, name: 'fetch_content', arguments: { url },
          })),
          stopReason: 'toolUse',
        });
        return streamOf(message);
      }
      return streamOf(finalize({ content: [{ type: 'text', text: fixture.report }], stopReason: 'stop' }));
    };
    const result = await runAgenticSearch(session, {
      sessionId,
      question,
      state,
      emit: (event) => events.push(event),
      transcript: { store: transcripts },
    });
    terminal = result.terminal;
    lastError = undefined;
  } catch (error) {
    lastError = error;
  } finally {
    globalThis.fetch = previousFetch;
    scrapeSeams.setLookupOverride(null);
    resetScrapePlane();
    resetSearchPlane();
    resetActiveCore();
    resetFetchLedger(sessionId);
  }
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  const turnGroups = transcripts?.read(sessionId)?.turnGroups ?? [];
  const transcript = turnGroups.length > 0 ? turnGroups[turnGroups.length - 1].messages : [];
  return {
    result: terminal ? { terminal, report: state.reportChunks.join(''), sources: [...state.sources] } : null,
    events,
    transcript,
  };
}

/** Four-stage diff of the agentic leg against the fixture's golden facts
 * (ADR-0011 stages, agentic form): coverage of the golden query against the
 * admitted pages; grounding decisions of the citation contract on the golden
 * report over the canonical admitted pool; admission sets must contain the
 * fixture's retrievable pages — a zero-ledger run FAILS (never a vacuous
 * pass); and the event backbone must carry the agentic minimal contract.
 */
export async function checkFixtureAgentic(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<ParityReport> {
  const stages: ParityStageResult[] = [];
  const coverageThreshold = options.thresholds?.coverageDelta ?? PARITY_THRESHOLDS.coverageDelta;
  const leg = await runAgenticLeg(fixture, options);
  const sources = leg.result?.sources ?? [];
  const reportText = leg.result?.report ?? '';

  // Stage 1: coverage — the admitted pages must cover the golden query.
  const coverage = auditEvidenceCoverage(
    fixture.query,
    [],
    sources.map((s) => ({ content: s.passage ?? s.snippet ?? '', domain: s.domain })),
    { language: fixture.language === 'ar' ? 'ar' : 'en' }
  );
  stages.push({
    stage: 'coverage',
    ok: coverage.overallScore >= 1 - coverageThreshold,
    detail: `agentic coverage=${coverage.overallScore} (≥ ${1 - coverageThreshold})`,
    expected: '≥ ' + (1 - coverageThreshold),
    actual: coverage.overallScore,
  });

  // Stage 2: grounding — the citation contract's decisions on the golden
  // report over the canonical (URL-sorted) admitted pool.
  const contract = new CitationGroundingContract();
  contract.registerExcerpts([...sources].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)));
  const v = contract.verifyAndSanitize(reportText);
  const groundingOk = v.totalFound > 0 && v.hallucinatedCount === 0;
  stages.push({
    stage: 'grounding',
    ok: groundingOk,
    detail: groundingOk
      ? `grounding holds (${v.validCount} valid / 0 hallucinated)`
      : `grounding diverged (${v.validCount} valid / ${v.hallucinatedCount} hallucinated of ${v.totalFound})`,
    expected: 'all citations valid',
    actual: v.hallucinatedIndices,
  });

  // Stage 3: admissions — the fixture's retrievable pages must be admitted;
  // a zero-ledger run is a BROKEN run (ADR-0013 D5), not a passing vacuum.
  const admittedUrls = [...new Set(sources.map((s) => s.url))].sort();
  const fixtureUrls = [...new Set([...Object.keys(fixture.pageHtml)])].sort();
  const zeroLedger = admittedUrls.length === 0;
  const admissionsOk = !zeroLedger && fixtureUrls.every((u) => admittedUrls.includes(u));
  stages.push({
    stage: 'admissions',
    ok: admissionsOk,
    detail: zeroLedger
      ? `zero-ledger run: no page admitted through the plane — a broken run, not a parity pass`
      : admissionsOk
        ? `all fixture pages admitted (${admittedUrls.length}/${fixtureUrls.length})`
        : `missing admissions: ${fixtureUrls.filter((u) => !admittedUrls.includes(u)).join(', ')}`,
    expected: fixtureUrls,
    actual: admittedUrls,
  });

  // Stage 4: sequence — the agentic minimal backbone in ANCHORED form: the
  // agent ran (agent_start before agent_end before agent_settled), the tool
  // rounds and the streamed report landed INSIDE the agent window, and the
  // run terminated explicitly with `finished` (Event Faithfulness, agentic
  // form). Exact equality is not required: the bridge legitimately surfaces
  // timing-dependent background-task events (session titling) whose position
  // is arrival-dependent, not contractual.
  const types: string[] = leg.events.map((e) => e.type as string);
  // Bridge vocabulary: the agent lifecycle surfaces as `session_state`;
  // tool rounds as `status`; the streamed answer as `report_chunk`.
  const agentStart = types.indexOf('session_state');
  const agentEnd = types.lastIndexOf('session_state');
  const firstStatus = types.indexOf('status');
  const firstReport = types.indexOf('report_chunk');
  const finishedIdx = types.indexOf('finished');
  const anchored = [
    agentStart !== -1,
    firstStatus > agentStart && firstStatus < agentEnd,
    firstReport > agentStart && firstReport < agentEnd,
    finishedIdx > agentStart && finishedIdx > types.lastIndexOf('status'),
    !types.includes('error') && !types.includes('cancelled') && !types.includes('budget_exhausted'),
  ];
  const sequenceOk = anchored.every(Boolean);
  stages.push({
    stage: 'sequence',
    ok: sequenceOk,
    detail: sequenceOk
      ? `agentic backbone anchored (${types.length} events; tool rounds and report inside the agent window; explicit finished)`
      : `agentic backbone diverged: ${anchored.map((a, i) => ['agent-ran', 'tool-round-window', 'report-window', 'explicit-terminal', 'no-failure'][i] + '=' + (a ? '✔' : '✖')).join(' ')}`,
    expected: sequenceOk ? undefined : 'session_state(running) → [tool rounds + report] → session_state(completed) → finished',
    actual: sequenceOk ? undefined : types.join(','),
  });

  const ok = stages.every((s) => s.ok);
  const fixtureResult: ParityFixtureResult = {
    fixture: `agentic/${fixture.name}`,
    ok,
    stages,
    summary: stages.map((s) => `${s.ok ? '✔' : '✖'} agentic/${fixture.name}/${s.stage}: ${s.detail}`),
  };
  const firstBad = stages.find((s) => !s.ok);
  return {
    ok,
    results: [fixtureResult],
    divergence: firstBad
      ? {
          fixture: `agentic/${fixture.name}`,
          stage: firstBad.stage,
          detail: firstBad.detail,
          expected: firstBad.expected,
          actual: firstBad.actual,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// The researcher leg (#146): the golden fixture replays through the REAL
// researcher machinery — a hosted AgentSession (ADR-0014 construction
// contract) on the plane-backed research toolset, driven by the scripted
// transport inside the agent window. The offline contract is the agentic
// leg's: routing fetch, DNS seam for fixture hostnames, planes + core reset
// in the SAME finally. The outcome is the researcher contract shape
// (`ResearcherRunResult`) plus the raw events, so `checkFixtureResearcher`
// can diff it against the baseline leg (order-insensitive admission sets).
// ---------------------------------------------------------------------------

export interface ResearcherLegFinding {
  url: string;
  title: string;
  domain: string;
  content: string;
  credibilityScore: number;
  milestoneId?: string;
  milestoneTitle?: string;
}

export interface ResearcherLegOutcome {
  result: {
    researcherId: string;
    facetIndex: number;
    facet: string;
    findings: ResearcherLegFinding[];
    toolCalls: number;
    dedupeShared: number;
  } | null;
  events: LiveEvent[];
  /** Vendored-plane ledger snapshots captured before the finally's reset —
   * the D5 proof that the leg retrieved through the planes. */
  planeLedger: { search: { ledgered: number; active: number }; scrape: { ledgered: number; active: number } } | null;
}

/** Replay one fixture facet through the re-hosted researcher path (ticket
 * #146): a hosted AgentSession on the plane-backed research tools with the
 * scripted transport, offline via the routing fetch. */
export async function runResearcherLeg(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<ResearcherLegOutcome> {
  const { createAgenticToolSurface } = await import('./agenticSearch');
  const { claimAndShare, resetFetchLedger } = await import('./fetchLedger');
  const { primarySearchPlane } = await import('./searchPlane');
  const { primaryScrapePlane, __testSeams: scrapeSeams, resetScrapePlane } = await import('./scrapePlane');
  const { resetSearchPlane } = await import('./searchPlane');

  const sessionId = `${options.sessionIdPrefix ?? 'parity-researcher'}-${fixture.name}`;
  const events: LiveEvent[] = [];
  const findings: ResearcherLegFinding[] = [];
  let fetchesTotal = 0;
  let planeLedger: ResearcherLegOutcome['planeLedger'] = null;

  const previousFetch = globalThis.fetch;
  let lastError: unknown = undefined;
  try {
    // Same protected global-scope pattern as every leg (#151 review law):
    // fetch and the DNS seam are patched INSIDE the try, restored in the
    // finally — a setup throw never leaks process state.
    globalThis.fetch = makeFixtureFetch(fixture) as typeof globalThis.fetch;
    const fixtureHostnames = new Set(
      Object.keys(fixture.pageHtml).map((u) => {
        try { return new URL(u).hostname; } catch { return u; }
      })
    );
    scrapeSeams.setLookupOverride(async (hostname) => {
      if (!fixtureHostnames.has(hostname)) {
        throw new Error(`parity fixture "${fixture.name}" has no DNS route for ${hostname}`);
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });
    resetScrapePlane();
    resetSearchPlane();
    resetActiveCore();

    // ONE HOSTED SESSION PER MILESTONE — the parent's fan-out contract
    // (one researcher per facet, #90): the re-hosted leg replays every
    // facet the plan assigns, sequentially for deterministic parity.
    const { createResearchSession } = await import('./agentSessionHost');
    const { runAgenticSearch } = await import('./agenticSearch');
    const seen = new Set<string>();
    for (let facetIndex = 0; facetIndex < fixture.plan.milestones.length; facetIndex++) {
      const milestone = fixture.plan.milestones[facetIndex];
      const facet = milestone?.query ?? fixture.query;
      const milestoneId = milestone?.id || `m${facetIndex + 1}`;
      const milestoneTitle = milestone?.query || facet;
      const brief = [
        `You are a specialized research subagent.`,
        `Your assigned research facet (topic ${facetIndex + 1}/${fixture.plan.milestones.length}): "${facet}".`,
        `Investigate ONLY this facet. Use the provided web tools to search for, fetch, and verify sources relevant to the facet.`,
        `Be concise: report the key facts you verified with their sources. Do not write a full report — the parent agent synthesizes.`,
      ].join('\n');

      // The REAL researcher tool surface — the SAME plane-backed surface the
      // #143 agentic leg uses (createAgenticToolSurface): the LENS-wrapped
      // web_search/fetch_content tools whose retrieval routes through the
      // ADR-0013 plane ledger with the gate and SSRF validation inside the
      // wrappers, and the admission guard as the start-time authority.
      const facetState = { sources: [] as SourceItem[], reportChunks: [] as string[], fetchesUsed: 0 };
      const surface = createAgenticToolSurface({
        sessionId,
        state: facetState,
        maxFetches: 8,
        emit: (event) => events.push(event),
        search: async (query) => {
          const hits = await primarySearchPlane(query);
          return hits.map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.snippet }));
        },
        fetchPage: async (url) => {
          const page = await primaryScrapePlane(url);
          if (!page?.content || page.content.startsWith('Content unavailable from ')) return null;
          return { url: page.url, title: page.title, text: page.content };
        },
      });

      // Researcher-harvest contract (the #89 ingestUrl contract, fed by the
      // runtime's tool execution): every URL surfaced by the surface's
      // web_search is FETCHED through the session ledger into the facet's
      // findings pool with the facet's milestone provenance — a snippet-only
      // shared entry is never enough (the #150 evidence-preservation clause:
      // findings carry the full page). Cross-researcher dedupe semantics
      // survive the swap bit-for-bit: the ledger shares one raw fetch.
      const harvest = async (url: string): Promise<void> => {
        if (seen.has(url) || findings.length >= 8) return;
        seen.add(url);
        try {
          const entry = await claimAndShare(sessionId, url, async () => {
            const page = await primaryScrapePlane(url);
            if (!page?.content || page.content.startsWith('Content unavailable from ') || page.content.startsWith('Error retrieving ')) return null;
            return page;
          });
          const page = entry?.page;
          if (
            !page
            || typeof page.title !== 'string'
            || typeof page.domain !== 'string'
            || typeof page.content !== 'string'
            || typeof page.credibilityScore !== 'number'
          ) return;
          findings.push({
            url: page.url,
            title: page.title,
            domain: page.domain,
            content: page.content,
            credibilityScore: page.credibilityScore,
            milestoneId,
            milestoneTitle,
          });
          events.push({
            type: 'source',
            url: page.url,
            title: page.title,
            domain: page.domain,
            credibility: page.credibilityScore as number,
            snippet: page.content.slice(0, 160),
            milestoneId,
            milestoneTitle,
          });
        } catch (err) {
          seen.delete(url);
          console.warn(`[runResearcherLeg] ingest failed for ${url}:`, err);
        }
      };
      const surfaceHandler = surface.handler;
      surface.handler = async (call) => {
        const outcome = await surfaceHandler(call);
        if (call.name === 'web_search' && outcome.success && typeof outcome.result === 'string') {
          let urlCount = 0;
          for (const match of outcome.result.matchAll(/https?:\/\/[^\s"'<>\\)\]]+/g)) {
            if (urlCount >= 8) break;
            urlCount += 1;
            await harvest(match[0].replace(/[.,;]+$/, ''));
          }
        }
        return outcome;
      };

      // This facet's retrievable pages: the fixture builders derive each
      // page host from its milestone query slug, so the facet's script
      // fetches ITS facet's pages (the parent researcher never touches
      // another facet's evidence).
      const facetSlug = facet.replace(/[^a-z0-9]+/gi, '');
      const facetPages = Object.keys(fixture.pageHtml).filter((u) => {
        try { return new URL(u).hostname.startsWith(facetSlug); } catch { return false; }
      });

      // Construction through the #140 seam (same form as the #142 runner's
      // bootstrap); the scripted transport rides as streamFunction (the #142
      // scripted-transport precedent), and the brief drives the agent window.
      // The run itself goes through the REAL runner — runAgenticSearch — so
      // the researcher window carries the explicit-terminal and
      // event-faithfulness contracts, not a hand-rolled loop.
      const hosted = await createResearchSession(
        { sessionId, agentDir: mkdtempSync(join(tmpdir(), 'lens-parity-researcher-')) },
        surface
      );
      hosted.session.agent.streamFunction = makeResearcherLegTransport(
        fixture.report,
        facetPages,
        facet,
        [brief]
      );

      await runAgenticSearch(hosted.session, {
        sessionId,
        question: brief,
        state: facetState,
        emit: (event) => events.push(event),
      });
      fetchesTotal += facetState.fetchesUsed;
    }
    lastError = undefined;
  } catch (error) {
    lastError = error;
  } finally {
    // The D5 evidence is captured BEFORE the planes reset: the snapshot
    // proves the leg exercised the vendored planes (never the silent
    // fallbacks), and it must survive the finally's own restoration.
    try {
      const { searchPlaneLedgerSnapshot } = await import('./searchPlane');
      const { scrapePlaneLedgerSnapshot } = await import('./scrapePlane');
      planeLedger = { search: searchPlaneLedgerSnapshot(), scrape: scrapePlaneLedgerSnapshot() };
    } catch {
      planeLedger = null;
    }
    globalThis.fetch = previousFetch;
    scrapeSeams.setLookupOverride(null);
    resetScrapePlane();
    resetSearchPlane();
    resetActiveCore();
    resetFetchLedger(sessionId);
  }
  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  return {
    result: {
      researcherId: `researcher_${sessionId}`,
      facetIndex: 0,
      facet: fixture.plan.milestones[0]?.query ?? fixture.query,
      findings,
      toolCalls: fetchesTotal,
      dedupeShared: 0,
    },
    events,
    planeLedger,
  };
}

function makeRequest(fixture: ParityFixture, researcherMode: boolean): ResearchRequest {
  return {
    query: fixture.query,
    report_type: 'quick',
    language: fixture.language === 'ar' ? 'ar' : 'en',
    llm_provider: 'openai',
    model_name: 'test-model',
    search_provider: 'duckduckgo',
    embedding_enabled: false,
    plan: fixture.plan,
    agency_mode: true,
    researcher_mode: researcherMode,
  } as ResearchRequest;
}

// ---------------------------------------------------------------------------
// The researcher parity check (#146): the re-hosted leg against the ADR-0011
// four-stage diff. Baseline = the parent's DELEGATED run (researcher_mode
// OFF) — the same reference the fan-out stage has used since #94. Comparison
// semantics are the order-insensitive admission semantics (the re-hosted
// researcher may admit pages in a different order than the loop); grounding
// is diffed on the canonical (URL-sorted) pool; the sequence stage is the
// delegated-loop backbone (researcher/additive events excluded). A
// zero-ledger re-hosted run (no findings at all) is a broken run, never a
// vacuous pass (ADR-0013 D5).
// ---------------------------------------------------------------------------

export async function checkFixtureResearcher(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<ParityReport> {
  const stages: ParityStageResult[] = [];
  const coverageThreshold = options.thresholds?.coverageDelta ?? PARITY_THRESHOLDS.coverageDelta;
  const baseline = await runLeg(fixture, 'delegation', options);
  const rehosted = await runResearcherLeg(fixture, options);

  const baselineSources = baseline.finished?.sources ?? [];
  const rehostedSources = rehosted.result?.findings ?? [];

  // Stage 1: coverage — ABSOLUTE form (the #143 agentic-leg precedent): the
  // re-hosted researcher's admitted pages must cover the golden query. A
  // delta against the delegated leg's finished sources would compare unequal
  // SHAPES, not equivalent pipelines: the delegated loop's finished sources
  // surface snippets only (its own admission pipeline), while the researcher
  // contract (ResearcherRunResult) carries full pages — the same evidence at
  // greater depth. Absolute coverage measures the re-hosted execution
  // against the fixture's golden facts.
  const rehostedCoverage = auditEvidenceCoverage(
    fixture.query,
    [],
    rehostedSources.map((f) => ({ content: f.content, domain: f.domain })),
    { language: fixture.language === 'ar' ? 'ar' : 'en' }
  ).overallScore;
  stages.push({
    stage: 'coverage',
    ok: rehostedCoverage >= 1 - coverageThreshold,
    detail: `re-hosted coverage=${rehostedCoverage} (≥ ${1 - coverageThreshold})`,
    expected: '≥ ' + (1 - coverageThreshold),
    actual: rehostedCoverage,
  });

  // Stage 2: grounding — ABSOLUTE form (#143): the citation contract's
  // decisions on the golden report over the canonical (URL-sorted) re-hosted
  // pool — every citation valid, none hallucinated.
  const canonical = (sources: Array<{ url: string; content?: string }>): SourceItem[] =>
    ([...sources] as SourceItem[]).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const contract = new CitationGroundingContract();
  contract.registerExcerpts(canonical(rehostedSources).map((s) => ({
    ...s,
    passage: (s as SourceItem).passage ?? (s as { content?: string }).content,
  })));
  const v = contract.verifyAndSanitize(fixture.report);
  const groundingOk = v.totalFound > 0 && v.hallucinatedCount === 0;
  stages.push({
    stage: 'grounding',
    ok: groundingOk,
    detail: groundingOk
      ? `grounding holds over the re-hosted pool (${v.validCount} valid / 0 hallucinated)`
      : `grounding diverged (${v.validCount} valid / ${v.hallucinatedCount} hallucinated of ${v.totalFound})`,
    expected: 'all citations valid',
    actual: groundingOk ? undefined : v.hallucinatedIndices,
  });

  // Stage 3: admissions — CROSS-LEG parity: the re-hosted researcher must
  // admit exactly the URL set the delegated baseline admitted for the same
  // fixture (order-insensitive), and a zero-ledger run is a broken run,
  // never a vacuous pass (ADR-0013 D5).
  const admittedUrls = [...new Set(rehostedSources.map((f) => f.url))].sort();
  const baselineUrls = [...new Set(baselineSources.map((s) => s.url))].sort();
  const zeroLedger = admittedUrls.length === 0;
  const admissionsOk = !zeroLedger && JSON.stringify(admittedUrls) === JSON.stringify(baselineUrls);
  stages.push({
    stage: 'admissions',
    ok: admissionsOk,
    detail: zeroLedger
      ? 'zero-ledger re-hosted run: no page admitted through the plane — a broken run, not a parity pass'
      : admissionsOk
        ? `identical admissions (${admittedUrls.length} sources, re-hosted vs baseline)`
        : `admission sets diverged: baseline=${JSON.stringify(baselineUrls)} re-hosted=${JSON.stringify(admittedUrls)}`,
    expected: admissionsOk ? undefined : baselineUrls,
    actual: admissionsOk ? undefined : admittedUrls,
  });

  // Stage 4: sequence — ANCHORED agentic form (the #143 precedent): each
  // re-hosted researcher window carries the runtime lifecycle with the tool
  // rounds and streamed report inside the agent window, and terminates
  // explicitly. The baseline leg's delegated backbone stays the recorded
  // #88 contract (pinned by checkFixture); the re-hosted windows are the
  // bridge vocabulary, not the delegated loop's.
  const types: string[] = rehosted.events.map((e) => e.type as string);
  // Multiple researcher windows (one per facet): the anchored read spans the
  // WHOLE run — first window open to last window close, with the final
  // terminal last.
  const agentStart = types.indexOf('session_state');
  const agentEnd = types.lastIndexOf('session_state');
  const firstStatus = types.indexOf('status');
  const firstReport = types.indexOf('report_chunk');
  const finishedIdx = types.lastIndexOf('finished');
  const anchored = [
    agentStart !== -1,
    firstStatus > agentStart && firstStatus < agentEnd,
    firstReport > agentStart && firstReport < agentEnd,
    finishedIdx > agentStart && finishedIdx > types.lastIndexOf('status'),
    !types.includes('error') && !types.includes('cancelled') && !types.includes('budget_exhausted'),
  ];
  const sequenceOk = anchored.every(Boolean);
  const baselineBackbone = backboneOf(baseline.events);
  stages.push({
    stage: 'sequence',
    ok: sequenceOk,
    detail: sequenceOk
      ? `re-hosted windows anchored (${types.length} events; ${fixture.plan.milestones.length} researcher windows; delegated baseline backbone ${baselineBackbone.length} events intact)`
      : `re-hosted backbone diverged: ${anchored.map((a, i) => ['agent-ran', 'tool-round-window', 'report-window', 'explicit-terminal', 'no-failure'][i] + '=' + (a ? '✔' : '✖')).join(' ')}`,
    expected: sequenceOk ? undefined : 'session_state(running) → [tool rounds + report] → session_state(completed) → finished (per window)',
    actual: sequenceOk ? undefined : types.join(','),
  });

  const ok = stages.every((s) => s.ok);
  const fixtureResult: ParityFixtureResult = {
    fixture: `researcher/${fixture.name}`,
    ok,
    stages,
    summary: stages.map((s) => `${s.ok ? '✔' : '✖'} researcher/${fixture.name}/${s.stage}: ${s.detail}`),
  };
  const firstBad = stages.find((s) => !s.ok);
  return {
    ok,
    results: [fixtureResult],
    divergence: firstBad
      ? {
          fixture: `researcher/${fixture.name}`,
          stage: firstBad.stage,
          detail: firstBad.detail,
          expected: firstBad.expected,
          actual: firstBad.actual,
        }
      : null,
  };
}

/** The scripted researcher for the fan-out leg (#146): one re-hosted
 * hosted-session researcher per facet — the REAL runRehostedResearcher
 * machinery on the session-level scripted transport (search its facet →
 * fetch its pages → terse report), per-researcher temp agentDir. The
 * parent's orchestration (fan-out pool, caps, budget, delegation) is the
 * code under test and runs unchanged. */
function makeScriptedResearcherFactory(fixture: ParityFixture) {
  return (sessionId: string, emitEvent: (event: LiveEvent) => void, options: import('./researcherAgent').ResearcherOptions) => ({
    run: async (request: ResearchRequest, signal?: AbortSignal) => {
      const { runRehostedResearcher } = await import('./researcherAgent');
      const slug = options.facet.replace(/[^a-z0-9]+/gi, '');
      const pages = Object.keys(fixture.pageHtml).filter((u) => {
        try { return new URL(u).hostname.startsWith(slug); } catch { return false; }
      });
      const decorate = (session: any) => {
        session.agent.streamFunction = makeResearcherLegTransport(
          fixture.report,
          pages,
          options.facet,
          []
        );
      };
      return runRehostedResearcher(
        sessionId,
        emitEvent,
        { ...options, agentDir: mkdtempSync(join(tmpdir(), 'lens-parity-researcher-')) },
        request,
        signal,
        decorate
      );
    },
  });
}

export async function runLeg(
  fixture: ParityFixture,
  path: 'delegation' | 'fanout',
  options: ParityHarnessOptions
): Promise<LegOutcome> {
  const events: LiveEvent[] = [];
  const emit = (e: LiveEvent) => events.push(e);
  const request = makeRequest(fixture, path === 'fanout');
  const previousFetch = globalThis.fetch;
  const { __testSeams: scrapeSeams } = await import('./scrapePlane');
  // Global state (fetch, DNS seam, active core) is only mutated INSIDE the
  // protected scope: any setup throw must still restore the process for the
  // next leg/test, never leak a patched fetch or DNS override.
  try {
    globalThis.fetch = makeFixtureFetch(fixture) as typeof globalThis.fetch;
    // Scrape-plane offline seam (#111): fixture hostnames must resolve for the
    // vendored SSRF validator (real DNS never consulted). Non-fixture hostnames
    // fail loudly — the offline contract is preserved, and the legs scrape the
    // golden pages through the real vendored plane instead of degrading to
    // identical-but-empty runs that would pass the stages vacuously.
    const fixtureHostnames = new Set(
      Object.keys(fixture.pageHtml).map((u) => {
        try { return new URL(u).hostname; } catch { return u; }
      })
    );
    scrapeSeams.setLookupOverride(async (hostname) => {
      if (!fixtureHostnames.has(hostname)) {
        throw new Error(`parity fixture "${fixture.name}" has no DNS route for ${hostname}`);
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });
    resetActiveCore();
    setActiveCore('pi', { overrideFactory: async () => options.provider });
    await new ParentResearchAgent(
      `${options.sessionIdPrefix ?? 'parity'}-${fixture.name}`,
      emit,
      undefined,
      path === 'fanout' ? makeScriptedResearcherFactory(fixture) : undefined,
      { respecialization: false }
    ).run(request);
  } finally {
    globalThis.fetch = previousFetch;
    scrapeSeams.setLookupOverride(null);
    resetActiveCore();
  }
  // #146: the fan-out leg now carries THREE finished events — the two
  // re-hosted researchers' windows AND the delegated loop's terminal. The
  // leg's outcome is the DELEGATED terminal (the last one): it carries the
  // merged evidence pool. events.find would grab a researcher window's
  // window-scoped terminal (2 window sources), breaking the parity stages.
  const finished = events.filter((e) => e.type === 'finished').at(-1) as LiveEvent | undefined;
  return {
    events,
    finished: finished ? { report: finished.report, sources: finished.sources } : null,
  };
}

// ---------------------------------------------------------------------------
// The researcher leg (#146): the final migration. The golden fixture replays
// through the REAL researcher machinery — a hosted AgentSession (ADR-0014
// construction contract) on the plane-backed research toolset — driven by a
// scripted transport inside the agent window. Same offline contract as every
// other leg: the routing fetch serves the fixture pages, fixture hostnames
// resolve for the vendored SSRF validator, and the SAME four-stage ADR-0011
// diff applies (order-insensitive admission semantics for parallel fan-outs).
// ---------------------------------------------------------------------------

/** Scripted pi-ai transport for the researcher leg: one tool round
 * (search → fetch the fixture pages) inside the agent window, then the
 * golden report verbatim — identical synthesis inputs by construction.
 * `briefTurns` are the exact user texts that open the researcher window
 * (the brief itself); any other turn (session titling etc.) answers
 * tersely without touching the tools. */
export function makeResearcherLegTransport(
  report: string,
  pageUrls: string[],
  searchQuery: string,
  briefTurns: string[] = []
): any {
  const usage = { input: 1, output: 1, total: 2 };
  const finalize = (m: any) => ({ ...m, role: 'assistant', api: 'scripted', provider: 'scripted', model: 'scripted-1', usage });
  const streamOf = (m: any) => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'done', reason: m.stopReason, message: m };
    },
    async result() {
      return m;
    },
  });
  const toolResultCount = (context: any): number =>
    (context?.messages ?? []).filter((m: any) => m.role === 'toolResult').length;
  const lastUserText = (context: any): string => {
    const messages = context?.messages ?? [];
    const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
    if (!lastUser) return '';
    const content = lastUser.content ?? lastUser.text ?? '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
    return '';
  };
  return async (_model: unknown, context: any) => {
    // Unrelated turns (session titling etc.) answer tersely; the researcher
    // window opens on the brief (which embeds the facet query), a bare-facet
    // question, or an explicitly registered brief text.
    const userText = lastUserText(context);
    const researcherTurn =
      userText === searchQuery
      || briefTurns.includes(userText)
      || userText.includes(`"${searchQuery}"`);
    if (!researcherTurn) {
      return streamOf(finalize({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }));
    }
    if (toolResultCount(context) === 0) {
      return streamOf(finalize({
        content: [{ type: 'toolCall', id: 'call-search', name: 'web_search', arguments: { query: searchQuery } }],
        stopReason: 'toolUse',
      }));
    }
    // Exactly ONE fetch round: re-emitting the page set when every result is
    // already in context would re-spend the session budget on ledger-shared
    // duplicate calls (#143: every fetch_content call costs a unit even when
    // the fetch is shared) — with a full 8-page facet that exhausts the
    // researcher's maxFetches before the report round.
    if (toolResultCount(context) < pageUrls.length && pageUrls.length > 0) {
      return streamOf(finalize({
        content: pageUrls.map((url, i) => ({
          type: 'toolCall', id: `call-fetch-${i}`, name: 'fetch_content', arguments: { url },
        })),
        stopReason: 'toolUse',
      }));
    }
    return streamOf(finalize({ content: [{ type: 'text', text: report }], stopReason: 'stop' }));
  };
}

/** Compare one fixture across all four stages:
 * outcome stages pin the fan-out leg to the delegation baseline
 * (order-insensitive admission semantics); the sequence stage pins the
 * delegated-loop backbone to the recorded baseline contract (#88 precedent,
 * now agent-level). */
export async function checkFixture(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<ParityFixtureResult> {
  const stages: ParityStageResult[] = [];
  const coverageThreshold = options.thresholds?.coverageDelta ?? PARITY_THRESHOLDS.coverageDelta;

  const delegation = await runLeg(fixture, 'delegation', options);
  const fanout = await runLeg(fixture, 'fanout', options);

  // Stage 1: coverage score (over each leg's finished sources). Since #146
  // the stage reads the SNIPPET layer only, on BOTH legs: the delegated
  // loop's finished sources legitimately carry snippets-only, while the
  // re-hosted researchers' findings enter the pool as full pages — measuring
  // full-page depth on one leg and snippet depth on the other compares
  // unequal shapes, not equivalent pipelines (the #143 absolute-form
  // lesson). Admission equality (stage 3) keeps the evidence identical;
  // this stage asserts both legs' reported evidence covers the query.
  const coverageOf = (leg: LegOutcome): number =>
    auditEvidenceCoverage(
      fixture.query,
      [],
      (leg.finished?.sources ?? []).map((s) => ({ content: s.snippet ?? s.passage ?? '', domain: s.domain })),
      { language: fixture.language === 'ar' ? 'ar' : 'en' }
    ).overallScore;
  const baselineCoverage = coverageOf(delegation);
  const fanoutCoverage = coverageOf(fanout);
  const coverageDelta = Math.abs(Number((baselineCoverage - fanoutCoverage).toFixed(2)));
  stages.push({
    stage: 'coverage',
    ok: coverageDelta <= coverageThreshold,
    detail: `delegation=${baselineCoverage} fanout=${fanoutCoverage} |Δ|=${coverageDelta} (≤ ${coverageThreshold})`,
    expected: baselineCoverage,
    actual: fanoutCoverage,
  });

  // Stage 2: citation grounding audit — identical sanitizer decisions on the
  // same report + shared evidence pool (admission preprocessing is
  // path-invariant by contract, so grounding decisions must match exactly).
  // Citation indices are positional over the registered excerpts, so the
  // shared pool is canonicalized by URL first — the fan-out leg's sources
  // array order is researcher-arrival dependent, which must not affect the
  // grounding contract (ADR-0011: order-insensitive admission semantics).
  const canonicalSourcesOf = (leg: LegOutcome): SourceItem[] =>
    [...(leg.finished?.sources ?? [])].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const groundingOf = (leg: LegOutcome) => {
    const contract = new CitationGroundingContract();
    // The grounding pool reads the SNIPPET layer on both legs (shape-neutral;
    // see stage 1's note): the citation contract's decisions must match
    // exactly on identical evidence at the same reported depth.
    contract.registerExcerpts(canonicalSourcesOf(leg).map((s) => ({ ...s, passage: s.snippet ?? s.passage })));
    const v = contract.verifyAndSanitize(leg.finished?.report ?? '');
    return {
      sanitizedText: v.sanitizedText,
      totalFound: v.totalFound,
      validCount: v.validCount,
      hallucinatedCount: v.hallucinatedCount,
      validIndices: v.validIndices,
      hallucinatedIndices: v.hallucinatedIndices,
    };
  };
  const baselineGrounding = groundingOf(delegation);
  const fanoutGrounding = groundingOf(fanout);
  const groundingEqual = JSON.stringify(baselineGrounding) === JSON.stringify(fanoutGrounding);
  stages.push({
    stage: 'grounding',
    ok: groundingEqual,
    detail: groundingEqual
      ? `identical grounding audit (${baselineGrounding.validCount} valid / ${baselineGrounding.hallucinatedCount} hallucinated)`
      : 'grounding audit diverged (delegation vs fan-out)',
    expected: groundingEqual ? undefined : baselineGrounding,
    actual: groundingEqual ? undefined : fanoutGrounding,
  });

  // Stage 3: admission counts — exact as SET semantics (researchers may
  // admit pages in a different order and emit extra per-facet source events;
  // the distinct admitted URL sets must still match the legacy loop).
  const admissionsOf = (leg: LegOutcome) => ({
    finishedUrls: [...new Set((leg.finished?.sources ?? []).map((s) => s.url))].sort(),
    scrapedUrls: [...new Set(leg.events.filter((e) => e.type === 'source').map((e) => e.url ?? ''))].sort(),
  });
  const baselineAdmissions = admissionsOf(delegation);
  const fanoutAdmissions = admissionsOf(fanout);
  const admissionsEqual = JSON.stringify(baselineAdmissions) === JSON.stringify(fanoutAdmissions);
  stages.push({
    stage: 'admissions',
    ok: admissionsEqual,
    detail: admissionsEqual
      ? `identical admissions (${baselineAdmissions.finishedUrls.length} sources / ${baselineAdmissions.scrapedUrls.length} scraped URLs)`
      : 'admission sets diverged (delegation vs fan-out)',
    expected: admissionsEqual ? undefined : baselineAdmissions,
    actual: admissionsEqual ? undefined : fanoutAdmissions,
  });

  // Stage 4: LiveEvent backbone — the delegated-loop backbone must equal the
  // recorded baseline contract (graph_node/thought/subqueries/reflection/
  // audit/report_chunk/finished order; #88 precedent at agent level; the
  // fan-out leg legitimately emits extra additive/researcher events).
  const delegationBackbone = backboneOf(delegation.events);
  const fanoutBackbone = backboneOf(fanout.events);
  const sequenceEqual = JSON.stringify(delegationBackbone) === JSON.stringify(fanoutBackbone);
  stages.push({
    stage: 'sequence',
    ok: sequenceEqual,
    detail: sequenceEqual
      ? `identical backbone (${delegationBackbone.length} events, delegation vs fan-out)`
      : 'LiveEvent backbone diverged (delegation vs fan-out)',
    expected: sequenceEqual ? undefined : delegationBackbone,
    actual: sequenceEqual ? undefined : fanoutBackbone,
  });

  const ok = stages.every((s) => s.ok);
  return {
    fixture: fixture.name,
    ok,
    stages,
    summary: stages.map((s) => `${s.ok ? '✔' : '✖'} ${fixture.name}/${s.stage}: ${s.detail}`),
  };
}

/** Run the full harness: every fixture through both agency legs, with a
 * readable equivalence report. */
export async function runParityHarness(
  fixtures: ParityFixture[],
  options: ParityHarnessOptions
): Promise<ParityReport> {
  const results: ParityFixtureResult[] = [];
  for (const fixture of fixtures) {
    results.push(await checkFixture(fixture, options));
  }
  const firstBad = results.find((r) => !r.ok);
  const divergence = firstBad
    ? (() => {
        const stage = firstBad.stages.find((s) => !s.ok)!;
        return {
          fixture: firstBad.fixture,
          stage: stage.stage,
          detail: stage.detail,
          expected: stage.expected,
          actual: stage.actual,
        };
      })()
    : null;
  return { ok: results.every((r) => r.ok), results, divergence };
}

/** Render the readable equivalence report (for logs and the artifact). */
export function formatParityReport(report: ParityReport): string {
  const lines: string[] = [];
  lines.push(`Parity harness: ${report.ok ? 'EQUIVALENT ✔' : 'DIVERGED ✖'}`);
  for (const r of report.results) {
    for (const line of r.summary) lines.push(`  ${line}`);
  }
  if (report.divergence) {
    lines.push(
      `Divergence: fixture=${report.divergence.fixture} stage=${report.divergence.stage} — ${report.divergence.detail}`
    );
    lines.push(`Expected: ${JSON.stringify(report.divergence.expected)}`);
    lines.push(`Actual:   ${JSON.stringify(report.divergence.actual)}`);
  }
  return lines.join('\n');
}
