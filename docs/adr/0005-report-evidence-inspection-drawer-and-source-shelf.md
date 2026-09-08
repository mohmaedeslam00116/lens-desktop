# 5. Report Evidence Inspection Drawer & Facet-Grouped Source Shelf UI

## Context
1. In wide and deep multi-hop research dossiers (50–200 ingested sources across multiple complex milestones), synthesized living reports contain dense academic and technical citations (`[1]`, `[2]`...). Abrupt external browser navigation disrupts reading flow and disorients the researcher.
2. Readers require immediate, verifiable proof of claim grounding: inspecting the exact verbatim source passage, normalized hybrid relevance score, source domain authority, and assigned milestone facet without losing their place in the living document.
3. In bilingual research settings (such as Modern Standard Arabic analytical synthesis of English primary literature), researchers need side-by-side or dual-language claim-to-passage alignment to verify interpretation and translation fidelity instantly.
4. Exploring massive admitted source collections (50–200+ sources) creates severe cognitive overload when presented as an unorganized flat list. Researchers need structured organization grouped by approved plan milestones, accompanied by multi-dimensional filtering (milestone facet, citation status, relevance tier, domain, and instant keyword search).

## Decision
1. **Interactive Evidence Inspection Drawer (`EvidenceInspectionDrawer`)**:
   - Implemented as an accessible slide-over sheet (`frontend/src/components/research/EvidenceInspectionDrawer.tsx`) opening immediately upon clicking any citation pill (`[1]`, `[2]`...) in `ReportRenderer` or clicking "Inspect Evidence" in `FacetGroupedShelf`.
   - Displays:
     - Exact verbatim highlighted source passage with quotation styling and 1-click clipboard copy.
     - Contextual report claim: the exact paragraph or sentence from the living report where the citation was anchored.
     - Bilingual evidence fidelity: side-by-side comparison comparing the report claim with the primary foreign-language excerpt when cross-lingual translation occurs.
     - Normalized relevance score (0..100%) and relevance tier (`High (≥ 80%)`, `Medium (60%–79%)`, `Standard (< 60%)`).
     - Academic credibility score and source domain badge with favicon.
     - Assigned milestone facet: identifying the specific approved research plan milestone that retrieved and admitted the source.
     - Direct external link opening the canonical URL via default browser.
     - Sequential citation stepper controls (`[Previous Citation]` and `[Next Citation]`) allowing exhaustive linear inspection across all cited sources without closing and reopening the drawer.
     - Strict accessible keyboard navigation: Escape key close, focus containment, and aria modal semantics.

2. **Facet-Grouped Source Shelf (`FacetGroupedShelf`)**:
   - Implemented as a comprehensive source explorer (`frontend/src/components/research/FacetGroupedShelf.tsx`) integrated into `MessageBox` as a dedicated view mode and into `AgentWorkspace` (upgrading the verified sources tab).
   - Groups admitted sources by approved plan milestones (`ResearchPlan.milestones`), preserving plan milestone order while gracefully capturing unassigned residual discoveries.
   - Real-time aggregate telemetry bar displaying Total Admitted Sources, Cited in Report, Background Admitted, and Unique Domains count.
   - Multi-dimensional filtering across 5 orthogonal axes:
     1. **Milestone Facet**: "All Milestones" plus individual facet tabs with per-milestone counts.
     2. **Citation Status**: 1-click toggle between "All Sources", "Cited in Report Only", and "Background Admitted".
     3. **Relevance Tier**: Filtering by High, Medium, or Standard relevance tiers.
     4. **Domain**: Filtering by individual source domains from admitted evidence.
     5. **Instant Keyword Search**: Live substring search across title, URL, domain, passage, and milestone query.
   - Source Cards featuring domain badges, citation pills, snippet previews, relevance metrics, external links, and 1-click `[Inspect Evidence]` action button.

3. **Core Engine Module (`evidenceShelf.ts`)**:
   - Encapsulates all pure evidence processing, regex citation extraction (protecting code blocks, inline code, links, and GFM callouts), numeral normalization (Eastern Arabic-Indic digits), source enrichment, multi-dimensional filtering, and statistical aggregation into a deterministic, zero-flakiness engine module (`frontend/electron/engine/evidenceShelf.ts`).
   - Verified by comprehensive unit and 200-source scale stress benchmark tests in `frontend/test/evidence_shelf_drawer.test.mjs`.

## Consequences
- Readers can verify any fact or statistic in seconds without leaving their reading flow.
- Bilingual translation and interpretation accuracy is verifiable at a glance.
- Massive source collections (200+ sources) are structured into clear, readable facet groups with instant multi-dimensional filtering (<50ms).
- Strictly conforms to `BRAND.md` and `DESIGN.md` monochrome neutral aesthetics (`#111111` / `#191919`, Inter and Cairo typography, zero decorative gradients, no unsupported "Pro" badge).
