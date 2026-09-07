# Specification: LENS Wide Research & Open Agent Skills Architecture

**Specification ID**: `SPEC-027`  
**GitHub Issue**: [#27: Spec: LENS Wide Research & Open Agent Skills Architecture](https://github.com/mohmaedeslam00116/lens-desktop/issues/27)  
**Parent Roadmap**: [#10: [Map] LENS Advanced Research: Wide Research, Verifiable Reports & Skills Roadmap](https://github.com/mohmaedeslam00116/lens-desktop/issues/10)  
**Date**: September 7, 2026  
**Status**: Ready for Agent (`ready-for-agent`)  

---

## Problem Statement

Researchers, investigative analysts, and technical professionals regularly encounter complex, high-stakes questions that cannot be answered satisfactorily by single-turn web searches or shallow AI summaries. 

Existing desktop AI research tools present several critical limitations:
1. **Shallow Source Sampling**: Standard research modes scrape only 5–15 web pages, leaving substantial blind spots on nuanced topics that require synthesizing dozens of cross-disciplinary sources.
2. **Lack of User Steering & Transparency**: The agent retrieves and writes in an uncontrollable "black box," preventing the user from inspecting or adjusting the research trajectory, subqueries, or domain scope before expensive retrieval begins.
3. **Context Degradation & Hallucinated Citations**: Attempting to feed hundreds of sources into a single generation prompt triggers "lost-in-the-middle" attention failure, resulting in superficial summaries and fabricated citation indices (`[1]`, `[2]`) detached from verifiable source passages.
4. **Isolated & Monolithic Capabilities**: Users cannot extend the research agent with specialized domain methodologies (e.g., deep scientific literature auditing, clinical trial extraction, or competitive SWOT synthesis) using open, portable industry standards (`SKILL.md`), and local offline models (e.g. Ollama) are frequently excluded from advanced agent workflows due to unreliable multi-turn tool calling.

---

## Solution

**LENS Wide Research (`بحث استقصائي موسع`)** combined with the **Open Agent Skills Standard (`agentskills.io`)** delivers an autonomous, verifiable desktop research experience that scales to hundreds of sources while keeping the user firmly in the loop:

1. **Dedicated Wide Research Mode (`ResearchMode = 'standard' | 'wide'`)**: An autonomous multi-phase engine investigating **50–200+ sources** across dozens of domains, fully backward-compatible with existing depth tiers.
2. **Collaborative Scoping Protocol**: Phase 1 generates a versioned 4-element `ResearchPlan` (objective, milestones, suggested skills, budget). The user inspects, edits subquery axes, toggles skills, and explicitly authorizes execution before retrieval begins.
3. **High-Throughput Parallel Retrieval & Deduplication**: An asynchronous worker pool (`BoundedScraperPool`) scraping 100–200 sources concurrently (10 global / 2 per-host limits, ~22.5s scrape duration) with 3-level deduplication (canonical URL, SHA-256 exact, 64-bit SimHash near-duplicate) and memory-bounded text extraction (<10 MB RAM footprint).
4. **Stratified Evidence Admission & Adaptive Audit**: Guarantees balanced representation across all approved milestones ($K_{\text{min}} = 8$), paired with mathematical evidence coverage auditing, smart early exit ($\ge 80\text{--}85\%$), and honest budget exhaustion warnings with interactive `[Extend Research]`.
5. **Hierarchical Grounded Synthesis & Zero Hallucinated Citations**: Per-milestone synthesis passes eliminate context degradation, while candidate excerpts receive pre-allocated immutable citation indices verified by automated post-generation validators, guaranteeing 100% citation grounding.
6. **Interactive Evidence Inspection UX**: A slide-over drawer (`EvidenceInspectionDrawer`) displaying verbatim source passages and bilingual side-by-side excerpts on citation badge clicks, paired with a milestone-organized source shelf (`FacetGroupedShelf`) with 1-click cited filtering.
7. **Native TypeScript Agent Skills Loader**: A zero-dependency loader discovering portable `SKILL.md` packages across workspace (`.agents/skills/`) and user AppData directories, enforcing 3-tier progressive disclosure, dual-path activation (controller pre-activation for Ollama + dynamic tool calling for cloud models), compaction shielding, non-destructive collision resolution, 1-click zip export, and shipping with two curated official launch skills (`academic-paper-analysis` and `competitive-market-intelligence`).

---

## User Stories

### Collaborative Scoping & Plan Approval
1. As a researcher, I want to review a proposed research plan before retrieval begins, so that I can ensure the agent investigates the exact axes relevant to my inquiry.
2. As an analyst, I want to add, edit, or delete research milestones (subqueries) in the proposed plan, so that I can steer the investigation toward specific topics of interest.
3. As a user, I want to toggle recommended skills on or off during plan review, so that I can decide which specialized methodologies apply to the session.
4. As a user, I want to approve, regenerate, or discard the research plan with a single click, so that I retain full control over the session lifecycle.
5. As a researcher, I want the approved research plan to strictly bind the agent's retrieval trajectory, so that the agent never drifts into irrelevant subtopics.

### Massive Source Ingestion & Adaptive Retrieval
6. As a researcher, I want LENS to investigate 100 to 200+ web pages across dozens of unique domains, so that my findings reflect comprehensive literature coverage.
7. As a user, I want massive web scraping to execute in parallel with host-rate limiting, so that hundreds of pages are ingested within ~25 seconds without triggering HTTP 429 rate limits or network congestion.
8. As a user, I want identical and near-duplicate web pages to be filtered out automatically using exact and SimHash deduplication, so that redundant content does not crowd out novel evidence.
9. As a researcher, I want evidence admission to guarantee chunks across every approved plan milestone, so that early search results do not starve later subtopics of representation.
10. As a user, I want LENS to audit evidence coverage quantitatively and exit early when coverage reaches $\ge 80\%$, so that research completes swiftly when sufficient facts have been gathered.
11. As a user, I want an honest notification if the source budget is exhausted before full coverage is reached, with an interactive `[Extend Research]` button, so that I can choose whether to allocate additional queries.

### Grounded Synthesis & Evidence Inspection
12. As a decision-maker, I want every factual claim in the research report to be backed by verifiable citations (`[1]`, `[2]`), so that I can rely on the findings with confidence.
13. As an investigator, I want an automated verifier to validate all citations post-synthesis, so that zero hallucinated or orphan citation brackets appear in the final text.
14. As a reader, I want clicking any citation badge in the report to open a slide-over drawer displaying the verbatim source passage, URL, and credibility score, without losing my reading place.
15. As an Arabic reader reading about English technical topics, I want the inspection drawer to display the original English excerpt alongside the Arabic claim, so that I can verify translation and interpretation fidelity instantly.
16. As an analyst, I want to explore all 100–200 ingested sources organized into milestone tabs in a source shelf, so that I can review the full corpus without cognitive overload.
17. As a researcher, I want a 1-click filter between "Cited in Report Only" and "All Ingested Sources", so that I can separate primary evidence from background discoveries.
18. As a professional, I want full export fidelity across PDF, DOCX, and Markdown preserving all citations as clickable footnotes and bibliographies, so that I can distribute reports to colleagues.

### Agent Skills Discovery, Activation & Management
19. As a developer, I want LENS to discover standard `SKILL.md` packages from `.agents/skills/` in my workspace and user AppData, so that I can share skills across tools like Cursor and Claude Code.
20. As a user running a local Ollama model, I want approved skills to be pre-activated into the agent's context during plan approval, so that I receive expert research guidance even without native model tool-calling.
21. As a user running advanced cloud models (Gemini, GPT-4o, Claude 3.5), I want the model to dynamically load skills mid-session via `activate_skill`, so that emerging research angles receive specialized instructions on the fly.
22. As a user, I want skill instructions to be immune from context compaction during multi-hop iterations, so that the agent never loses its specialized methodology mid-session.
23. As an academic researcher, I want to use the built-in `academic-paper-analysis` skill, so that scientific reports systematically extract benchmark metrics, ablation tables, and methodology audits.
24. As a business analyst, I want to use the built-in `competitive-market-intelligence` skill, so that commercial reports generate structured SWOT analyses and feature comparison matrices.
25. As a user, I want to drag-and-drop a skill folder or `.zip` file into LENS with an in-memory pre-inspection modal, so that I can verify its safety, author, and tools before saving.
26. As a user, I want to resolve name collisions non-destructively (keep, overwrite with backup, or rename), so that existing skills are never lost accidentally.
27. As a user, I want to export any installed skill as a clean, standard `.zip` file with a single click, so that I can use it in other agent environments.
28. As a security-conscious user, I want all skill resource paths to be strictly validated against the skill directory root, so that malicious packages cannot execute path traversal attacks.

### Session Resilience & Control
29. As a user, I want to cancel an in-progress research session in under one second, so that unresponsive searches can be halted immediately.
30. As a user cancelling research, I want partial evidence and drafts collected prior to cancellation to be preserved, so that work already completed is not lost.
31. As a user experiencing a network hiccup or page refresh, I want the WebSocket connection to replay missed events from an in-memory ring buffer, so that live research progress resumes smoothly.

---

## Implementation Decisions

### 1. Orchestration & Engine Architecture
- **Dedicated Orchestrator Seam**: Implement `WideResearchAgent` in `frontend/electron/engine/wideAgent.ts`, decoupled from the legacy `DeepResearchAgent` to safeguard existing regression-free tests.
- **5-Phase Execution Lifecycle**:
  - *Phase 1 (Collaborative Scoping)*: Generates `ResearchPlan` draft, streams to UI, and awaits user approval signal (`plan_approved`).
  - *Phase 2 (Parallel Ingestion)*: Executes high-throughput scraping across 100–200 sources using `BoundedScraperPool`.
  - *Phase 3 (Iterative Audit & Multi-Hop)*: Calculates mathematical evidence coverage across all milestones; triggers adaptive targeted queries if gaps exist; exits early if coverage $\ge 80\text{--}85\%$.
  - *Phase 4 (Hybrid Ranking & Skills)*: Ranks passages via BM25 + Dense RRF + MMR with query expansion, and applies active skill instructions.
  - *Phase 5 (Hierarchical Synthesis)*: Synthesizes per-milestone sections, followed by an executive summary, enforcing the `CitationGroundingContract`.
- **Three-Tier Evidence Memory Architecture**:
  - *Tier 1 (Raw Corpus)*: Full scraped text stored on disk or bounded memory structures (~2.4 MB for 200 sources).
  - *Tier 2 (Admitted Chunks)*: Stratified subset of high-relevance chunks ($K_{\text{min}} = 8$ per milestone, ~40–80 chunks total).
  - *Tier 3 (Synthesis Context)*: Ranked, deduplicated excerpts injected into section prompts (<32k tokens), completely preventing prompt overflow and lost-in-the-middle degradation.

### 2. Session Lifecycle, Recovery & Cancellation
- **4-State Lifecycle**: `planning` $\rightarrow$ `awaiting_approval` $\rightarrow$ `running` $\rightarrow$ terminal state (`completed` | `cancelled` | `failed`).
- **Sub-Second Cancellation**: Immediate abort propagation via `AbortController`, terminating active fetch requests in `<1s` while retaining partial evidence in a draft document.
- **Monotonic Event Ring Buffer**: Circular in-memory buffer (`EventRingBuffer`) caching the last 200–300 sequential events (`eventId: 1, 2, 3...`) per active session, enabling deterministic delta replay to the React frontend on WebSocket reconnects.

### 3. Ingestion & Retrieval Pipeline
- **Bounded Worker Pool (`BoundedScraperPool`)**: Global concurrency cap of 10 workers, per-hostname cap of 2 workers, 10s request timeouts, and exponential backoff on HTTP 429.
- **Three-Level Deduplication**:
  1. Canonical URL normalization (stripping tracking query params, fragments, trailing slashes).
  2. Exact SHA-256 content hashing.
  3. 64-bit SimHash near-duplicate detection with Hamming distance threshold $\le 3$.
- **Stratified Evidence Admission**: Guarantees a minimum quota of admitted passages ($K_{\text{min}} = 8$) for every approved milestone before allocating residual capacity by global hybrid relevance score.

### 4. Grounded Synthesis & Evidence Verification
- **Hierarchical Per-Facet Synthesis**: Sections are generated sequentially or in parallel milestone by milestone, followed by an executive meta-synthesis pass.
- **Citation Grounding Contract**: Source passages receive immutable brackets (`[1]`, `[2]`, ...) before generation. A post-synthesis regex validator inspects every bracket in the output against the admitted catalog; unmatched brackets are stripped or remapped, guaranteeing zero hallucinated citations.
- **Contradiction Callouts**: Models are instructed to surface conflicting data points explicitly between sources (e.g., conflicting revenue or benchmark figures).

### 5. Frontend Evidence Inspection & Source Shelf
- **`EvidenceInspectionDrawer`**: A slide-over sheet opening on citation badge click, presenting the verbatim source passage, publication metadata, domain favicon, direct external links, and bilingual side-by-side excerpts when Arabic text cites English sources.
- **`FacetGroupedShelf`**: A tabbed source explorer grouping all ingested sources by plan milestones, featuring 1-click toggling between `Cited in Report Only` and `All Ingested Sources`, plus instant keyword search.
- **Coverage Status & Extension**: Visual audit gauge showing milestone completion percentages, budget stop callouts, and an interactive `[Extend Research]` action.

### 6. Open Agent Skills Architecture (`SKILL.md`)
- **Native TypeScript Integration**: Pure Node.js/TypeScript loader in `frontend/electron/engine/skills/` with zero external agent framework dependencies and zero C++ native addons.
- **Discovery Hierarchy & Precedence**:
  1. Workspace: `<workspace>/.agents/skills/*/SKILL.md` (and alias `.lens/skills/`).
  2. User Global: `%APPDATA%/LENS/skills/*/SKILL.md` (and `~/.agents/skills/`).
  3. Built-in Bundle: Application-shipped official skills.
  *Precedence*: Workspace shadows User, which shadows Built-in.
- **Progressive Disclosure**:
  - Tier 1 (Catalog): `name` and `description` (~50–100 tokens per skill) disclosed at session start.
  - Tier 2 (Instructions): Full `SKILL.md` markdown loaded upon activation (<5000 tokens).
  - Tier 3 (Resources): Sub-files (`references/*`) loaded strictly on demand.
- **Lenient Parsing & Validation**: Validates `name` syntax `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` and `description` length. Automatically rescues unquoted colons in YAML descriptions to maintain cross-client compatibility with community skills.
- **Dual-Path Activation Strategy**:
  - *Controller Pre-Activation*: Selected skills in approved `ResearchPlan` are pre-injected into context, ensuring 100% activation reliability for local Ollama models.
  - *Dynamic Model Tool-Calling*: High-tier models (Gemini, GPT-4o, Claude) can dynamically invoke `activate_skill(name)`.
- **Compaction Shield (`<skill_content>`)**: Active skill instructions are wrapped in dedicated XML-style delimiters and strictly exempted from context compaction/summarization algorithms during multi-hop rounds.
- **Path Sandboxing (`SkillPathBoundary`)**: All secondary resource accesses resolve strictly within the parent skill root via `path.resolve()`, throwing `SECURITY_ACCESS_DENIED` on any directory traversal attempts.
- **Skills Management & Export UX**:
  - Drag-and-drop folder / `.zip` import with an in-memory pre-inspection modal.
  - Canonical 5-state lifecycle: `Installed`, `Enabled`, `Selected`, `Active`, `Incompatible`.
  - Non-destructive collision resolution with automated timestamped `.backup` directories.
  - 1-click standard `.zip` export preserving byte-for-byte fidelity without LENS-specific metadata.
- **Two Official Launch Skills**:
  - `skills/academic-paper-analysis/`: Specialized literature extraction with `methodology-audit.md` and `ablation-checklist.md`.
  - `skills/competitive-market-intelligence/`: Strategic commercial intelligence with `feature-matrix-template.md` and `swot-framework.md`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Focus**: Tests must exercise external public interfaces (`executeWideResearch`, `discoverSkills`, `loadSkill`, `exportPackage`), verifying observable outputs (events emitted, passages admitted, reports synthesized, zip packages generated) rather than internal private variables or helper functions.
- **Determinism**: Tests must be 100% reproducible offline without flakiness, relying on deterministic mocks for external networks and LLM provider endpoints.

### Tested Modules & Seams
1. **`WideResearchAgent` Seam**:
   - End-to-end 5-phase execution flow.
   - Plan generation and approval checkpoint blocking.
   - Bounded scraping concurrency and rate-limit backoff.
   - 3-level deduplication (canonical URL, SHA-256, SimHash).
   - Stratified evidence admission quota per milestone.
   - Adaptive multi-hop gap auditing and early exit ($\ge 80\%$).
   - Hierarchical synthesis with zero hallucinated citations.
   - Sub-second `AbortController` cancellation preserving partial evidence.
2. **`SkillRegistry` & `SkillLoader` Seam**:
   - 3-tier discovery hierarchy and deterministic precedence shadowing.
   - Lenient YAML frontmatter validation and diagnostic recovery.
   - 3-tier progressive disclosure token bounding.
   - Dual-path activation across mock providers (Gemini, OpenAI, Claude, Ollama).
   - Compaction shielding preventing skill loss during multi-hop compaction.
   - `SkillPathBoundary` path traversal and ZipSlip rejection.
   - Bit-for-bit round-trip import and export verification.
3. **Prior Art in Codebase**:
   - Builds upon the existing 78 tests across 26 suites in `frontend/test/` (`embeddings.test.mjs`, `bm25_rrf.test.mjs`, `evidence_coverage.test.mjs`, `mmr.test.mjs`, `query_expansion.test.mjs`, `embedding_cache.test.mjs`).

---

## Out of Scope

- **Phase 2 Executable Scripts (`phase:2-runtime` / Issue #19)**: Arbitrary script execution (running Python/Bash scripts inside skills) is deferred to Phase 2 runtime sandboxing. Phase 1 supports instruction-only and reference-based skills.
- **Proprietary Vendor Lock-in**: No custom, closed manifest formats or proprietary SDK requirements.
- **Paid Skill Marketplace / Cloud Distribution**: No cloud-hosted skill repository or payment processing; skills are managed locally via filesystem and zip packages.
- **Native C++ Compilation**: Zero native C++ node addons; pure Node.js/TypeScript only.
- **Autonomous Budget Expansion**: The agent cannot exceed the user-authorized source or time budget without explicit human approval via `[Extend Research]`.

---

## Further Notes

- **Brand & Visual Identity**: Strictly adheres to `BRAND.md` and `DESIGN.md` (monochrome neutral palette `#111111` / `#191919`, Inter and Cairo typography, concentric lens mark, no decorative gradients).
- **Internationalization**: Full Arabic and English bilingual parity across all research reports, inspection drawers, source shelves, and skill lifecycle states.
- **Triage Status**: Published directly as `ready-for-agent` for tracer-bullet ticket breakdown (`/to-tickets`).
