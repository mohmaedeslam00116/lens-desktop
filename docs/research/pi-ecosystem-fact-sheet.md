# Research: pi-ecosystem package fact-sheet

**Issue**: [#81](https://github.com/mohmaedeslam00116/lens-desktop/issues/81) · **Labels**: `wayfinder:research` · **As of**: 2026-09-13
**Method**: npm registry metadata + package tarball sources (downloaded and inspected, versions pinned below) + LENS engine source. Every claim below traces to one of those three primary sources; no secondary blogs or summaries were used.

## Verdicts at a glance

| Package | Version | License | Runtime shape | Verdict for LENS |
|---|---|---|---|---|
| `pi-web-access` | 0.29.0 | MIT | In-process Pi extension (registers 4 agent tools) | **Needs adaptation** — in-process-compatible, but expects the pi-coding-agent extension host LENS does not embed |
| `pi-subagents` | 0.67.0 | MIT | Foreground: in-process child Pi sessions; background: **detached runner process** | **Mostly violates the hard rule** — background mode is an external runtime; foreground is coupled to the full Pi host; adapt the *vocabulary*, not the package |
| `@juicesharp/rpiv-todo` | 2.10.0 | MIT | In-process Pi extension (`todo` tool, zero disk writes) | **Needs adaptation** — the schema + snapshot envelope are directly adoptable; the tool itself needs the extension host |
| `billion-context` | 0.1.107 | MIT | **Separate localhost HTTP proxy process** (not a library) | **Needs adaptation** — no in-process library entry point; usable as a host-supervised child proxy on the model wire |

---

## 1. pi-web-access (0.29.0)

**Facts** (registry + tarball `package.json`, `README.md`, `LICENSE`):
- Author Nico Bailon; repo `github.com/nicobailon/pi-web-access`; latest 0.29.0 published 2026-09-10. **MIT**.
- Runtime shape: a **Pi extension** (`pi.extensions: ["./index.ts"]`) loaded **in-process** into a Pi agent host. It registers four agent tools — `web_search`, `fetch_content`, `get_search_content`, `source_check` — plus slash commands (`/websearch`, `/curator`, `/search`) and an activity monitor. It is **not** a CLI extension and **not** a standalone library API: the tools exist only inside an agent tool loop that the extension host drives.
- **API surface** (README "Tools"):
  - `web_search({ query | queries, numResults, recencyFilter, domainFilter, provider, includeContent, workflow, proxy })` — provider fan-out with fallback chain (`searchRouting.providers`, `fallbackOn: transient|quota|network|invalid-response`), returns a synthesized answer with source citations; `provider: "all"` runs every eligible provider in parallel.
  - `fetch_content({ url, prompt, timestamp, frames, auth, proxy })` — URL fetch with content-type dispatch (see below).
  - `get_search_content` — offset/window reads into previously fetched documents (keeps big pages out of context).
  - `source_check` — claim-vs-source verification.
- **Provider configuration** (~25+ search providers): OpenAI/Codex, Brave, Parallel, TinyFish, Search1API, Searchinfinity, Querit, Tavily, Firecrawl, Jina, SERPdive, Kagi, Bocha, Ollama, AnySearch, XCrawl, Valyu, xAI/Grok, Mistral, Bright Data SERP, SerpBase, SerpApi, Serper, self-hosted SearXNG, keyless DuckDuckGo, Exa, Perplexity, Gemini API/Web, Kimi. **API keys are per-provider**, stored in `~/.pi/agent/web-search.json` (respects `PI_CODING_AGENT_DIR`). Three keyless paths exist: Exa MCP (zero-config), DuckDuckGo HTML (explicit-only), and OpenAI search reusing an existing Codex login.
- **Extraction**: local Readability/defuddle/turndown first; blocked-page fallbacks are *self-hosted* Firecrawl/Crawl4AI, Jina Reader; third-party hosted extractors are **disabled unless `fetchRouting.allowRemoteHostedProviders: true`** (SSRF-defensive default). PDFs → Markdown via unpdf/Datalab/Gemini saved to a temp `pi-web-pdf` dir; YouTube → Gemini Web → Gemini API → Perplexity; GitHub URLs → **local clone** (≤350MB, `gh` CLI for private repos) instead of scraping; SSRF guard on all outbound targets (`ssrf-protection.ts`); per-call `proxy` support.
- **Dependencies**: runtime — `@mozilla/readability`, `defuddle`, `linkedom`, `p-limit`, `promise.try`, `turndown`, `typebox`, `unpdf`, `undici`. **Peer (non-optional)**: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.

**Integration path for LENS**: LENS embeds only `@earendil-works/pi-agent-core` + `pi-ai` (`frontend/package.json`) — not the pi-coding-agent extension host nor pi-tui. Two options: (a) embed the extension host so `pi.extensions` load natively (heavier, brings pi-tui along), or (b) **lift the provider/extraction modules** (they are plain TypeScript over `undici`, with their own SSRF guard) behind LENS's own tool registrations. Either way it runs **in-process** — no external runtime. This could replace the engine's hand-rolled search provider plumbing with a fallback-chained, multi-provider search + extraction layer.

**Risks**: single-maintainer package; fast-moving (38 releases since Jan 2026); GitHub cloning requires `gh` CLI for private repos; the non-optional pi peers make "install and load" impossible without the host (hence the adaptation verdict).

---


## 2. pi-subagents (0.67.0)

**Facts** (registry + tarball `README.md`, `docs/*.md`, `LICENSE`):
- Author Nico Bailon; repo `github.com/nicobailon/pi-subagents`; latest 0.67.0 published 2026-09-10. **MIT**.
- **Delegation model**: the parent Pi session gets a `subagent` tool. A subagent is a **focused child Pi session with its own job**. *Foreground* children "run as sessions inside the parent Pi process" (in-process); *background* children "run as sessions inside a **detached runner process**" (`README.md` §How it works) — a spawned external Node process.
- **What a child receives** (`docs/agents.md`, `docs/tool-reference.md`): an agent definition (markdown + frontmatter: `description`, `systemPrompt`, tool/extension **allowlist**, skills, per-agent **model**, effort level, `timeoutMs`, per-agent persistent memory), the task prompt, a context mode (`fresh` or `fork` — `defaultSubagentContext`/`forkContext` config), and budgets (tool budget, usage budget, structured output). Builtins: `scout`, `researcher`, `evidence-auditor`, `worker`, `reviewer`, `oracle`, `delegate`.
- **Streaming/progress**: foreground runs stream in-conversation; background runs surface through FleetView / fleet inspector (TUI), **lifecycle artifacts on disk**, and an **in-process event-bus RPC** (`subagents:rpc:v1:ready|request|reply:<id>`; methods `ping`, `status`, `manage`, `spawn`, `steer`, `interrupt`, `stop`, `resume`; capability advertisement on `ping`). The RPC is explicitly **process-local**: "It does not reach separate Pi processes or child subagents; use the file lifecycle artifacts or `pi-intercom` for cross-process coordination" (`docs/extension-api.md` §Scope).
- **Concurrency control**: `globalConcurrencyLimit` (default **20** simultaneous children per run), `maxSubagentSpawnsPerRun` (default **64** cumulative admissions per run tree), `maxSubagentSpawnsPerSession`, opt-in `maxActiveAsyncRunsPerSession`, 30-min default run deadline, per-tool hard timeouts.
- **Dependencies**: runtime — `jiti`, `yaml`, `acorn`, `undici`, `typebox`, **`@earendil-works/pi-server@0.85.0`**. Peers (all optional): pi-ai, pi-tui, pi-agent-core, pi-coding-agent.

**Integration path for LENS**: LENS's hard rule is "no external agent runtime". Background mode **spawns detached processes** — an external runtime by any reading. Foreground mode is in-process but rides the full Pi coding-agent host (child *Pi sessions*, TUI fleet), which LENS does not embed; LENS embeds only `pi-agent-core`. The honest verdict: **do not adopt the package**; adopt the *vocabulary* — the multi-lane delegation semantics, budget caps, fork-vs-fresh context, and the `runs.run({ agent, task })` structured-spawn shape map cleanly onto spawning additional in-process `pi-agent-core` Agent instances from the engine, which satisfies the hard rule by construction.

**Risks**: `@earendil-works/pi-server` runtime dependency pulls a server runtime into the host; the detached background runner and its process-terminal-proof bookkeeping (#1030) is exactly the class of external process the hard rule forbids; heavy surface (325 files) with TUI assumptions throughout.

---

## 3. @juicesharp/rpiv-todo (2.10.0)

**Facts** (registry + tarball `README.md`, `docs/tool-schema.md`, `LICENSE`):
- Author juicesharp; repo `github.com/juicesharp/rpiv-mono` (`packages/rpiv-todo`); latest 2.10.0 published 2026-09-12. **MIT**.
- **Task shape** (`docs/tool-schema.md`): `todo` tool with actions `create | update | list | get | delete | clear`. Task = `{ id: number, subject, description?, activeForm?, status: "pending"|"in_progress"|"completed"|"deleted", blockedBy?: number[], owner?, metadata? }`. **Dependencies are first-class**: `blockedBy` edges validated *before* mutation — unknown ids, tombstoned deps, self-blocks, and cycles are all rejected. Explicit status machine (`completed` can only go to `deleted`; `deleted` is a terminal tombstone so historic edges still resolve); idempotent no-op updates are reported as such.
- **State storage**: **session-scoped and keyed by session** — "a detached or child session can neither read nor overwrite the foreground list". **Zero disk writes**: every successful tool result's `details` envelope carries the *complete post-mutation snapshot*, and state is rebuilt by walking the session branch and taking the last snapshot — which is how tasks survive `/reload` and compaction. The only file it touches is an optional read-only config.
- **External exposure without the Pi UI**: the `details.tasks` snapshot rides the standard tool-result envelope, so any host observing `tool_execution_end` events has the full task list after every mutation; a late joiner replays the branch. The TUI overlay is pure presentation — headless runs "still get the `todo` tool; nothing is rendered".
- **Dependencies**: `typebox`, `@juicesharp/rpiv-config`; peers pi-ai, pi-tui, pi-coding-agent (`rpiv-i18n` optional).

**Integration path for LENS**: the tool *registration* is Pi-extension-host-coupled (and the overlay is pi-tui), so loading it as-is needs the host LENS lacks. But the surface is tiny, fully documented, and I/O-free: LENS can adopt the **exact schema and snapshot-in-`details` envelope** as an in-process engine tool and map `details.tasks` onto a `LiveEvent` (the `piEventAdapter` already owns that seam). Compaction survival comes free — the snapshot lives in the conversation itself, matching LENS's own approved-plan frozen-trajectory pattern.

**Risks**: minimal. Single-maintainer; version 2.x churn (30+ releases in five months); the schema documentation, not the code, is the primary value for LENS.

---


## 4. billion-context (0.1.107) — CRITICAL

**Facts** (registry + tarball `README.md`, `LICENSE`, `dist/` bundle inspection):
- Author ranxianglei; repo `github.com/ranxianglei/billion-context`; latest 0.1.107 published 2026-09-12. **MIT**. **Zero runtime dependencies** (everything, including `acp-kernel`, is bundled); Node ≥ 20.
- **Can it run in-process as a library? — No.** The bundle is a CLI: `dist/index.js` self-invokes `main()` (spawn server, launch, or update commands); `startServer()` is internal and **not exported**. The shipped binaries are `bili` / `bili-proxy`, both of which end in `http.createServer(...)` + `server.listen(port, ...)` (verified in the bundle). There is **no library entry point** to wrap the model call inside the Electron main process.
- **What it is**: a **localhost HTTP proxy** that sits between agent and model API. It parses Anthropic/OpenAI-shaped requests, runs `acp-kernel` compression on the conversation, injects four context tools (`compress`, `decompress`, `search_context`, `acp_status`) plus an opt-in fifth (`absorb`, per-result compression), forwards to the real API, and rewrites the streaming response.
- **Modes**: *plugin/launcher mode* (`bili pi`, …) — the ACP-native agent registers the tools natively and executes `compress` itself; the client-side plugin (`dist/agent/pi.js`) detects the proxy via a `/bili/`-prefixed base URL or `BILLION_CONTEXT_PROXY` env and registers a provider pointing at it, file-free. *Proxy mode* — any client prefixes its base URL: `http://localhost:8787/bili/https://api.openai.com/v1`; the proxy executes `compress` server-side and carries summaries as an `acp_summary` **user** message (re-voiced from `system` so strict single-system backends like SGLang don't 400, and so the prefix-cache anchor stays byte-stable).
- **Compression strategy**: incremental, **reversible folding** — consumed ranges are folded into layered summaries written in small ranges; originals are cached in `blockContents` and can be decompressed on demand (`bili export --full` recovers the full history). **Prefix-cache friendly**: the head system message is kept byte-stable across compress turns so a new block never invalidates the whole-conversation prefix; sticky session routing synthesizes `x-session-id`.
- **Evidence-preservation semantics**: nothing is destroyed — compressed originals persist per session under `%USERPROFILE%\.local\share\billion-context\` (block summaries + `blockContents` + a bounded ~16k-token folded tail; the raw full history is never duplicated). Per-message refs use a stable content fingerprint; the README states the worst case of session-id collisions is "reduced compression efficiency, never data loss".
- **LENS fit against the hard rule**: it is *not* an agent runtime — no agent loop, no tool host beyond the injected context tools, no process supervising the agent. It is a stateful wire transformer. But it **cannot be in-process**: LENS would have to spawn and supervise a localhost proxy child process and point `PiAdapter`'s provider `baseUrl`s at `/bili/<upstream>` (the adapter's provider factories already take a `baseUrl`, so this is the natural seam). LENS must also pass an explicit `x-acp-session` header per conversation: the README flags that **pi sends no session id**, causing collision risk for concurrent conversations.

**Risks**: explicitly early ("Protocol handling and compression work against mock tests (500+ passing). Real-model integration testing is the next milestone."); `autoUpdate` defaults on (must disable for a packaged desktop app); Windows-specific EPERM hazard — antivirus/indexer/OneDrive locking the sessions dir (#362) with documented exclusions required; a stateful middlebox on every model call adds a failure mode (its health/stats endpoints `__bili/health`, `__bili/stats` help, but LENS would need a bypass path when the proxy is down); MITM/CA machinery exists for launcher modes (not needed for URL-prefix mode, but present in the dependency tree).

**Verdict**: **needs adaptation** — technically usable under the hard rule only in the narrow sense that it is not an agent *runtime*; it does require a separate, host-supervised proxy process on the model wire. Given its pre-1.0, mock-tested status, recommend treating it as an experiment behind a settings flag, never the default path.

---

## Recommendation summary

1. **Adopt the rpiv-todo schema** as an in-process engine tool (cheap, immediate, fits ADR-0009's seams) — adaptation, not installation.
2. **Pilot pi-web-access via module-lift** (option b) to consolidate the engine's hand-rolled provider plumbing behind its fallback-chained search + extraction tools — in-process, MIT, no hard-rule tension.
3. **Do not adopt pi-subagents**; carry its delegation vocabulary (budgets, fork/fresh context, structured spawn) into in-process `pi-agent-core` Agent fan-out.
4. **Defer billion-context** behind an opt-in experimental flag if long-session context pressure becomes measurable; it requires a supervised proxy child process and carries real pre-1.0 risk.

## Sources

- npm registry metadata for `pi-web-access@0.29.0`, `pi-subagents@0.67.0`, `@juicesharp/rpiv-todo@2.10.0`, `billion-context@0.1.107` (queried 2026-09-13; versions pinned, tarballs downloaded via `npm pack`).
- Tarball sources: `package.json`, `README.md`, `LICENSE`, `docs/` of each package (pi-subagents `docs/tool-reference.md`, `docs/agents.md`, `docs/extension-api.md`, `docs/configuration.md`; rpiv-todo `docs/tool-schema.md`; billion-context `README.md`, `dist/index.js`, `dist/agent/pi.js`).
- LENS: `frontend/package.json` (pi deps: `@earendil-works/pi-agent-core@0.85.1`, `pi-ai@0.85.1` only), `frontend/electron/engine/modelGateway.ts`, `frontend/electron/engine/piAdapter.ts`, `frontend/electron/engine/piEventAdapter.ts`.
