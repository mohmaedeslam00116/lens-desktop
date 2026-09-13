# 10. Research Agency Architecture: Parent/Researcher Orchestration on the Pi SDK

*Numbering note: ADR-0009 (Electron 29 → 44 runtime upgrade, ticket #67) was recorded in CHANGELOG only; its file was never merged. This document is numbered 0010 to match all published tracker references (map #80, decision ticket #83, tickets #88–#95).*

## Status

Accepted (decision ticket #83; resolved via the grilling record on that ticket).

## Context

LENS's embedded engine is post-pi-migration: the model gateway is pi-only, and the four pi-ecosystem packages are vendored and loadable (pi-web-access tools + the pure rpiv-todo modules in-process; billion-context behind a supervised subprocess; pi-subagents formally deferred because its full surface requires a real pi-coding-agent extension host). The Research Agency map (#80) asks for a Parent Research Agent decomposing queries into non-overlapping research facets, spawning specialized researcher subagents in parallel, with rpiv-todo planning, long-context compression, and an evidence auditor — while LENS keeps citations, evidence admission, coverage metrics, LiveEvent semantics, sessions, and final synthesis.

Eight structural decisions were grilled with the map owner and are locked here. The owner added a load-bearing clarification: **the Pi Agent ecosystem is the long-term direction for the researcher/tooling layer.** LENS-native implementations used to unblock the architecture are transitional scaffolding, not a permanent parallel architecture — but LENS-owned evidence contracts (admission, deduplication, budgets, telemetry boundaries, evidence-preservation semantics) remain authoritative unless there is a concrete reason to migrate them too.

## Decision

1. **Delegation — LENS-native in-process researcher loops now, pi-subagents-shaped seams.** Each researcher is a scoped pi-core agent run (AgentCore `generate()` with a researcher system prompt and toolset); the Parent Research Agent is plain TypeScript orchestration. The parent/researcher seams (Researcher Brief, progress stream, result envelope) mirror the pi-subagents delegation contract so a later host-based adoption is a mechanical swap, not a rewrite. pi-subagents adoption remains formally deferred.

2. **Long-context compression — the supervised compression proxy is the architecture.** Researcher model traffic may route through the supervised `bili` subprocess (URL-prefix mode, bound to engine lifetime, health-checked) behind a flag; unhealthy proxy degrades gracefully to uncompressed runs. Compression shrinks model-bound context only and never removes admitted evidence from the evidence bundle (compression ≠ deletion). billion-context is never imported in-process — its bundle self-starts a server on import.

3. **Retrieval — the Dual Retrieval Plane is stage one of an expand–contract toward Pi Agent tools.** Today: LENS-native search providers and scraping remain the primary, cost-controlled plane (keys and budgets owned by LENS settings); the pi-web-access toolset attaches supplementarily for its specialized modes (answer-mode fetch, source verification). End-state: pi-web-access (and future pi extensions) progressively **replace** the LENS-native researcher tools behind the same tool contract, so the swap requires no architectural rewrite. LENS-owned contracts stay authoritative throughout: stratified evidence admission, the DeduplicationEngine (cross-researcher dedupe: one fetch feeds every researcher), the single session evidence budget, the engine→renderer telemetry boundary, and evidence-preservation semantics.

4. **Evidence auditor — advisory by default, settings-gated escalation.** The auditor verifies that every important claim maps to retrieved sources and produces structured verdicts. Verdicts annotate admission and coverage telemetry by default; gating admission is a settings flag flipped only after the parity harness proves no coverage regression.

5. **Researcher roles — closed 5-role catalog plus budget-bounded deficit re-specialization.** The catalog is the map's five roles (primary/web, technical/deep-dive, opposing/independent, recent-news, source-verifier); the parent selects one role per facet deterministically. When the coverage audit reports gaps, the parent may spawn additional role-tagged researchers within the remaining budget — bounded so it cannot loop.

6. **LiveEvent mapping — additive telemetry event plus ordinary source events.** One new event type (`researcher_telemetry`, following the `wide_telemetry` precedent) carries researcher lifecycle/progress (`researcherId`, role, facet, phase, counts); evidence found by researchers flows as ordinary `source` events so the existing source pipeline and shelves work untouched. The LiveEvent union grows additively; consumers that ignore the new type lose nothing.

7. **Todo plan — parent-only writes, engine-internal truth, read-only projections.** The rpiv-todo research plan is session-scoped to the `ResearchSession` id; only the parent writes it. The renderer receives todo state exclusively as read-only projections inside agency telemetry events and never reads the todo store directly.

8. **Fan-out limits — named engine constants reusing existing seams.** Researcher concurrency = `min(#facets, 4)`. Researchers draw from the single existing session evidence budget (no second budget pool; admission/coverage keep enforcing it). The BoundedScraperPool caps (`C_global = 10`, `C_host = 2`) remain the underlying ingestion throttle. Cross-researcher URL dedupe stays in the DeduplicationEngine. Values are revisited only with parity-harness data (#94).

## Considered Options

- **pi-subagents as the delegation mechanism today** — rejected: its loader and foreground pipeline require a real pi-coding-agent extension host (verified during vendoring); building the host first would stall the whole chain. Its contract shape is retained instead.
- **LENS-native in-process compression only** — rejected as the primary: the supervised subprocess supervisor is built and tested, and a localhost compression proxy is infrastructure, not an "external agent runtime" (that rule targets Python sidecars and external agent hosts).
- **pi-web-access as the sole retrieval plane immediately** — rejected for now: LENS providers carry the budget/timeout hardening and settings-owned keys today; they are contract-preserving scaffolding on the way to the Pi-native end-state.
- **Gating auditor from day one** — rejected: destabilizes the coverage contract before parity data exists.
- **Open-ended LLM-invented roles** — rejected: breaks prompt/telemetry/parity tractability.
- **String-packed researcher progress in existing LiveEvent fields** — rejected: unparseable contract rot.
- **Two-way UI editing of the todo plan** — rejected: violates the parent-only hard rule and the engine→renderer boundary.
- **User-facing settings for all fan-out limits from day one** — rejected: constants behind telemetry are trivially promotable later; premature settings multiply surface area.

## Incremental Migration Spec

Phases map 1:1 onto the published tickets; each lands on the standard branch/PR flow with review (CodeRabbit) and a green full suite. No phase breaks the LiveEvent contract or evidence semantics.

| Phase | Ticket | Lands | Parity gate |
|---|---|---|---|
| 0 (done) | packages bridge | commit `5731377` | packages test green, no network |
| 1 | #88 parent orchestrator seam (dormant flag) | agency mode behind flag; facet assignments 1:1 from approved plan; researcher lifecycle events | report byte-equivalent to legacy loop on fixtures |
| 2 | #89 single in-process researcher; #92 compression proxy | one facet via researcher + pi-web-access toolset; bili routing behind flag | citations resolve to admitted evidence unchanged; proxy failure degrades gracefully |
| 3 | #90 fan-out; #91 auditor (advisory); #93 role catalog + re-specialization; #94 parity harness | parallel researchers under caps; URL dedupe across researchers; auditor verdicts annotated | #94 harness proves coverage score, citation grounding, admission counts, and LiveEvent sequence equivalence within documented thresholds |
| 4 (contract) | #95 default flip | agency path becomes the default; legacy loop behind escape flag | harness green on default configuration; docs + CHANGELOG in lockstep |
| 5 (future, separate tickets) | Pi-native tooling swap | pi-web-access becomes the primary retrieval plane behind the same tool contract; pi-subagents host adoption if/when feasible | each swap gated by the #94 harness; LENS evidence contracts unchanged |

## Consequences

- The agency chain (#88–#95) is unblocked with no extension-host prerequisite.
- Researchers, briefs, and the parent's interfaces are pi-subagents-shaped: the deferred host adoption, when it happens, is a swap behind stable seams.
- The Dual Retrieval Plane and LENS-native researcher loops are explicitly transitional; new engine work must not deepen them beyond what the migration spec requires.
- LENS evidence contracts (admission, dedupe, budgets, telemetry boundary, evidence preservation) are authoritative and outlive the tooling migration.
- The auditor can escalate to gating without a new architecture change — it is a settings flag backed by #94 data.
