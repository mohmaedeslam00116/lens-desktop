# Design System: Agent Studio & Command Center

<!-- impeccable:design-schema 1 -->

## Design Philosophy
Inspired by the tier-1 productivity environments of **Antigravity, Cursor, Linear, and Raycast**. The tool is built for serious intellectual work: it prioritizes information density, effortless readability, real-time agent transparency, and restrained elegance over decorative gimmicks.

---

## 1. Spatial Architecture & Workspace Layout (Three-Pane Studio)

1. **Left Activity & Session Rail (Width: 260px, collapsible to 56px):**
   - Workspace switcher and research status badge.
   - Quick "New Deep Research" button (`Ctrl + N`).
   - Command Palette launcher (`Ctrl + K`).
   - Categorized research history tree (Today, Past 7 Days, Older) with instantaneous search filter.
   - Bottom status panel: Local backend health, active model badge, and settings toggle.

2. **Center Research Canvas (The Living Document):**
   - Fixed optimal measure: 68–74ch for maximum reading speed and comprehension.
   - Dynamic sticky Table of Contents tracking active scroll headers.
   - Floating Action Dock: Quick export (PDF, Word, Markdown), copy raw markdown, and font scale.
   - Interactive Citation Badges: Clicking or hovering over `[1]`, `[2]` highlights the source in the inspector panel and previews the visited domain.

3. **Right Agent Inspector & Copilot Panel (Width: 380px, toggleable):**
   - **During Research:** Live agent telemetry radar, sub-queries decomposition tree, live visited sources cards with real domain favicons, and collapsible raw execution thoughts.
   - **Post Research:** Seamlessly morphs into the **Follow-up Copilot Chat**—allowing the user to interrogate the report, verify claims, and explore counter-arguments directly beside the document, eliminating clumsy modal overlays.

---

## 2. Color Palette (Obsidian & Restrained Cyber)

* **Deep Neutral Grounds:**
  - Base Background: `oklch(0.14 0.02 260)` (`#07090e`)
  - Workspace Canvas / Panels: `oklch(0.17 0.02 260)` (`#0c1017`)
  - Elevated Cards & Surfaces: `oklch(0.20 0.025 260)` (`#121824`)
  - Input & Search Wells: `oklch(0.12 0.015 260)` (`#05070a`)

* **Micro-Borders & Structural Lines:**
  - Panel Dividers: `rgba(255, 255, 255, 0.07)`
  - Card & Control Borders: `rgba(255, 255, 255, 0.05)`
  - Inset Highlight: `inset 0 1px 0 0 rgba(255, 255, 255, 0.04)`

* **Intentional Semantic Accents (Restrained):**
  - Primary Action / Agent Pulse: Electric Blue `oklch(0.60 0.18 250)` (`#3b82f6`) & Violet `oklch(0.58 0.20 275)` (`#6366f1`)
  - Success / Veracity: Emerald `oklch(0.68 0.16 150)` (`#10b981`)
  - Live Scraping / In-progress: Amber `oklch(0.72 0.15 70)` (`#f59e0b`)
  - Error / Alert: Crimson `oklch(0.62 0.20 25)` (`#ef4444`)

---

## 3. Typography & Typesetting

* **Font Families:**
  - Arabic: **Cairo** (weights 400, 500, 600, 700) with adjusted line-height (1.75–1.85) for optimal Arabic glyph rendering.
  - Latin & UI Elements: **Inter** / **Segoe UI** (weights 400, 500, 600) with tracking at `-0.015em` for headings.
  - Code, Citations, & Telemetry: Monospace (`ui-monospace`, `SFMono-Regular`, `Consolas`).

* **Hierarchy (Fixed Rem Scale):**
  - H1 Document Title: `1.75rem` (`28px`), font-weight 700, leading `2.25rem`.
  - H2 Section: `1.25rem` (`20px`), font-weight 600, leading `1.75rem`.
  - H3 Subsection: `1.05rem` (`16.8px`), font-weight 600.
  - Body Text: `0.9375rem` (`15px`), leading `1.65rem`, text color `oklch(0.90 0.01 260)`.
  - Secondary / Meta: `0.75rem` (`12px`), text color `oklch(0.60 0.02 260)`.

---

## 4. Anti-Patterns Explicitly Prohibited (Impeccable Craft Floor)

- NO nested cards inside cards.
- NO rainbow or gradient text.
- NO emoji used as UI icons (strictly sharp SVG Lucide icons with consistent stroke 1.5–1.75).
- NO full-screen modal overlays for chat or history (integrated into the three-pane studio layout).
- NO unstyled default browser scrollbars.
- NO zero-offset harsh drop shadows; all elevation is carried by micro-borders and subtle 1px inset highlights.
