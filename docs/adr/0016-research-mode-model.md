# ADR-0016: Research Mode Model — Two Modes, Wide as a Depth Preset, Per-Conversation

**Status:** Accepted
**Date:** 2026-09-29
**Decided in:** [Agent harness spec issue #118](https://github.com/mohmaedeslam00116/lens-desktop/issues/118) (grill-with-docs Round 1, Q2).
**Builds on:** ADR-0007 (wide research), ADR-0012 (agency default flip). Amends the request vocabulary declared in `engine/types.ts`.

## Context

The composer today sends three partially-overlapping controls: `depth` (`quick|deep|storm`), `perspective` (`balanced|technical|market|critical|storm`), and `mode` (`standard|wide`). Issue #118 introduces two first-class modes — **Agentic Search** (Pi loop, no plan gate) and **Deep Research** (plan-gated agency) — and wants `wide` demoted from a mode to a depth preset. The existing controls have overlapping vocabulary (`storm` is both a depth and a perspective) and `mode=wide` conflates "how deep" with "how governed".

## Decision

**Mode is the primary, per-conversation control; depth becomes a Deep Research-only preset that absorbs wide; perspectives stay Deep Research-only.**

1. **Two modes.** `Agentic Search` (Pi-native loop, no plan gate) and `Deep Research` (plan approval gate + agency orchestration). `mode` values become `agentic | deep` at the API boundary; the existing `standard|wide` request flag is folded per rule 3.
2. **Per-conversation, switchable only before the first turn.** A session's evidence contract and gate differ per mode — one session cannot be both gated and gate-free. Switching mode after the first turn starts a new conversation.
3. **Wide becomes a depth preset.** The depth picker appears only under Deep Research and carries three presets: `Quick | Deep | Wide`. The wire encoding stays compatible: `mode: 'wide'` on a Deep Research request is translated to `depth`-equivalent wide behavior (ADR-0007 semantics) — existing callers and tests keep passing while the UI presents one picker.
4. **Perspectives are Deep Research-only.** Perspective is a plan-first decomposition construct (STORM personas); Agentic Search's decomposition is Pi's loop, so the perspective control disappears under Agentic Search.
5. **`storm` survives inside Deep Research.** It remains a depth tier and the STORM perspective entry — the existing STORM experience, not a third mode.
6. **Composer hierarchy.** Mode picker sits above depth; depth is visible only under Deep Research; wide-budget guidance (100→200 source guidance, ADR-0007) attaches to the Wide preset.

## Consequences

- One conversation is unambiguously gated or ungated; the plan gate keys off mode instead of inferring from request shape.
- Request translation lives in one place (the `buildResearchStartPayload` seam), keeping `engine/types.ts` compatible until the harness migration renames the wire values under its own ticket.
- UI tests (composer controls) assert picker visibility rules: perspective and depth hidden under Agentic Search.

