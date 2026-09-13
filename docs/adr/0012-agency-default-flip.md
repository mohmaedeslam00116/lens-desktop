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
3. **Plan-less fallback: escape hatch, not silent reroute.** The agency path
   requires an approved plan; default-standard runs whose plan is missing or
   unapproved are not abandoned — the parent degrades: it logs a warning and
   delegates to the legacy loop with all telemetry seams attached. A client
   that explicitly sent an agency request (`agency_mode: true`) without an
   approved plan still gets the loud error (explicit contract violation
   remains loud).
4. **Wide mode is never rerouted** (unchanged phase-1 rule).
5. **Settings lockstep**: a `legacyMode` boolean joins the research settings
   surface and is forwarded on every start request; `researchRequest.mjs`
   passes it through untouched.
6. **Closure ticket**: legacy-loop removal is filed as a follow-up contract
   ticket, blocked on agency-default soak time (per ADR-0010 expand–contract).

## Consequences

- Default research execution now exercises the agency orchestration seams
  (#88–#94) on every standard run; the #94 harness gates regressions.
- The legacy loop stays one flag away for escape-hatch and A/B comparison;
  its removal is an explicit, scheduled contract step — not drift.
- Plan-less default runs remain functional (degraded, logged) instead of
  failing, preserving the pre-flip contract for unapproved-plan clients.

## Alternatives considered

- **Renderer sends `agency_mode: true` explicitly** — rejected: couples the
  flip to every payload-building call site and misses API/CLI entry points.
- **Silent reroute on missing plan with no warning** — rejected: hides
  authorization-contract violations; the degraded-delegation path must be
  observable in telemetry/logs.
- **Flip wide mode too** — rejected: out of scope for #95 (ADR-0010 phase 5
  covers pi-native tooling swaps under the same harness gate).
