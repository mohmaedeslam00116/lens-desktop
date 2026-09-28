---
name: LENS
description: Research, in focus. A bilingual evidence-first desktop research harness.
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
  harness-rail:
    backgroundColor: "{colors.dark-rail}"
    textColor: "{colors.dark-ink-secondary}"
    rounded: "{rounded.compact}"
    padding: "12px"
    width: "280px"
  workspace-utility-bar:
    backgroundColor: "{colors.dark-canvas}"
    textColor: "{colors.dark-ink-secondary}"
    typography: "{typography.label}"
    height: "40px"
  research-composer:
    backgroundColor: "{colors.dark-panel}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.composer}"
    padding: "20px 20px 14px"
  agent-card:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  artifact-inspector:
    backgroundColor: "{colors.dark-panel}"
    textColor: "{colors.dark-ink}"
    rounded: "{rounded.control}"
    padding: "16px"
    width: "384px"
  button-primary:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 13px"
---

# Design System: LENS

This document records the shipped, opt-in research-harness preview introduced for Issue #121. The harness components use the same semantic color and type primitives as the main LENS workspace.

## Overview

**Creative North Star: “The Evidence Harness.”**

LENS is a desktop place to ask, watch, inspect, and return to research. The workspace makes the evolving evidence visible without turning research into a simulated developer console. Its visual starting point is the user-supplied Stitch workspace: a disciplined desktop frame, a substantial history rail, a focused work canvas, and a contextual right inspector. Its product identity is entirely LENS: monochrome, bilingual, calm, and truthful.

The harness is an intentional replacement for the narrow-rail, single-column home composition when a user is working with a research session. It is not a generic three-pane application. The right region exists only when LENS has an active report, plan, evidence shelf, or graph to show. The empty state remains a quiet invitation to begin research.

**Key characteristics:**

- A wide, useful history and navigation rail rather than an icon strip.
- One central question-and-evidence canvas with a persistent, capable composer.
- A conditional inspector for real artifacts, never fabricated activity.
- Inter for English, Cairo for Arabic, and direction-aware layout.
- Neutral surfaces by default; status color carries meaning only.

`PRODUCT.md` defines product truth and `BRAND.md` defines identity authority. The supplied Stitch source is authorized implementation input for layout hierarchy and interaction rhythm, not a source of product claims, names, logos, repositories, terminals, PRs, tests, or demo data.

## Colors

LENS remains an off-black and off-white system. Canvas, rail, panel, surface, hover, boundary, and ink roles are defined in frontmatter and must be consumed through semantic theme channels. Dark and light themes retain the same hierarchy: rail is the most recessed persistent region; panel and surface distinguish work without a card wall.

### Primary

The inverted neutral action is the commitment treatment: pale ink on the dark theme and dark ink on the light theme. Use it for starting research, submitting a question, and one clearly primary action in a local context. It is not a brand-color substitute.

### Neutral

- **Canvas** is the reading and working field.
- **Rail** holds durable navigation, recent research, and compact controls.
- **Panel** frames the composer and inspector; **surface** groups a live agent card or evidence item.
- **Line** and **line-strong** separate regions and sharpen an active input without shadows.
- **Ink**, secondary ink, and muted ink express reading order; muted text never becomes the only status signal.

### Semantic status

Success, warning, and error colors describe actual researcher or engine state. They always appear with a label, icon, or both. Discovery, report, navigation, and ordinary tool chips stay neutral.

**The evidence-first color rule.** Color communicates a verified state; it never decorates an invented workflow or makes routine controls look important.

## Typography

Inter and Cairo are deliberate LENS choices. Inter is used for English; Cairo is used when Arabic is active. The interface mirrors its logical layout for Arabic, while the LENS wordmark remains left-to-right. System monospace is reserved for compact source URLs, identifiers, timestamps, and literal search/tool details—not prose or decorative code panels.

The central canvas favors reading before operation: display type introduces an empty state or report, title type names an active artifact, body type keeps report prose comfortably measurable, and label type supports controls and terse metadata. Agent messages and evidence titles stay concise; the inspector must never compete with the report as the primary reading surface.

**The reading-then-operation rule.** Make the question and evidence easiest to read; make execution details available without making them louder than the answer.

## Layout

The desktop harness uses a 40px utility bar above three possible regions:

- **Harness rail:** 280px on wide desktops. It contains LENS identity, entry points, recent research, saved/available work, and compact settings controls. It scrolls independently from the canvas. A selected research item is visible through tone, label, and `aria-current`, not color alone.
- **Research canvas:** the flexible primary region. In an empty state it centers a short LENS introduction and a composer at a readable maximum width. During research it becomes a vertically ordered event stream: question, current status, live agent cards, source/evidence updates, and report. The composer remains anchored at the lower edge of this region.
- **Artifact inspector:** 360–384px on a wide desktop. It presents only data LENS actually has: the plan, sources/evidence shelf, report outline, or graph. It is absent in an empty session and can be closed when the user needs uninterrupted reading.

At medium widths, the inspector becomes a closable overlay or drawer rather than squeezing the report. At narrow widths, the rail collapses behind an explicit control and the canvas takes priority. The app must preserve the existing language direction, keyboard access, and usable composer at every breakpoint.

**The conditional-inspector rule.** A third region earns its space with an active, truthful artifact; it is not a permanent empty dashboard column.

## Elevation & Depth

Tone, spacing, and one-pixel boundaries create the hierarchy. The rail is recessed, the canvas is calm, and the inspector/composer are grouped by panel tone and clear edges. A focused composer can strengthen its boundary. Dialogs retain their functional scrims.

There are no decorative gradients, colored glows, floating neon cards, or deep shadow stacks. A small incumbent functional shadow may support a modal or selected overlay, but it does not become a visual language.

**The quiet depth rule.** Separate work modes with structure first; add elevation only when it proves containment or focus.

## Shapes

Controls use compact rounded rectangles. The composer is the softest common container; agent cards and inspector sections use controlled radii; dense chips, key hints, and source-type labels are tighter. Pills are for truly compact status or filter tokens, not the default form of every button.

Lucide line icons and the concentric LENS mark remain the icon language. Icons have text labels or accessible names; an unfamiliar icon never carries a critical action alone. Preserve the existing visible keyboard-focus treatment whenever a control is restyled.

## Components

### Harness rail and utility bar

The utility bar carries lightweight, truthful desktop controls such as workspace actions, language/theme, and window-level context. The rail starts with the LENS mark and wordmark, then a clear entry action, primary navigation, and real research history. Group labels are quiet but readable; row actions appear on hover and remain keyboard reachable. Do not place imaginary repositories, schedules, quotas, or team agents here.

### Question composer

The composer accepts the existing question workflow. It has a clear text area, real model/search controls where those are available, concise keyboard guidance, and one primary submit action. Enter submits unless Shift is held or IME composition is active; Shift+Enter inserts a line break. Empty and loading states remain honest and preserve draft text.

### Event stream and agent cards

The canvas maps existing session, researcher, fan-out, audit, source, and report events into a readable sequence. An agent card names the real role, state, elapsed time when supplied, and a short current activity. Tool chips name actual queries or operations. A waiting, retrying, successful, and failed state must be visually and verbally distinct. If no event exists, the interface says so instead of manufacturing progress.

### Artifact inspector

The inspector is tabbed or sectioned around the real artifact set: plan, evidence/sources, report, and graph. Its empty treatment explains what will appear and how it arrives. Evidence rows expose the source title, domain or URL, and available relevance/status metadata. Report and graph summaries link or focus their canonical canvas surfaces; the inspector does not duplicate full report reading.

### Navigation, reports, and dialogs

Existing Home, Discover, Library, Graph, Skills, Settings, commands, and reports retain their working routes and semantics. The harness is a workspace mode, not a replacement for those product capabilities. Reports keep a comfortable reading measure; tables, source links, empty/error recovery, focus trapping, Escape, and reduced-motion behavior remain intact.

## Do's and Don'ts

### Do:

- **Do** translate the supplied Stitch structure and spacing into React components backed by LENS state.
- **Do** show only genuine research questions, events, tool activity, sources, plans, reports, and graph data.
- **Do** give the report canvas the largest share of visual attention.
- **Do** preserve Inter/Cairo, logical direction, visible focus, reduced motion, and dark/light semantic tokens.
- **Do** let the inspector collapse when it has no active artifact or harms reading space.
- **Do** describe empty, waiting, retrying, and failed research states explicitly.

### Don't:

- **Don't** retain Antigravity names, marks, blue/amber identity styling, decorative glows, gradients, or copied placeholder copy.
- **Don't** display fabricated PRs, commits, test passes, terminal commands, repositories, scheduled work, source counts, or agent outcomes.
- **Don't** turn the workspace into a generic IDE, a permanent blank three-pane shell, or a dashboard of equal-weight cards.
- **Don't** add an unsupported Pro tier, pretend an unimplemented control works, or claim research completion before LENS receives it.
- **Don't** sacrifice report readability, keyboard operation, or Arabic layout to reproduce a screenshot exactly.
