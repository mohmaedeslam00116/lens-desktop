# Specification: LENS Agent Harness — Agentic Search on a Pi-Only Backend

**Specification ID**: `SPEC-118`
**GitHub Issue**: [#118: [Map] Agentic Search on a Pi-Only Backend — Antigravity-style Workspace & Streaming Visibility](https://github.com/mohmaedeslam00116/lens-desktop/issues/118)
**Related decisions**: [#119](https://github.com/mohmaedeslam00116/lens-desktop/issues/119) (stuck-run fix & event mirroring, PR #123), [#120](https://github.com/mohmaedeslam00116/lens-desktop/issues/120) (Pi hosting verdict → `docs/research/pi-hosting-investigation.md`), [#121](https://github.com/mohmaedeslam00116/lens-desktop/issues/121) (harness workspace preview, PR #128), [#126](https://github.com/mohmaedeslam00116/lens-desktop/issues/126) (harness shell becomes the LENS workspace)
**ADRs**: ADR-0014 (Pi sole agentic backend, in-process `AgentSession` hosting), ADR-0015 (Artifact as a first-class session entity), ADR-0016 (mode model)
**Date**: September 29, 2026
**Status**: Ready for tickets (`/to-tickets`)

---

## Problem Statement

LENS ships one research mode — Deep Research — whose loop is plan-gated and agency-orchestrated end to end. Every question pays the plan-approval tax, and the user can only watch: once a run starts there is no way to redirect it, no way to ask a follow-up inside the same context, and no way to see what the agent is doing at the level of individual tool calls. The shipped Pi integration is `piAdapter.generateWithPi()` — a text-only LLM adapter over `pi-ai` with no loop, no tools, and no sessions — so "the agent" is really a synthesis call behind a hand-written orchestration tree.

The workspace inherits that limitation. Its right pane holds whatever the current run happens to produce, addressed through five separate fetch paths (plan, report, evidence shelf, graph, telemetry) with no shared identity, so nothing can say "this session produced four things, one of which failed." Failure is equally unaddressed: a provider with no usable key used to hang silently, a stalled stream hung forever (both fixed in #119), and the current taxonomy can express a dead run but not a *degraded* one where a single subagent failed and the report shipped with a known gap.

Three constraints frame the work:

1. **No second agentic framework.** Pi is LENS's single agentic backend (ADR-0014). Loop, tools, steering, compaction, and retry come from Pi; LENS keeps ownership of evidence admission, budgets, the ledgers, telemetry boundaries, and the plan gate.
2. **Two modes, one product.** Agentic Search (gate-free, Pi loop) and Deep Research (plan-first, plan-gated) are different contracts, not different depths of one contract (ADR-0016).
3. **Visibility is the product.** The harness shell must render *what actually happened*, from events, never from plausible-looking invention.

---

## Solution

**The LENS Agent Harness: an agent-first workspace whose two modes are served by one Pi backend, one event backbone, and one artifact contract.**

1. **Two modes, chosen per conversation** (ADR-0016). **Agentic Search** runs Pi's loop directly — no plan gate, no perspective, capped by sources and a turn ceiling. **Deep Research** keeps today's plan-gated agency orchestration; `wide` is demoted from a mode to its third depth preset (`Quick | Deep | Wide`).
2. **Pi hosted in-process as one conversation-scoped `AgentSession`** (ADR-0014). The session is constructed with a research-only tool allow-list (`web_search`, `source_check`, `fetch_content`, `get_search_content`, `todo`), `agentDir` under LENS app-data, and keys passed via `setRuntimeApiKey` — never persisted, never logged. `steer()` redirects the in-flight turn-group; `followUp()` queues the next one; `abort` cancels.
3. **A dedicated `/api/agent/*` engine namespace** that reuses the existing session manager, WebSocket stream, and provider admission guard as shared modules — never by bending `/api/research/start`, whose plan-gate assumptions must stay intact.
4. **First-class session-scoped Artifacts** (ADR-0015). `{ id, type, title, state, producer, payload, createdAt, updatedAt }` for the four output types (`plan`, `report`, `evidence-shelf`, `graph`), announced on the LiveEvent backbone through `artifact_created` / `artifact_updated` so the workspace pane renders from events alone.
5. **One accounting story across both modes.** The user-facing budget stays **sources** (already in Settings); every `fetch_content` / `get_search_content` result flows through the existing session Fetch Ledger, and Agentic Search adds an invisible **turn ceiling** that terminates through the existing `budget_exhausted` event.
6. **A three-tier failure taxonomy → surface mapping**: recoverable-and-continuing → agent card + status line; run-terminal-and-actionable → `CalloutAlert` with the existing bilingual action copy; agent-terminal-but-run-survives → agent card shows `failed` and the report discloses the coverage gap.
7. **One shell.** The harness workspace becomes the LENS workspace; the old shell and `isHarnessPreviewOpen` are deleted in the same flip PR, capability-gated and CI-gated.

---

## User Stories

### Mode Model & Conversation Lifecycle

1. As a user with a quick factual question, I want a mode with no plan gate, so that I am not asked to approve a plan for a question that does not need one.
2. As a user with a complex, high-stakes question, I want Deep Research's plan approval and perspective controls, so that I can steer the investigation before expensive retrieval begins.
3. As a user choosing a mode, I want the choice to be per-conversation and set before the first turn, so that one conversation is never ambiguously half-gated.
4. As a user who picked the wrong mode, I want switching mode to start a new conversation rather than silently reinterpreting the current one, so that a session's evidence contract stays truthful.
5. As a Deep Research user, I want one depth picker offering Quick, Deep, and Wide, so that "how deep" is one decision instead of two overlapping ones.
6. As a user in Agentic Search, I want no perspective control, so that the composer shows only the controls that mode actually honours.

### Agentic Search Loop & Steering

7. As a user running Agentic Search, I want to redirect the run mid-flight without losing what it has already gathered, so that a wrong assumption costs a correction rather than a restart.
8. As a user with a follow-up question, I want to queue it into the same conversation context, so that the second question benefits from the first answer's evidence.
9. As a user mid-run, I want to cancel in under a second and keep the partial transcript and artifacts, so that work already done is not lost.
10. As a user watching a run, I want to see each tool call as it happens, so that I can tell the difference between "thinking" and "stuck".
11. As a user, I want the agent to be able to search, fetch, and check sources — and to be structurally incapable of writing, editing, or executing files, so that a research tool cannot mutate my machine.
12. As a user issuing a steer, I want it to cost no additional sources and to not reset my budget, so that redirecting is free.

### Artifacts & Workspace

13. As a user, I want to see one list of everything this session has produced, so that I do not have to hunt through separate panes for the plan, report, shelf, and graph.
14. As a user, I want each artifact to show its own state (pending, ready, failed), so that a failed graph does not make a successful report look broken.
15. As a user inspecting evidence, I want the shelf artifact to open the existing inspection drawer, so that the artifact pane adds identity rather than a new reading experience.
16. As a user, I want artifact state announced on the same event stream as everything else, so that the pane cannot drift from the engine's view of truth.

### Failure Visibility & Recovery

17. As a user hitting a transient transport failure, I want the run to keep going and show me the retry on the agent card, so that a hiccup does not look like a crash.
18. As a user hitting a run-terminal, actionable failure (no provider key, budget exhausted, watchdog timeout), I want a bilingual callout that tells me what to do next, so that I am never left staring at a stalled run.
19. As a user whose single subagent failed while others succeeded, I want the report to ship and disclose the coverage gap, so that partial success is visible rather than silently laundered into a complete-looking report.
20. As a user, I want no fabricated agent, terminal, or repository activity in the workspace, so that what I see is what happened.

### Migration & Parity

21. As a maintainer, I want the new shell to land only once both modes run end-to-end in it, so that the flip is a capability milestone rather than a rewrite deadline.
22. As a maintainer, I want every Deep Research behaviour preserved behind the parity harness, so that adopting the new mode model cannot silently regress the existing one.
23. As a maintainer, I want the existing `standard|wide` wire values translated rather than changed, so that stored sessions and existing tests keep working.
24. As a maintainer, I want the flip PR to delete the old shell's entry point, so that the product does not carry two shells in steady state.

---

## Implementation Decisions

### 1. Mode Model & Composer (ADR-0016)

- **Two modes.** `mode` becomes `agentic | deep` at the API boundary. Agentic Search → `/api/agent/*`, gate-free. Deep Research → `/api/research/*`, plan-gated.
- **Per-conversation, locked after the first turn.** The conversation record carries its mode; the composer disables the mode control once a turn exists, and switching starts a new conversation. A session cannot be both gated and gate-free.
- **Wide is a depth preset.** The depth picker renders only under Deep Research with three presets: `Quick | Deep | Wide`. Wide keeps ADR-0007 semantics and its 100→200 source guidance.
- **Wire compatibility.** The translation lives in the existing `buildResearchStartPayload` seam: a `Wide` preset on a Deep Research conversation emits today's `mode: 'wide'` request unchanged. `standard|wide` remain the wire values until a separate ticket renames them; stored history and the existing suite keep passing.
- **Perspectives stay Deep Research-only.** The perspective control is hidden under Agentic Search, where decomposition is Pi's loop rather than a STORM persona.
- **`storm` survives.** It remains a Deep Research depth tier and the STORM perspective entry.

### 2. Agentic Search Loop — Pi `AgentSession` Hosting (ADR-0014)

- **Hosting.** `AgentSession` runs **in-process** in the engine via the official Pi SDK. RPC-over-stdio is a recorded fallback, never a parallel path.
- **Session shape.** **One `AgentSession` per Agentic Search conversation**, created on the first turn and held in memory. Each user submit is a **turn-group**.
- **Tool allow-list at construction.** Exactly `web_search`, `source_check`, `fetch_content`, `get_search_content`, `todo`. Coding tools are never granted, so there is nothing for a permissions UI to approve; a test asserts the constructed allow-list equals exactly those five.
- **State location.** `agentDir` resolves under the LENS app-data directory — never `~/.pi`.
- **Keys.** Passed via `setRuntimeApiKey` at construction; never persisted into Pi state and never logged.
- **Ownership boundary.** Pi owns the loop, session lifecycle, steering, compaction, and retry. LENS owns evidence admission, budgets, the fetch and plane ledgers, telemetry boundaries, and the plan gate — every LENS control sits at a policy point around tool calls (`beforeToolCall` = budget/ledger/evidence gate; `afterToolCall` = admission + telemetry), so Pi's loop cannot bypass LENS accounting.
- **Pi-only is structural.** `/api/agent/*` takes no provider parameter — there is nothing to configure. Deep Research's synthesis keeps the existing `LLMProvider` seam until a later ADR retires it, so parity is untouched.

### 3. Engine Surface — the `/api/agent/*` Namespace (Q8)

- **New namespace, shared modules.** `POST /api/agent/start`, `POST /api/agent/:id/steer`, `POST /api/agent/:id/follow-up`, `POST /api/agent/:id/abort`. These reuse the existing session manager, WebSocket broadcaster, and provider admission guard **as modules** — not by extending `/api/research/*` routes.
- **Why a separate namespace.** `/api/research/start` carries plan-gate assumptions; Agentic Search must never consult the gate. A dedicated route file makes "Agentic Search has no plan gate" provable by reading one file, and a test asserts the agent routes never read provider settings.
- **No collision with `/api/followup`.** The existing `POST /api/followup` is stateless report chat (`DeepResearchAgent.answerFollowup`); it is untouched and semantically distinct from `/api/agent/:id/follow-up`.
- **Session lifecycle is shared.** The existing `planning → awaiting_approval → running → {completed, cancelled, failed}` state machine (`sessionLifecycle.ts`) continues to guard transitions; agent sessions enter it at `running` and never touch `awaiting_approval`.
- **Start-time admission guard applies.** `/api/agent/start` returns the same HTTP 422 bilingual admission failure when the configured provider has no usable key.

### 4. Budget & Ledger Accounting (Q9)

- **Sources stay the user-facing unit.** Settings already exposes a source budget, and both modes use it; the wide 100→200 guidance continues to attach to the Wide preset.
- **One fetch story.** Every `fetch_content` / `get_search_content` result in Agentic Search flows through the existing session-scoped **Fetch Ledger** (canonical-URL keyed, promise-memoized), exactly as researchers do today — a fetch is a fetch, and the ledger remains the dedupe authority across subagents.
- **Plane ledgers still gate retrieval.** The search and scrape planes keep their `{ active, ledgered }` accounting, so no retrieval in either mode can be unledgered.
- **A hard turn ceiling.** Agentic Search adds an invisible ceiling (default 40 turns per turn-group) as a safety rail. Exhaustion terminates through the existing `budget_exhausted` event with the existing bilingual copy — no new terminal vocabulary.
- **Tokens are Pi-internal.** LENS never surfaces or budgets tokens; per ADR-0014 the loop is Pi's, the budget is LENS's.

### 5. Artifacts (ADR-0015, Q13)

- **Entity shape.** `{ id, type, title, state, producer, payload, createdAt, updatedAt }`, persisted inside the LENS session record.
- **Closed type set.** `plan`, `report`, `evidence-shelf`, `graph`. A new producer adds a type deliberately.
- **Per-artifact state.** `pending → ready | failed`, so a failed graph and a ready report coexist truthfully.
- **Events (Q13).** Two new `LiveEvent` union members — `artifact_created` and `artifact_updated` — plus one shared optional payload field `artifact: { id, type, title, state, producer }`. This follows the `researcher_telemetry` additive precedent exactly: a union member plus an optional payload field, mirrored in `engine/types.ts` and `src/types/index.ts`, with a test pinning the two unions in lockstep.
- **Two members, not one.** "New pane entry" and "state transition" are rendered differently; an `action` field would force the renderer to re-derive intent.
- **Pre-terminal only.** Artifact events fire before the terminal event, so they ride the existing `subscribe → socket` broadcast with no lifecycle change and respect the Event Faithfulness rule (no silent drops).
- **Producer-agnostic.** Deep Research and Agentic Search emit the same events for the same four types; the pane never learns which mode produced an artifact.
- **Out of scope.** A cross-session artifact library; the Library view stays report-based.

### 6. Steering, Follow-Up & Cancellation (Q14)

- **`steer()` mutates the in-flight turn-group.** Allowed only while the session is `running`. Pi injects the instruction into the active context: no re-plan, no evidence-gate re-run, **no budget reset** — subsequent fetches still hit the Fetch Ledger, and the instruction itself costs no source.
- **`followUp()` queues the next turn-group.** Each queued group is gated by budget and ledger anew.
- **Terminal states reject both with 409.** This falls out of `sessionLifecycle`'s existing illegal-transition rejection plus the existing bilingual lifecycle copy — not new rules.
- **`abort` is immediate.** Same abort-propagation contract as today's cancellation: partial transcript and produced artifacts are preserved.
- **Agent management.** The workspace lists live subagents with per-agent state and offers view/cancel, driven by the existing `researcher_telemetry` events.

### 7. Failure & Retry Taxonomy → Surface Mapping (Q10)

Three tiers, mapped to the three surfaces LENS already has (no toasts are introduced):

| Tier | Examples | Surface |
|---|---|---|
| **Recoverable, in progress** | transport retry, stream resume | agent card state + status line — never an alert; the run continues |
| **Run-terminal, actionable** | provider admission (422), budget/turn exhausted, watchdog timeout | `CalloutAlert` with the existing bilingual action copy ("raise the limit…", "check provider…") |
| **Agent-terminal, run survives** | one subagent fails, others proceed | agent card shows `failed`; the parent degrades gracefully and the report discloses the facet gap |

- **Coverage disclosure is mandatory.** A run that lost a facet states the gap in the report's coverage section; it never presents a degraded run as complete.
- **No fabricated state.** Retry, cancellation, and terminal failures render from real events only (#119's mirroring), and the workspace never invents agent, terminal, or repository activity.

### 8. Event Backbone Additions

- **Additive only.** `LiveEvent` (`engine/types.ts`) gains `artifact_created` and `artifact_updated` plus the optional `artifact` payload; existing members and payload fields are unchanged.
- **Existing plumbing is sufficient.** Events are broadcast through `researchSession.subscribe(event → sockets)`; artifact and agent-tool events are pre-terminal, so `isCompleted` and the 30-minute retention behave exactly as today.
- **Delta replay covers the new events.** The `?since=<eventId>` WS reconnect path replays them like any other event — no special-casing, and terminal outcomes are still not resurrected.
- **Lockstep is tested.** A test asserts the engine union and the renderer union carry the same members and the same payload fields, so a one-sided addition fails the suite.

### 9. Transcript & History (Q15)

- **Renderer `localStorage` stays the single history store** (`deep_research_history`). No engine-side disk persistence is introduced; engine sessions remain in-memory with the existing 30-minute retention.
- **History records gain** `mode`, `transcript` (a copy of Pi's `state.messages` — plain JSON, not a new format), and `artifacts` (ids + states).
- **Reopening a history conversation is read-only replay.** Artifacts render from their stored states; no engine session is implied.
- **Resuming a live conversation** works only while the engine session is alive, using the existing `?since=<eventId>` delta replay. When the session has been cleaned up, the conversation is history, and the UI says so rather than offering a resume that cannot work.

### 10. Deep Research Migration Sequence (Q11)

Parity-gated; no step deletes a working path before its replacement is green.

1. **Agentic Search ships alongside.** New `/api/agent/*` namespace, new composer mode, per-conversation mode model. Deep Research is untouched.
2. **The harness shell becomes default** once both modes run end to end in it (see §11), per Q5's single-shell decision.
3. **Deep Research controls migrate.** `depth` becomes the `Quick | Deep | Wide` picker and `perspective` stays under Deep Research — inside the new shell.
4. **The request shape is versioned, not changed.** `standard|wide` remain the wire values as internal aliases, so stored sessions, history, and the existing suite keep working. The parity harness (ADR-0011) gates every step.

### 11. The Harness Shell Flip (Q5, Q16)

One flip ticket, capability-gated. It is done when — and only when — all eight hold:

1. The mode picker is present and locked after the first turn.
2. Both modes run end to end in the new shell.
3. The artifact pane renders all four types with per-artifact states.
4. The history rail shows both modes and replays transcripts.
5. Settings, skills, library, graph, and discover are all reachable in the new shell.
6. `isHarnessPreviewOpen` and the old shell's entry point are **deleted in the same PR** — no steady-state dual shell.
7. The full suite is green and `impeccable detect` is clean for `frontend/src`.
8. The flip never ships ahead of its own green gate: CI is the gate, not local confidence.

---

## Testing Decisions

### What Makes a Good Test

- **External behaviour focus.** Tests exercise public seams (`/api/agent/*` routes, the constructed `AgentSession`, the artifact event stream, the composer's request payload) and assert observable outputs — events emitted, artifacts announced, requests shaped, transitions rejected. They do not assert private helpers.
- **Determinism.** Tests are reproducible offline with deterministic Pi/LLM transports (the existing faux-response and fixture patterns), never live networks. A test that passes alone but fails in the suite is a defect in the test.
- **The invariant is the test.** "Pi-only" and "research-only tools" are proven by assertions on the constructed allow-list and on the agent route's inputs, not by documentation.
- **Lockstep tests.** Where a union is mirrored across the engine and renderer, a test pins both sides so a one-sided edit fails.

### Tested Modules & Seams

1. **`/api/agent/*` route seam**: start/steer/follow-up/abort; 422 admission failure; 409 on terminal states; no provider parameter accepted; the route never reads provider settings.
2. **`AgentSession` construction seam**: allow-list equals exactly `web_search`, `source_check`, `fetch_content`, `get_search_content`, `todo`; `agentDir` resolves under LENS app-data; keys never persisted or logged.
3. **Accounting seam**: agent-mode fetches land in the Fetch Ledger; plane ledgers stay closed; the turn ceiling terminates through `budget_exhausted`.
4. **Artifact seam**: `artifact_created`/`artifact_updated` payload shape; per-artifact states; pre-terminal ordering; engine↔renderer union lockstep.
5. **Composer seam**: `buildResearchStartPayload` translation — Wide preset → `mode: 'wide'`; perspective and depth hidden under Agentic Search; mode locked after the first turn.
6. **Parity seam**: ADR-0011 harness stays green through every migration step, proving Deep Research is unchanged.
7. **Prior art in codebase**: the existing suite (472 tests today, `npm test`), the `#119` visibility tests, and the `#121` harness-workspace tests remain the regression floor.

---

## Out of Scope

- **Permissions / approval UI.** Under the research-only allow-list nothing is ever granted, so there is nothing to approve. The **seam** is specified (the allow-list is asserted and the construction point is single), so granting a capability later is a deliberate change rather than a redesign.
- **User-facing hooks / plugin surface.** Only LENS policy points are specified (`beforeToolCall` = budget/ledger/evidence gate; `afterToolCall` = admission + telemetry). No user-authored hook API.
- **Session trees / forking.** Pi provides it; LENS promises no UX for it in this spec.
- **Any scheduler or scheduled/background tasks.** Background *work* (async subagents) is in scope; scheduled future runs are not.
- **Discover feed work.** The surface returns only if the new shell needs it later (operator decision on #118).
- **A cross-session artifact library.** Library stays report-based.
- **Engine-side transcript persistence.** History stays in the renderer's `localStorage`; no new datastore.
- **Token-level budgeting in the UI.** Tokens stay Pi-internal.
- **Renaming the `standard|wide` wire values.** A later ticket may do it; this spec translates instead.

---

## Further Notes

- **Brand & visual identity.** The harness shell adheres to `BRAND.md` and `DESIGN.md` (monochrome neutral palette `#111111` / `#191919`, Inter and Cairo typography, concentric lens mark, no decorative gradients, no unsupported "Pro" badge). Status colours already declared in `DESIGN.md` are the only semantic accent, always paired with an icon and a label.
- **Internationalization.** Full Arabic and English parity for every new surface — mode picker, agent cards, artifact states, failure callouts, and turn/budget exhaustion copy.
- **Environment caution.** Port 8000 may be held by an unrelated local service; the engine's readiness probe reports its owning `pid` and bound port so the caller can prove it reached this engine (the smoke test's readiness gate relies on this).
- **Determinism caution.** The suite's file list is explicit in `package.json` and guarded by a completeness test; add new test files to that list in the same change.
- **Triage status.** Ready for `/to-tickets`; ticket slicing follows the migration sequence in §10 so the parity harness gates every step.





