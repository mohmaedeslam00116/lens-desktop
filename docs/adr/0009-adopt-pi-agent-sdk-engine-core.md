# 9. Adopt the pi Agent SDK as the LENS Engine Agent Core

## Context

The LENS embedded research engine (`frontend/electron/engine/`) hand-rolls its agent core from scratch:

- `models.ts` — a bespoke multi-provider LLM client (per-provider SSE parsing, tool-call accumulation, streaming) for gemini, openai, anthropic, groq, deepseek, openrouter, mistral, ollama.
- `agent.ts` (`DeepResearchAgent`) / `wideAgent.ts` (`WideResearchAgent`) — orchestration loops (graph nodes, hops, reflection, budget expansion) over that client.

Maintaining this from-scratch plumbing is the pain the map owner wants gone. The wayfinding map *Engine Core: Adopt an Existing Agent SDK for the LENS Embedded Research Engine* (issue #58) resolved the investigative tickets: engine review (#61), SDK survey (#62), fact verification (#64), pi evaluation (#65), and locked the acceptance criteria in a grilling session with the map owner (#63), who has **decided in favor of the pi agent SDK**.

Key evidence:

- **Survey shortlist**: Vercel AI SDK v7 > LangGraph.js > VoltAgent, with disqualifications (Claude Agent SDK — subprocess + commercial license; Google ADK TS — Gemini-first; OpenAI Agents JS — second-class non-OpenAI providers; Python frameworks — sidecar).
- **pi evaluation (#65)**: `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` are plain Node/TS libraries, MIT-licensed, very active (earendil-works/pi, 104k★, Sep 2026), with an agent runtime (tool calling, state/session management, event streaming) nearly isomorphic with LENS's `LiveEvent` contract. **Blocking condition**: `pi-ai` 0.85.1 engine-pins `node >= 22.19.0` while LENS ships Electron 29.4.6 (Node 20.x). The map owner accepted the resulting Electron upgrade as a prerequisite (exit criteria Q7).
- **Antigravity SDK** (the original fallback): no-go — Python-only client over a closed-source binary, Gemini-only providers; cannot run as a Node/TS library inside Electron (#60).

## Decision

We adopt the **pi agent SDK** (`@earendil-works/pi-ai` + `@earendil-works/pi-agent-core`) as the LENS engine agent core, replacing the hand-rolled multi-provider plumbing while keeping the engine's domain value (retrieval pipeline, citation grounding, skills subsystem, `LiveEvent` contract). The migration is governed by this seam contract:

1. **Runtime prerequisite**: upgrade Electron from 29.4.6 to **>= 36.9.0** — the first stable line carrying **Node 22.19.0**, satisfying pi-ai's `node >= 22.19.0` (verified via `releases.electronjs.org/releases.json`, all 36.9.0 / 37.5.0 / 38.1.0 released 2025-09-10). Pin to a maintained patch line current at adoption time (36.x/37.x/38.x) and re-verify pi's `engines` requirement in the adoption PR.

2. **`ModelClient` seam (`models.ts`)**: replace the provider plumbing with `createModels()` from pi-ai. Provider mapping — gemini→`google`, openai→`openai`, anthropic→`anthropic`, groq/deepseek/openrouter/mistral→native pi providers, **ollama→custom OpenAI-compatible provider** (`createProvider()` + OpenAI compatibility settings, base URL/`/v1`). Preserve the `LLMRequestOptions` shape: api-key resolution, `endpoint`, `temperature`, `tools`, `onChunk`→pi `text_delta`, and abort support.

3. **Agent loops**: LENS keeps ownership. `DeepResearchAgent` / `WideResearchAgent` orchestration (graph nodes, perspective decomposition, hops, reflection, budget expansion, coverage audits) stays; only LLM and tool execution are delegated to pi. The plan-approval pause (`awaiting_approval`) maps natively: build the conversation → pause → resume with the user-approved plan. `ResearchSession` remains the source of truth; pi state/session backends are optional.

4. **Event adapter (`LiveEvent` contract)**: one adapter maps pi events to `LiveEvent` — `agent_start`/`turn_start`/`message_start` → `graph_node` (active); `message_update` (`text_delta`) → `thought`/stream deltas; `tool_execution_start`/`tool_execution_end` → tool-flow + `source` updates; `turn_end`/`agent_end` → completed/failed. Consumers (`server.ts` WebSocket, React UI) are untouched.

5. **Skills subsystem**: register the existing `/skills/` activation manager as one pi tool (`activate_skill`) through pi's typebox-validated tool schema. `SkillActivationManager`, the registry, and the compaction shield stay unchanged behind a thin tool bridge.

6. **Telemetry**: no automatic transmission. Only vendor-neutral contract types are consumed; LENS wires no telemetry adapter. Re-verify at adoption that no default send path exists in the published packages.

7. **Pinning**: pi is pre-1.0 and fast-moving; pin exact versions (pi's own supply-chain practice) and re-verify API stability within the adoption PR.

## Consequences

**Positive**

- Most hand-rolled provider plumbing retires, including the dead SSE-parser half of `models.ts` identified in the engine review (#61).
- pi's event model (message/tool/turn granularity) is nearly isomorphic with `LiveEvent`, so the adapter stays thin.
- Session/state management, context serialization, streaming tool-call partial JSON, and abort are first-class; MIT + supply-chain hardening (pinned exact deps, shrinkwrap) suit desktop redistribution.

**Negative / risks**

- Electron major upgrade is a packaging/runtime change: `electron-builder` 24.13.3 must target the new line, and the engine must be regression-tested on the new runtime.
- pi is pre-1.0: API churn risk — mitigated by exact pinning and adoption-time re-verification.
- Ollama requires a small OpenAI-compatible shim (same effort class as the survey's Vercel AI SDK adapter).
- The `pi-telemetry` dependency must be shown inert (no default send path).

**Parity gate**

The swap lands only when the existing suite proves parity: citation grounding (`hierarchical_synthesis_grounding`), wide research (`wide_research_agent`, `wide_mode_server`), skills (`skill_activation_compaction_shield`, `skills_*`), and the engine/server seams.

**References**: research branches `research/engine-core-review`, `research/agent-sdk-survey`, `research/sdk-survey-verification`, `research/antigravity-fallback`, `research/pi-agent-sdk` (lens-desktop repo).