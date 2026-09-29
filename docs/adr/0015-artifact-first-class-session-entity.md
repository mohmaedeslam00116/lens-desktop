# ADR-0015: Artifact as a First-Class, Session-Scoped Entity

**Status:** Accepted
**Date:** 2026-09-29
**Decided in:** [Agent harness spec issue #118](https://github.com/mohmaedeslam00116/lens-desktop/issues/118) (grill-with-docs Round 1, Q4).
**Builds on:** ADR-0005 (evidence shelf), ADR-0007 (wide-research export), ADR-0011 (parity harness artifact usage is unrelated — "artifact" there means a diagnostic file).

## Context

LENS produces several outputs per session: the plan (approval document), the LivingReport (Markdown string), the evidence shelf (derived on request), the ResearchGraph (derived), plus telemetry. The Agent Harness workspace's right pane, the export path, and the failure taxonomy all need to answer "what has this session produced, and what state is each item in" — today each output is fetched or derived through its own path with no shared identity, lifecycle, or events.

## Decision

**An Artifact is a first-class entity scoped to a session, stored in the LENS session record and announced on the LiveEvent backbone.**

1. **Shape.** `{ id, type, title, state, producer, payload, createdAt, updatedAt }`, persisted inside the LENS session record — not a new datastore.
2. **Types.** `plan`, `report`, `evidence-shelf`, `graph` — the four outputs above. The type set is closed; new producers add a type deliberately.
3. **Events.** `artifact_created` and `artifact_updated` join the LiveEvent backbone, honoring the Event Faithfulness rule (no silent drops). The right pane renders from these events, not from ad-hoc fetches.
4. **State.** Each artifact carries its own lifecycle state (`pending` → `ready` / `failed`), so a failed report and a failed graph are individually representable — this is what a view-layer grouping (option b) could not express.
5. **Plan stays the approval document.** The plan artifact wraps the existing plan-approval flow; approval semantics (ADR-0001) are untouched.
6. **Out of scope.** A cross-session artifact library. The Library view remains report-based.

## Consequences

- Export, failure taxonomy, and the harness right pane key off one identity space instead of five fetch paths.
- Deep Research and Agentic Search share the artifact contract even though their producers differ.
- Renderer tests can assert pane contents from events alone; the parity harness continues to ignore artifact events for sequence equality or must include them once both paths emit them (spec decides ordering).

