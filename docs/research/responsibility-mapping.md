# Research: LENS responsibility mapping to Pi SDK / packages / LENS-must-remain

**Issue**: [#82](https://github.com/mohmaedeslam00116/lens-desktop/issues/82) · **Labels**: `wayfinder:research` · **As of**: 2026-09-13
**Grounding**: current post-pi-migration engine (`frontend/electron/engine/` — the state the issue references via `research/cline-core-adaptation` maps 1:1 to main post-#85): `modelGateway.ts` (pi-only), `piAdapter.ts`, `piSkillsBridge.ts`, `piEventAdapter.ts`, the `agent.ts`/`wideAgent.ts`/`synthesis.ts` loops, `admission.ts`, `evidenceCoverage.ts`, `evidenceShelf.ts`, `dedup.ts`, `search.ts`, `scoping.ts`, `server.ts`. Package capabilities are grounded in the [pi-ecosystem fact-sheet](pi-ecosystem-fact-sheet.md).
**Legend**: **[Pi-SDK]** = pi runtime (`pi-ai`/`pi-agent-core`) · **[Pi-pkg]** = pi package (web-access/subagents/rpiv-todo/billion-context) · **[LENS]** = LENS-specific, must remain.

## Responsibility mapping table

| # | LENS responsibility | Current implementation (grounded) | Classification | Notes |
|---|---|---|---|---|
| 1 | Model provider routing / generation | `piAdapter.ts` registers pi-ai providers per LENS id; all calls via `modelGateway.generate()` | **[Pi-SDK]** ✅ | Migrated (ADR-0009, #70–#73). Carries window `128000` / `maxTokens` `8192` defaults (`models.ts`). |
| 2 | Agent loop, tool calling, streaming, turn cancellation | `pi-agent-core` `Agent` drives the loop; LENS forwards a session `AbortSignal` per request | **[Pi-SDK]** ✅ | Pi owns the loop; LENS owns the forwarded signal. |
| 3 | Skills discovery/validation/sandboxing + single `activate_skill` tool | `skills/*` (loader/parser/pathBoundary) + `piSkillsBridge.ts` registers it as the one tool | **[LENS]** (pipeline/sandbox) + **[Pi-SDK]** (tool host) | Host is pi; pipeline, sandbox, compaction shield are LENS. |
| 4 | Query decomposition / facet planning | `scoping.ts` `generateResearchPlan` (objective→milestones→skills) + `queryExpansion.ts` (bilingual) + `agent.ts` subqueries | **[LENS]** | Plan *logic* is LENS; the LLM calls ride the pi gateway. |
| 5 | Web search + fetching | `search.ts` `MultiSearchProvider` (hand-rolled duckduckgo/tavily/serper/google) + `scraper.ts` + `scraperPool.ts` + `discover.ts` | **[Pi-pkg]** → `pi-web-access` | Replaces 4 providers with 25+ + SSRF-guarded fetch + PDF/YouTube/GitHub. Module-lift needed (peers pi-coding-agent/pi-tui not embedded). |
| 6 | Deduplication + overlap detection | `dedup.ts` (L1 canonical URL, L2 content hash, L3 hybrid) + BM25/RRF/MMR + embeddings `rankSourcePassages` | **[LENS]** ❗ | Nothing in pi or a package. |
| 7 | Source credibility | `scoping.ts` `web-retrieval-curator` + `evidenceShelf.ts` `relevanceTier` + `admission.ts` tiering | **[LENS]** ❗ | pi-web-access's SSRF guard is security, not credibility. |
| 8 | Evidence admission (stratified, quota-guaranteed) | `admission.ts` `admitStratifiedEvidence` (K_min=8/milestone, residual by hybrid score, budget telemetry, `[Extend Research]`) | **[LENS]** ❗ | Core differentiator. |
| 9 | Claim→source mapping (citation grounding) | `synthesis.ts` `CitationGroundingContract` (deterministic `[1]..` brackets, post-synthesis regex verification, zero hallucinated) + `evidenceShelf.ts` `isCited` | **[LENS]** ❗ | Non-negotiable trust property. |
| 10 | Coverage tracking + gap reporting + adaptive hops | `evidenceCoverage.ts` `auditEvidenceCoverage` + `generateAdaptiveHopPlan` (subquery/aspect/metric/diversity weights) | **[LENS]** ❗ | Not in pi or a package. |

| 11 | Research-plan state (live todos) | `scoping.ts` `ResearchPlan` + `plan_scoping_lifecycle` (approved-plan frozen trajectory) | **[Pi-pkg]** → `rpiv-todo` schema | Session-scoped task model + snapshot-in-`details` envelope adoptable as an in-process LENS tool; overlay not needed. |
| 12 | Long-context compression | **None today** (LENS budgets chunks; no reversible folding; no proxy) | **[Pi-pkg]** → `billion-context` | Pre-1.0, **not a library** (localhost proxy process), Windows sessions-dir hazard; defer behind a flag. |
| 13 | Subagent / lane orchestration | `wideAgent.ts` `WideResearchAgent` (parallel lanes, per-lane synthesize) + `agent.ts` fan-out | **[Pi-pkg]** → `pi-subagents` vocabulary | Background mode spawns a **detached runner** → violates "no external agent runtime". **Adopt vocabulary, not the package.** |
| 14 | Final synthesis | `synthesis.ts` `HierarchicalSynthesis` (milestone→meta) + `reportExport.ts` | **[LENS]** | Grounding enforced deterministically here; pi only supplies the model calls. |
| 15 | LiveEvent emission + buffering | `types.ts` contract + `eventBuffer.ts` ring buffer + `sessionLifecycle.ts` + `piEventAdapter.ts` (maps pi events → LiveEvent) | **[LENS]** ❗ | Pi-agent-core emits its *own* shape; `LiveEvent` + buffered lifecycle is LENS-owned. |
| 16 | Plan-approval pause (approval gate) | `server.ts` `startAuthorizedExecution` — blocks until `approvePlan`, aborts un-authorized retrieval, freezes the trajectory | **[LENS]** ❗ | No pi/package equivalent; security/control seam LENS must build. |
| 17 | Cancellation | `server.ts` `aborted` flag + `session.researchSession.signal` threaded through `generate()` → `piAdapter` | **[LENS]** + **[Pi-SDK]** | LENS owns session-scoped cancellation; pi honors the forwarded signal. |
| 18 | Session lifecycle / persistence | `sessionLifecycle.ts` `ResearchSession`, `eventBuffer.ts` retention/eviction | **[LENS]** | Pi-agent-core has sessions; lifecycle + LiveEvent persistence are LENS. |
| 19 | Local hybrid retrieval + embeddings | `bm25.ts`, `rrf.ts`, `mmr.ts`, `embeddings.ts`, `embeddingCache.ts`, `chunker.ts` | **[LENS]** ❗ | Not in pi or a package. |
| 20 | Live topical discovery feeds | `discover.ts` | **[LENS]** | Not in pi or a package. |

## Gaps — must remain LENS-built (neither pi SDK nor a package provides these)

1. **Evidence admission** — per-milestone quota, residual distribution, budget-exhaustion telemetry with `[Extend Research]` expansion (#8).
2. **Citation grounding contract** — deterministic bracket allocation + automated verification stripping hallucinated citations (#9).
3. **Coverage auditing + adaptive multi-hop planning + gap report** (#10).
4. **Deduplication + bilingual hybrid relevance** (#6, #19) — canonical-URL + content-hash + BM25/RRF/MMR + embeddings.
5. **Source credibility tiering + evidence shelf** (#7 + `evidenceShelf.ts`) — facet-grouped bilingual organization.
6. **`LiveEvent` contract, event buffer, session lifecycle** (#15, #18).
7. **Plan-approval pause + frozen-trajectory enforcement** (#16) and **session-scoped cancellation** (#17).
8. **Bilingual (Arabic/English) parity** across all of the above heuristics.

## Adaptation decisions feeding the architecture ticket

- **pi-web-access** → module-lift `search.ts`/`scraper*` behind LENS tools (in-process, MIT); replaces 4 hand-rolled providers with a fallback-chained 25+ set. No hard-rule tension.
- **rpiv-todo** → adopt the **task schema + snapshot-in-`details` envelope** as an in-process LENS tool feeding `LiveEvent` (compaction-survival for free); skip the TUI overlay.
- **pi-subagents** → **do not adopt**; keep orchestration in `wideAgent.ts`, borrow the delegation *vocabulary* (budget caps, fork/fresh context, structured spawn) for in-process `pi-agent-core` fan-out.
- **billion-context** → **defer behind an opt-in flag**; localhost proxy process (not a library), pre-1.0; pass `x-acp-session` per conversation if ever adopted.