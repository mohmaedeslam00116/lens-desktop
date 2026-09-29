# ADR-0014: Pi as the Sole Agentic Backend with In-Process AgentSession Hosting

**Status:** Accepted
**Date:** 2026-09-29
**Decided in:** [Agent harness spec issue #118](https://github.com/mohmaedeslam00116/lens-desktop/issues/118) (grill-with-docs Round 1, Q3 + hosting verdict #120).
**Builds on:** ADR-0010 (research agency), ADR-0013 (primary retrieval plane). Supersedes nothing; sets the target architecture for the Agent Harness migration.

## Context

Today's Pi integration is `piAdapter.generateWithPi()` — a text-only LLM adapter over `pi-ai` with no loop, no tools, and no sessions. `AgentSession` appears nowhere in the codebase. The Agentic Search mode required by issue #118 needs a real agentic loop with tools, mid-run steering, and queued follow-ups. The hosting investigation (`docs/research/pi-hosting-investigation.md`, branch `research/pi-hosting`, verdict recorded in issue #120) evaluated in-process SDK hosting against RPC-over-stdio and recommended in-process hosting with an explicit boundary clause.

## Decision

**Pi is LENS's single agentic backend, hosted in-process via the official SDK's `AgentSession`, with a construction-time tool allow-list and a hard ownership boundary.**

1. **One backend.** No second agentic framework. Every agentic capability (loop, tools, steering, compaction, retry) comes from Pi; LENS never reimplements loop mechanics. Enforced by a single construction point so a hypothetical second backend cannot be introduced silently.
2. **In-process hosting.** `AgentSession` runs in the engine process via the official SDK. RPC-over-stdio is recorded as a later fallback only if in-process hosting proves untenable (crash isolation, memory pressure) — not a parallel path.
3. **Tool allow-list at construction.** Exactly `web_search`, `source_check`, `fetch_content`, `get_search_content`, `todo`. Coding tools (`write`, `edit`, `bash`, …) are never granted. Because permissions are never granted, there is nothing for a permissions UI to approve; the allow-list test is the invariant's proof.
4. **State location.** `agentDir` resolves under the LENS app-data directory — never `~/.pi`, so LENS never reads or writes the user's personal Pi configuration.
5. **Key handling.** Provider keys pass through `setRuntimeApiKey` at session construction; they are never persisted into Pi-owned state and never logged (consistent with ADR-0013's no-leak clause).
6. **Ownership boundary.** **Pi owns:** the agent loop, session lifecycle, steering, compaction, retry. **LENS owns:** evidence admission, budgets, the fetch/plane ledgers, telemetry boundaries, and the plan gate. Every LENS-owned control sits at the policy points around tool calls (`beforeToolCall` = budget/ledger/evidence gate; `afterToolCall` = admission + telemetry), so Pi's loop never bypasses LENS accounting.

## Consequences

- Agentic Search gets `steer()` (mid-run redirection), `followUp()` (queued turns), and `abort` (cancel) from one conversation-scoped session (shape decided in Round 1 Q3; recorded in the spec, not an ADR).
- LENS persists its own transcript copy in the session record (`Pi`'s `state.messages` is plain JSON — a copy, not a new format).
- The research-only invariant is testable: a suite test asserts the constructed allow-list equals exactly the five research tools.
- Swapping the deep-research parent/researcher loops onto the same hosting is a later increment gated by the parity harness (ADR-0011).

