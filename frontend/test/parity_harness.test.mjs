import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  runParityHarness,
  formatParityReport,
  PARITY_THRESHOLDS,
} from '../dist-electron/engine/parityHarness.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';
import {
  searchPlaneLedgerSnapshot,
  resetSearchPlane,
} from '../dist-electron/engine/searchPlane.js';
import {
  scrapePlaneLedgerSnapshot,
  resetScrapePlane,
  __testSeams as scrapeTestSeams,
} from '../dist-electron/engine/scrapePlane.js';
// #146: the golden-fixture builders are SHARED (test/parity_fixture_builders.mjs)
// across the parity suites. The shared pages carry substantive content because
// every leg must admit its pages through the SAME vendored plane (whose
// extractor enforces a usefulness bar) — the #94 file-local thin pages
// predate the vendored scrape plane's completeness gate.
import {
  makeFixture,
  makeFauxProvider,
} from './parity_fixture_builders.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
  resetSearchPlane();
  resetScrapePlane();
  scrapeTestSeams.setLookupOverride(null);
});

// Vendored scrape plane: fixture hostnames resolve without real DNS (offline
// D6 requirement) — the vendored SSRF validation itself stays ON.
beforeEach(() => {
  scrapeTestSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
});

async function pi() {
  return await import('@earendil-works/pi-ai');
}

// ---------------------------------------------------------------------------
// Golden fixtures come from the SHARED builders (test/parity_fixture_builders.mjs):
// the same fixture shape replays through the #94 agency legs, the #143 agentic
// leg, and the #146 researcher leg, and the pages carry substantive content so
// every leg admits them through the SAME vendored plane (its extractor enforces
// a usefulness bar that thin pre-#146 pages failed).
// ---------------------------------------------------------------------------

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

/** Builds a faux provider queueing each fixture's OWN golden report —
 * the runner consumes fixtures sequentially, so responses are grouped per
 * fixture (responseCount per fixture, report per fixture). */
async function makeFaux(fixtures) {
  const faux = await makeFauxProvider(fixtures);
  return faux;
}

// Response budget across the three legs per fixture (generous):
//   legacy = 1, delegation = 1, fanout = 2 rounds × #facets (researchers,
//   with search hits) + 1 (synthesis). Unused queued responses are harmless.
const responseCount = (fixture) => 6 + 2 * fixture.plan.milestones.length;

const ARTIFACT_DIR = path.join(process.cwd(), 'test', 'artifacts');
const ARTIFACT = path.join(ARTIFACT_DIR, 'parity-report.json');
const FORCED_ARTIFACT = path.join(ARTIFACT_DIR, 'parity-report-forced.json');

/** Persists the divergence artifact (JSON + human-readable) so a failing
 * run leaves the diff on disk BEFORE the assertion fires. */
async function writeArtifact(report, artifactPath = ARTIFACT) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify({ ...report, humanReadable: formatParityReport(report) }, null, 2)
  );
}

describe('Parity regression harness (ticket #94 — ADR-0010 phase-3 gate)', () => {
  it('runs both paths on shared offline fixtures and emits a readable equivalence report (baseline parity)', async () => {
    // One provider per fixture (its own golden report), one harness run per
    // fixture — leg response counts vary, so per-fixture queues cannot desync.
    const results = [];
    for (const fixture of FIXTURES) {
      const faux = await makeFaux([fixture]);
      const r = await runParityHarness([fixture], { provider: faux.provider });
      results.push(...r.results);
      if (!r.ok) {
        // Artifact first — the diff must outlive the failing assertion.
        await writeArtifact(r);
      }
      assert.equal(
        r.ok, true,
        `baseline parity broke for ${fixture.name} — divergence artifact written to ${ARTIFACT}\n${formatParityReport(r)}`
      );
    }
    assert.equal(results.length, FIXTURES.length);

    // Plane gate (#109): the fixture leg ran through the vendored pi-web-access
    // plane — every search admission was ledgered through the bounded gate
    // (no unledgered retrieval), not served by the silent native fallback.
    const ledger = searchPlaneLedgerSnapshot();
    assert.ok(ledger.ledgered > 0, 'parity fixture must exercise the vendored plane');
    assert.equal(ledger.active, 0, 'plane gate fully released after the run');

    // Scrape-plane gate (#111): page retrieval also runs through the vendored
    // plane (fetch_content behind the scrape seam) — every scrape admission
    // ledgered (D5: no unledgered retrieval).
    const scrapeLedger = scrapePlaneLedgerSnapshot();
    assert.ok(scrapeLedger.ledgered > 0, 'parity fixture must exercise the vendored scrape plane');
    assert.equal(scrapeLedger.active, 0, 'scrape gate fully released after the run');

    // Readable report: every fixture carries one line per documented stage.
    const STAGES = ['coverage', 'grounding', 'admissions', 'sequence'];
    for (const r of results) {
      assert.deepEqual(r.stages.map((s) => s.stage), STAGES);
      assert.ok(r.summary.every((line) => line.includes('✔')));
    }
    const text = results.map((r) => r.summary.join('\n')).join('\n');
    for (const f of FIXTURES) {
      for (const stage of STAGES) assert.ok(text.includes(`${f.name}/${stage}`), `missing ${f.name}/${stage} in report`);
    }
  });

  it('documents the equivalence thresholds and enforces exact grounding/admissions semantics', async () => {
    // Documented threshold (ADR-0011): coverage |Δ| ≤ 0.05, everything else exact.
    assert.equal(PARITY_THRESHOLDS.coverageDelta, 0.05);

    const faux = await makeFaux([FIXTURES[0]]);
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
    const faux = await makeFaux([FIXTURES[0]]);
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

    try {
      await writeArtifact(report, FORCED_ARTIFACT);
      const artifact = JSON.parse(await readFile(FORCED_ARTIFACT, 'utf8'));
      assert.equal(artifact.divergence.stage, 'coverage');
      assert.match(artifact.humanReadable, /DIVERGED/);
      assert.match(artifact.humanReadable, /coverage/);
    } finally {
      await rm(FORCED_ARTIFACT, { force: true });
    }
  });
});
