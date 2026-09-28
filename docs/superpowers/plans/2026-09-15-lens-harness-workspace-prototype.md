# LENS Harness Workspace Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in LENS research-harness preview from the user-authored Stitch desktop shell, backed only by existing LENS research-session state.

**Architecture:** App remains the owner of research lifecycle, history, settings, and routes. A pure artifact-model seam determines what a conditional inspector may truthfully show; focused harness components consume the already-owned state and callbacks. Exiting the preview only changes local view state, so it cannot reset or replace a ResearchSession.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React, Node built-in test runner with jiti, Electron/Vite.

## Global Constraints

- Copy the supplied Stitch hierarchy and spacing only; retain no Antigravity identity, fabricated IDE/terminal/PR/test/repository content, blue/amber identity colors, gradients, or glows.
- Use LENS semantic dark/light tokens, Inter/Cairo, logical direction, visible focus, and reduced-motion behavior.
- The inspector appears only for a selected LENS artifact that has real data and is closable at every width.
- Preserve routes, storage keys, API endpoints, WebSocket events, model controls, and report export behavior.
- Every new production seam begins with a failing offline test; run the focused test before and after implementation.
- Update CHANGELOG.md under [Unreleased], then run both builds, the full frontend suite, the Impeccable detector, and a final diff check.

---

## File Structure

- Create: frontend/src/utils/harnessWorkspace.ts — pure artifact availability, default selection, and parent-session card state.
- Create: frontend/src/components/harness/HarnessArtifactInspector.tsx — conditional plan/evidence/report/graph summary.
- Create: frontend/src/components/harness/LensHarnessWorkspace.tsx — the opt-in shell, rail, canvas, and composer placement.
- Modify: frontend/src/App.tsx — preview state, prop wiring, and truthful retry/failure transitions.
- Modify: frontend/src/components/vane/Sidebar.tsx — explicit preview entry action.
- Modify: frontend/src/index.css — responsive harness geometry using semantic variables.
- Create: frontend/test/harness_workspace.test.mjs — pure behavior and source integration contracts.
- Modify: frontend/test/visibility_fix.test.mjs — retry/failure transition coverage if its existing feed seam is extended.
- Modify: CHANGELOG.md, DESIGN.md, .impeccable/design.json — shipped behavior and design capture.

### Task 1: Define the honest workspace-view model

**Files:**

- Create: frontend/src/utils/harnessWorkspace.ts
- Test: frontend/test/harness_workspace.test.mjs

**Interfaces:**

- Consumes: ResearchPlan | null | undefined, SourceItem[], report text, ResearchGraphNode[], loading/status/error.
- Produces: HarnessArtifactTab, availableHarnessArtifacts(input), defaultHarnessArtifact(input), deriveHarnessSessionCard(input).

- [ ] **Step 1: Write the failing test**

    const { availableHarnessArtifacts, defaultHarnessArtifact, deriveHarnessSessionCard } =
      await jiti.import('../src/utils/harnessWorkspace.ts');

    it('exposes only backed artifacts and selects evidence before a report', () => {
      const input = { plan: null, sources: [{ url: 'https://example.com', title: 'Source' }], report: '', graphNodes: [] };
      assert.deepEqual(availableHarnessArtifacts(input), ['evidence']);
      assert.equal(defaultHarnessArtifact(input), 'evidence');
    });

    it('derives retrying and failed parent cards from actual state', () => {
      assert.equal(deriveHarnessSessionCard({ loading: true, status: 'Reconnecting…', error: '' }).status, 'retrying');
      assert.equal(deriveHarnessSessionCard({ loading: false, status: '', error: 'Connection failed' }).status, 'failed');
    });

- [ ] **Step 2: Run the test and verify RED**

Run: npm test -- test/harness_workspace.test.mjs

Expected: FAIL because the utility module does not exist.

- [ ] **Step 3: Write minimal production code**

    export type HarnessArtifactTab = 'plan' | 'evidence' | 'report' | 'graph';

    export function availableHarnessArtifacts(input: HarnessArtifactInput): HarnessArtifactTab[] {
      return [
        ...(input.plan ? ['plan' as const] : []),
        ...(input.sources.length ? ['evidence' as const] : []),
        ...(input.report.trim() ? ['report' as const] : []),
        ...(input.graphNodes.length ? ['graph' as const] : []),
      ];
    }

    export function defaultHarnessArtifact(input: HarnessArtifactInput): HarnessArtifactTab | null {
      return availableHarnessArtifacts(input)[0] ?? null;
    }

    export function deriveHarnessSessionCard(input: HarnessSessionInput): HarnessSessionCard | null {
      if (!input.loading && !input.error && !input.status) return null;
      const retrying = /reconnect/i.test(input.status);
      return { label: 'Research session', detail: input.error || input.status, status: input.error ? 'failed' : retrying ? 'retrying' : input.loading ? 'running' : 'waiting' };
    }

- [ ] **Step 4: Run the test and verify GREEN**

Run: npm test -- test/harness_workspace.test.mjs

Expected: PASS.

- [ ] **Step 5: Commit**

    git add frontend/src/utils/harnessWorkspace.ts frontend/test/harness_workspace.test.mjs
    git commit -m "feat: model truthful harness artifacts"

### Task 2: Build the conditional artifact inspector

**Files:**

- Create: frontend/src/components/harness/HarnessArtifactInspector.tsx
- Modify: frontend/test/harness_workspace.test.mjs

**Interfaces:**

- Consumes: available HarnessArtifactTab values, selected tab, ResearchPlan, sources, report, graph nodes, Language, and onClose.
- Produces: an aside with only data-backed tabs, aria-selected state, and an explicit close action.

- [ ] **Step 1: Write the failing source-contract test**

    const inspector = await readFile(new URL('../src/components/harness/HarnessArtifactInspector.tsx', import.meta.url), 'utf8');
    assert.match(inspector, /availableTabs\.map/);
    assert.match(inspector, /onClose/);
    assert.doesNotMatch(inspector, /Antigravity|Pull request|Terminal|Repository/);

- [ ] **Step 2: Run the test and verify RED**

Run: npm test -- test/harness_workspace.test.mjs

Expected: FAIL because the inspector file does not exist.

- [ ] **Step 3: Write minimal production code**

Map availableTabs to labelled plan, evidence, report, and graph buttons. Show only actual plan objective/milestones, source title/domain/URL, report availability, and graph-node count. Use bdi dir="ltr" for URLs and return null when availableTabs is empty. The parent therefore has no empty inspector column.

- [ ] **Step 4: Run focused verification**

Run: npm test -- test/harness_workspace.test.mjs; npm run build:react

Expected: PASS and a successful Vite build.

- [ ] **Step 5: Commit**

    git add frontend/src/components/harness/HarnessArtifactInspector.tsx frontend/test/harness_workspace.test.mjs
    git commit -m "feat: add truthful harness artifact inspector"

### Task 3: Build the opt-in LENS harness shell

**Files:**

- Create: frontend/src/components/harness/LensHarnessWorkspace.tsx
- Modify: frontend/src/index.css
- Modify: frontend/test/harness_workspace.test.mjs

**Interfaces:**

- Consumes: live query/report/status/thoughts/sources/plan/graph/agents/history plus onStartResearch, onNewResearch, onSelectReport, onOpenSettings, and onExit callbacks.
- Produces: LensHarnessWorkspace with data-testid="lens-harness", a wide rail, utility bar, central empty/active canvas, docked composer, and conditional inspector.

- [ ] **Step 1: Write the failing source-contract test**

    const harness = await readFile(new URL('../src/components/harness/LensHarnessWorkspace.tsx', import.meta.url), 'utf8');
    assert.match(harness, /data-testid="lens-harness"/);
    assert.match(harness, /onStartResearch/);
    assert.match(harness, /onSelectReport/);
    assert.match(harness, /HarnessArtifactInspector/);
    assert.doesNotMatch(harness, /Antigravity|Pull request|Terminal|Repository|Open IDE/);

- [ ] **Step 2: Run the test and verify RED**

Run: npm test -- test/harness_workspace.test.mjs

Expected: FAIL because the shell file does not exist.

- [ ] **Step 3: Write minimal production code**

Compose the shell from BrandLogo, EmptyChatMessageInput, MessageBox, MessageInput, and AgentFeedList. The rail lists actual saved reports and invokes onSelectReport(report). Empty state retains existing model/setup controls through EmptyChatMessageInput. Active state receives currentStatus, thoughts, cards, sources, and report content. Inspector selection initializes from defaultHarnessArtifact and is hidden when availableHarnessArtifacts is empty.

- [ ] **Step 4: Add responsive CSS**

Add .lens-harness, .harness-rail, .harness-utility-bar, .harness-canvas, and .harness-inspector. At 1280px and above use a 280px rail, 40px utility bar, and 384px inspector. Below that make the inspector a fixed closable drawer. Below 700px hide the rail behind an explicit control. Use border-inline-*, padding-inline, and existing CSS variables only.

- [ ] **Step 5: Run focused verification**

Run: npm test -- test/harness_workspace.test.mjs; npm run build:react

Expected: PASS and a successful Vite build.

- [ ] **Step 6: Commit**

    git add frontend/src/components/harness/LensHarnessWorkspace.tsx frontend/src/index.css frontend/test/harness_workspace.test.mjs
    git commit -m "feat: add LENS harness workspace preview"

### Task 4: Wire preview entry, state preservation, and live terminal truth

**Files:**

- Modify: frontend/src/App.tsx
- Modify: frontend/src/components/vane/Sidebar.tsx
- Modify: frontend/test/harness_workspace.test.mjs
- Modify: frontend/test/visibility_fix.test.mjs

**Interfaces:**

- Consumes: existing App state/handlers.
- Produces: isHarnessPreviewOpen, LensHarnessWorkspace props, onOpenHarness sidebar action, retry/failure agent status transitions.

- [ ] **Step 1: Write the failing tests**

    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /isHarnessPreviewOpen/);
    assert.match(app, /<LensHarnessWorkspace/);
    assert.match(app, /retrying/);

    const sidebar = await readFile(new URL('../src/components/vane/Sidebar.tsx', import.meta.url), 'utf8');
    assert.match(sidebar, /onOpenHarness/);
    assert.match(sidebar, /Workspace preview/);

- [ ] **Step 2: Run the tests and verify RED**

Run: npm test -- test/harness_workspace.test.mjs test/visibility_fix.test.mjs

Expected: FAIL because the preview state/action and retry transition do not exist.

- [ ] **Step 3: Write minimal production code**

App adds isHarnessPreviewOpen. When true it renders LensHarnessWorkspace with current state and existing callbacks; onExit only clears the flag. Sidebar receives onOpenHarness and renders a labelled preview action. Before WebSocket delta replay, App changes only non-terminal cards to retrying and sets a bilingual reconnecting message; a replacement socket open changes retrying cards to running. Terminal error, cancellation, budget exhaustion, and exhausted reconnect attempts mark only non-terminal cards failed. No researcher card is fabricated without researcher telemetry.

- [ ] **Step 4: Run focused tests and builds**

Run: npm test -- test/harness_workspace.test.mjs test/visibility_fix.test.mjs; npm run build:react; npm run build:electron

Expected: PASS, successful Vite build, and successful Electron TypeScript build.

- [ ] **Step 5: Commit**

    git add frontend/src/App.tsx frontend/src/components/vane/Sidebar.tsx frontend/test/harness_workspace.test.mjs frontend/test/visibility_fix.test.mjs
    git commit -m "feat: wire live LENS harness preview"

### Task 5: Document and verify the finished surface

**Files:**

- Modify: CHANGELOG.md
- Modify: DESIGN.md
- Modify: .impeccable/design.json

- [ ] **Step 1: Update the documents**

Add an Unreleased feature entry: an opt-in evidence-harness preview uses live research data and a conditional inspector. Remove the DESIGN.md TARGET marker, replace it with measured implementation details, and update .impeccable/design.json from the delivered components.

- [ ] **Step 2: Run the one post-change Impeccable detector pass**

Run: & '.agents/skills/impeccable/scripts/impeccable.cmd' detect --json frontend/src/components/harness frontend/src/App.tsx frontend/src/components/vane/Sidebar.tsx frontend/src/index.css

Expected: record every finding; fix blockers and document any deliberate LENS/Inter exception.

- [ ] **Step 3: Run final verification**

Run: npm test; npm run build:react; npm run build:electron; git diff --check

Expected: all tests/builds pass and no whitespace errors.

- [ ] **Step 4: Commit**

    git add CHANGELOG.md DESIGN.md .impeccable/design.json
    git commit -m "docs: record LENS harness workspace"

## Self-Review

**Spec coverage:** Task 1 makes artifact absence honest. Task 2 supplies plan/evidence/report/graph inspection. Task 3 implements the user-authorized Stitch-derived shell with bilingual geometry. Task 4 provides deliberate entry/exit, history/composer callbacks, and live retry/failure truth. Task 5 covers documentation, design validation, tests, and builds.

**Placeholder scan:** Every task has concrete file paths, commands, interfaces, behavior, and expected outcomes.

**Type consistency:** HarnessArtifactTab, availableHarnessArtifacts, defaultHarnessArtifact, and deriveHarnessSessionCard originate in Task 1 and are consumed by Tasks 2–4. LensHarnessWorkspace owns visual inspector selection; App remains the research lifecycle owner.
