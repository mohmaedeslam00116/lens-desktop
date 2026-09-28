# LENS Harness Workspace Prototype Design

## Purpose

Implement issue #121 as an interactive, disposable React prototype based directly on the operator's supplied Stitch desktop-harness HTML. The prototype lets the operator evaluate the new shell using LENS's actual research-session state rather than fabricated IDE, pull-request, terminal, or agent activity.

## Scope

The prototype adds an explicit preview entry point alongside the stable LENS workspace. It preserves the existing research workflow and uses its current renderer state: query, history, session status, streamed report, live sources, researcher cards, plan, and typed artifacts.

The supplied Stitch structure is copied as the starting point for:

1. A left conversation/history rail.
2. A centered empty-state composer.
3. A conversation and live-event canvas after a ResearchSession starts.
4. A right-hand artifact inspector.

The prototype does not add a coding workspace, repository browser, scheduled-task backend, Electron window-control implementation, new agent runtime, or synthetic execution data.

## Layout and Data Flow

`App` keeps the current LENS workspace as the default surface. A clearly labelled prototype entry point renders `LensHarnessWorkspacePrototype` and passes the existing live renderer state to it. This makes the design reversible: closing the preview returns to the shipping interface without changing a ResearchSession.

The copied shell maps to LENS data as follows:

| Stitch region | LENS replacement |
| --- | --- |
| Antigravity header and mark | LENS mark and current workspace actions |
| Conversation/project rail | LENS history and navigation actions |
| Empty prompt | Existing query, model settings, and `handleStartResearch` |
| Agent execution stream | `thoughts`, `currentStatus`, and `AgentFeedState` from the live event feed |
| Walkthrough inspector | tabs for Plan, Evidence shelf, Living Report, and Research graph |
| PR, tests, files, terminal data | omitted unless LENS has a real corresponding artifact |

All strings must retain Arabic/English parity. The LENS mark remains left-to-right in Arabic. Code-like identifiers, URLs, citation numbers, and metric values remain direction-isolated.

## Visual Rules

The operator authored the supplied Stitch design, so its component hierarchy and spacing may be copied. Its external product identity and token system are not LENS product truth. The prototype therefore uses the existing LENS monochrome palette, Inter/Cairo typography, semantic state colors only for real agent status, and no decorative gradient or glow.

The existing unmounted `WorkstationPrototypeView` and `components/ide/` family are not extended. A subsequent cleanup change retires them once this prototype is accepted.

## Interaction Rules

- The empty composer starts the existing research request; it does not create a parallel conversation backend.
- The history rail reopens a stored `ReportData` through the current LENS selection behavior.
- The running workspace displays real event-derived activity. Empty, loading, error, cancelled, and budget-exhausted states use the renderer's existing messages.
- The inspector switches only between the typed LENS artifacts that have data. It must not claim that an absent plan, graph, or evidence set exists.
- The preview has a clear exit control and does not persist a different app layout preference.

## Verification

The proposed public seams are:

1. **Prototype entry seam:** entering and exiting the preview preserves the current LENS workspace and research state.
2. **Composer seam:** submitting a query from the copied composer invokes the existing research-start callback with that query.
3. **Live-event seam:** supplied researcher activity, source, plan, and report data appear in their corresponding prototype regions; absent artifacts render an honest empty state.
4. **Bilingual seam:** Arabic direction mirrors ordinary UI while preserving LTR identifiers and the LENS wordmark.

Tests remain offline and use deterministic UI fixtures. Build verification runs React and Electron builds; the final implementation also undergoes the required CodeRabbit review before merge.

## Acceptance Criteria

- The prototype visibly follows the supplied Stitch shell while reading as LENS.
- It is reachable intentionally but cannot replace or break the default workspace.
- Its composer, history, activity cards, sources, plan, report, and artifact inspector use existing LENS state only.
- No Antigravity, IDE, PR, source-code, or invented execution copy remains in the prototype.
- Arabic and English layouts work, and the existing research flow remains green.
