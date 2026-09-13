import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  runParityHarness,
  formatParityReport,
  PARITY_THRESHOLDS,
} from '../dist-electron/engine/parityHarness.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
});

async function pi() {
  return await import('@earendil-works/pi-ai');
}

// ---------------------------------------------------------------------------
// Golden fixtures: deterministic DDG results + article pages served to the
// REAL retrieval stack (MultiSearchProvider + PageScraper) by the harness's
// routing fetch. No network anywhere.
// ---------------------------------------------------------------------------

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

/** Builds a fixture with per-milestone DDG pages and article pages whose
 * content mirrors the milestone query (so coverage is measurable). */
function makeFixture(name, objective, milestoneQueries, pagesPerFacet = 3) {
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
        `Detailed evidence about ${q}.`,
        `Findings on ${q} show measurable progress and reproducible results across independent measurements.`,
        `Additional analysis of ${q} confirms the reported trends under controlled conditions.`,
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

const FIXTURES = [
  // Legacy 'quick' depth caps ingestion at 4 sources (initialSourceCap) and
  // executes at most 2 subqueries (maxSubqueries), so golden fixtures keep
  // ≤ 2 facets × ≤ 2 pages — within both paths' caps — making admission-set
  // equality meaningful rather than cap-truncated. (Fan-out plans with more
  // facets retrieve per-facet evidence the legacy quick loop never fetches;
  // that is a legitimate agency capability, not a parity break.)
  makeFixture('fusion-en', 'Fusion energy', ['fusion reactor basics', 'tokamak plasma scaling'], 2),
  makeFixture('grid-two-facet', 'Renewable grids', ['solar grid integration', 'wind storage systems'], 2),
];

const REPORT = FIXTURES[0].report;

async function makeFaux(totalResponses) {
  const ai = await pi();
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  const queued = [];
  for (let i = 0; i < totalResponses; i++) queued.push(ai.fauxAssistantMessage(REPORT));
  faux.setResponses(queued);
  return faux;
}

// Response budget across the three legs per fixture (generous):
//   legacy = 1, delegation = 1, fanout = 2 rounds × #facets (researchers,
//   with search hits) + 1 (synthesis). Unused queued responses are harmless.
const responseCount = (fixture) => 6 + 2 * fixture.plan.milestones.length;

const ARTIFACT_DIR = path.join(process.cwd(), 'test', 'artifacts');
const ARTIFACT = path.join(ARTIFACT_DIR, 'parity-report.json');

describe('Parity regression harness (ticket #94 — ADR-0010 phase-3 gate)', () => {
  it('runs both paths on shared offline fixtures and emits a readable equivalence report (baseline parity)', async () => {
    const faux = await makeFaux(FIXTURES.reduce((sum, f) => sum + responseCount(f), 0));
    const report = await runParityHarness(FIXTURES, { provider: faux.provider });

    assert.equal(report.ok, true, `baseline parity broke: ${formatParityReport(report)}`);
    assert.equal(report.divergence, null);
    assert.equal(report.results.length, FIXTURES.length);

    // Readable report: every fixture carries one line per documented stage.
    const STAGES = ['coverage', 'grounding', 'admissions', 'sequence'];
    for (const r of report.results) {
      assert.deepEqual(r.stages.map((s) => s.stage), STAGES);
      assert.ok(r.summary.every((line) => line.includes('✔')));
    }
    const text = formatParityReport(report);
    assert.match(text, /EQUIVALENT/);
    for (const f of FIXTURES) {
      for (const stage of STAGES) assert.ok(text.includes(`${f.name}/${stage}`), `missing ${f.name}/${stage} in report`);
    }
  });

  it('documents the equivalence thresholds and enforces exact grounding/admissions semantics', async () => {
    // Documented threshold (ADR-0011): coverage |Δ| ≤ 0.05, everything else exact.
    assert.equal(PARITY_THRESHOLDS.coverageDelta, 0.05);

    const faux = await makeFaux(responseCount(FIXTURES[0]));
    const report = await runParityHarness([FIXTURES[0]], { provider: faux.provider });
    assert.equal(report.ok, true);

    const r = report.results[0];
    const grounding = r.stages.find((s) => s.stage === 'grounding');
    const admissions = r.stages.find((s) => s.stage === 'admissions');
    const coverage = r.stages.find((s) => s.stage === 'coverage');
    assert.match(grounding.detail, /identical grounding audit/);
    assert.match(admissions.detail, /identical admissions/);
    assert.match(coverage.detail, /≤ 0.05/);
  });

  it('divergence beyond thresholds fails with a diff artifact identifying the stage', async () => {
    const faux = await makeFaux(responseCount(FIXTURES[0]));
    // Force divergence via the threshold override (proves the artifact path:
    // stage identification + expected/actual diff, not just a boolean).
    const report = await runParityHarness([FIXTURES[0]], {
      provider: faux.provider,
      thresholds: { coverageDelta: -1 },
    });
    assert.equal(report.ok, false);
    assert.equal(report.divergence.fixture, FIXTURES[0].name);
    assert.equal(report.divergence.stage, 'coverage');
    assert.equal(typeof report.divergence.expected, 'number');
    assert.equal(typeof report.divergence.actual, 'number');

    await mkdir(ARTIFACT_DIR, { recursive: true });
    try {
      await writeFile(
        ARTIFACT,
        JSON.stringify({ ...report, humanReadable: formatParityReport(report) }, null, 2)
      );
      const artifact = JSON.parse(await readFile(ARTIFACT, 'utf8'));
      assert.equal(artifact.divergence.stage, 'coverage');
      assert.match(artifact.humanReadable, /DIVERGED/);
      assert.match(artifact.humanReadable, /coverage/);
    } finally {
      await rm(ARTIFACT, { force: true });
    }
  });
});
