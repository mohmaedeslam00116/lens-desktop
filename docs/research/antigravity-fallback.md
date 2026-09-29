# Antigravity SDK Feasibility as the Fallback Agent Core

**Research ticket**: [mohmaedeslam00116/lens-desktop#60](https://github.com/mohmaedeslam00116/lens-desktop/issues/60)
**Date**: 2026 (research snapshot; facts verified against PyPI and the `google-antigravity/antigravity-sdk-python` GitHub repository at time of writing)
**Verdict**: ❌ **NO-GO** — the Google Antigravity SDK is not a usable fallback agent core for the LENS embedded research engine.

---

## 1. What the SDK actually is

The **Google Antigravity SDK** (`pip install google-antigravity`, currently **v0.1.16**, Python **≥ 3.10**, **Apache-2.0**) is a Python SDK for building AI agents "powered by Antigravity and Gemini". It positions itself as "a secure, scalable, and stateful infrastructure layer that abstracts the agentic loop".

Critically, its actual architecture is **not a pure library**. The README states:

> "The Google Antigravity SDK relies on a compiled runtime binary that is included in the platform-specific wheels published to PyPI. **Cloning this repository alone is not sufficient to run the SDK.** Always install from PyPI … to obtain the binary."

The agent loop itself does **not** run in the Python layer. Per the repository's own `connections/README.md`, the Python SDK is a client shim that spawns a **closed-source, Go-compiled "localharness" binary** and communicates with it over **WebSockets using protobuf messages** (`OutputEvent`, `InputEvent`, `StepUpdate`). `LocalConnectionStrategy(binary_path="/path/to/localharness", …)` makes this explicit.

### What it provides (Layer model, per its README)

| Capability | Status | Notes |
|---|---|---|
| Agent loop abstraction | ✅ | Three layers: `Agent` (high-level), `Conversation`/`ChatResponse`/`Step`/`ToolCall` (session), `Connection`/`ConnectionStrategy` (transport) |
| Streaming | ✅ | `async for token in response`, `response.thoughts` (reasoning deltas), `response.tool_calls` (typed tool-call events), `conversation.receive_steps()` |
| Tool calling | ✅ | Python callables registered as tools; `ToolRunner`; MCP servers (Stdio/SSE); declarative policies (`deny`/`allow`/`ask_user`); hooks; sandboxed `run_command` |
| Session/state | ✅ | `Conversation` accumulates step history, `turn_count`, `last_response`, persistence/skills/triggers |
| Multimodal | ✅ | Images/video/audio/documents ingestion, image generation models |

### Model / provider coverage — the decisive gap

`google/antigravity/models.py` defines exactly **two** endpoint types:

- `GeminiAPIEndpoint` — Gemini Developer API (`GEMINI_API_KEY`)
- `VertexEndpoint` — Vertex AI (project/location + ADC, or Express-mode API key)

Plus a `LiteRTAgentConfig` for **local on-device models via LiteRT** (`model_path="~/.litert-lm/models/gemma4-26b/model.litertlm"`) — i.e., Gemma `.litertlm` files only. The default model is `gemini-3.8-flash`.

**There is no OpenAI, Anthropic, Ollama, or generic OpenAI-compatible endpoint support.** No BYO-provider seam exists that LENS could plug its eight providers into.

## 2. Runtime requirements vs. the LENS engine

LENS's embedded engine (`frontend/electron/engine/`) is plain **TypeScript running inside the Electron main process** — no Python, no external harness, one runtime, one process tree.

Adopting Antigravity would require, inside every packaged LENS desktop app:

1. **A Python ≥ 3.10 runtime** (sidecar, e.g. PyInstaller/venv bundling) — the SDK is Python-only.
2. **The closed Go `localharness` binary** obtained from a platform wheel (win_amd64 / win_arm64 / macOS arm64 / manylinux x86_64+aarch64 wheels on PyPI), which must be shipped, version-matched to the Python shim, and spawned per session.
3. **WebSocket + protobuf IPC plumbing** between the shim and the harness.

It does **not** require the Antigravity IDE, but it effectively replaces one Electron-local TypeScript engine with a three-process (Electron ⇄ Python ⇄ Go binary) stack whose middle and outer layers we neither control nor ship source for.

**No Node/TypeScript SDK exists.** npm has no `google-antigravity` package (404); the `antigravity` npm name is an unrelated placeholder ("placeholder for the haters", v0.0.0).


## 3. License & redistribution

- The **Python source** is Apache-2.0 (Google LLC, 2026 headers).
- The **Go harness binary** is compiled and distributed **only via PyPI wheels**; its source is not in the repository. Redistribution terms of that binary inside a packaged commercial desktop app are **unstated and unverified** — the repository's LICENSE covers the Python code, and there is no explicit grant covering the binary artifact.
- Even if redistribution were permitted, we would be shipping an opaque binary whose update cadence, telemetry behavior, and security posture we cannot audit — in a desktop app that runs in the user's workspace.

## 4. Mapping onto LENS seams (the "if go" sketch that never survives contact)

Assume, hypothetically, we bridged Electron ⇄ a Python sidecar:

| LENS seam | Antigravity counterpart | Fit |
|---|---|---|
| `ModelClient` (`models.ts`) — `LLMRequestOptions` with `provider: 'gemini' \| 'openai' \| 'anthropic' \| 'groq' \| 'deepseek' \| 'openrouter' \| 'mistral' \| 'ollama'`, SSE streaming, inline tool-loop | `LocalAgentConfig` + `GeminiAPIEndpoint`/`VertexEndpoint` | ❌ **Broken**. Only Gemini/Vertex/LiteRT-Gemma endpoints exist. Seven of LENS's eight providers (including the entire Ollama local-model path) have no mapping. The ModelClient seam would have to remain hand-rolled anyway, which defeats the purpose of adopting the SDK. |
| `DeepResearchAgent` / `WideResearchAgent` (`agent.ts` / `wideAgent.ts`) — research loops with planning, milestone budgets, source admission, coverage scoring, cancellation | `Conversation` / `Connection` autonomous harness loop (file writes, `run_command`, coding-agent tools) | ❌ **Wrong loop shape**. The harness loop is an autonomous coding-agent loop with filesystem/command capabilities; LENS's loops are research pipelines emitting plan/coverage/citation semantics. Wrapping one in the other means fighting the harness's tool policies and step model to produce research events. |
| `LiveEvent` contract (`types.ts`) — typed events (`thought`, `source`, `graph_node`, `plan_*`, `wide_telemetry`, `report_chunk`, …) emitted over the engine's WebSocket to the React UI | `Step`, `ChatResponse.thoughts`, `ChatResponse.tool_calls` (protobuf `OutputEvent`/`StepUpdate`) | ⚠️ **Lossy adapter**. Thoughts and tool calls map approximately to `thought` events, but `source`, `graph_node`, `plan_*`, coverage and telemetry events are LENS-domain concepts the harness never emits; they would still be produced by LENS code, meaning the SDK sits *around* the loop, not *inside* it — no abstraction gained. |

Conclusion: the SDK would impose a Python+Go sidecar runtime while LENS keeps 100% of its existing ModelClient and loop code, plus a lossy event adapter. Negative net value.

## 5. Maturity risks

- **Pre-1.0, fast churn**: 0.1.0 (May 2026) → 0.1.16 (Sep 2026), essentially weekly releases. Changelog shows default-model churn (default flipped to `gemini-3.8-flash` in 0.1.16) and repeated config-surface changes — no stability guarantee.
- **0.x semver**: breaking changes allowed in any minor/patch bump; a packaged desktop app would pin a binary+shim pair that can silently drift.
- **Docs**: README + per-package READMEs in-repo; no standalone documentation site; no formal API stability policy.
- **Community**: ~3.4k stars / ~1.3k forks, 31 open issues at time of review — real interest, young project.
- **Opaque core**: the agent loop lives in a closed binary, so bugs in the loop (the part LENS would most depend on) are neither inspectable nor patchable by us.

## 6. Verdict and recommendation

**NO-GO.** The Antigravity SDK is a Python-only, Gemini-family-only, closed-binary-harness agent framework. It fails the LENS fallback criteria on all three axes that matter:

1. **Runtime mismatch** — requires Python ≥ 3.10 plus a proprietary Go harness binary inside an Electron app that currently ships zero external agent runtimes.
2. **Provider mismatch** — no OpenAI/Anthropic/Ollama/OpenAI-compatible support; the `ModelClient` seam (the actual thing a "fallback agent core" would replace) cannot be implemented on top of it.
3. **Loop mismatch** — its autonomous coding-harness loop neither emits nor understands the LENS `LiveEvent` research contract; the adapter would be lossy and the harness capabilities (file writes, shell) are attack surface a research engine does not want.

**Recommendation**: keep the fallback slot for the existing hand-rolled `ModelClient` + `DeepResearchAgent`/`WideResearchAgent` loops (already multi-provider incl. Ollama-local). If a general agent-loop SDK is still wanted as a fallback core, better-fitting candidates to evaluate are **TypeScript-native, provider-agnostic** libraries (e.g. Vercel AI SDK / AI SDK v5 agent abstractions, LangGraph.js) which run in-process in the Electron main, implement `ModelClient` trivially, and map naturally onto `LiveEvent` emission. That evaluation is out of scope for this ticket.

## Sources

- PyPI package metadata: `https://pypi.org/pypi/google-antigravity/json` (v0.1.16, Apache-2.0, Python ≥ 3.10, requires-dist: `google-genai>=1.0`, `mcp<3.0,>=1.0`, `pydantic>=2.0`, `websockets>=12.0`, `protobuf>=7.35`; release dates 2026-05-19 → 2026-09-02; platform wheels incl. `win_amd64`).
- Repository: `https://github.com/google-antigravity/antigravity-sdk-python` (README with "compiled runtime binary" notice; `connections/README.md` describing the Go `localharness`, WebSocket + protobuf transport; `google/antigravity/models.py` defining `GeminiAPIEndpoint`/`VertexEndpoint`/`LiteRTAgentConfig`; `CHANGELOG.md` 0.1.16 default model change).
- npm registry: `https://registry.npmjs.org/google-antigravity` (404 — no Node SDK); `https://registry.npmjs.org/antigravity` (unrelated placeholder, v0.0.0).
- LENS source: `frontend/electron/engine/models.ts` (`ModelClient`, `LLMRequestOptions`, provider dispatch incl. `ollama`), `frontend/electron/engine/types.ts` (`LLMProvider` union, `LiveEvent`), `frontend/electron/engine/agent.ts` (`DeepResearchAgent`, `emitEvent: (event: LiveEvent) => void`), `frontend/electron/engine/wideAgent.ts`.

