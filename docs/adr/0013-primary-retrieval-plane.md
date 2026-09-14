# ADR-0013: pi-web-access as the Primary Retrieval Plane

**Status:** Accepted
**Date:** 2026-09-14
**Decided in:** [Primary-plane boundary ticket #107](https://github.com/mohmaedeslam00116/lens-desktop/issues/107) (nine decisions locked); first implemented in ticket #109.
**Builds on:** ADR-0010 (research agency), ADR-0011 (parity regression harness), ADR-0012 (agency default flip).

## Context

Phase 5 of ADR-0010 calls for replacing LENS-native research tools with Pi Agent
extensions wherever the Pi ecosystem provides the corresponding capability,
while LENS-owned evidence contracts (evidence admission, dedupe, budgets,
telemetry boundaries, evidence preservation) remain authoritative. The
[source-level parity audit](https://github.com/mohmaedeslam00116/lens-desktop/issues/108)
of the vendored pi-web-access 0.29.0 found no blocking risks: telemetry-zero,
MIT, graceful failure modes, and a DuckDuckGo provider whose request URL and
HTML parsing are wire-compatible with the native implementation.

## Decision

**pi-web-access is LENS's primary retrieval plane. LENS remains authoritative
for evidence admission, dedupe, budgets, telemetry boundaries,
concurrency/fetch controls, and evidence preservation.**

The boundary was locked as nine decisions:

1. **Swap unit — sequenced both.** The *provider-seam swap* is the expand
   step: pi-web-access serves retrieval behind the engine's existing search
   seam (the injected search function), so the tool contract and page/evidence
   structures are preserved while what sits behind the seam changes. The
   *tool-plane migration* (researchers retrieving via direct tool calls
   through the bridge) is a later increment.
2. **Primary provider — DuckDuckGo keyless.** Zero-config parity keeps the
   swap mechanical and the harness deterministic. A settings →
   `web-search.json` write-through makes keyed providers opt-in (#112).
3. **`fetch_content` answer-mode — explicitly unsupported.** It requires a
   model and would split synthesis ownership, which stays exclusively with the
   Parent Research Agent. The bridge returns graceful guidance text.
   Consequence: under LENS, pi-web-access makes **zero LLM calls**.
4. **Retirement order — search first.** Native search provider modules retire
   at the contract step immediately after the expand merges; the native
   scraper stays for its own harness-gated increment (evidence admission,
   dedupe, budget ledger, snapshot wrapping, and provenance semantics operate
   on the LENS page structure).
5. **Seam wrapping — non-negotiable.** All pi-web-access outbound traffic is
   covered by LENS's fetch ledger, scrape pool, concurrency caps, budgets, and
   telemetry boundaries. **No unledgered retrieval is allowed.**
6. **Fixture evolution — stub the plane, keep the stages.** Parity-harness
   fixtures stub pi-web-access provider endpoints with the same golden
   content; all four stage semantics stay strict (coverage ≤ 0.05, grounding
   exact, admission sets exact, sequence byte-equal). Admission is never
   relaxed to superset semantics.
7. **Config seam — its own ticket** (#112), sequenced after the swap by review
   preference only; the harness stubs endpoints, so it gates nothing.
8. **Contract-step gating — no soak.** The engine is the only consumer of the
   retired modules and the parity harness is the explicit gate.
9. **Recording — this ADR lands in the swap PR** with the first implementation
   that honors the boundary.

## Contract state (amended at ticket #112 — config seam, D2 complete)

The keyed provider implementations (Tavily / Serper HTTP clients) retired:
keyed search serves through the vendored providers (`searchWithTavily` /
`searchWithSerper` via jiti) under the same gate and ledger as the keyless
plane — D2's contract is complete, and `MultiSearchProvider.search` reduces
to a delegation to the plane. Provisioning:

- **LENS settings → `web-search.json` write-through** (`engine/configSeam.ts`):
  merge-on-write (vendored-managed fields like `ssrf`/`fetch` are preserved),
  empty-means-remove (clearing a key in LENS removes the field and the env
  export), and a `0o700`/`0o600` best-effort safe file. With no keys
  configured, NO file is written — zero-config parity pinned by test.
- **Immediate effect**: the seam also exports `TAVILY_API_KEY` /
  `SERPER_API_KEY` to the process environment (in-process only); the vendored
  credential resolver reads env per call, so a fresh key works without a
  restart even though the vendored module caches its config at first read.
  Key-file precedence still wins (vendored contract: config > env).
- **No-leak clause enforced**: the engine API (`/api/settings/search-keys`)
  returns only redacted summaries (`{ set, cleared }` / boolean status); warn
  paths pass errors through `redactKeyMaterial` before logging; keys never
  appear in logs or telemetry. The plane's caller-key override rides a
  one-call env set/restore.
- **Failure semantics**: a keyed vendored failure degrades to the keyless DDG
  plane (native semantic); the keyless path never re-enters the keyed path
  (terminal, no cycle); aborts and saturation propagate as before.

## Contract state (amended at ticket #111 — scrape plane)

The second increment moved page retrieval onto the plane: pi-web-access
`extractContent` (the engine of `fetch_content`) serves scrapes behind the
engine's scrape seam (`scrapeFn` / the pool's default fetcher), and the native
fetch/cheerio implementation is retired. `PageScraper.scrape` remains as a
thin static facade over `primaryScrapePlane` — the seam tests stub to inject
offline fixtures — so all three former direct-call sites (delegated loop,
researchers, `BoundedScraperPool`) route through the plane unchanged.
Boundary-preserving mappings the adapter pins:

- **SSRF validation stays ON** (hardening over the native scraper, which
  fetched any URL unvalidated): vendored `ssrf-protection` runs with its own
  DNS resolution, so private/loopback addresses are blocked before any fetch.
- **Error semantics preserved**: origin HTTP errors map to the native
  `Content unavailable from … (HTTP N).` sentinel (the pool's rate-limit
  backoff keys on it); transport failures (SSRF block, DNS, timeout) throw
  the native `Failed to scrape …` error; caller aborts propagate as
  `AbortError`; a vendored timeout maps to the native `Request timed out`.
- **LENS-owned signals preserved**: `calculateCredibilityScore` provenance
  and the ~6,000-character stored-content budget are applied LENS-side after
  vendored extraction (the vendored HTTP cap is 5 MB).
- **Every fetch is gate-admitted and ledgered** (D5):
  `scrapePlaneLedgerSnapshot()` proves admission counts; the bounded gate
  mirrors the search plane (abort-aware queue, waiter slot inheritance,
  saturation fails loudly).
- **Parity harness offline seams**: the harness runner resolves fixture
  hostnames through the plane's lookup seam (real DNS never consulted;
  non-fixture hostnames fail loudly) and its DDG route matcher decodes both
  wire forms — the vendored plane encodes spaces as `+` while the retired
  native implementation used `%20`, and since #109 the matcher only matched
  the `%20` form, silently leaving the parity legs with empty search results
  (the scrape-plane ledger gate exposed the vacuous runs; both legs degraded
  identically, so the stages passed on nothing).

## Contract state (amended at ticket #110)

The contract step retired the native DuckDuckGo HTML implementation and the
unused Instant-Answer module: the vendored plane is the **only** keyless
search path. The native `search()` seam remains as the keyed-provider entry
(Tavily/Serper retire at the #112 config seam); its keyless fallback routes
to the primary plane, and the plane's failure fallback goes straight to the
caller's keyed provider or propagates — the seam is terminal in both
directions, so no plane↔native re-entry cycle exists (an earlier draft that
fell back through `search()` hung the suite on a 39k-iteration fallback
cycle; the terminal-fallback design is load-bearing). Wide mode keeps its
keyed routing through `search()` unchanged.

## Implementation shape (first increment, #109)

- `engine/searchPlane.ts`: the primary plane adapter — signature-compatible
  with `MultiSearchProvider.search`, so it slots behind the engine's search
  seam (`searchFn`) unchanged. DDG queries execute through the vendored
  DuckDuckGo module (loaded via the package bridge's jiti loader); every call
  is admitted through a bounded concurrency gate and counted in the plane
  ledger (`searchPlaneLedgerSnapshot`), proving no unledgered retrieval.
- Keyed providers (Tavily/Serper keys present) keep the native path until the
  config seam (#112) provisions them through `web-search.json`.
- Fallback: post-contract, the plane IS the keyless path — a vendored-plane
  failure falls back **directly** to the caller's keyed provider (static
  `searchTavily`/`searchSerper` calls) or propagates when no keys exist.
  Never through `MultiSearchProvider.search()`: that would re-enter the
  plane and cycle (see the contract-state amendment). Caller aborts
  propagate.
- Answer-mode guard: the package tool handler intercepts `fetch_content`
  `mode: 'answer'` calls pre-dispatch and returns guidance text.
- The parity harness runs through the vendored plane (fixtures already serve
  the DDG HTML the vendored parser reads); a plane-ledger assertion proves
  fixture runs exercised the plane, not the silent fallback.

## Alternatives considered

- **Tool-plane swap first** (researchers call pi tools directly): rejected as
  the first step — bigger blast radius, and the deterministic backbone's
  budget/ledger semantics are pinned to the seam functions.
- **Keyed provider required** (e.g. Tavily): better raw quality, but breaks
  zero-config operation and harness determinism.
- **Support answer-mode via model injection**: duplicates the Parent's
  synthesis role and splits synthesis ownership — violates a map hard rule.
- **Relax admission stages to superset semantics**: would hide real
  regressions at the plane boundary.

## Consequences

- Retrieval quality for keyless operation is bounded by DDG HTML — unchanged
  from the native path it replaces (wire-identical request, same parser
  classes).
- The plane ledger and bounded gate are the enforcement point for the
  boundary clause; future retrieval paths (tool-plane migration) must admit
  through the same gates. Ledger gates double as vacuity detectors: a parity
  run with zero ledgered admissions is a broken run, not a passing one.
- Re-vendor drift of pi-web-access remains a maintenance risk (mitigated by
  the vendoring script's upstream diff check).
- The tool-plane migration remains fog on the
  [Research Agency map](https://github.com/mohmaedeslam00116/lens-desktop/issues/80)
  until the scrape-plane increment proves bridge fidelity.
