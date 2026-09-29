# Engine Core Review: Domain Value vs. Replaceable Agent Plumbing

- **Issue**: [#61 — Engine core review: separate domain value from replaceable hand-rolled agent plumbing](https://github.com/mohmaedeslam00116/lens-desktop/issues/61)
- **Scope**: `frontend/electron/engine/` at commit `0608fc6` (branch `research/engine-core-review`)
- **Method**: direct read of every listed module; import graph checked via grep (who imports `models.ts`, who calls `parseProviderSseEvents`, etc.)
- **Audience**: the SDK-survey and SDK-decision tickets — each verdict below states what an SDK must cover to replace the plumbing, and what must be lifted into the new host regardless.

---

## TL;DR

- The engine splits cleanly: **~80% of the code is LENS domain value** (retrieval pipeline, evidence admission, citation grounding, skills, session lifecycle) that any SDK swap must preserve as-is.
- The replaceable surface is **much smaller than the issue assumes**: `models.ts` is the only true agent-core plumbing, and its most impressive part (`parseProviderSseEvents`, a full multi-provider streaming SSE + tool-call accumulator) is **dead code** — exported, never imported, never called. The live path is plain non-streaming JSON `fetch` with a 5-deep single-tool recursion loop.
- `agent.ts` is the only file that genuinely mixes generic agent-loop orchestration with LENS behavior, and even there the "agent loop" is a fixed linear pipeline (subqueries → search → scrape → rank → synthesize), not a dynamic tool-using loop. `wideAgent.ts` is domain orchestration, not agent plumbing.
- **Biggest correctness gap an SDK would fix**: tool results are fed back as *fake user messages* ("Tool response for X: …") instead of provider-native tool-result roles (Anthropic `tool_result`, Gemini `functionResponse`, OpenAI `tool` role) — and only the **first** tool call per turn is ever executed.

---


## Per-module inventory

Legend: **KEEP** = pure domain value, preserve under any SDK. **REPLACE** = commodity plumbing an SDK/provider library covers. **PARTIALLY-KEEP** = mixed; split listed.

| Module | Verdict | One-line justification |
|---|---|---|
| `models.ts` | **REPLACE** (core) / **DELETE** (dead half) | Hand-rolled non-streaming provider HTTP + naive tool loop is exactly what an agent SDK covers; the 210-line streaming SSE parser is dead code — delete it or actually wire it up; keep only the LENS-flavored `ModelOption` catalog heuristics if the settings UI survives. |
| `agent.ts` (DeepResearchAgent) | **PARTIALLY-KEEP** | The linear pipeline and its LENS event/grounding calls are domain; the subquery-generation and single-tool `activate_skill` dispatch are generic agent-loop fodder an SDK's planner/tool-loop replaces. |
| `wideAgent.ts` (WideResearchAgent) | **KEEP** | Not an agent loop at all — a coverage-gated budget-expansion retrieval pipeline (100→200 sources, 0.8 coverage threshold) with clean DI seams; keep whole, incl. `sanitizeCitationIndices`. |
| `server.ts` | **KEEP** | Embedded-engine HTTP transport (17 routes), CORS/origin checks, 2 MB body cap, session wiring — API surface, not agent plumbing; only the `/api/research/*` handler bodies shrink if agents move to an SDK. |
| `types.ts` | **KEEP** | The `LiveEvent` contract (20 event types), `ResearchPlan`, `SessionState` machine, and `WideResearchTelemetry` are the UI-facing domain contract every consumer depends on. |
| `synthesis.ts` | **KEEP** (crown jewel) | `CitationGroundingContract.verifyAndSanitize` (deterministic citation verification + hallucinated-citation stripping) and `HierarchicalSynthesis` (per-milestone sections → meta-pass → contradiction callouts) are the product's core IP; only its `LLMGenerator` call sites touch the SDK. |
| `scoping.ts` | **KEEP** | Research-plan generation/validation/regeneration + skill suggestion — LENS planning domain, one `ModelClient.generate` call to re-point. |
| `sessionLifecycle.ts` | **KEEP** | Session state machine (validated transitions), partial-draft capture, sub-second cancellation via `AbortController` — orchestration domain, SDK-agnostic. |
| `eventBuffer.ts` | **KEEP** | 300-entry ring buffer for SSE reconnection replay — transport domain, trivially portable. |
| `discover.ts` | **KEEP** | Live topical discovery feed (`DiscoverService`) — product feature, no agent plumbing. |
| `search.ts` | **KEEP** | `MultiSearchProvider` (duckduckgo/tavily/serper) — retrieval domain; not LLM plumbing. |
| `scraper.ts` / `scraperPool.ts` | **KEEP** | Page fetching + domain credibility scoring + bounded concurrency pool with dedup stats — retrieval infrastructure. |
| `embeddings.ts` | **KEEP** | Provider embedding clients (OpenAI/Gemini batch/Ollama) + the hybrid retrieval pipeline (`rankSourcePassages`, `fallbackEvidence`, BM25/MMR/RRF fusion re-exports) — the embedding HTTP calls are commodity but tiny and self-contained; keep unless the SDK brings embeddings too. |
| `embeddingCache.ts` | **KEEP** | Persistent vector cache with stats — pure infrastructure. |
| `bm25.ts` | **KEEP** | BM25 index with bilingual tokenizer, Arabic normalizer + light stemmer — hard domain value. |
| `chunker.ts` | **KEEP** | Markdown/HTML section-aware structured chunking — retrieval domain. |
| `dedup.ts` | **KEEP** | Canonical-URL normalization, SimHash-64 + Hamming near-duplicate engine — retrieval domain. |
| `mmr.ts` / `rrf.ts` | **KEEP** | Maximal-marginal-relevance selection and rank fusion — classic IR algorithms, provider-independent. |
| `admission.ts` | **KEEP** | Stratified per-milestone evidence admission + budget-exhausted event synthesis — the wide-research quality gate. |
| `evidenceCoverage.ts` | **KEEP** | Coverage audit (subquery/aspect/metric/diversity scores) + adaptive hop planning — drives wide-agent budget expansion. |
| `evidenceShelf.ts` | **KEEP** | Source-shelf enrichment, milestone faceting, filters/stats, citation inspection (incl. Eastern-Arabic numeral handling, bilingual mismatch detection) — UI-domain logic. |
| `queryExpansion.ts` | **KEEP** | Bilingual AR/EN query expansion + language detection + Arabic stemming — retrieval domain. |
| `reportExport.ts` | **KEEP** | PDF/DOCX export payload validation + HTML/DOCX generation — product feature. |
| `skills/*` (12 files) | **KEEP** | Entire skill subsystem — parser/loader/registry/pathBoundary/zipArchive/collisionResolver/compactionShield/hostToolMapper/activation/service — is LENS-specific capability management; note `activation.ts` imports `LLMToolDefinition` from `models.ts` (re-point to the new tool-schema type on swap). |

Counts: KEEP 24 · REPLACE 1 (`models.ts`, with partial salvage) · PARTIALLY-KEEP 1 (`agent.ts`).

---

## `models.ts` deep dive — what the hand-rolled layer actually implements

Two disjoint halves in one 830-line file:

### A. `parseProviderSseEvents()` (lines 50–210) — **dead code, never called**

Grep confirms zero importers (`agent.ts` and `synthesis.ts` import only `ModelClient`/`LLMRequestOptions`; `server.ts` imports `ModelClient`). What it *would* provide if wired:

- Generic SSE frame parser (`event:` / `data:` lines, multi-line data, CRLF normalization, `[DONE]` sentinel).
- **Gemini**: `candidates[0].content.parts[]` — inline `part.text` and complete `functionCall {name, args}` objects (no accumulation needed; Gemini emits whole calls).
- **Anthropic**: `content_block_start` (captures `tool_use` block name + initial `input`), `content_block_delta` (`text_delta` for text; `input_json_delta.partial_json` string-concatenated per block index), `content_block_stop` (JSON-parse accumulated args, fall back to initial input). Index-keyed map supports parallel blocks.
- **OpenAI-delta family** (openai/groq/deepseek/openrouter/mistral): `choices[0].delta.content` for text; `delta.tool_calls[]` accumulated by `call.index` — name captured from first fragment, `function.arguments` string fragments concatenated (also tolerates object-valued args via `JSON.stringify`).
- **Ollama**: `message.content` / top-level `response` for text; complete `message.tool_calls[].function {name, arguments}` objects.
- Safety: 512 KiB byte cap on accumulated tool args per call; oversized accumulations rejected rather than parsed.

This is ~exactly the "streaming + tool-call accumulation" feature an SDK ships. Verdict: delete, or use as the spec for what the SDK must handle for these 8 providers.

### B. `ModelClient` — the live, replaceable plumbing

- **Request shaping (`generate` dispatcher, lines 555–565)**: 3 code paths for 8 providers.
  - `generateGemini` (567–651): `POST :generateContent?key=…`; extracts `system` role into `systemInstruction`; maps `assistant`→`model`; `generationConfig.temperature`; tools as `functionDeclarations`.
  - `generateAnthropic` (653–724): `POST /v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01`; system message hoisted to top-level `system:`; **hardcoded `max_tokens: 4096`**; tools as `{name, description, input_schema}`.
  - `generateOpenAICompatible` (726–829): `/chat/completions` for **5 providers via a base-URL/API-key/default-model table** — groq (`api.groq.com/openai/v1`, `GROQ_API_KEY`, llama-3.3-70b-versatile), deepseek (`api.deepseek.com/v1`, `DEEPSEEK_API_KEY`, deepseek-chat), openrouter (`openrouter.ai/api/v1`, meta-llama/llama-3.3-70b-instruct), mistral (`api.mistral.ai/v1`, mistral-large-latest), ollama (`localhost:11434/v1`, dummy key, llama3.1:8b). All: `Authorization: Bearer`, tools as `{type:'function', function:{…}}`.
- **Tool loop**: `MAX_TOOL_RECURSION_DEPTH = 5`; per turn **only the first tool call is executed** (extra parallel calls silently dropped); results threaded back as a *fabricated* `user` message (`Tool response for X: {json}`) plus an `assistant` message (`Activated skill: …`) — provider-native tool-result roles are never used, so Gemini/Anthropic multi-turn tool fidelity is degraded. The handler is hardwired to one tool: `activate_skill` (skill-activation semantics leak into the provider layer).
- **"Streaming"**: `onChunk` exists on every path but is invoked **once, with the complete text**, after the response arrives. There is no token-level streaming anywhere in the live path — `report_chunk` UI events are one-shot. The dead SSE parser (A) was presumably built for this and never connected.
- **`formatProviderTools`** (520–553): tool-schema shaping per provider family (gemini `functionDeclarations` / anthropic `input_schema` / OpenAI `function`). Commodity.
- **`fetchDynamicModels`** (219–461): per-provider live model catalogs (ollama `/api/tags`; gemini/openai/groq/deepseek/openrouter/mistral/anthropic list endpoints) with hand-curated tags, context strings, and `recommended` flags, plus static fallback lists. This is **settings-UI domain**, not agent core — an SDK won't replace it; decide whether to keep it as-is.
- **`testConnection`** (463–518): latency-ping via a one-token generate. Commodity.

### What a standard agent SDK must cover to replace `models.ts`

1. Provider adapters for all 8 (gemini + anthropic + 5×OpenAI-compatible + ollama) with correct request shaping (system-prompt placement, role mapping, `anthropic-version`, max_tokens, key/env fallbacks, custom endpoints for ollama).
2. **True streaming** text chunks and **streaming tool-call accumulation** for OpenAI-delta, Anthropic block-delta, and Gemini inline-call shapes (the dead parser documents the exact edge cases: index-keyed parallel calls, partial-JSON assembly, arg-size guards).
3. A tool loop that executes **all** tool calls per turn and threads results back in provider-native format.
4. Tool/schema registration in each provider's dialect (replaces `formatProviderTools`).
5. Model listing + connection test only if the settings UX keeps live catalogs (else keep `fetchDynamicModels` as-is).

---


## `agent.ts` vs `wideAgent.ts` — generic loop vs LENS behavior

### `agent.ts` (DeepResearchAgent, 635 lines) — PARTIALLY-KEEP

- **Generic agent-loop plumbing (REPLACE-able)**: subquery generation via one JSON-array prompt + regex extraction + static fallback triple; the linear hop cap (`quick=2/deep=3/storm=4` subqueries); single-tool `activate_skill` dispatch; the `answerFollowup` static chat-completion helper. Any SDK planner/tool-loop can express these.
- **LENS-specific (KEEP)**: `graph_node` event emission with the root→perspective→subquery→source node taxonomy; bilingual (AR/EN) `thought`/`status` narration; perspective labels incl. STORM; plan-milestone trajectory freeze (`plan.milestones` override generated subqueries); skill pre-activation (dual-path: plan-suggested + approved); semantic-retrieval branch with graceful lexical fallback; `CompactionShield`-exempt context compaction; mandatory `CitationGroundingContract.verifyAndSanitize` on the final report; the dossier system prompt (AR/EN structure, conditional tables/Mermaid).
- Note: the whole class is a **fixed pipeline**, not a dynamic agent — it makes ~3 generate calls per run (subqueries, optional tool turns, final synthesis). An SDK buys little here beyond the plumbing already listed for `models.ts`.

### `wideAgent.ts` (WideResearchAgent, 473 lines) — KEEP

- Despite the name, this is **coverage-controlled retrieval orchestration**, not an agent loop: `discoverUntilBudget` (round-robin milestone search, 25 hits/query, evidence-suffix re-queries) → `BoundedScraperPool.scrapeAll` → hybrid `buildCandidates` (embeddings with lexical fallback) → `admitStratifiedEvidence` → coverage audit → **budget expansion loop** (100 initial → +25 per gap → 200 max, gated on 0.8 coverage score, emitting `wide_telemetry` expansion events) → `HierarchicalSynthesis` → `sanitizeCitationIndices` → telemetry + finished event.
- Clean DI seams (`WideResearchAgentDependencies`: search/createPool/rankPassages/admitEvidence/synthesize) make it directly testable and SDK-agnostic.
- `sanitizeCitationIndices` (88–126): Markdown-link/reference-definition-aware citation-index purger — pure domain, keep verbatim.

---

## Migration notes for the SDK-decision ticket

1. **Seam to preserve**: the engine already funnels all LLM traffic through `ModelClient.generate` (callers: `agent.ts`, `wideAgent.ts` via `synthesis.ts`, `scoping.ts`, `server.ts` test endpoints, `synthesis.ts` `HierarchicalSynthesis`). Replacing `ModelClient` internals with an SDK while keeping the `LLMRequestOptions`/`onChunk` signature is the lowest-risk path; widening `onChunk` to true token streaming then upgrades `report_chunk` for free.
2. **Type coupling**: `skills/activation.ts` imports `LLMToolDefinition` from `models.ts` — keep that type (or an equivalent) in the new layer.
3. **Behavioral deltas to expect from an SDK**: parallel tool execution (today: first-call-only), native tool-result roles (today: fake user messages), real streaming (today: one-shot), configurable max output (today: Anthropic hardcoded at 4096). Each is an improvement, but `CitationGroundingContract` post-verification must stay mandatory so hallucinated citations are still stripped regardless of model behavior.
4. **Dead code**: remove `parseProviderSseEvents` + `ParsedSseToolCall`/`ParsedProviderSseEvents` exports if the SDK covers streaming; otherwise they are the reference spec for wiring real streaming.

