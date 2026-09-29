# Pi-Only Agent Runtime Hosting (in-process AgentSession)

Status: accepted
Date: 2026-09-29
Ticket: #122 (settlement of #120, part of #118)

## Context

The Agentic Search map (#118) fixed Pi as the sole agent backend — the question
was never *whether* to host Pi's agent runtime but *how*. Ticket #120
investigated hosting with evidence from the pi repository docs (`rpc.md`,
`sdk.md`), the installed `@earendil-works/pi-coding-agent@0.85.1` (full
findings: `docs/research/pi-hosting-investigation.md`), and upstream discussion
of pi-agent-core as an embedded runtime. Today's engine uses only
`pi-agent-core` + `pi-ai` (raw `agentLoop`/`Agent` + hand-rolled session,
compaction, steering, and retry) while the `pi-coding-agent` layer ships
alongside, already vendored to `dist-electron/vendor/pi/` for the tool bridge.

Three hosting options existed: `AgentSession` in-process via the official SDK,
RPC-over-stdio against a `pi --mode rpc` subprocess, and the status quo
pi-agent-core loop. The package's own docs recommend in-process `AgentSession`
for Node hosts. LENS is an Electron 44 (Node 24.20) desktop app with an
in-process engine — the process-boundary isolation an RPC host buys is a
hardening fallback here, not a requirement, and the hand-rolled loop re-builds
what `AgentSession` provides (session state, steering queues, compaction,
auto-retry) at permanent maintenance cost.

## Decision

1. **Host `AgentSession` in-process (per LENS session) via the official SDK.**
   `createAgentSession` runs in the Electron main process, one session per
   agentic turn-group, `SessionManager.inMemory()` unless a spec requires
   transcript persistence (SPEC-028 does: LENS persists `state.messages`
   itself, keyed to the `ResearchSession`).
2. **Research-tools-only allow-list at construction.** Agentic Search sessions
   are granted only LENS research tools (`web_search`, `source_check`,
   `fetch_content`, `get_search_content`, `todo`); coding tools
   (`read`/`write`/`edit`/`bash`) are never granted. The allow-list is the
   permission grant (SPEC-028 Decision 5).
3. **LENS owns the discovery surfaces**: `agentDir` points at
   `app.getPath('userData')/pi-agent` (never `~/.pi`), `PI_OFFLINE: true` on
   `ModelRuntime.create` (LENS provisions providers itself), and provider keys
   ride as non-persisted runtime overrides from LENS settings.
4. **Enforcement stays in the LENS-wrapped tools.** The ADR-0013 retrieval
   gate, plane ledger, and SSRF validation hold inside the tool wrappers;
   `beforeToolCall`/`afterToolCall` are observation points (telemetry, audit)
   in v1 — no policy logic moves into hooks (SPEC-028 Decision 6).
5. **Event bridge, not state bleed.** `session.subscribe` events map onto the
   LiveEvent backbone (agent-card lifecycle, tool chips, streamed deltas,
   retry/terminal states); runtime session state never becomes LENS state
   except through the explicit transcript persistence seam.
6. **The Pi-only rule is enforced at named seams**: one session-construction
   seam is the only `createAgentSession` call site, and a suite guard
   (`test/pi_only_guard.test.mjs`) fails CI if any module under
   `frontend/electron/` imports a second agent/orchestration runtime.
7. **Deep Research migrates last, parity-gated.** LENS-native parent/
   researcher orchestration remains until each researcher re-hosts as an
   `AgentSession` under this contract, gated by the ADR-0011 parity harness
   with expand–contract retirement of the native researcher loop.

## Consequences

- The engine gains steering/follow-up queues, compaction, and auto-retry from
  the runtime instead of maintaining hand-rolled equivalents; the
  pi-subagents deferral (per-researcher `AgentSession` hosting) becomes
  mechanical.
- The ESM-only package loads via dynamic `import()` behind the existing shim
  precedent; packaged-asar behavior is proven by the #129 smoke/verify gates,
  with `proper-lockfile`/`cross-spawn` as unpacked-asar candidates to verify
  at build time.
- Pi 0.x churn is contained by the existing exact-version pins.
- A second agent framework can no longer enter the codebase silently — the
  guard test fails the build, and the construction seam concentrates review
  attention on one file.

## Alternatives considered

- **RPC-over-stdio subprocess host** — recorded as the fallback for crash/
  isolation hardening; strict LF JSONL framing (Node `readline` is
  non-compliant) plus a protocol layer for no current requirement. Rejected
  as the starting architecture.
- **Stay on the raw pi-agent-core loop** — rejected: re-builds session,
  steering, compaction, and retry by hand while the layer that provides them
  already ships in the dependency tree.
- **LangGraph/CrewAI-style orchestration layer** — rejected and prohibited by
  the map's standing rule; see Decision 6 for the enforcement.
