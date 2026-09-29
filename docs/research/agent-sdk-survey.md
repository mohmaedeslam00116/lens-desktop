# Agent SDK Survey for the LENS Embedded Engine (Issue #62)

**Date**: September 2026 (survey period). **Method**: primary-source review — official docs, GitHub repositories, npm registry metadata, changelogs and license files. Facts are cited to their owning source. Items flagged ⚠ carried residual uncertainty at survey time and should be re-verified against the cited URL before an adoption PR is cut.

## Grounding: what LENS has today

From repo inspection (`frontend/electron/engine/`):

- **`models.ts`** (~30 KB): a hand-rolled `ModelClient` with `parseProviderSseEvents()` — raw SSE parsing for Gemini, Anthropic, and OpenAI (Ollama reached via its OpenAI-compatible transport), with accumulated tool-call deltas, per-index `rejected` flags for malformed tool arguments, and a hard `MAX_TOOL_ARG_BYTES` (512 KiB) guard.
- **Two imperative agent loops**: `agent.ts` (`DeepResearchAgent` — multi-hop search/scrape/coverage audit with `LiveEvent` emission) and `wideAgent.ts` (`WideResearchAgent` — budgeted wide discovery with stratified admission, pool scraping, hierarchical synthesis, grounding verification).
- **Call surface to replace**: `LLMRequestOptions { provider, model, messages, tools, toolHandler, onChunk, endpoint, apiKey, temperature }`. Tool schemas are **dynamic** (`parameters: Record<string, any>`), not statically zod-typed.

**Hard constraints (fail = disqualified):**

1. Runs as a library inside the Electron main process (Node) — no Python, no mandatory sidecar service.
2. Multi-provider: Ollama/local models **plus** Gemini + OpenAI + Anthropic.
3. Token-level streaming **and** tool/function calling, with an event stream adaptable onto the `LiveEvent` WebSocket contract.
4. Actively maintained (commits within the last ~6 months) and permissively licensed (MIT/Apache-2.0 or similar).

An extra constraint derived from the codebase: **no native modules** (avoids `electron-rebuild` tax in the packaged installer).

---

## 1. Vercel AI SDK v5 (`ai` + AI SDK Agents)

- **Sources**: https://ai-sdk.dev/docs · https://github.com/vercel/ai · https://www.npmjs.com/package/ai
- **License**: Apache-2.0 (monorepo `vercel/ai`). ✅
- **Node fit**: ✅ Pure TypeScript, in-process (Node 18+, Edge, browsers). No sidecar, no companion service. Best-in-class Electron-main fit; zero native modules.
- **Provider coverage**: ✅ First-party `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` (Gemini), plus `@ai-sdk/openai-compatible` and a community-provider registry (https://ai-sdk.dev/providers/community-providers). Ollama has no first-party Vercel provider, but its OpenAI-compatible endpoint (`http://localhost:11434/v1`) works through `@ai-sdk/openai-compatible`, and community packages exist (e.g. `ollama-ai-provider-v2` for v5). **All four required providers covered.**
- **Streaming**: ✅ `streamText()` exposes `textStream` / `textDeltaStream` (token-level `AsyncIterable<string>`) and `fullStream` — a typed stream of parts (`text-delta`, `reasoning-delta`, `tool-call`, `tool-result`, `finish-step`, …). Maps directly onto LENS's `onChunk` → `LiveEvent` pipeline; `tool-call` parts arrive only when arguments are complete, simplifying the 512 KiB guard.
- **Tool calling**: ✅ `tool({ inputSchema: zod, execute })` for statically typed tools, **`dynamicTool({ ... })`** for runtime-declared JSON-Schema tools — a near-exact match for LENS's dynamic `LLMToolDefinition`. Multi-step loops via `stopWhen: stepCountIs(n)`; v5 also ships a first-class `Agent` class (https://ai-sdk.dev/docs/agents/overview) with tool/middleware composition.
- **Bundle/runtime weight**: LOW — small dependency set (zod peer, `@standard-schema/spec`); provider packages are leaf-like; no native modules; no server required.
- **Maintenance health**: EXCELLENT — v5 GA mid-2025 (https://ai-sdk.dev/blog/ai-sdk-5); among the most actively maintained TS repos in the AI space; frequent releases; very large npm adoption. ✅ (constraint 4)
- **Migration effort for LENS**: **LOW–MODERATE, ~1–2 weeks.**
  - Phase 1: reimplement `ModelClient` internals over `streamText` + a small provider registry; keep the public `LLMRequestOptions` seam so both agent loops compile untouched.
  - Phase 2: delete `parseProviderSseEvents`; the only nontrivial parity work is re-expressing the 512 KiB tool-arg cap and malformed-arg `rejected` logic on top of `fullStream` accumulation.
  - Phase 3 (optional): adopt the `Agent` class; keep the hand-rolled loops.


## 2. LangGraph.js (`@langchain/langgraph`)

- **Sources**: https://langchain-ai.github.io/langgraphjs/ · https://github.com/langchain-ai/langgraphjs · https://www.npmjs.com/package/@langchain/langgraph
- **License**: MIT. ✅
- **Node fit**: ✅ Pure JS/TS library, in-process. No sidecar. (The optional LangGraph **Platform/Server** is a separate deployment product — not required for library use.)
- **Provider coverage**: ✅ Inherits the full LangChain chat-model ecosystem: `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, `@langchain/ollama` (local models first-class). All four required providers covered.
- **Streaming**: ✅ `.stream()` / `.streamEvents()` with `streamMode: "messages"` for token-level chunks and `"updates"`/`"custom"` for graph-state events; `streamEvents` v2 gives a unified event stream (`on_chat_model_stream`, `on_tool_start`, …) adaptable to `LiveEvent`.
- **Tool calling**: ✅ Standard LangChain `BaseChatModel.bindTools()` with `DynamicStructuredTool` (zod-typed). Tools are zod-static by default; dynamic JSON-Schema tools require a thin adapter.
- **Bundle/runtime weight**: MODERATE–HIGH — LangChain core + graph runtime + one model package per provider; dependency tree is noticeably larger than Vercel AI SDK, though still pure-JS (no native modules).
- **Maintenance health**: EXCELLENT — 1.0 release line, very active monorepo, strong release cadence. ✅
- **Migration effort for LENS**: **HIGH, ~3–5 weeks.** The graph abstraction (StateGraph, reducers, channels) forces a re-architecture of both imperative loops into node/edge graphs. Pays off only if LENS needs durable checkpointing, human-in-the-loop interrupts, or time-travel — none of which the current engine requires. Overkill as a provider layer.

## 3. Mastra

- **Sources**: https://mastra.ai/docs · https://github.com/mastra-ai/mastra · https://www.npmjs.com/package/@mastra/core
- **License**: Apache-2.0 ⚠ (verify the current LICENSE file at re-check; historically EPL-1.0, relicensed to Apache-2.0 in 2025). ✅ per current repo.
- **Node fit**: ✅ Pure TS, in-process. ⚠ `@mastra/core` historically pushed a **storage** requirement (LibSQL by default; several 2025 issues about "storage required" in workflows/memory). Storage backends are pluggable with an in-memory driver, but this is a real runtime-weight caveat for an embedded engine — verify the current in-memory story before adopting.
- **Provider coverage**: ✅ Delegates to the **Vercel AI SDK** underneath, so Ollama (openai-compatible / community providers), Gemini, OpenAI, and Anthropic are all supported.
- **Streaming**: ✅ Inherits AI SDK streams; Mastra agents expose `.stream()` with text/tool events plus a newer evented stream API.
- **Tool calling**: ✅ zod-typed tools (`createTool`); dynamic tools possible but the framework is zod-first.
- **Bundle/runtime weight**: MODERATE–HIGH — `@mastra/core` pulls the AI SDK plus its own workflow engine, memory, and storage abstractions. Heavier than using the AI SDK directly; ensure optional telemetry/observability servers are not auto-started.
- **Maintenance health**: EXCELLENT — well-funded, rapid release cadence, but **churny**: APIs (streaming, storage) changed materially across 2025 releases. ✅ with caveat.
- **Migration effort for LENS**: **MODERATE–HIGH, ~2–4 weeks.** Its gains (workflow engine, memory, evals) mostly duplicate capabilities LENS already hand-rolled (event buffer, synthesis, scoping). You would carry the framework to re-build what you deleted.

## 4. OpenAI Agents SDK for JavaScript (`@openai/agents`)

- **Sources**: https://openai.github.io/openai-agents-js/ · https://github.com/openai/openai-agents-js · https://www.npmjs.com/package/@openai/agents
- **License**: MIT. ✅
- **Node fit**: ✅ Pure TS library (also runs on edge runtimes). No sidecar.
- **Provider coverage**: ⚠ **Partial — the deciding flaw.** First-class for OpenAI; other providers via the AI SDK integration (`setAISDKModel`) or a custom `Model` interface, so Gemini/Ollama are reachable. **Anthropic is reachable only through the AI SDK bridge or a hand-written custom `Model`** — not a first-class provider. Meets the letter of constraint 2 but with real friction and second-class ergonomics for 3 of 4 providers.
- **Streaming**: ✅ `runner.run(agent, input, { stream: true })` yields typed stream events (`raw_model_stream_event`, `run_item_stream_event`, `agent_updated_stream_event`); adaptable to `LiveEvent` with a thin transformer.
- **Tool calling**: ✅ `tool({ parameters: zod, execute })`; function tools; hosted tools are OpenAI-only. zod-static; dynamic schemas need conversion.
- **Bundle/runtime weight**: LOW–MODERATE — small core; depends on the OpenAI SDK plus (optionally) AI SDK packages for non-OpenAI models.
- **Maintenance health**: EXCELLENT — active OpenAI-maintained repo. ✅
- **Migration effort for LENS**: **MODERATE, ~2–3 weeks ⚠** — clean agent primitives (handoffs, guardrails), but running the full stack on Anthropic + Ollama means living on the compat bridge; SSE-guard parity work similar to the AI SDK route.
- **Verdict**: disqualified on constraint 2's spirit — Anthropic second-class.

## 5. Anthropic Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

- **Sources**: https://docs.claude.com/en/api/agent-sdk/overview · https://github.com/anthropics/claude-agent-sdk-typescript · https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- **License**: MIT for the SDK package ⚠ (verify package LICENSE); **the SDK wraps the Claude Code CLI engine, which is under Anthropic's commercial terms** — the runtime is not a permissively licensed library artifact.
- **Node fit**: ❌ **FAILS constraint 1.** It drives a **subprocess** (the `claude` CLI engine shipped via the `@anthropic-ai/claude-code` dependency) rather than running as an in-process library. In an Electron main process this means bundling and spawning a large external engine per session — a de-facto sidecar.
- **Provider coverage**: ❌ **Anthropic-only.** No Gemini, no OpenAI, no Ollama. Fails constraint 2 outright.
- **Streaming**: ✅ (for what it supports) async-iterator message stream with typed SDK system messages.
- **Tool calling**: ✅ MCP-based tool servers plus built-in Claude Code tools; not adaptable to LENS's dynamic in-process tool schema model without an MCP shim.
- **Bundle/runtime weight**: HIGH — ships the full Claude Code CLI as a dependency (tens of MB, bundled engine), spawns subprocesses.
- **Maintenance health**: Active (Anthropic-maintained). ✅
- **Migration effort for LENS**: **Not viable.** Disqualified: subprocess runtime (constraint 1) + single-provider (constraint 2).

## 6. Google ADK for TypeScript (`google-adk` / ADK JS)

- **Sources**: https://google.github.io/adk-docs/ · https://github.com/google/adk-python (Python flagship; JS/TS edition repo/package ⚠ verify current location) · npm: `google-adk`
- **License**: Apache-2.0. ✅
- **Node fit**: ✅ Pure TS library, in-process (early-preview maturity).
- **Provider coverage**: ❌ **Gemini-first; the TS/JS edition does not ship first-class OpenAI/Anthropic/Ollama model integrations** (the Python ADK reaches other providers via LiteLLM; the JS edition has no equivalent bridge at survey time). Fails constraint 2.
- **Streaming**: ⚠ present but preview-grade; event model designed around ADK Runner sessions.
- **Tool calling**: ✅ (function tools, MCP tools) but tied to the ADK runtime.
- **Bundle/runtime weight**: LOW–MODERATE, but the JS edition is young and its API surface is moving.
- **Maintenance health**: Active but **preview-stage** for TS; the Python edition is the flagship. ⚠
- **Migration effort for LENS**: **Not sensible.** Disqualified: single-provider (Gemini-first) + preview maturity.


## 7. VoltAgent (`@voltagent/core`)

- **Sources**: https://voltagent.dev/docs/ · https://github.com/VoltAgent/voltagent · https://www.npmjs.com/package/@voltagent/core
- **License**: MIT. ✅
- **Node fit**: ✅ Pure TS, in-process. The VoltAgent **observability server/UI is optional** (⚠ verify it never auto-starts when omitted).
- **Provider coverage**: ✅ Built on top of the **Vercel AI SDK** model layer (plus documented LiteLLM support for local models) — OpenAI, Anthropic, Gemini, and Ollama (via AI SDK community providers / openai-compatible) all covered.
- **Streaming**: ✅ Agent-level streaming hooks and event emitters (`onAgentStart`, stream chunks, tool events); adaptable to `LiveEvent`.
- **Tool calling**: ✅ zod-typed `createTool`; dynamic tools possible via AI SDK `dynamicTool` pass-through.
- **Bundle/runtime weight**: LOW–MODERATE — core wraps the AI SDK plus its agent toolkit; smaller than Mastra/LangGraph.
- **Maintenance health**: ACTIVE — fast-moving project, frequent releases. ✅ (⚠ smaller community than the majors; lower bus factor.)
- **Migration effort for LENS**: **LOW–MODERATE, ~1.5–3 weeks** — similar shape to the AI SDK route but adds its own agent abstraction on top. Since it delegates to the AI SDK anyway, VoltAgent over plain AI SDK buys a prebuilt agent loop at the cost of an extra framework layer and a smaller ecosystem.

## 8. LlamaIndex.TS (`llamaindex` / `@llamaindex/core`)

- **Sources**: https://docs.llamaindex.ai/llamaindex/framework/ts/ · https://github.com/run-llama/LlamaIndexTS · https://www.npmjs.com/package/llamaindex
- **License**: MIT. ✅
- **Node fit**: ✅ Pure TS, in-process.
- **Provider coverage**: ✅ `@llamaindex/openai`, `@llamaindex/anthropic`, `@llamaindex/google`, and `@llamaindex/ollama` — all four required providers covered (⚠ verify exact current package names).
- **Streaming**: ✅ async-iterable token streams (`LLMReadableStream`) from chat engines and agent workflows.
- **Tool calling**: ✅ `FunctionTool` (zod / JSON-schema); agent workflows with tool events.
- **Bundle/runtime weight**: MODERATE — the umbrella `llamaindex` package pulls RAG machinery LENS does not need; slimmer `@llamaindex/core` + provider packages is the right shape but more assembly.
- **Maintenance health**: GOOD — active repo, steady releases; the TS edition tracks the Python project with some lag. ✅
- **Migration effort for LENS**: **MODERATE, ~2–3.5 weeks.** The framework's center of gravity is RAG indexing/retrieval, which overlaps LENS's own retrieval stack (BM25, RRF, MMR, dedup) rather than replacing it; the agent layer (`AgentWorkflow`) is younger and less battle-tested than the AI SDK's.


## 10. Comparison matrix

| Candidate | License | Pure Node lib | Ollama | Gemini | OpenAI | Anthropic | Token streaming | Dynamic tools | Native-mod risk | Health (≤6mo commits) | LENS migration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Vercel AI SDK v5** | Apache-2.0 | ✅ | ✅ (openai-compatible / community) | ✅ 1st-party | ✅ 1st-party | ✅ 1st-party | ✅ async iter, typed `fullStream` | ✅ `dynamicTool` | None | ✅ Excellent | **1–2 wks** ✅ |
| **LangGraph.js 1.0** | MIT | ✅ | ✅ `@langchain/ollama` | ✅ | ✅ | ✅ | ✅ streamMode/streamEvents | zod bridge | None | ✅ Excellent | 3–5 wks |
| **Mastra** | Apache-2.0 ⚠ | ✅ (storage caveat ⚠) | ✅ (via AI SDK) | ✅ | ✅ | ✅ | ✅ | ✅ zod | LibSQL if adopted | ✅ Excellent (churny) | 2–4 wks |
| **OpenAI Agents JS** | MIT | ✅ | ✅ (compat) | ✅ (compat) | ✅ native | ❌ custom `Model`/bridge only | ✅ stream events | zod bridge | None | ✅ Excellent | 2–3 wks ⚠ |
| **Claude Agent SDK** | MIT SDK ⚠ / commercial CLI | ❌ subprocess | ❌ | ❌ | ❌ | ✅ only | ✅ async gen | ✅ MCP | CLI binary | ✅ Active | **Not viable** |
| **Google ADK TS** | Apache-2.0 | ✅ preview | ❌ | ✅ | ❌ | ❌ | ⚠ preview | ✅ | None known | ⚠ Young | Skip |
| **VoltAgent** | MIT | ✅ | ✅ (via AI SDK) | ✅ | ✅ | ✅ | ✅ evented | ✅ zod | None core | ✅ Active | 1.5–3 wks |
| **LlamaIndex.TS** | MIT | ✅ | ✅ ⚠ pkg name | ✅ | ✅ | ✅ | ✅ async iter | ✅ zod | None core | ✅ Good | 2–3.5 wks |
| dzhng/deep-research | MIT | ✅ (app, not lib) | — | — | — | — | ❌ no stream contract | ❌ | None | ⚠ Skeleton | Not adoptable |

## 11. Ranked shortlist & recommendation for LENS

1. **Adopt Vercel AI SDK v5 as the provider layer** (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible` → Ollama). Keep `DeepResearchAgent` and `WideResearchAgent` unchanged — they are the product's differentiator (coverage audits, stratified admission, grounding verification), and no surveyed framework loop matches them.
2. **Runner-up: LangGraph.js** — adopt only if/when LENS needs durable checkpoints, human-in-the-loop interrupts, or resumable graphs. Its provider coverage is equivalent (via LangChain integrations incl. Ollama), but the graph re-architecture (3–5 weeks) is unjustified by current requirements.
3. **Third: VoltAgent** — a viable AI-SDK-plus-agent-loop option, but it delegates to the same underlying model layer as recommendation 1, so it adds a framework layer without adding capability LENS lacks.

**Migration invariants (for the AI SDK path):**

- Preserve the **512 KiB tool-argument cap** — re-implement as `fullStream` tool-call accumulation validation.
- Preserve the **`LiveEvent` emission contract** — `textStream` → `onChunk` → `emitEvent` must remain byte-compatible for the WebSocket clients.
- Keep the **`LLMRequestOptions` seam** through Phase 1 so both agent loops compile untouched; delete `parseProviderSseEvents` in Phase 2 only once per-provider parity tests (streamed text + streamed tool calls, for all 4 providers) pass.

**Deferrals**: durable workflows/memory → Mastra (only with the in-memory storage story verified); prebuilt subagents → AI SDK `Agent` class first (zero new dependency).

**Hard disqualifications**: Claude Agent SDK (constraint 1: subprocess runtime; constraint 2: Anthropic-only; commercial CLI terms); Google ADK TS (constraint 2: Gemini-first, no first-class OpenAI/Anthropic/Ollama in the JS edition; preview maturity); OpenAI Agents JS (constraint 2 spirit: Anthropic only via custom `Model`/AI-SDK bridge — second-class for 3 of 4 required providers); dzhng/deep-research (not a library, no stream/tool contract, strictly weaker than the engine's existing loop).

## 12. Uncertainty log (re-verify before an adoption PR)

- ⚠ Mastra: confirm current LICENSE file and the in-memory-storage story ("storage required" issues across 2025).
- ⚠ OpenAI Agents JS: confirm current major version and the exact custom-`Model`/Anthropic docs page.
- ⚠ `google-adk` npm package name and repo location; confirm current provider list for the TS edition.
- ⚠ LangChain: confirm `@langchain/ollama` package name in the 1.0 line.
- ⚠ VoltAgent: confirm 1.x status and that the observability server is fully optional (never auto-starts).
- ⚠ LlamaIndex.TS: confirm current provider package names (`@llamaindex/ollama` etc.) and `AgentWorkflow` API stability.
- ⚠ Claude Agent SDK: confirm SDK package LICENSE vs. the CLI's commercial terms.

## 9. Purpose-built open-source deep-research frameworks

- **`dzhng/deep-research`** — https://github.com/dzhng/deep-research (MIT): the canonical TS "deep research" recursive loop (query generation → search → evaluate → sub-queries). It is a thin **app/skeleton**, not a maintained library: no published npm package contract, Firecrawl-first, minimal tool/stream abstraction. Its value is as a **reference**; it would be a net downgrade from LENS's `DeepResearchAgent` (coverage audits, stratified admission, grounding verification, telemetry). Not adoptable, but not a disqualification risk either — LENS already owns a stronger loop.
- **`google-gemini/gemini-fullstack-langgraph-quickstart`** — https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart (Apache-2.0): a fullstack deep-research **app** on LangGraph.js; useful only as a reference for LangGraph.js live-event streaming patterns.
- **Non-TS, excluded by constraint 1**: LangChain `open_deep_research` (Python), HuggingFace smolagents `open-deep-research` (Python), Stanford STORM (Python) — all require a Python sidecar.
- npm packages literally named `deep-research` are thin community wrappers around the dzhng loop, not maintained libraries — avoid.

