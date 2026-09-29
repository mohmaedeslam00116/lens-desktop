# Specification: LENS Agentic Search Harness — Pi-Only Agent Runtime, Agent Workspace & Typed Artifacts

**Specification ID**: `SPEC-028`
**GitHub Issue**: [#122: Final spec synthesis: UX + backend specification for /to-tickets](https://github.com/mohmaedeslam00116/lens-desktop/issues/122)
**Parent Roadmap**: [#118: [Map] Agentic Search on a Pi-Only Backend: Antigravity-style Workspace & Streaming Visibility](https://github.com/mohmaedeslam00116/lens-desktop/issues/118)
**Date**: September 29, 2026
**Status**: Ready for Agent (`ready-for-agent`)

---

## Problem Statement

LENS is research-first, not agent-first. Its research agency runs on hand-rolled orchestration layered over the raw `pi-agent-core` loop, which means the harness behaviors that define an Antigravity-style agent workspace — user-facing agent loops, mid-run steering, session/compaction/retry management, per-agent visibility, permissions as policy points, first-class typed artifacts — are either absent or rebuilt by hand where a runtime already provides them.

The map (#118) settled the foundations with evidence: the stuck-run diagnosis and visibility fix (#119/#123) made every engine event surfaceable, the Pi runtime hosting investigation (#120) recorded the verdict to host the official `AgentSession` in-process, and the workspace prototype direction (#121/#126) locked the layout and its truthfulness rules. What remained was composition: a complete UX + backend/harness specification that turns those decisions into a buildable plan.

This document is that specification. Every decision below was confirmed with the operator on 2026-09-29 (see Further Notes).

## Solution

**One harness, one backend: Pi.** LENS hosts the official `@earendil-works/pi-coding-agent` `AgentSession` in-process — the layer it already ships — as the sole agent runtime, forever. **Agentic Search (`البحث الوكيل`)** becomes the default-in-chat research loop: gate-free, self-directed through LENS's research tools, bounded by session budget and the plane's fetch ledger. **Deep Research (`البحث المعمّق`)** keeps its plan-first, plan-gated agency until the final phase re-hosts each researcher as an `AgentSession`, parity-gated. The workspace becomes an agent workspace: per-agent activity cards, tool-call chips, live sources, and a right-hand inspector of typed artifacts — Plan, Evidence Shelf, Living Report, Research Graph, and the new **Agentic Conversation** — fed solely by the LiveEvent backbone. The Pi-only rule is enforced at named seams, not by convention.

The nine settled decisions, each expanded below:

1. **Scope**: comprehensive harness specification, distributed across phased tickets (Agentic Search → workspace → steering/polish → Deep Research migration).
2. **Session model**: one `AgentSession` per agentic turn-group (hosting verdict), steering/follow-ups mid-run via the runtime queues.
3. **Transcript**: persisted LENS-side (plain-JSON `state.messages` keyed to the `ResearchSession`); history replays conversations as they happened.
4. **Deep Research migration**: in spec as the final phase, parity-gated (ADR-0011), expand–contract to retirement of the native researcher loop.
5. **Permissions**: research-tools-only allow-list at session construction plus budget/ledger caps — no interactive prompts.
6. **Policy enforcement**: inside the LENS-wrapped tools (gate, ledger, SSRF); hooks are observation points in v1.
7. **Agent management v1**: the single agentic loop with explicit cancel; multi-agent management arrives with the migration phase.
8. **Artifacts**: the four adopted types (Plan, Evidence Shelf, Living Report, Research Graph) plus the Agentic Conversation as a fifth.
9. **Retries**: full transparency — runtime `auto_retry_*` surfaced, tool errors passed to the loop, no swallowed failures.

## User Stories

### Ask LENS a question, agentically

A researcher types a question in chat. Agentic Search starts immediately — no plan-approval gate. The agent card comes alive; tool-call chips show the real queries as the loop issues them; sources stream into the shelf; the answer arrives grounded in admitted evidence. The user never waited on a plan to answer a question that did not need one.

### Steer the loop mid-run

Mid-run, the user types a correction ("skip the paywalled ones, focus on 2025 papers"). The steering queues through the runtime's `steer()`/`followUp()` path and the loop redirects — visibly, as a queued-then-applied event, never silently.

### Watch the run honestly

Everything the runtime does is visible: `agent_start/end`, `tool_execution_*` with real names and outputs, `auto_retry_*` when a provider hiccup is retried, terminal states (`completed`, `cancelled`, `budget_exhausted`, provider failure) rendered explicitly. Silence is never mistaken for progress (the #119 law, extended to AgentSession events).

### Inspect the artifacts

The right-hand inspector holds the run's typed artifacts: the plan (when Deep Research produced one), the evidence shelf, the living report, the research graph — and the agentic conversation itself as a first-class, replayable artifact.

### Cancel cleanly

One cancel aborts the session; the UI shows an explicit terminal state and what was already admitted to the shelf. Nothing dangles, nothing pretends.

### Revisit past conversations

Past agentic conversations persist LENS-side and replay from the history rail as they happened — the transcript is a LENS artifact, not a runtime side effect.

## Implementation Decisions

### 1. Pi-only runtime hosting (ADR-0014)

The engine hosts `AgentSession` in-process per the #120 verdict: `createAgentSession` in the Electron main process, one session per turn-group, `ModelRuntime.create({ PI_OFFLINE: true })` per engine boot, provider keys injected as non-persisted runtime overrides from LENS settings, and `agentDir` pointed at `app.getPath('userData')/pi-agent` so Pi's global discovery never collides with a user's real `~/.pi`. The package is already installed and vendored (`@earendil-works/pi-coding-agent@0.85.1`, pinned); the ESM-only package loads via dynamic `import()` behind the existing shim precedent, and the packaged-asar behavior is proven by the #129 smoke/verify gates (unpacked-asar for `proper-lockfile`/`cross-spawn` verified at build time).

**The Pi-only rule is enforced, not aspirational**: the engine owns a single session-construction seam; no second agent runtime (LangGraph, CrewAI, AutoGen, or any parallel orchestration framework) may be imported anywhere under `frontend/electron/`. A guard test in the suite asserts this the way `deferred_report_chunk.test.mjs` guards the bundle split — one import would fail CI, silently or otherwise.

### 2. Session model & lifecycle

One `AgentSession` per agentic turn-group (a question or a follow-up exchange), matching the hosting verdict. The session runs on `SessionManager.inMemory()`; LENS persists the transcript itself — `state.messages` is plain JSON — keyed to the `ResearchSession` so history replay shows the conversation as it happened. Runtime session state never becomes LENS state: the LiveEvent bridge (Decision 5 of the hosting verdict) maps `session.subscribe` events onto the existing backbone (`agent_start/end` → agent-card lifecycle, `tool_execution_*` → chips, `message_update.text_delta` → streamed answer), and LENS continues to own event faithfulness — every UI element traces to a real event.

### 3. Agentic Search loop contract

Agentic Search **bypasses the plan-approval gate** (that gate is a Deep Research invariant, unchanged). Its bounds are budgetary, not procedural: the session budget caps cost, the plane's fetch ledger caps retrieval, and evidence admission/dedupe/telemetry boundaries stay LENS-owned exactly as in ADR-0013's boundary clause. The loop terminates into LENS's evidence contracts: the final answer and its admitted sources land in the shelf and report pipeline like any other run's output.

### 4. Permissions & policy points

Authorization happens **at session construction**: the research-tools-only allow-list (`web_search`, `source_check`, `fetch_content`, `get_search_content`, `todo`) is the permission grant — coding tools (`read`/`write`/`edit`/`bash`) are never granted, not merely blocked. The retrieval gate, fetch ledger, and SSRF validation remain **inside the LENS-wrapped tools** (ADR-0013), where they already hold; `beforeToolCall`/`afterToolCall` hooks are reserved as **observation points** (telemetry, audit) in v1 — no policy logic moves into hooks, so there is exactly one enforcement point per contract. No interactive permission prompts in v1.

### 5. Failure, retries & terminal taxonomy

Provider-transient errors retry via the runtime's built-in auto-retry, and every `auto_retry_*` event surfaces in the feed — retries are shown, never swallowed. Tool errors pass to the loop to reason about and recover from; LENS does not pre-digest them. Terminal states (`completed`, `cancelled`, `budget_exhausted`, provider failure) are explicit UI states per the visibility law of #119/#123: a run that stops is *seen* stopping, with what it produced.

### 6. Agent workspace & typed artifacts

The workspace follows the #126 direction: the user-authored Stitch harness is the **layout and interaction starting point** (compact rail, centered composer, conversation-first canvas, restrained right inspector), rewritten as LENS components under `BRAND.md`/`DESIGN.md` monochrome discipline — no Antigravity identity, no fabricated data, tool chips and agent cards driven only by real events. The inspector's typed artifacts: **Plan** (Deep Research), **Evidence Shelf**, **Living Report**, **Research Graph**, and the fifth — **Agentic Conversation** — a projection of the persisted transcript (Decision 2). Agent management in v1 is the single agentic loop with explicit cancel; multi-agent management (view/cancel per researcher) arrives with the migration phase (Decision 7), when there are multiple real agents to manage.

### 7. Deep Research migration (final phase)

Deep Research keeps LENS-native orchestration — parent, fan-out, auditor, roles are LENS domain, not agent runtime — until its migration phase re-hosts each **researcher** as an `AgentSession` with the same construction contract (research tools, caps, event bridge). Every migration step is parity-gated through the ADR-0011 harness: golden-fixture replays through both paths, four strict diff stages, expand–contract ordering — the native researcher loop retires only after parity runs green. The plan-approval gate, budget accounting, and evidence preservation are preserved bit-for-bit across the swap.

### 8. Background & parallel work

v1 runs one foreground agentic loop per session — the honest scope for single-user desktop research today. The session model does not preclude more: the construction seam accepts multiple sessions, so parallel/background work becomes an additive capability when the researcher migration introduces genuinely parallel agents, not a re-architecture.

## Testing Decisions

### What makes a good test

The suite's standing laws apply unchanged: deterministic, explicit file lists guarded by `test_suite_completeness.test.mjs`; a test that passes alone but fails in the suite is a defect in the test; behavior changes land with their tests in the same PR.

### Tested modules & seams

- **Session-host construction** (`engine`): the constructor contract — research-tools-only allow-list, `agentDir` under userData, `PI_OFFLINE`, runtime-override keys, in-memory session manager — asserted against the real `createAgentSession` options object. A tool outside the allow-list, or an `agentDir` escaping userData, is a test failure.
- **Event bridge** (`engine`): fixture-driven mapping of `session.subscribe` events → LiveEvents, including `auto_retry_*`, tool errors, and every terminal state. A dropped event class is a failure (the #119 law, mechanized).
- **Transcript persistence** (`engine`): round-trip of `state.messages` into the LENS-side store keyed to the session; history replay reads what the run wrote, byte-for-byte JSON.
- **Steering & cancellation** (`engine`): `steer()`/`followUp()` queue-then-apply produces visible queued events; cancel aborts the session and emits the explicit terminal event with already-admitted evidence intact.
- **Boundary integrity** (`engine`): the gate/ledger/SSRF checks fire from inside the tool wrappers — a hook-based bypass attempt fails; admission/dedupe/budget behavior is unchanged from ADR-0013's contract.
- **Pi-only guard** (`test/pi_only_guard.test.mjs`): no module under `frontend/electron/` imports a second agent/orchestration runtime; the session-construction seam is the only `createAgentSession` call site.
- **Parity (migration phase)**: the ADR-0011 harness replays golden fixtures through re-hosted researcher sessions; divergence above the four-stage threshold blocks the swap step.

## Out of Scope

- **Interactive permission prompts** — authorization is construction-time (Decision 4); prompts are a future layer if ever needed.
- **Background task scheduler & multi-session UI** — reserved by Decision 8, built when parallel agents exist.
- **Coding tools** (`read`/`write`/`edit`/`bash`) — never granted to research sessions.
- **RPC-over-stdio isolation mode** — the recorded fallback for hardening, not the starting architecture.
- **Pi extension-host surface** beyond research tools (custom commands, extension discovery) — unnecessary at this layer.
- **Installer artifact** — this track is code-only; packaging accompanies a milestone release.

## Further Notes

- **Decision record**: all ten decisions confirmed by the operator via structured grilling on 2026-09-29 against the settled map evidence (#119/#123 visibility, #120 hosting verdict, #121/#126 workspace direction, ADR-0013 boundary clause, ADR-0011 parity law).
- **Primary sources**: `docs/research/pi-hosting-investigation.md` (hosting verdict and contract), the map issue #118 and its closed decision tickets.
- **ADR-0014** records the hosting decision; ADR-0010/0011/0013 continue to govern agency architecture, parity, and the retrieval plane respectively.
- **Hand-off**: this specification is the `/to-tickets` input. Tickets are distributed across phases in this order: (1) Pi runtime hosting + event bridge + Agentic Search loop, (2) agent workspace + typed artifacts + transcript/history, (3) steering + cancellation polish, (4) Deep Research researcher re-hosting, parity-gated, expand–contract to retirement.
