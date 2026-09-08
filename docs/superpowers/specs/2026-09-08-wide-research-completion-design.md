# Wide Research Completion Design

## Purpose

Complete the Phase 1 promise in issue #27: make Wide Research a distinct, usable desktop workflow rather than a `storm` depth alias. The workflow begins with an approved plan, retrieves 100 sources by default, may expand automatically to 200 when evidence coverage shows a justified gap, and produces grounded, inspectable reports.

## Scope

This design covers four connected deliverables:

1. A dedicated `WideResearchAgent` execution seam.
2. A discoverable Wide Research mode in the React UI.
3. Real PDF and DOCX report-export endpoints.
4. End-to-end tests for mode selection, approval gating, scalable retrieval, telemetry, citation grounding, and export payloads.

It does not add executable skill runtimes, arbitrary command execution, or dependency installation. Those remain the explicitly deferred Phase 2 scope in issue #19.

## Architecture

`DeepResearchAgent` remains the standard research path for `quick`, `deep`, and the existing `storm` depth behavior. A new `WideResearchAgent` owns only `ResearchMode = 'wide'`; this keeps the standard path’s smaller source budgets and latency profile independent from the large-corpus workflow.

The engine server chooses the agent from a request’s explicit `mode`. A standard request defaults to `standard`; a request with `mode: 'wide'` follows this lifecycle:

1. Generate and emit a draft `ResearchPlan`.
2. Wait in `awaiting_approval`; no search or scraping starts before `plan_approved`.
3. Retrieve the approved milestone queries through `BoundedScraperPool`, `DeduplicationEngine`, stratified admission, and evidence auditing.
4. Start with a 100-source budget. If the audit reports coverage below the target and budget remains, increase the authorized budget in bounded increments until no more than 200 sources are requested.
5. Emit structured telemetry for discovered, fetched, unique, admitted, cited, the active budget, and every expansion reason.
6. Run hierarchical synthesis with `CitationGroundingContract`, then emit the report, sources, and grounding data.

Cancellation continues to propagate through `AbortSignal` and preserves partial evidence. Any network or provider failure becomes an observable session event and leaves the standard mode unaffected.

## UI

The entry surface presents mutually exclusive `Standard Research` and `Wide Research` choices in Arabic and English. Selecting Wide Research visibly states “100 sources initially; automatic expansion up to 200 when evidence gaps remain.”

Wide Research always opens the plan-approval modal. Its scope panel displays the starting budget and maximum budget. While running, a telemetry panel shows the five source counts and an expansion timeline. Standard Research continues directly without the mandatory approval gate.

## Export

The engine implements `POST /api/export/pdf` and `POST /api/export/docx` for the payload already sent by the frontend. Both endpoints validate the report payload, return a file attachment with the correct MIME type, and preserve report text, source URLs, and citation labels. Markdown export remains client-side.

## Verification

Tests use the public seams:

- `WideResearchAgent.run()` for approval gating, 100-source start, automatic bounded expansion to 200, cancellation, telemetry, and citation grounding.
- The server request boundary for selecting the dedicated wide agent.
- The React entry UI for mode visibility and request construction.
- The PDF/DOCX export endpoints for successful file responses and invalid-request rejection.

The suite remains offline, uses deterministic provider/search fixtures, runs under `node --test`, and adds no native C++ dependency.

## Acceptance Criteria

- Wide Research is visibly selectable and sends `mode: 'wide'`.
- Retrieval cannot begin before plan approval in Wide Research.
- A normal run starts at 100 sources and may grow automatically, with an absolute ceiling of 200.
- The dedicated agent uses the bounded scraper pool and existing deduplication, admission, coverage, synthesis, and grounding contracts.
- Users can see source-stage counts and expansion reasons while the run is active.
- PDF and DOCX controls download files returned by implemented engine endpoints.
- Standard Research behavior and its tests remain green.
