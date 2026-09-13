# Parity Harness (ADR-0010 phase-3 gate)

Status: accepted
Date: 2026-09-13
Ticket: #94 (part of #80, ADR-0010)

## Context

ADR-0010 decision 10 (phase table) requires the parity harness to prove that
the agency path (parent + researchers) is equivalent to the legacy standard
loop before the default flips and before the auditor starts gating or the
fan-out constants are retuned:

> #94 harness proves coverage score, citation grounding, admission counts, and
> LiveEvent sequence equivalence within documented thresholds.

Tickets #88–#93 built the agency path incrementally with one spot parity test
(byte-equivalent report + shared event backbone on one fixture). #94 turns that
spot check into a **reusable regression harness**: N golden fixtures, both
paths, diffed on four dimensions with explicit thresholds and a divergence
artifact identifying the failing stage.

## Decision

1. **Reusable harness module** (`frontend/electron/engine/parityHarness.ts`):
   `runParityHarness({ fixtures, fixturesDir?, thresholdOverrides? })` executes
   every fixture through both paths in the SAME process — legacy
   `DeepResearchAgent` first, then agency `ParentResearchAgent`, with a full
   `resetActiveCore()` between legs — and compares:
   - **Coverage score** — legacy vs agency `coverageAudit.overallScore`;
     threshold: |Δ| ≤ 0.05.
   - **Citation grounding audit** — both paths run the same
     `CitationGroundingContract.verifyAndSanitize` on the same report with the
     same evidence pool, so the sanitized report and per-claim audit outcomes
     (removed/kept) must be byte-identical. Divergence means evidence
     admission or grounding preprocessing drifted, which is a parity break by
     definition.
   - **Admission counts** — finished.sources length, scraped_sources length,
     dedupe-filtered count: must match exactly (budget is path-invariant).
   - **LiveEvent sequence** — the shared backbone, normalized as follows:
     additive agency-only events (`researcher_telemetry`,
     `fanout_telemetry`) and agency-mode orchestration `status` messages
     are **excluded** from the canonical sequence before comparison — they
     have no legacy counterpart (the legacy path cannot emit them, so
     including them would fail parity by construction) and are covered by
     their own suites (#88–#93) rather than this stage — and consecutive
     `report_chunk` runs collapse (chunk boundaries are
     arrival-timing dependent). The remaining sequence must be equal to
     the legacy loop's.
2. **Golden fixtures** *(amended by #104: the harness runs two agency legs —
   delegation baseline vs fan-out — after the legacy single-loop route was
   removed; the legacy-vs-delegation byte-equivalence remains pinned at the
   agent level by the #88 contract test)*: plan +
   offline retrieval stubs (per-facet search/scrape maps) + expected report.
   Fixture JSON stores the plan and retrieval maps; deterministic offline
   agents live in the harness. No network. The agency leg runs with
   `respecialization: false` so launch counts stay deterministic; the audit
   section is part of both reports by contract (#91).
3. **Divergence artifact** (`frontend/test/artifacts/parity-report.json`,
   gitignored): a single JSON identifying the fixture, the failing stage,
   expected-vs-actual values, and the backbone diff when the sequence stage
   fails.
4. **Suite integration** (`frontend/test/parity_harness.test.mjs`): the
   harness runs offline in the standard suite and fails with the artifact path
   on divergence. Thresholds are documented in the harness header (docblock)
   and this ADR; the equivalence report is also asserted readable (fixture
   list, stages, status, deltas).

## Consequences

- The default flip and constant retuning (#90/#93) now have a gate: any
  regression shows up as a staged divergence with a diff artifact.
- Equivalence thresholds are documented in one place (ADR + harness docblock).
- Baseline parity is proven by the suite going green on golden fixtures.
- Divergences caused by deliberate additive contract changes require a
  recorded fixture refresh — visible in review, not silent.

## Alternatives considered

- **Snapshot the full LiveEvent streams byte-for-byte** — rejected: chunk
  boundaries are arrival-timing dependent (the legacy loop itself is not
  deterministic run-to-run); the backbone contract is the documented
  equivalence, not chunking.
- **Run the harness only in CI** — rejected: the ticket requires it to run
  offline in the standard suite as the regression gate.
