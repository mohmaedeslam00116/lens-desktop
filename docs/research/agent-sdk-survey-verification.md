# Verification Addendum — Agent SDK Survey (Issue #64)

**Date**: 2026-09-12 (verification pass). **Parent document**: `docs/research/agent-sdk-survey.md` (branch `research/agent-sdk-survey`, Issue #62). **Method**: every item in the parent survey's uncertainty log (§12) re-verified against live primary sources on 2026-09-12: npm registry metadata (`npm view`), GitHub repository APIs (license files, `pushed_at`, archive/deprecation status), and official docs pages fetched live.

**Headline**: all seven ⚠-flagged items were resolved. Three corrections were material (LlamaIndex.TS deprecated; Claude Agent SDK not MIT; Google ADK TS package name wrong), but **the shortlist ranking does not change**: Vercel AI SDK first, LangGraph.js second, VoltAgent third. Two disqualifications (Claude Agent SDK, Google ADK TS) were re-confirmed with corrected evidence.

---

## 1. Mastra — license & storage story ⚠ → ✅ resolved

| Claim in survey | Verified value (2026-09-12) | Verdict |
|---|---|---|
| License: Apache-2.0 (relicensed from EPL-1.0 in 2025) | `@mastra/core` 1.66.0, npm license `Apache-2.0`, last publish 2026-09-12. Repo `LICENSE.md`: content **outside** `ee/` directories is Apache-2.0 (© 2025 Kepler Software, Inc.); content under `ee/` (`@mastra/core/auth/ee`, `@mastra/core/agent-builder/ee`, `@mastra/editor/ee`) is under a proprietary "Mastra Enterprise Edition (EE) License v1.0 (Effective August 24, 2026)" | **Confirmed, with nuance** — hybrid license. The Apache-2.0 grant covers the framework core LENS would consume; the `ee/` enterprise extensions are proprietary. Not a disqualifier for embedding `@mastra/core`. |
| Storage required / in-memory story unclear | Official storage docs (https://mastra.ai/en/docs/storage/overview, fetched live): "The default in-memory store is useful for tests and short local experiments"; persistent storage (LibSQLStore, Postgres, composite stores) is **opt-in** via `new Mastra({ storage: ... })` | **Resolved** — storage is optional; in-memory is the default. LibSQL is recommended (not required) for persistence. The 2025 "storage required" friction has been superseded by the 1.x storage API (`MastraCompositeStore`). |

**Impact on survey**: Mastra's storage caveat (§3, comparison-matrix "storage caveat ⚠") is cleared; the "churny API" caveat stands (the `ee/` split is itself new as of Aug 2026). Mastra remains a solid 4th-tier option — still heavier than plain AI SDK for LENS's needs. No ranking change.

## 2. OpenAI Agents JS — current major version & custom-Model docs ⚠ → ✅ resolved

- **Version**: `@openai/agents` latest = **0.18.0** (published 2026-09-10), MIT. Still **pre-1.0** — no 1.x release line as of 2026-09-12. Repo actively maintained (`pushed_at` 2026-09-12).
- **Docs page confirmed**: https://openai.github.io/openai-agents-js/guides/models/ contains an "**AI SDK integration**" section stating: "If you want to use non-OpenAI models without implementing `ModelProvider` yourself, see *Using any model with Vercel's AI SDK*. That adapter lets you plug an AI SDK model into the Agents runtime directly." — i.e., non-OpenAI models (including Anthropic and Ollama) are reachable **only** via the Vercel AI SDK adapter or a hand-written `Model`/`ModelProvider`. The survey's "second-class for 3 of 4 providers" characterization is accurate.

**Verdict**: disqualification on constraint 2's spirit stands. No ranking change.

## 3. Google ADK for TypeScript — package name, repo, provider list ⚠ → ✅ resolved (correction)

| Claim in survey | Verified value | Verdict |
|---|---|---|
| npm package: `google-adk` | **`google-adk` does not exist** (npm registry returns 404). The correct package is **`@google/adk`** — v2.0.0, Apache-2.0, published 2026-08-21; devtools companion `@google/adk-devtools` | **Corrected** |
| Repo location uncertain | **`https://github.com/google/adk-js`** — active (`pushed_at` 2026-09-10), Apache-2.0, "open-source, code-first Typescript toolkit" | **Confirmed** (repo exists at this exact location) |
| Gemini-first, no first-class OpenAI/Anthropic/Ollama in the TS edition | Live code search across `google/adk-js` for "openai": **0 hits**. Docs tree (`docs/guides/`) covers tools only; README examples use `model: 'gemini-flash-latest'`. A design doc (`docs/adk-ts-improvements.md`) targets parity with ADK Python (streaming, HITL) but shows no multi-provider model-integration roadmap in the shipped v2.0.0. There is an `@google/adk-integrations` package, but it contains web/devtools integrations, not model providers | **Confirmed** — still Gemini-first; constraint-2 failure stands |

**Verdict**: package name corrected (`@google/adk`, not `google-adk`); disqualification (Gemini-first, single-provider) re-confirmed against v2.0.0. No ranking change. **Update the comparison matrix row name to `@google/adk`.**

## 4. LangChain — `@langchain/ollama` package name in the 1.0 line ⚠ → ✅ confirmed

- `@langchain/ollama` exists: **v1.3.0**, MIT, last publish 2026-06-17. It is the current 1.x-line Ollama integration.
- `@langchain/langgraph` latest = **1.4.15**, MIT, published 2026-09-12; repo `langchain-ai/langgraphjs` actively maintained (`pushed_at` 2026-09-12). The 1.0 release-line claim in the survey holds.

**Verdict**: confirmed; LangGraph.js remains the runner-up. No ranking change.


## 5. VoltAgent — 1.x status & observability server ⚠ → ✅ resolved (correction)

- **Version correction**: `@voltagent/core` latest = **2.10.0** (published 2026-08-27), MIT. The project crossed to a **2.x major line** since the survey. The repo's migration guide documents the breaking changes.
- **Observability/server question — fully resolved**: in the 2.x line the built-in server options (`port`, `enableSwaggerUI`, `autoStart`, custom endpoint registration) were **removed from `@voltagent/core` entirely**. The HTTP/observability server now only runs when you explicitly opt in: `new VoltAgent({ server: honoServer() })` with the separate `@voltagent/server-hono` package. Instantiating agents without a server provider **never auto-starts anything** — verified against the official migration guide (voltagent.dev) and docs (https://voltagent.dev/docs/agents/overview/).
- License MIT, repo `VoltAgent/voltagent` active (`pushed_at` 2026-08-27), still built on the Vercel AI SDK model layer.

**Verdict**: survey's caution resolved in VoltAgent's favor; the "extra framework layer over AI SDK" critique stands. VoltAgent remains third. No ranking change.

## 6. LlamaIndex.TS — provider package names & `AgentWorkflow` stability ⚠ → ❌ material correction (deprecated)

- **MAJOR CORRECTION**: `run-llama/LlamaIndexTS` is **archived on GitHub** (last push 2026-03-11) and its README carries a deprecation notice: *"**This project is deprecated and no longer maintained.**"*
- The provider packages still exist on npm (`@llamaindex/ollama` 0.1.24, `@llamaindex/openai` 0.4.23, `@llamaindex/anthropic` 0.3.27, `@llamaindex/google` 0.4.1 — all last published 2026-06-05; umbrella `llamaindex` 0.12.1, last published 2025-12-31), but with the repo archived the package-name question is moot.
- **`AgentWorkflow` API stability**: question moot — the framework will receive no further maintenance.

**Verdict**: the survey's "Maintenance health: GOOD" for LlamaIndex.TS (§8, matrix "✅ Good") is **now wrong**. LlamaIndex.TS moves from "viable but not preferred" to **disqualified on constraint 4** (not actively maintained). It was already below the cut line, so **no change to the top-3 ranking** — but the comparison matrix and §8 should mark it deprecated, and it must not be revisited as a fallback.


## 7. Claude Agent SDK — SDK package LICENSE vs. CLI commercial terms ⚠ → ❌ material correction (not MIT)

- **MAJOR CORRECTION**: the survey hedged "License: MIT for the SDK package ⚠". Live verification of `anthropics/claude-agent-sdk-typescript/LICENSE.md`:

  > © Anthropic PBC. All rights reserved. Use is subject to Anthropic's [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms).

  npm likewise reports the license as `SEE LICENSE IN README.md`. **The SDK package is not MIT — it is governed by the same Anthropic Commercial Terms as the CLI.** The survey's "MIT SDK / commercial CLI" split is wrong; it is **commercial terms throughout**.
- **Reinforcing finding**: `@anthropic-ai/claude-agent-sdk` 0.3.269 (published 2026-09-11) ships **platform-specific native binaries** as optional dependencies (`@anthropic-ai/claude-agent-sdk-win32-x64`, `-linux-x64`, `-darwin-arm64`, …) — a compiled engine, not a pure-TS library. This strengthens the constraint-1 failure (subprocess/native runtime in the Electron main process).
- Anthropic-only provider coverage: unchanged (no Gemini/OpenAI/Ollama support).

**Verdict**: disqualification ("Not viable") re-confirmed — and on **stronger grounds** than the survey stated (commercial license + native binary runtime, in addition to subprocess + single-provider). No ranking change.


## 8. Ranking impact assessment

**The ranked shortlist (§11) does not change.**

| Rank | Candidate | Post-verification status |
|---|---|---|
| 1 | **Vercel AI SDK** | **Strengthened.** `ai` is now **v7** (7.0.99, Apache-2.0, published 2026-09-12; LICENSE file verified Apache-2.0). Provider packages current: `@ai-sdk/openai` 4.0.66, `@ai-sdk/anthropic` 4.0.53, `@ai-sdk/google` 4.0.69, `@ai-sdk/openai-compatible` 3.0.48 — all Apache-2.0, all published within the last 48h. The survey's "v5" label is stale; the recommendation generalizes to "the current major line (v7)". Migration estimates in §1 should be re-checked against v7 API changes before an adoption PR. |
| 2 | **LangGraph.js** | **Confirmed.** 1.x line (`@langchain/langgraph` 1.4.15) + `@langchain/ollama` 1.3.0 verified; active. |
| 3 | **VoltAgent** | **Confirmed, updated.** Now 2.x (2.10.0); observability server verified fully opt-in (removed from core). Still viable; still third. |
| — | Mastra | Storage caveat **cleared** (in-memory default, storage opt-in); hybrid Apache-2.0/EE license noted. Rises slightly as a fallback but remains below the top 3 for LENS's use case. |
| — | LlamaIndex.TS | **Downgraded to disqualified** (archived + deprecated repo). Was below the cut line already. |
| — | OpenAI Agents JS, Google ADK TS (`@google/adk`), Claude Agent SDK | Disqualifications re-confirmed with corrected evidence. |

### Corrections to carry into the survey document on next edit

1. §3 / matrix (Mastra): drop the "storage required ⚠" caveat; note the hybrid `ee/` Enterprise Edition license split (Apache-2.0 core, proprietary `ee/`).
2. §6 / matrix (Google ADK TS): package is `@google/adk` (npm `google-adk` does not exist), repo `google/adk-js`, current version 2.0.0; disqualification stands.
3. §8 / matrix (LlamaIndex.TS): mark **deprecated/archived** (run-llama/LlamaIndexTS, deprecation notice in README); remove "Good" health.
4. §5 / matrix (Claude Agent SDK): replace "MIT SDK ⚠ / commercial CLI" with "**Commercial Terms throughout** (LICENSE.md, verified 2026-09-12)"; add native-binary runtime finding.
5. §7 (VoltAgent): update to 2.x; observability server verified opt-in.
6. §4 (OpenAI Agents JS): pin "current version 0.18.0, pre-1.0"; docs pointer: `guides/models/` → "AI SDK integration" section.
7. §1 (Vercel AI SDK): update `ai` to the v7 major line (7.0.x); re-validate `streamText`/`dynamicTool`/`Agent` API surface against v7 docs before the adoption PR.

## 9. Verification source index (all accessed 2026-09-12)

- npm registry: `@mastra/core`, `@openai/agents`, `@google/adk`, `google-adk` (404), `@langchain/ollama`, `@langchain/langgraph`, `@voltagent/core`, `@anthropic-ai/claude-agent-sdk`, `@llamaindex/{ollama,openai,anthropic,google}`, `llamaindex`, `ai`, `@ai-sdk/{openai,anthropic,google,openai-compatible}` (`npm view` — version, license, `time.modified`, dist-tags, dependencies).
- GitHub API: `mastra-ai/mastra` (LICENSE.md + ee/LICENSE), `openai/openai-agents-js`, `google/adk-js` (README, docs tree, code search), `VoltAgent/voltagent` (migration guide, types, docs), `anthropics/claude-agent-sdk-typescript` (LICENSE.md, contents), `run-llama/LlamaIndexTS` (README deprecation notice, archived flag), `langchain-ai/langgraphjs`, `vercel/ai` (LICENSE).
- Official docs fetched live: https://mastra.ai/en/docs/storage/overview · https://openai.github.io/openai-agents-js/guides/models/ · https://voltagent.dev/docs/agents/overview/ · https://voltagent.dev/docs/quick-start/
