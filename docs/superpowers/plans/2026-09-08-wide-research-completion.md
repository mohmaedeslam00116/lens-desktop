# Wide Research Completion Implementation Plan

> **For implementation:** Use the `test-driven-development` skill. Every task below begins with a failing automated test, then the smallest production change that makes it pass.

**Goal:** Complete issue #27 with an explicit Wide Research workflow that starts from an approved plan, retrieves up to 100 sources initially, expands automatically and transparently only when coverage requires it (hard cap 200), produces grounded synthesis, and exports reports as real PDF and DOCX files.

**Architecture:** Keep `DeepResearchAgent` as the direct, low-latency standard path. Add a dedicated `WideResearchAgent` that composes existing bounded scraping, deduplication, passage ranking, stratified evidence admission, coverage auditing, hierarchical synthesis, and citation grounding. The HTTP server selects that agent only for the explicit `mode: 'wide'` request. Keep file-format generation dependency-free: have the Electron main process render a safely escaped HTML report using Chromium `printToPDF`, and create DOCX OOXML in memory with the existing pure-Node ZIP writer.

**Approved design:** `docs/superpowers/specs/2026-09-08-wide-research-completion-design.md`

**Tech stack:** Electron 29, TypeScript, React 18, Node test runner, existing `BoundedScraperPool`, `StratifiedEvidenceAdmission`, `HierarchicalSynthesis`, `createZipArchive`, Chromium `webContents.printToPDF`.

---

## Contracts to establish

### Wide execution contract

Add these types in `frontend/electron/engine/types.ts`:

```ts
export interface WideResearchTelemetry {
  initialBudget: number;       // Always 100 for a new wide run
  activeBudget: number;        // 100, then bounded expansions
  maximumBudget: number;       // Always 200
  discovered: number;
  fetched: number;
  unique: number;
  admitted: number;
  cited: number;
  hop: number;
  coverageScore?: number;
  expansion?: {
    from: number;
    to: number;
    reason: string;
    uncoveredMilestones: string[];
    uncoveredSubqueries: string[];
  };
}
```

Add `wide_telemetry` to `LiveEvent['type']` with a `wideTelemetry?: WideResearchTelemetry` payload. Mirror the required display types in `frontend/src/types/index.ts`, including `ResearchMode`, `WideResearchTelemetry`, and optional report metadata (`mode`, `wideTelemetry`) so stored history does not lose the completed run’s counters.

Do not treat `report_type: 'storm'` as Wide Research. `storm` stays a standard depth option for backwards compatibility. Only `mode: 'wide'` starts plan approval and the dedicated agent.

### Export contract

Create `frontend/electron/engine/reportExport.ts` with pure functions:

```ts
export interface ReportExportPayload {
  title: string;
  content: string;
  sources: string[];
  costs?: number;
  created_at?: string;
  language?: 'ar' | 'en';
}

export interface ReportExportService {
  renderPdf(html: string): Promise<Buffer>;
}

export function validateReportExportPayload(value: unknown): ReportExportPayload;
export function createExportHtml(payload: ReportExportPayload): string;
export function createDocxBuffer(payload: ReportExportPayload): Buffer;
```

`createExportHtml` must escape report and source text before placing it in HTML; it preserves Markdown report text in a wrapped `<pre>` rather than interpreting it as untrusted HTML. `createDocxBuffer` must produce an OOXML `.docx` ZIP with `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`, and `docProps/core.xml`; use paragraph runs for title, metadata, report paragraphs, and source URLs. Set bidi paragraph properties when the payload language or text is Arabic. The output is a valid document, not a renamed ZIP or Markdown file.

Change `startEmbeddedServer` to accept an optional `ReportExportService`; the server owns HTTP validation and response headers, while Electron owns only Chromium PDF rendering. In `frontend/electron/main.ts`, pass a `renderPdf` implementation that creates a hidden sandboxed `BrowserWindow`, loads the generated escaped HTML via a data URL, calls `webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })`, and destroys the temporary window in `finally`.

---

## Task 1: Add a dedicated, testable WideResearchAgent

**Files:**
- Create: `frontend/electron/engine/wideAgent.ts`
- Modify: `frontend/electron/engine/types.ts`
- Create: `frontend/test/wide_research_agent.test.mjs`
- Modify: `frontend/package.json`

### Step 1: Write failing behavior tests

Add `wide_research_agent.test.mjs` to the `npm test` command before implementation. Use deterministic injected dependencies rather than live search, scraping, embeddings, or models. The agent constructor should accept an optional dependency object containing `search`, `createPool`, `rankPassages`, and `synthesize`; production defaults call existing engine services.

Cover these test cases:

1. Missing or non-approved plan rejects before it calls `search` or `createPool`.
2. An approved plan starts with `initialBudget === activeBudget === 100` and `maximumBudget === 200`; it asks the bounded pool to scrape no more than 100 unique candidates in its initial batch.
3. The 100-source fixture with sufficient coverage emits an initial `wide_telemetry`, does not expand, runs `admitStratifiedEvidence`, and emits a grounded `finished` event.
4. A below-threshold first audit with 200 deterministic distinct fixtures emits an expansion event with a non-empty reason, raises the active budget in a bounded increment, and never requests or reports more than 200 sources.
5. A below-threshold run with no additional unique candidates ends honestly without exceeding 200 and includes uncovered-facet telemetry.
6. Aborting its signal stops new work, emits no `finished`, and leaves emitted sources available to `ResearchSession` as a partial draft.
7. A synthesis fixture containing `[999]` produces a final report with that hallucinated citation stripped by `CitationGroundingContract`.

Run the specific test and confirm it fails because `wideAgent.js` does not exist.

### Step 2: Implement the narrow production seam

Implement `WideResearchAgent` with these invariants:

1. Accept only an approved `WideResearchRequest` (`mode === 'wide'`, `plan.status === 'approved'`). Never generate or revise a plan inside the agent.
2. Derive retrieval batches from the frozen `plan.milestones`. Search sufficient distinct milestone/query variants to fill the current source budget, deduplicate URLs before pool submission, and keep the candidate URL list bounded by the active budget.
3. Use a single `BoundedScraperPool` instance per run. Route `onProgress` into telemetry and source events. Read `getDeduplicationStats()` for truthful unique/deduplicated counts.
4. Turn scraped pages into structured passage candidates. When configured embeddings are usable, call existing `rankSourcePassages` (hybrid vector/BM25/RRF); when unavailable or failing, use `chunkStructuredDocument` plus a deterministic lexical/credibility score. Assign each chunk to its frozen milestone based on the query batch that found its source.
5. Call `admitStratifiedEvidence` with a 100-source initial budget and the current hop. Emit its coverage data, quota shortfalls, and any generated adaptive query plan.
6. Expand only when the coverage audit is below its threshold, the candidate supply is not exhausted, and the active budget is below 200. Add at most 25 sources per expansion; emit one `wide_telemetry` record containing the old/new budgets and concrete uncovered facets. Do not ask the user to approve an automatic expansion.
7. Create `HierarchicalSynthesis` from admitted evidence and the frozen plan. Forward synthesis progress as status/telemetry, emit only grounded source records, then emit `finished` with report, plan, enriched sources, grounding verification, and final telemetry.
8. Respect `AbortSignal` before/after every search batch, pool call, ranking call, and synthesis call. Do not swallow an abort into a successful completion.

Run the new test file until it passes, then run the full `npm test` suite.

### Step 3: Keep type and build contracts green

Compile with `npm run build:electron`. Resolve all strict TypeScript errors by updating both engine and React type surfaces; do not use `any` to bridge the new telemetry contract.

## Task 2: Dispatch explicit mode correctly and preserve plan authorization

**Files:**
- Modify: `frontend/electron/engine/server.ts`
- Modify: `frontend/electron/engine/sessionLifecycle.ts`
- Modify: `frontend/electron/engine/types.ts`
- Create: `frontend/test/wide_mode_server.test.mjs`
- Modify: `frontend/test/plan_scoping_lifecycle.test.mjs`
- Modify: `frontend/package.json`

### Step 1: Write failing boundary tests

Add server-level tests using a server factory or dependency-injected agent factory (do not bind port 8000 or call external services):

1. `{ mode: 'wide' }` creates a session in wide mode, emits a proposed plan, and does not invoke either agent before approval.
2. Approving that plan constructs `WideResearchAgent`, never `DeepResearchAgent`, and passes the frozen approved plan unchanged.
3. `{ report_type: 'storm' }` without `mode: 'wide'` starts `DeepResearchAgent` directly and does not display or require the plan gate.
4. Invalid/missing `mode` defaults to standard mode.
5. A second approval after a terminal session cannot schedule a duplicate run.

Run the file and confirm it fails before changing server behavior.

### Step 2: Implement explicit selection

In `server.ts`:

1. Import `WideResearchAgent` and use a small `createResearchAgent(request, sessionId, emitEvent, activationManager)` helper that is injectable in tests.
2. Compute wide mode solely from `body.mode === 'wide'`; normalize every other request to `mode: 'standard'` before session creation.
3. Retain plan generation only for wide mode and call it with `targetSources: 100`, `maxHops: 2`, and `maxSources: 200` held as server-owned policy rather than a client-controlled cap.
4. In `startAuthorizedExecution`, instantiate the selected agent only after `researchSession.isPlanAuthorized()` returns true. Bind the approved plan to the request and carry the immutable 100/200 limits with it.
5. Preserve standard direct execution and existing REST/WebSocket plan handling. Ensure cancelled or failed sessions cannot be scheduled again.

In `sessionLifecycle.ts`, remove the legacy inference that converts `storm` to wide. Its `mode` is now the explicit request mode or standard.

Run the new tests, `plan_scoping_lifecycle.test.mjs`, and full `npm test`.

## Task 3: Make Wide Research discoverable and telemetry visible in the desktop UI

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/vane/EmptyChat.tsx`
- Modify: `frontend/src/components/vane/EmptyChatMessageInput.tsx`
- Modify: `frontend/src/components/research/PlanApprovalModal.tsx`
- Create: `frontend/src/components/research/WideResearchTelemetry.tsx`
- Modify: `frontend/src/components/vane/MessageBox.tsx`
- Modify: `frontend/src/index.css` (or the stylesheet that owns `research-composer`)
- Create: `frontend/test/wide_research_ui.test.mjs`

### Step 1: Write failing UI/contract tests

Because the project’s tests are Node-based, expose pure UI helpers beside their components and test those helpers plus stable rendered markup contracts:

1. `buildResearchStartPayload` returns `mode: 'wide'`, `maxSources: 200`, and preserves normal depth/focus settings when the selected mode is wide; it returns no plan-only fields in standard mode.
2. A source-level/render contract asserts the composer exposes mutually exclusive `Standard Research` / `Wide Research` controls, uses Arabic equivalents, and contains the exact 100-to-200 guidance.
3. A telemetry formatter displays all five counts, active budget, hard maximum, coverage percentage when present, and the expansion reason when one arrives.
4. The plan modal copy for wide mode says it starts at 100 and expands automatically only up to 200; it does not present 200 as the initial target.

Run the test before implementation and confirm the discoverable Wide label is absent.

### Step 2: Implement the UI state and request boundary

1. Replace the overloaded `optimizationMode` meaning with two independent controls in `App.tsx`: existing performance/depth selection (`speed`, `balanced`, `quality`) and `researchMode: 'standard' | 'wide'`. Default to `standard`; preserve the selected mode for a follow-up only if the user has not begun a new standard research task.
2. Export a pure `buildResearchStartPayload` helper from `App.tsx` (or a small `src/utils/researchRequest.ts`) and use it in `handleStartResearch`. A wide request sends `mode: 'wide'`, `maxSources: 200`, and all model/search settings; its underlying standard depth may remain `deep` but must not use `storm` as a mode signal.
3. Thread `researchMode` and setter through `EmptyChat` to `EmptyChatMessageInput`. Add an accessible segmented/radio control with bilingual labels. Wide’s visible helper text is: Arabic `يبدأ بـ 100 مصدر، ويتوسع تلقائيًا حتى 200 فقط عندما تبقى فجوات أدلة.`; English `Starts with 100 sources and automatically expands to 200 only when evidence gaps remain.`
4. On `wide_telemetry` websocket messages, store the latest telemetry and a small expansion history in `App.tsx`; reset both on a new research. Forward it to a new `WideResearchTelemetry` panel rendered beside the active research radar (not hidden behind a report-only view). The panel must be absent for standard research.
5. Make `PlanApprovalModal` accept `mode`/budget props. For wide mode, render an explicit non-editable starting budget of 100 and hard cap of 200 near its scope summary. Continue to show target source and hop counts, but never label the cap as a target. Keep its existing keyboard, focus, RTL, and approve/discard behavior.
6. Preserve the monochrome palette and Inter/Cairo typography declared by `BRAND.md` and `DESIGN.md`; add focused-control and screen-reader labels for both radio choices.

Run the UI test, `npm run build:react`, then `npm run build:electron`.

## Task 4: Implement safe, real PDF and DOCX export endpoints

**Files:**
- Create: `frontend/electron/engine/reportExport.ts`
- Modify: `frontend/electron/engine/server.ts`
- Modify: `frontend/electron/main.ts`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/test/report_export.test.mjs`
- Modify: `frontend/package.json`

### Step 1: Write failing export tests

Add `report_export.test.mjs` and include it in `npm test`. Test pure module behavior and an HTTP handler instantiated with a fake PDF service:

1. A valid payload produces an escaped export HTML document: literal `<script>` from report content must not appear as a live tag; Arabic and citation text remain present as text.
2. `createDocxBuffer` returns a ZIP whose entries include the five required OOXML parts; `word/document.xml` contains the title, citations, and source URLs in escaped XML text; Arabic input includes bidi paragraph properties.
3. The DOCX buffer opens through the existing `readZipArchive` and is not empty.
4. `POST /api/export/pdf` returns `200`, `application/pdf`, attachment disposition, and exactly the fake renderer bytes. `POST /api/export/docx` returns the Office DOCX MIME type, attachment disposition, and a ZIP signature (`PK`).
5. Missing title/content or malformed `sources` returns a deterministic `400` JSON error; the renderer must not run.

Run it to get the expected red state.

### Step 2: Implement the export module and server endpoints

1. Implement strict payload validation with bounded string/array sizes and normalization. Strip control characters from attachment filenames and derive a safe ASCII filename; never take a filesystem path from the renderer request.
2. Build a static, print-friendly HTML document with neutral LENS styling, title, creation metadata, report text, source list, and no external resources/scripts. Escape all text for both HTML and XML contexts.
3. Create a minimal but valid DOCX with the existing `createZipArchive`. Include document properties, styles, and bidi writing properties for Arabic paragraphs. Do not add an npm export dependency or native module.
4. Add `POST /api/export/pdf` and `POST /api/export/docx` before the generic 404 in `server.ts`. Set `Content-Type`, `Content-Length`, and `Content-Disposition: attachment` exactly once, then end the binary buffer. Turn generator/renderer errors into a safe `500` JSON error.
5. Parameterize `startEmbeddedServer(port, { reportExportService })`; server tests inject a fake PDF renderer. In `main.ts`, construct the production service using a hidden `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`, call `printToPDF`, and destroy the export window even after failure.
6. Update `handleExport` to revoke the object URL after click and show the existing user-facing error surface if the endpoint rejects. Keep Markdown export entirely client-side.

Run the export tests, full `npm test`, `npm run build:electron`, and a local Electron smoke test that exports a short Arabic-and-English report in both formats.

### Step 3: Visual artifact QA

Use the PDF and DOCX workflows already selected for this task:

1. Render the generated PDF to PNG pages and inspect every page for Arabic/English legibility, citations, source URLs, page breaks, and no clipping.
2. Render the generated DOCX to PNG pages using the bundled document renderer and inspect every page at 100% zoom. Confirm title hierarchy, bidirectional text, source list, and no overlap.
3. If either artifact has a defect, fix the generator and repeat render/inspection before considering the export feature done.

## Task 5: Documentation, quality gate, packaging, and PR closure

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Create: `docs/adr/0007-wide-research-execution-and-export.md`
- Modify: `CHANGELOG.md`
- Modify as needed: `PRODUCT.md`, `DESIGN.md` only if current language contradicts the implemented feature

### Step 1: Write/update documentation tests or assertions first

Add assertions to the relevant test suite that the public feature contracts remain true: explicit wide mode, 100-to-200 bounded policy, mandatory plan approval, and output MIME types. Do not document capabilities that the tested implementation does not deliver.

### Step 2: Update lockstep docs

1. Add the `WideResearchAgent`, Wide Research budget policy, source telemetry, and report export terminology to `CONTEXT.md`.
2. Record an ADR explaining why wide mode is a separate orchestration seam, why only `mode: 'wide'` activates it, the fixed 100/200 safety boundary, and the dependency-free Electron/OOXML export design.
3. Update `README.md` with user-facing Wide Research behavior, plan approval, automatic expansion condition, telemetry, and PDF/DOCX downloads.
4. Add the feature under `[Unreleased]` in `CHANGELOG.md` as a MINOR release candidate, including the validated wide mode and true export endpoints.

### Step 3: Verify the full deliverable

Run, in this order:

```powershell
cd frontend
npm test
npm run build:react
npm run build:electron
npx impeccable detect
npm run build:installer
```

Then manually smoke test the built Electron app:

1. Confirm Standard Research starts directly.
2. Confirm Wide Research is immediately visible, proposes a plan, and does not begin retrieval until approval.
3. Confirm its plan and running telemetry start at 100 and display a hard maximum of 200.
4. Confirm PDF and DOCX buttons download valid files; complete the visual artifact QA from Task 4.

Request the required standards and specification reviews, fix any blocking findings, create a pull request, merge only after both reviews and checks pass, close issue #27 with the PR reference, and publish the required SemVer release/tag after the version bump.

---

## Explicit non-goals and guardrails

- No executable third-party skill runtime, arbitrary script execution, or issue #19 scope.
- No client-controlled value above 200 and no silent expansion; every expansion is reported with evidence-gap context.
- No wide-mode activation from the legacy `storm` depth alias.
- No live-network tests, provider keys, or native C++ dependencies.
- No export writes to arbitrary user paths; the endpoint returns bytes and the browser download flow chooses the destination.
