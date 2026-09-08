# 4. Hierarchical Per-Facet Synthesis & Citation Grounding Contract

## Context
1. In wide and deep multi-hop research dossiers (50–200 ingested sources across multiple complex milestones), single-pass monolithic LLM synthesis suffers from severe context degradation, prompt token overflow, and "lost-in-the-middle" attention attenuation.
2. Large Language Models frequently hallucinate reference numbers (e.g. citing `[99]` or `[42]` when only `[1]..[8]` were admitted in evidence), destroying reader trust and research provenance.
3. When primary sources report conflicting empirical data (e.g. diverging benchmark throughput, latency, parameter counts, pricing, or dates), standard LLM generation tends to blend, average, or arbitrarily select one number, concealing critical empirical trade-offs from the researcher.

## Decision
1. **Hierarchical Per-Facet Synthesis (`HierarchicalSynthesis`)**:
   - Decomposes final report generation into two coordinated phases:
     - **Phase 1 (Milestone-Level Analytical Sections)**: Synthesizes an exhaustive, publication-grade analytical section for each approved plan milestone from its admitted evidence passages. Prompts remain tightly bounded (<15k tokens), eliminating lost-in-the-middle degradation.
     - **Phase 2 (Meta-Synthesis Pass)**: Synthesizes an overarching executive summary, strategic takeaway callout (`> [!NOTE]`), cross-cutting comparison matrix (contrasting milestones, architectures, benchmarks, and trade-offs in GitHub Flavored Markdown tables), and strategic recommendations (`> [!TIP]`).
   - Assembles the sections into an integrated, publication-grade research dossier with a comprehensive Grounded References section.
   - Provides a deterministic offline fallback mode that constructs grounded sections and comparison matrices even if external LLM providers are unavailable.

2. **Deterministic Citation Grounding Contract (`CitationGroundingContract`)**:
    - Pre-allocates deterministic 1-based sequential citation indices (`[1]`, `[2]`...) to candidate excerpts before any synthesis prompt is constructed.
    - An automated post-generation regex verifier scans generated text across all sections and the final report.
    - Identifies all bracketed references; strips or remaps any unmapped, out-of-bounds, or hallucinated citation brackets, while preserving valid citations and cleaning whitespace and punctuation.
    - Robust delimiter and multilingual support: handles semicolons (`[1; 2]`), Modern Standard Arabic commas (`[1، 2]`), Arabic-Indic / Persian digits (`[١]`), Unicode dashes (`—`, `−`), and large range expansions up to 250 sources.
    - Post-strip punctuation normalization collapses duplicate delimiters, removes orphaned commas before terminal punctuation, and cleans empty bracket pairs.
    - Protects fenced code blocks, inline code, `<skill_content>` tags, markdown links (`[text](url)`), callout badges (`[!NOTE]`, `[!WARNING]`), and task list checkboxes (`- [ ]`, `- [x]`) without consuming linebreaks.
    - Executes a mandatory secondary verification sweep guaranteeing `zeroHallucinationGuaranteed = true`.

3. **Standardized Empirical Contradiction Callouts**:
   - System and milestone prompts explicitly mandate highlighting empirical disagreements using a standardized GFM alert format:
     ```markdown
     > [!WARNING]
     > **Contradiction Callout: <Topic>**
     > - Source [X] (<Domain>): <Claim A>
     > - Source [Y] (<Domain>): <Claim B>
     > *Discrepancy Analysis*: <Root cause analysis>
     ```
   - Provides full Modern Standard Arabic parity (`تعارض في البيانات ومؤشرات القياس`).
   - Features automated heuristic detection (`detectMetricContradictions`) identifying >20% numerical variance between distinct domains, proactively alerting the synthesizer.

## Consequences
- Reports remain technically dense and exhaustive regardless of total source scale (50 or 200 sources).
- Zero hallucinated citations are mathematically guaranteed in the synthesized report.
- Researchers can verify any claim via the `EvidenceInspectionDrawer` using stable, grounded citation brackets.
- Empirical conflicts between primary literature are highlighted transparently rather than obscured.
