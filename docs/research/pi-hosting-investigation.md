# Pi Runtime Hosting Investigation (Map: Agentic Search on a Pi-Only Backend)

**Ticket**: wayfinder research — "Pi runtime hosting investigation (cost, packaging, sandboxing, Electron fit)"
**Sources**: pi repo docs (`rpc.md`, `sdk.md`), installed `@earendil-works/pi-coding-agent@0.85.1` (node_modules inspection), public discussion #3337 (pi-agent-core as an embedded runtime).

## Verdict

**Host `AgentSession` in-process (per LENS session), via the official SDK, with a LENS-owned `ResourceLoader` and tool allow-list.** The package's own docs recommend exactly this for Node.js hosts ("consider using `AgentSession` directly … instead of spawning a subprocess"). RPC-over-stdio is the fallback for isolation hardening later, not the starting point.

This is not a new dependency: `@earendil-works/pi-coding-agent@0.85.1` is **already installed** in `frontend/` (vendored to `dist-electron/vendor/pi/` for the tool bridge; the full package with `dist/` ≈ 19 MB is in node_modules). The engine currently uses only `pi-agent-core` + `pi-ai`; the hosting step activates the `pi-coding-agent` layer that ships alongside them.

## Findings

### 1. Runtime shape — three hosting options, one recommended

| Option | What | Fit |
|---|---|---|
| **`AgentSession` in-process (SDK)** | `createAgentSession({ sessionManager, modelRuntime, tools, cwd, agentDir })` in the Electron main process | **Recommended.** Same process as the engine → direct `LiveEvent` bridging, no protocol layer, in-memory sessions. |
| RPC mode (`pi --mode rpc`) | JSONL commands (`prompt`/`steer`/`abort`/`get_state`…) + async events over stdio | Fallback for crash/isolation hardening. Framing is strict LF JSONL (Node `readline` is non-compliant — must hand-split). |
| `pi-agent-core` loop only (today's pi adapter) | Raw `agentLoop`/`Agent` + hand-rolled everything | What LENS does now; leaves session/compaction/steering/retry to be re-built by hand. |

Third-party evidence the architecture fits: Eleiris AI chose pi-agent-core over LangGraph precisely because "a durable orchestration layer sits above the agent" and pi is "deliberately just the agent turn" — with `beforeToolCall`/`afterToolCall` hooks and JSON-serializable context. LENS's Parent/Researcher loops are exactly such an orchestration layer.

### 2. The event stream is the observability backbone — already Antigravity-shaped

`session.subscribe()` delivers: `agent_start`/`agent_end`, `turn_start`/`turn_end`, `tool_execution_start`/`tool_execution_update`/`tool_execution_end` (tool name, streaming output, `isError`), `message_update` (`text_delta`, `thinking_delta`), `queue_update`, `compaction_*`, `auto_retry_*`. Event-level granularity (no internal token noise unless wanted) maps 1:1 onto the workspace's per-agent activity cards, tool-call chips, and failure states. This is the Agentic Search data source.

### 3. Tools & sandboxing — allow-list at session creation

- `createAgentSession({ tools: [...] })` — LENS runs Agentic Search sessions with **only** its research tools (`web_search`, `source_check`, `fetch_content`, `get_search_content` + `todo`). The coding tools (`read`/`write`/`edit`/`bash`) are simply never granted. This is the primary sandboxing control and it is a first-class constructor option.
- All retrieval tools already route through the vendored pi-web-access plane behind LENS's gate + ledger (ADR-0013) — the SSRF/budget/ledger boundary survives the runtime swap because the tools themselves stay LENS-wrapped.
- `beforeToolCall`/`afterToolCall` hooks available for policy checks if deeper interception is needed.

### 4. Credentials & models — clean LENS-settings integration

`ModelRuntime` auth priority: runtime overrides (`setRuntimeApiKey`, **not persisted**) → `auth.json` → env vars → fallback resolver. LENS Settings keys can ride as runtime overrides per session — no `~/.pi/agent/auth.json` writes, no disk leakage. `InMemoryCredentialStore` injection supported. Custom `models.json` path supported (`modelsPath`), so LENS's model catalog can feed Pi's model resolution. `PI_OFFLINE` disables catalog network access — set it; LENS already provisions providers itself.

### 5. Resource discovery — point `agentDir` at LENS, not `~/.pi`

`DefaultResourceLoader` discovers extensions/skills/prompts/context from `cwd` + `agentDir`. LENS already keeps skills in `.agents/skills/` (which Pi discovers natively) — but the engine must set `agentDir` to an **app-data directory** so Pi's global discovery, settings, sessions, and credentials never collide with a user's real `~/.pi/agent`. A custom `ResourceLoader` removes discovery surprises entirely if needed.

### 6. Packaging & compatibility

- **ESM-only** (exports carry only `import` conditions) — the CJS engine loads it via dynamic `import()`; precedent exists (`piShim.mjs`, the pi-ai adapter's ESM shim). The vendor script already copies `.ts` sources for jiti; hosting uses the real `dist/` — no transpile needed.
- `engines.node >= 22.19.0`; Electron 44 bundles Node 24.20 ✓ (ADR floor already satisfied).
- dist ≈ 19 MB — the NSIS installer grows by ~19 MB uncompressed (compresses substantially; current installer is 177 MB). Acceptable; no native modules in the dep list (`chalk`, `jiti`, `undici`, `yaml`, `typebox`, `proper-lockfile`, `cross-spawn` — all pure JS).
- electron-builder packaging: the package is already in `dependencies` → ships in `node_modules` of the asar as today; `proper-lockfile`/`cross-spawn` are unpacked-asar candidates to verify at build time.

### 7. What stays LENS-owned (boundary clause, unchanged)

Evidence admission, dedupe, budgets (session budget, fetch ledger), telemetry boundaries, evidence preservation, credibility scoring, plan approval invariant (Deep Research only), and the LiveEvent backbone. Pi hosts the loop/sessions/steering/compaction/retry; LENS owns the research domain. `AgentSession` state is plain JSON (`state.messages`) — session persistence/telemetry stays under LENS control.

### 8. What LENS gets for free by hosting the real runtime

Steering + follow-up queueing mid-run (`steer()`/`followUp()` — Antigravity-style user redirection), automatic context compaction for long agentic sessions, auto-retry with backoff on transient provider errors, session trees (fork/branch), and the extension API (`sendMessage`, custom commands) — all previously deferred as "needs a real pi-coding-agent host" (the pi-subagents deferral).

## Recommended hosting architecture (contract for the Agentic Search spec)

1. One `AgentSession` per Agentic Search conversation turn-group, `SessionManager.inMemory()` unless transcript persistence is specced.
2. Tools: LENS research tools only (allow-list at construction), each already gate+ledger wrapped.
3. `ModelRuntime.create({ PI_OFFLINE: true })` per engine boot; keys via `setRuntimeApiKey` from LENS settings; model catalog bridged from LENS's own.
4. `agentDir` → `app.getPath('userData')/pi-agent` (never `~/.pi`).
5. Event bridge: `session.subscribe` → `LiveEvent` (`agent_start/end` → agent-card lifecycle; `tool_execution_*` → tool chips; `message_update.text_delta` → report stream; `auto_retry_*`/errors → failure states).
6. Deep Research keeps LENS-native orchestration (Parent/Researcher) until its migration ticket, then re-hosts each researcher as an `AgentSession` — parity-gated via the ADR-0011 harness.

**Risks**: ESM/dynamic-import edge cases in the packaged asar (mitigate: verify in the built installer, unpacked-asar if needed); unanswered upstream question on high concurrency (irrelevant at desktop scale); Pi 0.x churn (pin exact versions, as LENS already does).
