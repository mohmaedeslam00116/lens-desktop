/**
 * parityHarness.ts — parity regression harness (ADR-0010 phase-3 gate, ticket #94).
 *
 * Replays golden fixture runs through BOTH research paths — the legacy
 * standard loop (DeepResearchAgent) and the agency path (ParentResearchAgent
 * with per-facet researchers) — in the same process on identical offline
 * fixtures, and diffs the outcomes:
 *
 *   1. Coverage score           |Δ overallScore| ≤ 0.05 (rounded to 2 dp)
 *   2. Citation grounding audit identical (sanitized report + per-claim
 *      audit fields over the shared evidence pool)
 *   3. Admission counts         exact match (finished sources + source events)
 *   4. LiveEvent sequence       identical shared backbone (additive
 *                               agency-only events filtered, consecutive
 *                               report_chunk runs collapsed)
 *
 * Equivalence thresholds (ADR-0011):
 *  - Coverage: |Δ| ≤ 0.05 — both paths ingest through the same admission
 *    pipeline; small numeric drift from MMR ordering is tolerated, semantic
 *    drift is not.
 *  - Grounding / admissions / sequence: EXACT — both paths must make
 *    identical admission and grounding decisions on identical evidence.
 *
 * Fixtures are offline: the harness injects a routing `fetchImpl` that serves
 * deterministic HTML for the fixtures' search + page URLs, so the REAL
 * MultiSearchProvider / PageScraper / DeduplicationEngine / BoundedScraperPool
 * stack runs in every leg. The faux LLM provider is supplied by the caller
 * (the same one for every leg → identical synthesis inputs).
 *
 * Per fixture the harness runs THREE legs:
 *   - legacy    : DeepResearchAgent (the reference path)
 *   - delegation: ParentResearchAgent with researcher_mode OFF — the strict
 *                 LiveEvent-sequence stage pins this leg's shared backbone
 *                 (source events included) to the legacy loop (the #88
 *                 byte-equivalence contract, generalized)
 *   - fanout    : ParentResearchAgent with researcher_mode ON — the outcome
 *                 stages (coverage / grounding / admissions) pin this leg's
 *                 RESULTS to the legacy loop. Comparisons here are
 *                 order-insensitive (admission set semantics): researchers
 *                 may admit the same pages in a different order and emit
 *                 extra per-facet `source` events; the SET of admitted
 *                 sources, the coverage score, and the grounding decisions
 *                 must still match exactly.
 *
 * The agency legs run with `respecialization: false` for deterministic
 * launch counts (ADR-0011; #93's deficit follow-ups are exercised by their
 * own suite).
 */

import { DeepResearchAgent } from './agent';
import { ParentResearchAgent } from './parentAgent';
import { resetActiveCore, setActiveCore } from './modelGateway';
import { auditEvidenceCoverage } from './evidenceCoverage';
import { CitationGroundingContract } from './synthesis';
import { LiveEvent, ResearchPlan, ResearchRequest, SourceItem } from './types';

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

/** Collapse consecutive report_chunk runs and strip agency-only additive
 * events — the shared backbone contract (ticket #88 parity test precedent). */
export function backboneOf(events: LiveEvent[]): string[] {
  const filtered = events.filter(
    (e) => e.type !== 'researcher_telemetry'
      && e.type !== 'fanout_telemetry'
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
      for (const [query, html] of Object.entries(fixture.searchHtml)) {
        if (url.includes(encodeURIComponent(query))) return html;
      }
      return null;
    }
    for (const [pageUrl, html] of Object.entries(fixture.pageHtml)) {
      if (url === pageUrl || url.startsWith(pageUrl)) return html;
    }
    return null;
  };
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const html = route(url);
    if (html === null) {
      return new Response(`parity fixture "${fixture.name}" has no route for ${url}`, { status: 404 });
    }
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
}

function makeRequest(fixture: ParityFixture, researcherMode: boolean): ResearchRequest {
  return {
    query: fixture.query,
    report_type: 'quick',
    language: fixture.language === 'ar' ? 'ar' : 'en',
    llm_provider: 'openai',
    model_name: 'test-model',
    api_keys: { openai: 'test-key' },
    search_provider: 'duckduckgo',
    embedding_enabled: false,
    plan: fixture.plan,
    agency_mode: true,
    researcher_mode: researcherMode,
  } as ResearchRequest;
}

async function runLeg(
  fixture: ParityFixture,
  path: 'legacy' | 'delegation' | 'fanout',
  options: ParityHarnessOptions
): Promise<LegOutcome> {
  const events: LiveEvent[] = [];
  const emit = (e: LiveEvent) => events.push(e);
  const request = makeRequest(fixture, path === 'fanout');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = makeFixtureFetch(fixture) as typeof globalThis.fetch;
  resetActiveCore();
  setActiveCore('pi', { overrideFactory: async () => options.provider });
  try {
    if (path === 'legacy') {
      await new DeepResearchAgent(`${options.sessionIdPrefix ?? 'parity'}-${fixture.name}`, emit).run(request);
    } else {
      await new ParentResearchAgent(
        `${options.sessionIdPrefix ?? 'parity'}-${fixture.name}`,
        emit,
        undefined,
        undefined,
        { respecialization: false }
      ).run(request);
    }
  } finally {
    globalThis.fetch = previousFetch;
    resetActiveCore();
  }
  const finished = events.find((e) => e.type === 'finished') as LiveEvent | undefined;
  return {
    events,
    finished: finished ? { report: finished.report, sources: finished.sources } : null,
  };
}

/** Compare one fixture across all four stages:
 * outcome stages pin the fan-out leg to the legacy loop (order-insensitive
 * admission semantics); the sequence stage pins the delegation leg's shared
 * backbone to the legacy loop. */
export async function checkFixture(
  fixture: ParityFixture,
  options: ParityHarnessOptions
): Promise<ParityFixtureResult> {
  const stages: ParityStageResult[] = [];
  const coverageThreshold = options.thresholds?.coverageDelta ?? PARITY_THRESHOLDS.coverageDelta;

  const legacy = await runLeg(fixture, 'legacy', options);
  const delegation = await runLeg(fixture, 'delegation', options);
  const fanout = await runLeg(fixture, 'fanout', options);

  // Stage 1: coverage score (over each leg's finished sources).
  const coverageOf = (leg: LegOutcome): number =>
    auditEvidenceCoverage(
      fixture.query,
      [],
      (leg.finished?.sources ?? []).map((s) => ({ content: s.passage ?? s.snippet ?? '', domain: s.domain })),
      { language: fixture.language === 'ar' ? 'ar' : 'en' }
    ).overallScore;
  const legacyCoverage = coverageOf(legacy);
  const fanoutCoverage = coverageOf(fanout);
  const coverageDelta = Math.abs(Number((legacyCoverage - fanoutCoverage).toFixed(2)));
  stages.push({
    stage: 'coverage',
    ok: coverageDelta <= coverageThreshold,
    detail: `legacy=${legacyCoverage} fanout=${fanoutCoverage} |Δ|=${coverageDelta} (≤ ${coverageThreshold})`,
    expected: legacyCoverage,
    actual: fanoutCoverage,
  });

  // Stage 2: citation grounding audit — identical sanitizer decisions on the
  // same report + shared evidence pool (admission preprocessing is
  // path-invariant by contract, so grounding decisions must match exactly).
  const groundingOf = (leg: LegOutcome) => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts(leg.finished?.sources ?? []);
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
  const legacyGrounding = groundingOf(legacy);
  const fanoutGrounding = groundingOf(fanout);
  const groundingEqual = JSON.stringify(legacyGrounding) === JSON.stringify(fanoutGrounding);
  stages.push({
    stage: 'grounding',
    ok: groundingEqual,
    detail: groundingEqual
      ? `identical grounding audit (${legacyGrounding.validCount} valid / ${legacyGrounding.hallucinatedCount} hallucinated)`
      : 'grounding audit diverged (legacy vs fan-out)',
    expected: groundingEqual ? undefined : legacyGrounding,
    actual: groundingEqual ? undefined : fanoutGrounding,
  });

  // Stage 3: admission counts — exact as SET semantics (researchers may
  // admit pages in a different order and emit extra per-facet source events;
  // the distinct admitted URL sets must still match the legacy loop).
  const admissionsOf = (leg: LegOutcome) => ({
    finishedUrls: [...new Set((leg.finished?.sources ?? []).map((s) => s.url))].sort(),
    scrapedUrls: [...new Set(leg.events.filter((e) => e.type === 'source').map((e) => e.url ?? ''))].sort(),
  });
  const legacyAdmissions = admissionsOf(legacy);
  const fanoutAdmissions = admissionsOf(fanout);
  const admissionsEqual = JSON.stringify(legacyAdmissions) === JSON.stringify(fanoutAdmissions);
  stages.push({
    stage: 'admissions',
    ok: admissionsEqual,
    detail: admissionsEqual
      ? `identical admissions (${legacyAdmissions.finishedUrls.length} sources / ${legacyAdmissions.scrapedUrls.length} scraped URLs)`
      : 'admission sets diverged (legacy vs fan-out)',
    expected: admissionsEqual ? undefined : legacyAdmissions,
    actual: admissionsEqual ? undefined : fanoutAdmissions,
  });

  // Stage 4: LiveEvent backbone — strict, delegation leg vs legacy (the #88
  // byte-equivalence contract generalized to every fixture; the fan-out leg
  // legitimately emits extra additive events).
  const legacyBackbone = backboneOf(legacy.events);
  const delegationBackbone = backboneOf(delegation.events);
  const sequenceEqual = JSON.stringify(legacyBackbone) === JSON.stringify(delegationBackbone);
  stages.push({
    stage: 'sequence',
    ok: sequenceEqual,
    detail: sequenceEqual
      ? `identical backbone (${legacyBackbone.length} events, delegation vs legacy)`
      : 'LiveEvent backbone diverged (delegation vs legacy)',
    expected: sequenceEqual ? undefined : legacyBackbone,
    actual: sequenceEqual ? undefined : delegationBackbone,
  });

  const ok = stages.every((s) => s.ok);
  return {
    fixture: fixture.name,
    ok,
    stages,
    summary: stages.map((s) => `${s.ok ? '✔' : '✖'} ${fixture.name}/${s.stage}: ${s.detail}`),
  };
}

/** Run the full harness: every fixture through both paths, with a readable
 * equivalence report. */
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
