# Architecture Map — Retrieval in Agentic Search & Deep Research (v1.5.0)

Status: **recorded, not yet migrated**. This map is the pre-implementation
record for the Pi-owned retrieval migration (12-item brief). Every claim
below was verified against `main` at v1.5.0 (`bd11a36`) — file:line cited,
no wording patches proposed.

## 1. Real runtime path — Agentic Search

`POST /api/agent/start` → search HTTP, per hop:

1. `server.ts:1190` handler parses `AgenticStartRequest`
   (`server.ts:136-142`): `{ question, provider?, max_fetches?, model_name? }`.
   **No `search_provider`.** `provider` is the **LLM** provider
   (`normalizeAgentStartRequest`, `server.ts:145-155`, default `google`).
2. `startAgenticSearchSession` (`server.ts:277-324`) wires the tool surface
   with `search: (query) => primarySearchPlane(query)` (`server.ts:292-295`)
   — **provider defaults to `'duckduckgo'`, `maxResults` 8**
   (`searchPlane.ts:347-352`).
3. `createAgenticResearchSession` → `agentSessionHost.createResearchSession`
   with `ModelRuntime.create({ allowModelNetwork: false,
   authPath, modelsPath })` (`agentSessionHost.ts:180-195`) and
   `createAgentSessionFromServices({ customTools,
   noTools: 'builtin', resourceLoaderOptions: { noExtensions: true,
   noSkills: true, noContextFiles: true } })`
   (`agentSessionHost.ts:382-395`).
4. `runAgenticSearch` → `session.prompt(question)` (`agenticSearch.ts:326`).
5. `web_search({ query })` — the **only** search schema
   (`agenticSearch.ts:140-151`, `properties: { query }`,
   `required: ['query']`) → `context.search(query)` → `primarySearchPlane`
   → `serveThroughPlane` (gate + ledger, `searchPlane.ts:221-236`) →
   `loadPlaneResolver` (`searchPlane.ts:195-217`) jiti-loads the **vendored
   `web-access/duckduckgo.ts`** → live HTTP against `html.duckduckgo.com`.
   Keyed Tavily/Serper only when a key is configured (`searchPlane.ts:255-341`).
6. `fetch_content({ url })` (`agenticSearch.ts:182-194`) → `claimAndShare`
   (fetch ledger) → `primaryScrapePlane` (`scrapePlane.ts:227-278`) →
   vendored `web-access/extract.ts`.

Net: **the user's `search_provider` setting never reaches Agentic Search.**
The setting flows only into `/api/research/start`
(`App.tsx:699`, `wideAgent.ts:179`). Agentic Search is DuckDuckGo-first by
construction, regardless of what Settings shows.

## 2. Real runtime path — Deep Research

Standard loop (`agent.ts:107+`): subqueries → `primarySearchPlane(subq, …,
6)` (`agent.ts:321`) → `ingestHits` → `claimAndShare` → `scrapedSources`
→ optional embedding rank (`agent.ts:454-479`, skipped when zero sources)
→ `evidenceText || fallbackEvidence(...)` (`agent.ts:500-510`) →
**unconditional** `generate(...)` (`agent.ts:587-600`) → citation sanitize
→ advisory audit → `finished`. Researcher fan-out (`researcherAgent.ts`)
and wide mode (`wideAgent.ts`) ride the same planes; `wideAgent` still
synthesizes on `evidence = []` (`wideAgent.ts:315-320`).

The vendored extension's real 4-tool surface (`web_search`,
`fetch_content`, `source_check`, `get_search_content` —
`piResearchTools.ts:43-46`) loads **only** on the opt-in researcher path
(`agent.ts:138`). The agentic path never calls `buildResearchPackageTools`.

## 3. Root cause of stale Gemini results (4-link chain)

1. **Retrieval is date-blind.** No `recency`/`freshness`/`temporal`/
   `publishDate`/`domainFilter` logic exists anywhere in retrieval or
   synthesis (grep-verified; `numResults` is plumbing only).
   `SourceItem` carries **no publication/update timestamp field at all**
   (all `updatedAt` hits are session bookkeeping). DDG snippets arrive
   without dates, and nothing retains or inspects them downstream.
2. **No provider-native grounding.** `piAdapter.ts` has zero grounding /
   `web_search` / Responses-API usage (grep-verified), and the pinned
   `pi-ai@0.85.1` exposes **no search-grounding API in `dist`**
   (grep-verified). A Gemini (`google`) run therefore answers current-events
   questions from parametric knowledge up to its training cutoff.
3. **Synthesis covers for missing evidence.** On zero evidence the standard
   loop substitutes `'No external evidence retrieved. Synthesize an
   exhaustive report based on verified knowledge.'` (`agent.ts:576-583`)
   and generates unconditionally; `HierarchicalSynthesis` has no abstain
   branch, and its offline fallbacks emit authoritative prose with
   fabricated `[1]` brackets (`synthesis.ts:1397-1487`, `:1371-1395`).
   `verifyAndSanitize` strips bad brackets but never marks
   unsupported/uncertain (`synthesis.ts:366-612`).
4. **No test can catch it.** Zero freshness/date/provenance tests exist
   (grep-verified in `frontend/test`); the suite asserts text shapes, never
   returned dates or provider provenance.

Any one link suffices for a stale-but-authoritative dossier; all four are live.

## 4. Why 40 Pi providers become 8 visible

- The Pi snapshot lists **40 providers, 39 with models** (measured live
  via `getPiCatalogSnapshot` on a clean agent dir at v1.5.0).
- `SettingsModal.tsx:112` hardcodes `SUPPORTED_PI_IDS` to 8 ids
  (`google, openai, anthropic, groq, deepseek, openrouter, mistral, ollama`).
- Pills iterate the allowlist, not the catalog (`SettingsModal.tsx:561-563`);
  a Pi id outside the list can never render (`:563` returns null), and
  `current.llm_provider` can only be set from allowlisted pills, the
  palette, or legacy migration. The renderer type `LLMProvider`
  (`types/index.ts:5`) repeats the same 8.
- Companion staleness: footer hardcodes `v1.0.0` (`SettingsModal.tsx:514-517`);
  the Search tab exposes only `duckduckgo/tavily/serper`
  (`SettingsModal.tsx:1167-1170`, type at `types/index.ts:272`); the palette
  omits `mistral` and `serper` (`CommandPalette.tsx:31,35`).

## 5. Upstream evaluation (2026-10-02)

- **Vendored `pi-web-access` is 0.29.0; upstream latest is 0.35.0**
  (repo `nicobailon/pi-web-access`). The 0.35 surface already implements the
  demanded modern contract: `query`/`queries`, `provider`, `numResults`
  (default 5, max 20), **`recencyFilter` (`day/week/month/year`)**,
  **`domainFilter` (± excludes)**, `includeContent`, `workflow: 'none'`
  (raw results, provider identified per query, **no summary model call**),
  plus `source_check` (claim → `supported/contradicted/unclear/
  missing-evidence` artifact with hashes — no auto semantic inference),
  `get_search_content` (paged stored-content retrieval), and
  `searchRouting` with **`useCurrentModel`** (active-model-aware OpenAI
  Hosted search), ordered fallback chains (`fallbackOn`), and 25+ search
  providers (OpenAI/Codex incl. subscription auth, Brave, Exa incl.
  zero-config MCP, Parallel, TinyFish, Search1API, Searchinfinity, Querit,
  Tavily, Jina, Kagi, Gemini API, Mistral, xAI, Ollama, SearXNG, keyless DDG…).
- **`pi-search` (npm) is not viable**: v1.0.0 placeholder, description
  `## seq6-p0`, no extension surface. Dropped from the plan.
- **Compat notes**: 0.35 README requires Pi ≥ v0.37.3-era APIs; its devDeps
  pin `@earendil-works/*@0.86.1` while LENS pins `0.85.1` — the upgrade
  ticket must prove extension-module compat (jiti-load + tool-call shape)
  against 0.85.1 first, and bump Pi packages only if the suite demands it.
- **Policy boundary the upgrade must keep**: LENS refuses
  `fetch_content mode: 'answer'` (ADR-0013 D3; synthesis stays
  Parent-owned) and the extension must run at `workflow: 'none'`
  (no curator, no summary model, no answer model) — Pi owns mechanism,
  never synthesis. LENS keeps: SSRF preflight + private-range blocking,
  URL canonicalization/dedupe, plane gate + ledgers, session fetch budgets,
  telemetry events, citation grounding/sanitization, and the new
  abstention/uncertainty surfacing. The extension's own SSRF guard and
  `fetchRouting.allowRemoteHostedProviders: false` default stay on as
  defense in depth, never as the primary gate.

## 6. Proposed post-migration path (tracks → brief items)

- **Track A — catalog-driven Settings (item 1)**: delete `SUPPORTED_PI_IDS`
  and `LLMProvider`'s closed union; pills/key-slots/console-links derive
  from `GET /api/pi/providers` + `/api/pi/auth-status` (unknown ids render
  with a generic console-link fallback, never dropped). Footer reads the
  app version + engine identity (no hardcoded `v1.0.0`). Search tab lists
  the extension's eligible search providers from a new
  `GET /api/pi/search-providers` route (Pi truth, not 3 hardcoded ids).
- **Track B — search-provider plumbing (item 2)**: `AgenticStartRequest`
  gains `search_provider`; `startAgenticSearchSession` threads it into the
  tool surface; Deep Research keeps its existing field. Renderer sends the
  setting on both starts. Guard test: agent start with `tavily` setting and
  no key falls back per routing and the test observes the fallback.
- **Track C — vendor upgrade + mechanism swap (items 4, 5, 6)**:
  vendor `pi-web-access@0.35.x` (update `vendor-pi-packages.mjs` module
  list — the 0.35 `index.ts` registers 4 tools, not loose modules);
  `searchPlane`/`scrapePlane` call the extension modules
  (`web_search` with provider/recency/domain/includeContent,
  `fetch_content` readable/raw only, `get_search_content`,
  `source_check`) inside the existing LENS gates/ledgers. DDG becomes the
  last keyless fallback, not the default engine. `useCurrentModel` routes
  GPT-subscription sessions to Hosted search; Gemini/Mistral/xAI sessions
  route to their extension providers with Pi-stored keys. Extension-host
  loading (`noExtensions`) stays off for sessions — mechanism comes
  through audited module calls, not ambient extension discovery.
- **Track D — honest tool surface (items 3, 7)**: `web_search` exposes the
  full upstream contract (`query/queries, provider, numResults,
  recencyFilter, domainFilter, includeContent`); `fetch_content` exposes
  `url/urls, mode (readable/raw — `answer` refused), prompt/timestamp for
  video`; add `get_search_content` (paged retrieval) and `source_check`
  (claim-evidence artifact) tools with LENS budget/ledger wrapping, or
  record an ADR removing `source_check`/`get_search_content` from
  `RESEARCH_TOOL_ALLOW_LIST`. No misleading names survive either way.
- **Track E — freshness semantics (item 8)**: temporal-intent detection
  (latest/current/today/breaking/`new model`/announcement patterns,
  bilingual), provider-side `recencyFilter` application, date-aware query
  variants, `publishedAt` retention on admitted sources (new optional
  field, never breaking the shape), stale-result penalization in ranking,
  and claim-level support verification via `source_check` before citation.
- **Track F — adversarial freshness tests (item 9)**: live-keyed tests
  asserting dates + provider provenance (not text): current model
  announcements per provider, today's news, historical controls, official-
  source requests, conflicting sources, stale high-ranking results. Live
  tests gate on key presence (skip loudly without keys — never fake green).
- **Track G — evidence honesty (items 10, 11)**: zero-evidence and
  unresolved-conflict runs surface `unsupported`/`uncertain` instead of
  synthesizing dossiers — standard loop, `HierarchicalSynthesis`, and wide
  mode all gain the abstain branch; the empty-evidence prompt substitution
  (`agent.ts:576-583`) and fabricating fallbacks
  (`synthesis.ts:1371-1487`) are deleted, with regression tests proving a
  no-evidence run cannot emit an authoritative report.

## 7. Validation + blockers

- Offline gates (this machine): typechecks, full suite (incl. new
  date/provenance/admission/abstention tests), renderer build, parity
  harness (retrieval-mechanism change must keep all four stage semantics).
- **Live gates need provider keys: none are present here**
  (`GEMINI/GOOGLE/OPENAI/ANTHROPIC/XAI/GROQ/DEEPSEEK/MISTRAL/OPENROUTER/
  TAVILY/SERPER` all absent; Ollama `ECONNREFUSED`). Keyless DDG probes can
  run here; keyed-provider and native-routing validation needs keys on the
  operator's machine (wizard handoff at implementation time — keys are never
  pasted into chat or committed).
- No prompt-wording or filter-only patches: every track above moves the
  mechanism (routes, schemas, storage, gates) with tests that fail while
  the old path lives.

## 8. Open decisions (for spec/tickets)

1. Pi packages 0.85.1 → 0.86.x: upgrade only if the 0.35 module
   integration proves incompatibility (suite decides).
2. `web-search.json` location/sync vs LENS `web-search.json` write-through
   (`configSeam`): extend the seam to the 0.35 schema or keep LENS-owned
   provider keys with per-call injection (watch: upstream `$NAME`/`!cmd`
   credential sources and `openaiUseProviderBaseUrl`).
3. Curator UI (`/websearch`, activity monitor): permanently off
   (`workflow: 'none'`, `toolActivation` scoped) — headless engine has no
   interactive curator; record as ADR.
4. `source_check` in the agentic loop vs Deep Research only (cost/latency).
