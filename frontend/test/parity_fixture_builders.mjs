import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import parityHarnessDefault from '../dist-electron/engine/parityHarness.js';
import researcherAgentDefault from '../dist-electron/engine/researcherAgent.js';
const { makeResearcherLegTransport } = parityHarnessDefault;
const { runRehostedResearcher } = researcherAgentDefault;

/**
 * Shared golden-fixture builders for the ADR-0011 parity suites (the #94
 * delegation/fan-out harness, the #143 agentic leg, and the #146 researcher
 * leg all replay the SAME fixture shape offline).
 *
 * The article pages carry substantive content — the vendored extractor's
 * usefulness bar (MIN_USEFUL_CONTENT = 500 chars) must be cleared by every
 * leg that admits pages through the vendored plane (the researcher leg
 * does; the #143 agentic leg's own suite carries the same lesson). Every
 * fact the pages state is generic deterministic fixture text; the pages
 * mirror their milestone query so the coverage audit is measurable.
 */

function ddgResultsPage(entries) {
  return `<html><body>${entries
    .map(
      (e) => `<div class="result">
        <h2 class="result__a" href="${e.url}">${e.title}</h2>
        <a class="result__snippet" href="${e.url}">${e.snippet}</a>
      </div>`
    )
    .join('')}</body></html>`;
}

function articlePage(title, paragraphs) {
  return `<html><head><title>${title}</title></head><body><article>${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join('')}</article></body></html>`;
}

/** Builds a fixture with per-milestone DDG pages and substantive article
 * pages whose content mirrors BOTH the objective and the milestone query
 * (so absolute coverage is measurable — the #143 lesson: the coverage
 * audit reads the objective's tokens) and that clear the vendored
 * extractor's usefulness bar.
 *
 * The default 2 pages per facet keeps the delegated 'quick' loop (which
 * ingests at most 4 sources and 2 subqueries) able to reach EVERY facet's
 * pages on its own — larger fan-out plans retrieve per-facet evidence the
 * delegated quick loop never fetches, which would break the admission-set
 * parity stages against the baseline (the #94 budget note). */
export function makeFixture(name, objective, milestoneQueries, pagesPerFacet = 2) {
  const plan = {
    id: `plan-${name}`,
    version: 2,
    objective,
    milestones: milestoneQueries.map((q, i) => ({
      id: `m${i + 1}`,
      query: q,
      rationale: `facet ${i + 1}`,
      status: 'pending',
    })),
    suggestedSkills: [],
    status: 'approved',
    estimatedScope: { targetSources: 8, maxHops: 2 },
  };
  const searchHtml = {};
  const pageHtml = {};
  for (const q of milestoneQueries) {
    const entries = [];
    for (let i = 1; i <= pagesPerFacet; i++) {
      const url = `https://${q.replace(/[^a-z0-9]+/gi, '')}-src${i}.example/article`;
      entries.push({ url, title: `${q} source ${i}`, snippet: `${q} overview` });
      pageHtml[url] = articlePage(`${q} source ${i}`, [
        `The ${objective} investigation reports on ${q}: detailed evidence about ${q} shows measurable progress and reproducible results across independent measurements, with the framework and its protocol holding under controlled conditions in every evaluation run of the suite.`,
        `Additional analysis of ${q} confirms the reported trends: the architecture, its implementation, and the algorithm each hold under controlled comparison, with performance metrics recorded per run and reproducible results across independent measurements.`,
        `Further findings on ${q}: benchmark evaluation of the approach shows precision at 88.8%, duplicate fetches dropped by 45%, and average audit time of 12 seconds across the comparison suite, with every measurement documented under controlled conditions.`,
        `The benchmark suite for ${q} also documents the known limitations and risks: bypass attempts are a real challenge, the bottleneck is the single enforcement point, and the trade-off favors one enforcement point over distributed policy checks, with the vulnerability surface staying minimal and the limitation documented.`,
        `Evaluation metrics for ${q}: throughput reaches 120 Mbps, latency drops by 42%, accuracy stands at 99.9%, the comparison score improves by 15%, and the noise margin is 7 dB under controlled conditions, with reproducible results across every independent measurement run in the suite.`,
      ]);
    }
    searchHtml[q] = ddgResultsPage(entries);
  }
  const report =
    `# ${objective} Report\n\n` +
    `The evidence shows clear findings across the research facets. ` +
    `The first key finding is grounded in the retrieved sources [1]. ` +
    `The second key finding is grounded in additional sources [2]. ` +
    `The third key finding is grounded in further sources [3].\n`;
  return { name, query: objective, language: 'en', plan, report, searchHtml, pageHtml };
}

/**
 * Builds the faux pi provider queueing each fixture's OWN golden report —
 * the runner consumes fixtures sequentially, so responses are grouped per
 * fixture (responseCount per fixture, report per fixture). Response budget
 * across the legs per fixture (generous): legacy = 1, delegation = 1,
 * fanout = 2 rounds × #facets + 1 (synthesis). Unused queued responses are
 * harmless.
 */
export async function makeFauxProvider(fixtures) {
  const ai = await import('@earendil-works/pi-ai');
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  const responseCount = (fixture) => 6 + 2 * fixture.plan.milestones.length;
  const queued = [];
  for (const fixture of fixtures) {
    for (let i = 0; i < responseCount(fixture); i++) {
      queued.push(ai.fauxAssistantMessage(fixture.report));
    }
  }
  faux.setResponses(queued);
  return faux;
}

/**
 * The #143 agentic-leg golden fixture shape, shared: one milestone on four
 * substantive pages across four domains, with the coverage vocabulary and
 * metric density the coverage audit needs to reach its full range.
 */
export function makeAgenticFixture(name) {
  const objective = 'Boundary integrity evidence in agentic retrieval';
  const milestoneQuery = 'tool boundary enforcement';
  const plan = {
    id: `plan-${name}`,
    version: 2,
    objective,
    milestones: [{ id: 'm1', query: milestoneQuery, rationale: 'facet 1', status: 'pending' }],
    suggestedSkills: [],
    status: 'approved',
    estimatedScope: { targetSources: 8, maxHops: 2 },
  };
  const hostBase = milestoneQuery.replace(/[^a-z0-9]+/gi, '');
  const pages = [
    [
      'The LENS-wrapped tools of the agentic retrieval loop enforce the retrieval boundary and preserve evidence integrity inside their wrappers. The retrieval gate, the fetch ledger, and SSRF validation all fire inside the wrapper on every single call.',
      'Detailed evidence about boundary enforcement shows the gate and the ledger mechanics admit each page exactly once, and SSRF validation blocks internal address lookups before any content exists.',
      'Additional analysis of the enforcement architecture confirms the framework and its protocol hold under controlled conditions across independent measurements.',
    ],
    [
      'The enforcement architecture and its pipeline mechanics keep the boundary intact: implementation, framework, and algorithm each run inside the LENS-wrapped definitions on every single call the agent makes.',
      'A bypass attempt through a hook cannot execute: the runtime cannot execute a tool it never granted, so no evidence is admitted through a blocked path, and the wrappers stay the single enforcement point.',
      'Further analysis of the enforcement protocol confirms the boundary architecture holds under controlled comparison conditions across independent runs, with reproducible results and measurable progress in every measurement.',
    ],
    [
      'Benchmark results and evaluation metrics show 42% reduction in unledgered retrievals, 99.9% admission accuracy, and 3ms ledger latency across the full benchmark evaluation of the boundary enforcement pipeline.',
      'Throughput reaches 120 Mbps, precision stands at 88.8%, duplicate fetches dropped by 45%, and average audit time is 12 seconds of measured performance in the comparison suite.',
      'The plane sustains 2.5 GHz throughput with a 7 dB noise margin, and the benchmark comparison score improves by 15% under controlled conditions, with reproducible results across every independent measurement run in the suite.',
    ],
    [
      'Known limitations and risks remain: bypass attempts through hooks are a real challenge, and the bottleneck is the single enforcement point that every policy check must traverse.',
      'The trade-off favors one enforcement point over distributed policy checks; the drawback is acceptable and the vulnerability surface stays minimal, though the trade-off is documented.',
      'Further analysis confirms the risk assessment: the limitation is documented, the challenge stays bounded, and no flaw remains unmanaged under controlled conditions.',
    ],
  ];
  const searchEntries = [];
  const pageHtml = {};
  for (let i = 1; i <= pages.length; i++) {
    const url = `https://${hostBase}-src${i}.example/article`;
    searchEntries.push({ url, title: `Wrapper enforcement source ${i}`, snippet: 'The wrappers enforce the boundary.' });
    pageHtml[url] =
      `<html><head><title>Wrapper enforcement source ${i}</title></head><body><article>` +
      pages[i - 1].map((p) => `<p>${p}</p>`).join('') +
      '</article></body></html>';
  }
  const searchHtml = {
    [milestoneQuery]:
      '<html><body>' +
      searchEntries
        .map(
          (e) => `<div class="result"><h2 class="result__a" href="${e.url}">${e.title}</h2>
        <a class="result__snippet" href="${e.url}">${e.snippet}</a></div>`
        )
        .join('') +
      '</body></html>',
  };
  const report =
    '# Boundary integrity evidence in agentic retrieval Report\n\n' +
    'The wrappers enforce the boundary inside their definitions [1]. ' +
    'The gate, ledger, and SSRF checks hold within the enforcement architecture [2]. ' +
    'Evaluation metrics show the admission pipeline performs under benchmark [3]. ' +
    'Known limitations favor a single enforcement point [4].\n';
  return { name, query: objective, language: 'en', plan, report, searchHtml, pageHtml };
}

/** A fixture with NO routable retrieval at all: every search 404s and every
 * page fetch has no DNS route — the run cannot admit a single page. */
export function makeVacuousFixture(name) {
  const plan = {
    id: `plan-${name}`,
    version: 2,
    objective: 'Vacuous retrieval',
    milestones: [{ id: 'm1', query: 'nothing routes here', rationale: 'facet 1', status: 'pending' }],
    suggestedSkills: [],
    status: 'approved',
    estimatedScope: { targetSources: 8, maxHops: 2 },
  };
  return { name, query: 'Vacuous retrieval', language: 'en', plan, report: '# Vacuous\n\nEmpty [1].\n', searchHtml: {}, pageHtml: {} };
}

/** Fresh per-process agentDir for offline session construction (the runtime's
 * credential file is environment-dependent; concurrent test workers must
 * never share one). */
export function freshAgentDir() {
  return mkdtempSync(join(tmpdir(), 'lens-parity-agentsession-'));
}

/**
 * Offline researcher factory for the RE-HOSTED contract (ticket #146): one
 * `runRehostedResearcher` per facet — a REAL hosted AgentSession whose model
 * transport is scripted (the session-level `streamFunction` seam, the same DI
 * point the #142/#143 legs use). The parent's orchestration (fan-out pool,
 * caps, budget, delegation, respecialization) is the code under test and
 * runs unchanged; retrieval itself routes through the real vendored planes,
 * so tests that need findings must serve the fixture pages via the routing
 * fetch + the scrape-plane DNS seam.
 *
 * `pagesFor(options)` returns the page URLs the facet's scripted round
 * fetches (search → fetch pages → terse report); return [] for a researcher
 * that finds nothing. `searchQueryFor(options)` names the query the scripted
 * web_search round issues (default: the facet text). `decorate(session,
 * brief)` rides the same seam for extra observation (e.g. environment
 * probes in the compression tests); `brief` is the researcher's own opening
 * prompt as the engine built it — registered as a scripted turn verbatim,
 * so a custom `searchQueryFor` never needs to couple to the brief's wording.
 */
export function makeScriptedResearcherFactory({ report = 'ok', pagesFor = () => [], searchQueryFor, decorate } = {}) {
  return (sessionId, emit, options) => ({
    run: (request, signal) =>
      runRehostedResearcher(
        sessionId,
        emit,
        { ...options, agentDir: freshAgentDir() },
        request,
        signal,
        (session, brief) => {
          session.agent.streamFunction = makeResearcherLegTransport(
            report,
            pagesFor(options),
            searchQueryFor ? searchQueryFor(options) : options.facet,
            [brief]
          );
          decorate?.(session, brief);
        }
      ),
  });
}
