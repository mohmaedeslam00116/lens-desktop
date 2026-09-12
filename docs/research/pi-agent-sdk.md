# pi Agent SDK — Evaluation for the LENS Engine Agent Core

Ticket: [Evaluate the pi agent SDK as a candidate for the LENS engine agent core](https://github.com/mohmaedeslam00116/lens-desktop/issues/65)
Branch: `research/pi-agent-sdk` · Context: [SDK survey](agent-sdk-survey.md) + [verification addendum](agent-sdk-survey-verification.md)

## Identity

- Project: **earendil-works/pi** (formerly `badlogic/pi-mono`), website pi.dev. "AI agent toolkit: unified LLM API, agent loop, TUI, coding agent CLI."
- **MIT license**, 104,379 stars, ~active (last push 2026-09-11, npm publishes 2026-09-05, 45 published versions of `agent-core`).
- Relevant packages (TypeScript/Node):
  - `@earendil-works/pi-ai` — unified multi-provider LLM API with provider catalogs, auth resolution, token/cost tracking, context serialization, tree-shaking.
  - `@earendil-works/pi-agent-core` — stateful agent runtime: tool calling, state/session management, **event streaming** (`agent.subscribe`). 3.6 MB unpacked; deps: diff, yaml, ignore, typebox, chord, pi-ai, pi-telemetry. SQLite session backend is a separate opt-in package (`pi-session-backend-sqlite-node`).
  - `@earendil-works/pi-coding-agent` — the CLI/TUI (not needed by LENS).
- Standalone separable library: **yes** — `agent-core` + `ai` are regular npm libraries with no CLI or service dependency.
- Caution: `pi-ai` on npm (unrelated placeholder, MIT, v0.0.1 by mitsuhiko) is a name reservation — ignore it; the real packages are scoped `@earendil-works/*`.

## Constraint scoring

| Constraint | Verdict |
|---|---|
| 1. Plain Node/TS library in Electron main (no sidecar) | ⚠️ **YES as a library, but see Node requirement** — no Python/sidecar; `agent-core` is a normal npm package. **However `pi-ai` 0.85.1 engine-pins `node >= 22.19.0`; LENS runs Electron 29.4.6 (Node 20.x)**. A `legacy-node20` dist-tag (0.74.2) exists but is an older line — a maintenance risk long-term. Drop-in today on Electron 29: **NO**; after an Electron upgrade (Node 22+): **YES**. |
| 2. Multi-provider incl. Ollama/local | ✅ OpenAI, Anthropic, Google, DeepSeek, Mistral, Groq, OpenRouter, xAI, Together AI, Bedrock, NVIDIA NIM, Cloudflare, etc. **No built-in Ollama provider**, but a custom OpenAI-compatible provider (`createProvider()` + OpenAI compatibility settings, or a dynamic provider) covers Ollama/local — the same pattern the survey validated for Vercel AI SDK v5. |
| 3. Token streaming AND tool calling with adaptable events | ✅ `streamSimple`/`stream` API with token deltas; `message_update` events carry `text_delta`; tool calls stream (`tool_execution_start/update/end`), including **streaming tool-call partial JSON**. Event sequence (`agent_start → turn_start → message_* → turn_end → agent_end`) maps cleanly onto the LENS `LiveEvent` contract through an adapter. |
| 4. Maintained + permissive license | ✅ MIT; extremely active project (104k★, multiple releases/week); supply-chain hardening (pinned exact deps, shrinkwrap, npm audit in CI) which suits shipping inside a desktop installer. No built-in permission sandbox in the lib itself — irrelevant for LENS's in-process engine use (LENS already owns its boundary). |

## Architecture fit (what the ticket cares about)

- **Agent-loop ownership**: LENS's plan-approval pause (`awaiting_approval`) needs the caller to own the loop. pi's `Agent.prompt()` is a step-wise call — LENS can build, pause, and resume the conversation across approval; agent state persists via session backends. ✅
- **State/session management**: first-class (AgentMessage model, `transformContext`/`convertToLlm` pipeline, pluggable session backends, context serialization in pi-ai). ✅ ✅
- **Custom app message types**: supported via declaration merging — useful for LENS research-graph nodes. ✅
- **Node runtime**: requires Node ≥ 22.19 (latest line). Electron 29 ships Node 20.x → **blocking for a drop-in today**.

## Ranking impact

- pi does **not** displace the ranking **given the current runtime** — the Node 22 pin fails the drop-in requirement on Electron 29.
- If the team accepts an **Electron upgrade to a Node-22 line** (e.g. Electron 36+/37+), pi becomes the **strongest candidate overall**: it replaces the most hand-rolled code (`models.ts` plumbing **and** the agent-loop/orchestration in `agent.ts`/`wideAgent.ts` boundary concerns), with a purpose-built event model nearly matching `LiveEvent`, sessions, and loop control — inherently better than Vercel AI SDK v7 for the plan-approval + streaming-telemetry requirements.
- Net: **keep pi live as a conditional top contender**; the decision ticket weighs "Electron/Node upgrade cost + risk" against "most hand-rolled code retired". This makes Q5 (plan-approval pause) and Q1 (provider floor incl. Ollama) in the criteria grilling strictly more important, and adds a new criteria question: is upgrading Electron to Node 22+ acceptable?

## Open questions / caveats

- Verify the minimum Electron version carrying Node ≥ 22.19 before promising an upgrade path (Electron 36+ expected; confirm exact minor).
- pi is fast-moving (pre-1.0 majors, 0.x) — pin exact versions (their own supply-chain practice) and re-verify API stability at adoption time.
- Ollama path needs a small custom-provider shim (same effort class as the Vercel AI SDK adapter).