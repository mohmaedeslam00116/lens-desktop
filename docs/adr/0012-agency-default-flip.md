# Agency Default Flip (ADR-0010 phase 4, contract step)

Status: accepted
Date: 2026-09-13
Ticket: #95 (part of #80, ADR-0010)

## Context

ADR-0010's phase table schedules the contract step: with the parity harness
(#94) green, research runs default to the agency path while the legacy
single-loop remains reachable behind an escape flag pending removal
(expand–contract closure). The dormancy rules from phase 1 (agency only via
explicit opt-in, wide never rerouted, unknown flags default-off) are inverted
for the standard loop only.

## Decision

1. **Default flip is server-side routing, not renderer payload changes.** The
   standard loop routes to the Parent Research Agent when neither the request
   nor settings opt out. This keeps the flip instant for all entry points and
   the renderer payload contract unchanged.
2. **Escape flag = `legacy_mode: true`** on the request. Resolution order:
   request flag > settings default. Any non-`false` value of the engine
   default keeps the agency path; `legacy_mode: true` restores the legacy
   single-loop exactly as before the flip.
3. **Authorization stays strictly gated — no plan-less fallback.** The agency
   path requires an approved plan, period. With the flip, the session
   lifecycle remains the owner of the plan-less UX: runs stop at the approval
   gate (`isPlanAuthorized`) before any agent is constructed, so a default
   run without an approved plan never reaches retrieval. The parent's engine
   guard throws for any unapproved plan regardless of how the request arrived
   (explicit `agency_mode` or default routing). A plan-less delegation
   fallback was considered and REJECTED in review: it would start retrieval
   before authorization — an authorization bypass dressed as UX.
4. **Wide mode is never rerouted** (unchanged phase-1 rule).
5. **Settings lockstep**: a `legacyMode` boolean joins the research settings
   surface and is forwarded on every start request; `researchRequest.mjs`
   passes it through untouched.
6. **Closure ticket**: legacy-loop removal is filed as a follow-up contract
   ticket (#104), blocked on agency-default soak time (per ADR-0010
   expand–contract).

## Consequences

- Default research execution now exercises the agency orchestration seams
  (#88–#94) on every standard run; the #94 harness gates regressions.
- The legacy loop stays one flag away for escape-hatch and A/B comparison;
  its removal is an explicit, scheduled contract step (#104) — not drift.
- The authorization invariant is unchanged by the flip: retrieval is strictly
  gated until `isPlanAuthorized()` is satisfied, at both the session gate and
  the parent's engine guard.

## Alternatives considered

- **Renderer sends `agency_mode: true` explicitly** — rejected: couples the
  flip to every payload-building call site and misses API/CLI entry points.
- **Plan-less runs delegate to the legacy loop with a warning** — rejected in
  review: starts retrieval without `isPlanAuthorized()`, weakening the
  authorization policy. The session lifecycle already owns the plan-less UX
  (approval gate precedes execution); the engine guard must not bypass it.
- **Flip wide mode too** — rejected: out of scope for #95 (ADR-0010 phase 5
  covers pi-native tooling swaps under the same harness gate).
