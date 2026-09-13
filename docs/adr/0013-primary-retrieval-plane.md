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

## Implementation shape (first increment, #109)

- `engine/searchPlane.ts`: the primary plane adapter — signature-compatible
  with `MultiSearchProvider.search`, so it slots behind the engine's search
  seam (`searchFn`) unchanged. DDG queries execute through the vendored
  DuckDuckGo module (loaded via the package bridge's jiti loader); every call
  is admitted through a bounded concurrency gate and counted in the plane
  ledger (`searchPlaneLedgerSnapshot`), proving no unledgered retrieval.
- Keyed providers (Tavily/Serper keys present) keep the native path until the
  config seam (#112) provisions them through `web-search.json`.
- Fallback: any vendored-plane failure falls back through the canonical native
  seam entry (`MultiSearchProvider.search`), keeping one interception point;
  caller aborts propagate.
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
  boundary clause; future retrieval paths (scrape-plane increment, tool-plane
  migration) must admit through the same gates.
- Re-vendor drift of pi-web-access remains a maintenance risk (mitigated by
  the vendoring script's upstream diff check).
- The tool-plane migration remains fog on the
  [Research Agency map](https://github.com/mohmaedeslam00116/lens-desktop/issues/80)
  until the scrape-plane increment proves bridge fidelity.
