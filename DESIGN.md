---
name: LENS
description: Research, in focus. A bilingual monochrome research workspace.
colors:
  dark-canvas: "rgb(17 17 17)"
  dark-rail: "rgb(13 13 13)"
  dark-panel: "rgb(25 25 25)"
  dark-surface: "rgb(33 33 33)"
  dark-hover: "rgb(43 43 43)"
  dark-line: "rgb(48 48 48)"
  dark-line-strong: "rgb(70 70 70)"
  dark-ink: "rgb(237 237 235)"
  dark-ink-secondary: "rgb(185 185 181)"
  dark-ink-muted: "rgb(149 149 144)"
  dark-accent: "rgb(237 237 235)"
  dark-on-accent: "rgb(24 24 23)"
  dark-focus: "rgb(163 163 157)"
  light-canvas: "rgb(250 250 249)"
  light-rail: "rgb(244 244 243)"
  light-panel: "rgb(255 255 255)"
  light-surface: "rgb(239 239 237)"
  light-hover: "rgb(230 230 227)"
  light-line: "rgb(218 218 214)"
  light-line-strong: "rgb(190 190 184)"
  light-ink: "rgb(25 25 24)"
  light-ink-secondary: "rgb(69 69 65)"
  light-ink-muted: "rgb(99 99 93)"
  light-accent: "rgb(30 30 28)"
  light-on-accent: "rgb(250 250 248)"
  light-focus: "rgb(99 99 93)"
  status-success: "#34d399"
  status-warning: "#fbbf24"
  status-error: "#fb7185"
typography:
  display:
    fontFamily: "Inter, 'Segoe UI', sans-serif"
    fontSize: "clamp(25px, 2.65vw, 34px)"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.03em"
  display-arabic:
    fontFamily: "Cairo, 'Segoe UI', sans-serif"
    fontSize: "clamp(25px, 2.65vw, 34px)"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  wordmark:
    fontFamily: "Inter, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  headline:
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.5
  title:
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontSize: "0.9375rem"
    lineHeight: 1.9
  composer:
    fontSize: "16px"
    lineHeight: 1.85
  label:
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "0.88em"
rounded:
  keycap: "4px"
  compact: "6px"
  action: "7px"
  control: "8px"
  new-research: "9px"
  code-block: "10px"
  dialog: "12px"
  composer: "14px"
spacing:
  tight: "6px"
  compact: "8px"
  control: "12px"
  content: "16px"
  panel: "20px"
  gutter: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 13px"
  button-primary-light:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 13px"
  button-disabled:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink-muted}"
    rounded: "{rounded.action}"
  button-icon:
    textColor: "{colors.dark-ink-muted}"
    rounded: "{rounded.control}"
    size: "36px"
  research-composer:
    backgroundColor: "{colors.dark-panel}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.composer}"
    padding: "20px 20px 14px"
  library-search:
    backgroundColor: "{colors.dark-panel}"
    rounded: "{rounded.control}"
    padding: "12px 16px 12px 40px"
  navigation-item:
    textColor: "{colors.dark-ink-muted}"
    rounded: "{rounded.control}"
    padding: "11px 2px"
  workflow-template:
    textColor: "{colors.dark-ink-secondary}"
    rounded: "{rounded.action}"
    padding: "6px 10px"
  settings-panel:
    backgroundColor: "{colors.dark-surface}"
    rounded: "{rounded.dialog}"
    padding: "16px"
---

# Design System: LENS

## Overview

**Creative North Star: "Research, in focus."**

LENS frames a question, keeps its evidence legible, and provides a familiar workspace for revisiting research. Its chosen language is precise and restrained: charcoal and off-white surfaces, compact controls, a concentric lens mark, and quiet typography. The user pinned Vercel/Cursor-like monochrome colors and preservation of the approximate rail and central research layout.

This is an Operate refresh of the implemented application. Inter and Cairo are intentional incumbent choices, including an exception to generic design detectors that discourage Inter. The system modernizes actual research, library, graph, settings, and command controls; it does not prescribe the obsolete three-pane studio proposal.

**Key Characteristics:**

- Monochrome surfaces with semantic status color.
- A compact rail and a readable central research area.
- English and Arabic typography with direction-aware spacing.
- Flat structure, explicit controls, and visible keyboard focus.

Source authority: `frontend/src/index.css`, `frontend/tailwind.config.js`, the brand component, and implemented components. This document records code, not an accessibility certification or an end-to-end research guarantee. Product truth lives in PRODUCT.md; identity rules live in BRAND.md. Extensions and isolated component previews live in `.impeccable/design.json`.

## Colors

The palette combines neutral charcoal with subtly warm ink and paper. Frontmatter preserves the CSS source's RGB channels. Paired dark/light names describe the same semantic roles in each theme. Component frontmatter defaults to dark, with the primary light variant explicit; sidecar previews bind to active semantic CSS variables.

### Primary

The **inverted action** uses accent against on-accent: pale ink on the dark canvas, dark ink on the light canvas. This is the research submit and new-research treatment. It is not a colored brand accent.

### Neutral

- **Canvas** holds the workspace; **rail** slightly separates persistent navigation.
- **Panel** frames the composer, search, and command dialog; **surface** distinguishes grouped settings and hovered or selected controls.
- **Hover**, **line**, and **line-strong** provide progressively firmer interaction and boundary tones.
- **Ink**, **secondary ink**, and **muted ink** establish reading priority. Muted ink also supplies theme-aware placeholders.
- **Focus** supplies the keyboard outline and composer focus boundary.

### Semantic status

Emerald indicates completed or successful states, amber indicates a setup warning, and rose indicates failed or destructive states. Pair state color with an icon or text. Routine report and table actions use neutral controls. Status colors are existing Tailwind values, not a new brand palette; their presence does not mean every contrast combination has passed an audit.

**The Meaningful Color Rule.** Reserve chromatic color for a meaningful status; keep brand, navigation, and routine report controls monochrome.

The root light palette is overridden by the root `dark` class. Tailwind's `slate` and even `white` aliases map to semantic channels for incumbent components; literal white cannot be assumed from the class name. Older vscode, obsidian, dark, and light config groups remain compatibility material, not this system's palette authority.

## Typography

English uses Inter with Segoe UI and sans-serif fallbacks. Arabic uses Cairo with the same fallbacks through the root language attribute. Both fonts are requested from Google Fonts in `frontend/index.html`; offline availability depends on caching, with system fallbacks remaining valid. Tailwind's sans stack additionally contains Cairo and system-ui. Code uses system monospace.

The wordmark always reads **LENS** and remains left-to-right in Arabic. Its base role is in frontmatter; the home variant uses (31px), paired with a (40px) mark. Navigation uses the (31px) mark alone. At the narrow breakpoint the home mark and wordmark become (34px) and (27px). Small and extra-large component variants also exist.

The home heading follows the fluid display role, with zero Arabic tracking and a heavier Arabic weight. Report headings use headline and title roles; the third level is (1.05rem) at weight (600). Report body has a (72ch) maximum measure. Home support copy is (14px), line height (1.8), and at most (55ch). Metadata spans (10–12px). Library and graph page headings use (24px) at weight (600). This is an observed hierarchy, not a uniform mathematical scale.

**The Bilingual Identity Rule.** Change reading direction and UI family with language; keep the LENS wordmark upright and left-to-right.

## Layout

The app fills (100dvh). A (78px) rail sits beside a flexible content column. The workspace header is (61px) high with (30px) inline padding; the remaining main region scrolls. Logical borders and spacing follow the root direction, so Arabic mirrors the workspace.

The home wrapper is at most (808px), including (24px) side padding, yielding a (760px) inner composer area. Top padding varies from (36px) to (76px) with viewport height. The introduction precedes a framed composer, model/keyboard metadata, template chips, and two columns of divided topic rows. This is the current home composition; report screens may use their own reading and support areas. Library and graph use a (56rem) maximum outer width with (24px) horizontal and (40px) vertical padding.

At widths up to (700px), header padding tightens to (18px), topics become one column, composer controls wrap, and settings navigation becomes a horizontal wrapping group. At widths up to (450px), the rail becomes (60px), the header becomes (55px), home side padding becomes (16px), and the primary composer action spans the row. The rail retains labels. Command hints progressively hide to save room. Provider grids also use Tailwind's (640px) small breakpoint.

Settings use a (56rem) maximum width and nominal (620px) height, bounded by viewport height minus (32px), with internal content scrolling. Commands use a (36rem) maximum width, sit (12vh) from the top, and limit the result list to (55vh). There is no universal three-pane layout or implemented mobile navigation drawer.

## Elevation & Depth

Depth is primarily tonal and structural: a one-pixel boundary separates canvas, panel, and control. The composer rests flat and clarifies its border on focus. Settings and commands use black scrims at (80%) and (70%), respectively. There is no decorative glow or gradient identity treatment.

One incumbent low shadow remains on active settings navigation: `0 1px 2px 0 rgb(0 0 0 / 0.05)`. It does not establish a large floating-card vocabulary. Scrollbars are thin (6px) with a line-strong thumb.

**The Quiet Depth Rule.** Establish hierarchy through tone, spacing, and a fine boundary before adding elevation.

## Shapes

Compact rounded rectangles define the controls. Frontmatter captures the observed radius vocabulary: keycaps and inline code are tight, controls are modestly rounded, dialogs and grouped settings are softer, and the composer has the largest common container radius. Status badges can be pills; they do not dictate ordinary button shapes.

The original mark has two concentric circles and four focus ticks, with a (1.6px) stroke in its (32 × 32) viewbox. It inherits current text color. BRAND.md defines minimum size and clear space. Lucide line icons supply interface actions; navigation uses (19px) icons at (1.65px) stroke.

## Components

### Buttons and navigation

Primary actions invert accent and on-accent, have a minimum height of (36px), and fade to (85%) opacity on hover. Disabled submit uses surface and muted ink with a not-allowed cursor. The new-research action is (38 × 38px); preference icon buttons are (36 × 36px). Navigation stacks an icon and label. Hover and `aria-current="page"` use surface plus ink; current state is also exposed semantically.

Global keyboard focus is a (2px) focus-color outline with (4px) offset. Some fields use a focused boundary instead. Preserve a visible equivalent when overriding the outline.

### Question composer and templates

The composer has a line-strong border and panel background. Its textarea is (16px), grows within a (100–260px) height range, and permits vertical resizing. Focus-within clarifies the enclosing border. Native selects expose depth and source focus with accessible labels. Submit is disabled for an empty trimmed question or while loading.

Enter submits unless Shift is held or input composition is active; Shift+Enter inserts a line break. Template chips replace a recognized template prefix while preserving the subject, set applicable mode/focus, and return focus to the textarea. Topic rows populate and focus the question. The model name is a separate setup control with bidirectional text isolation.

### Search, lists, and reports

Library search uses a panel field with an inset icon and fine boundary. Report entries are divided rows with title, date, source count, and directional icon; hover underlines the title. Empty history and unmatched filters have distinct explanations and next actions. Clearing all history has an inline confirmation.

The graph is a list of received research nodes with type, available parent relationship, status text, and icon. Empty and loading states are distinct. Do not illustrate fabricated completed nodes as real progress. Report prose uses the reading measure above, scrollable code blocks, logical blockquote borders, and tabular numerals in tables. Neutral report/export controls share the workspace palette, and table controls follow the selected interface language.

### Settings and commands

Settings group model, search, local provider, and preference controls in a bounded dialog. Provider and model selections use neutral surfaces and borders. API/model identifiers use monospace where helpful. Commands provide search, ArrowUp/ArrowDown selection, and Enter activation. Ctrl/Cmd+K opens commands; Ctrl/Cmd+N starts research. Export commands appear only with an active report.

Both dialogs use labelled modal semantics, initial focus, Tab containment, Escape close, and restoration to the prior focused element when it remains connected. These come from `useDialogFocus`; they do not establish a complete accessibility audit.

Reduced-motion CSS reduces animation and transition durations to (.01ms), one animation iteration, and automatic scrolling. Rail and primary-action transitions use (.18s ease-out); composer borders use (.2s ease-out). Separately implemented animation systems still need checking.

### Identity and truthful states

LENS is the title, mark, and visible product name in both languages. Packaging retains `deep-research-desktop` and `com.deepresearch.desktop`; history/settings retain `deep_research_history` and `deep_research_settings`. Language/theme preferences use `lens_language` and `lens_theme`. Preserve these and existing endpoints through visual updates.

Settings accurately state that the active storage path is localStorage and key encryption is not enabled there. An available Electron secureStore API does not establish encrypted UI persistence. Model discovery and research require a working server/provider configuration; local Ollama does not make web retrieval offline. Browser previews alone do not establish paid-research reliability, export fidelity, security, or universal accessibility.

## Do's and Don'ts

### Do:

- **Do** use semantic theme channels for surfaces, ink, focus, and routine controls.
- **Do** keep the question and readable report central while retaining the compact navigation rail.
- **Do** preserve Inter/Cairo, logical spacing, and the left-to-right LENS wordmark.
- **Do** pair status color with text or an icon and describe empty/error recovery clearly.
- **Do** preserve visible keyboard focus, draft text through setup, and reduced-motion behavior.
- **Do** preserve application and storage identifiers during visible rebranding.

### Don't:

- **Don't** add decorative glow, gradient wordmarks, or an unsupported Pro tier.
- **Don't** restore the obsolete three-pane proposal as current layout documentation.
- **Don't** use brand accent color to distinguish routine report or navigation actions.
- **Don't** claim verified encryption, offline web research, guaranteed accuracy, or completed graph activity without supporting implementation and evidence.

