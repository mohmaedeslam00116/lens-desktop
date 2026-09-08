# Product: LENS

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Researchers, students, engineers, and knowledge workers who need to investigate a question, compare sources, and read a structured report in Arabic or English.

## Product Purpose

LENS is a desktop research workspace that turns a question into a research process and a report. Users can inspect the research activity, revisit reports, and export their work.

## Positioning

A focused, bilingual research tool with a familiar productivity workspace. The user supplies an AI provider configuration or connects a local Ollama instance. Avoid promises of guaranteed accuracy or fixed source counts.

## Operating Context

Electron desktop application using a React frontend and an embedded TypeScript research server (`frontend/electron/engine`). The current implementation starts that server on port 8000; earlier Python/FastAPI descriptions no longer represent the active entry point.

## Capabilities and Constraints

- Research question with quick, balanced, and deep modes, plus web, academic, and community focus.
- Hierarchical milestone-by-milestone synthesis and meta-synthesis with deterministic citation grounding contract, stripping unmapped citation brackets.
- Streamed research steps and source discovery; report reading, table extraction, and diagram presentation.
- Compact navigation rail: Home, Discover, Library, Knowledge graph, and Skills Hub.
- Local report history and search; report export controls for PDF, DOCX, Markdown, and extracted-table CSV.
- Arabic/English interface direction and persistent dark/light preferences.
- Provider configuration, model discovery, and local Ollama connection.
- Actual research and connected model discovery require the embedded server and a working provider configuration. Browser-only previews do not establish end-to-end research reliability.
- Existing settings are persisted by App.tsx in localStorage. Electron exposes secureStore separately; do not equate the available encryption API with verified encrypted persistence in the active UI.

## Brand Commitments

- Name: **LENS**, selected by the user; identical English wordmark in both interface languages.
- Brand line: **Research, in focus.** Arabic expression: **نظرة أعمق. فهم أوضح.**
- User-pinned reference: Vercel/Cursor-like neutral black, charcoal, gray, and off-white; reserve color for meaningful status.
- Preserve the approximate existing rail and central research/report layout while refining typography, controls, surfaces, and spacing.
- Original concentric lens mark; restrained monochrome wordmark. No decorative glow, gradient wordmark, or unsupported Pro label.
- Retain stable package identity, appId, storage identifiers, and endpoints during visual rebranding.

## Product Principles

1. Keep the research question and the report central.
2. Show observed research progress; never invent completed graph nodes.
3. Preserve a drafted question through provider setup and connection errors.
4. Make Arabic and English equally navigable.
5. Explain empty and error states with a useful next action.

Brand guidelines: BRAND.md. Implemented visual system: DESIGN.md.
