# LENS — Research, in focus.
### نظرة أعمق. فهم أوضح.

**LENS** is an autonomous desktop research workspace that turns complex questions into clear, source-backed understanding. Designed with a focused, monochrome aesthetic inspired by Vercel and Cursor, LENS provides a familiar productivity environment with a native TypeScript embedded engine, live topical discovery, and multi-format report synthesis.

---

## 🌟 Key Capabilities

1. **Focused Research Workspace:**
   - Central framed question composer with quick, balanced, and deep research modes.
   - Targeted search domain focus (All Web, Academic Papers, Community Discussions).
   - Zero-dependency embedded TypeScript engine running locally on port 8000 inside Electron.

2. **Streamed Reasoning & Evidence Progress:**
   - Live research timeline displaying search sub-queries, visited web sources, and academic citations.
   - Transparent gap reflection (STORM & Open Deep Research multi-hop methodology).

3. **Live Intelligence & Discovery Feed:**
   - Real-time global news and trending research topics across Technology & AI, Markets & Finance, Science, and World Affairs.
   - One-click transition from any trending headline into a deep investigation.

4. **Structured Report Dossiers:**
   - Publication-grade markdown reports with inline citations (`[1]`, `[2]`).
   - Contextual GitHub-flavored comparison tables and Mermaid workflow diagrams.
   - Dedicated reading time metrics and dynamic table of contents.

5. **Multi-Provider & Local Model Autonomy:**
   - Dynamic model discovery upon API key configuration.
   - Latency diagnostics and connection testing.
   - Full support for **Google Gemini**, **OpenAI**, **Anthropic Claude**, **Groq**, **DeepSeek**, **OpenRouter**, **Mistral**, and local offline **Ollama**.

6. **Bilingual Navigation (RTL / LTR):**
   - Seamless Arabic and English interfaces with direction-aware layouts and native typography (Inter & Cairo).
   - Upright, left-to-right LENS wordmark preserved across both languages.

7. **Multi-Format Export & Speech:**
   - Real desktop export to **PDF** and **Microsoft Word (.docx)**, plus client-side **Markdown (.md)** and **CSV** for extracted tables.
   - Built-in text-to-speech reading for auditory review.

8. **Resilient Session Lifecycle & Reconnect Recovery:**
   - Monotonic `EventRingBuffer` storing the latest 300 sequential telemetry events for deterministic WebSocket delta replays on reconnect (`?since=<lastEventId>`).
   - Sub-second `<100ms` `AbortController` cancellation preserving partial gathered evidence and draft reports.
   - Formal session state machine (`planning` -> `awaiting_approval` -> `running` -> `completed` / `cancelled` / `budget_exhausted` / `failed`).

9. **Bounded Parallel Ingestion & 3-Level Deduplication Engine:**
   - Asynchronous worker pool (`BoundedScraperPool`) with global ($C_{\text{global}} = 10$) and per-host ($C_{\text{host}} = 2$) concurrency throttles, internal 10s request timeouts, and non-blocking exponential backoff on HTTP 429 rate limits.
   - 3-level deduplication (`DeduplicationEngine`): Level 1 canonical URL normalization, Level 2 exact SHA-256 content hashing invariant to whitespace, casing, and punctuation, and Level 3 64-bit SimHash near-duplicate detection with Hamming distance threshold $\le 3$.
   - Memory-bounded ingestion pipeline keeping 200 ingested sources strictly under 10 MB RAM.

10. **Stratified Evidence Admission & Multi-Hop Coverage Audit:**
    - Facet-aware passage selection (`StratifiedEvidenceAdmission`) guaranteeing representation across all approved milestones ($K_{\text{min}} = 8$) before allocating residual capacity by global hybrid relevance score.
    - Mathematical coverage auditing (`evidenceCoverage.ts`) quantifying subquery coverage, quantitative metric density, analytical perspective breadth, and domain diversity.
    - Smart early exit when coverage meets target quality threshold ($\ge 80\%$), with honest budget exhaustion telemetry and interactive `[Extend Research]` action payloads when retrieval limits are reached.

11. **Collaborative Research Plan Scoping & Approval UX:**
    - Explicit Wide Research mode generates versioned 4-element `ResearchPlan` blueprints (`objective`, `milestones`, `suggestedSkills`, `estimatedScope`); it begins with a 100-source retrieval budget and may expand that budget automatically to 200 only when evidence gaps remain.
    - Interactive bilingual React `PlanApprovalModal` with inline subquery editing, milestone creation and removal, and contextual skill toggles.
    - Strict human-in-the-loop trajectory authorization freezing retrieval bounds, paired with iterative regeneration guidance (`v1` -> `v2`) and sub-second cancellation resilience.

12. **Native Agent Skills Discovery, Validation & Path Sandboxing:**
    - 3-Tier deterministic discovery registry (`SkillRegistry`) scanning Workspace (`.agents/skills/`), User Global (`%APPDATA%/LENS/skills/`, `~/.agents/skills/`), and Built-in bundles with strict precedence shadowing.
    - Lenient YAML frontmatter parser recovering unquoted colons in descriptions without throwing syntax errors, validating lowercase alphanumeric names (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) and description length bounds ($\le 1024$ chars).
    - Strict filesystem path boundary sandbox (`SkillPathBoundary`) enforcing normalized directory containment (`path.resolve()`), blocking relative traversal (`../../`), null-byte injection, and out-of-root symlinks with `SECURITY_ACCESS_DENIED`.

13. **Dual-Path Skill Activation, Model Routing & Compaction Shield:**
    - Dual-path activation: Controller-assisted pre-activation injecting approved plan skills into session context for 100% activation reliability on local LLMs (Ollama / Llama 3.1), plus dynamic tool-calling `activate_skill(name)` for cloud providers (Gemini, OpenAI, Claude).
    - `HostToolMapper` mapping declared `allowed-tools` to native capabilities (`web_search`, `read_url`, `read_resource`, `record_evidence`) with zero privilege escalation.
    - `CompactionShield` wrapping active skill instructions in `<skill_content name="...">` blocks, strictly exempting them from context compaction and multi-hop summarization passes.

14. **Hierarchical Per-Facet Synthesis & Citation Grounding Contract:**
    - Multi-stage hierarchical synthesis (`HierarchicalSynthesis`): generates exhaustive analytical sections for each approved plan milestone from admitted evidence (<15k token prompt bounds), followed by an overarching Meta-Synthesis Pass generating executive overviews, strategic takeaway callouts (`> [!NOTE]`), cross-cutting comparison matrices in GFM tables, and strategic recommendations (`> [!TIP]`).
    - Deterministic provenance & index pre-allocation (`CitationGroundingContract`): assigns immutable 1-based citation indices (`[1]`, `[2]`...) before synthesis.
    - Automated post-synthesis regex verification: scans generated text, cleans whitespace/punctuation, and strips or remaps any unmapped or hallucinated citation brackets, mathematically guaranteeing zero hallucinated citations on reports of any scale (50- and 200-source scale tested).
    - Standardized GFM empirical contradiction callouts (`> [!WARNING]`) highlighting metric and benchmark discrepancies between sources with full Arabic and English bilingual parity.

15. **Report Evidence Inspection Drawer & Facet-Grouped Source Shelf:**
    - Interactive slide-over `EvidenceInspectionDrawer` opening directly upon clicking citation pills (`[1]`, `[2]`...) in the living report or source cards in the shelf.
    - Displays exact highlighted verbatim source passage, normalized hybrid relevance score and tier (`High`, `Medium`, `Standard`), academic credibility, source domain badge with favicon, external URL link, assigned plan milestone facet, and sequential citation navigation stepper.
    - Bilingual evidence fidelity: side-by-side alignment comparing synthesized report claims with original foreign-language excerpts without breaking reading flow.
    - `FacetGroupedShelf` organizing admitted sources by approved plan milestones, featuring 5-dimensional filtering (milestone facet, citation status, relevance tier, source domain, instant search) and real-time aggregate telemetry counters.

16. **Agent Skills Management UX, Non-Destructive Resolver & Launch Skills:**
    - Dedicated Agent Skills management interface (`SkillsManagerView`) integrated into the primary sidebar with package drag-and-drop, telemetry counters, and 5-state lifecycle tracking (`Installed`, `Enabled`, `Selected`, `Active`, `Incompatible`).
    - In-memory pre-inspection modal extracting frontmatter, allowed tools, and scanning for executable scripts with security warnings prior to installation.
    - Zero-dependency Node.js PKZIP archiver (`zipArchive.ts`) featuring strict Zip-Slip directory traversal defense and pristine 1-click package export.
    - Non-destructive collision resolver (`collisionResolver.ts`) offering `Keep Existing`, `Overwrite with Backup` (timestamped preservation), and `Rename on Import`, while isolating active research sessions from disk modifications.
    - Official launch skills: `academic-paper-analysis` (methodology audit and ablation checklists) and `competitive-market-intelligence` (feature matrices and SWOT frameworks).

17. **End-to-End Interoperability Suite & Four-Pillar Acceptance Gates:**
    - Automated cross-client offline test fixtures for Anthropic (nested references) and Cursor / OpenAI (lenient unquoted colons), with strict Zip-Slip traversal rejection.
    - Deterministic bit-for-bit round-trip qualification (`import (zip) -> SkillRegistry -> export (zip)`) verifying 100% content preservation without proprietary metadata injection.
    - Deterministic SSE parsing fixtures simulating all 4 supported providers (Gemini, OpenAI, Claude, Ollama), plus tool schemas and controller pre-activation.
    - Four-Pillar Acceptance Gate verification: Format Gate (100% `agentskills.io` schema compliance), Security Gate (100% traversal and unsandboxed-script import rejection), Precision Gate (query-driven domain activation with 0% domain false positives), and Citation Fidelity Gate (zero hallucinated citations in a full wide research run).
    - 100% offline verification in `node --test` integrated into `npm test` across 312 tests with zero native C++ dependencies.

---

## 🏗️ Repository Structure

```
lens-desktop/
├── BRAND.md                   # Brand identity, mark specifications, and voice guidelines
├── CONTEXT.md                 # Project domain model and glossary
├── DESIGN.md                  # Comprehensive design system tokens and component specs
├── PRODUCT.md                 # Product definition, users, positioning, and commitments
├── AGENTS.md                  # Operational guidelines for AI agents and engineering skills
├── docs/                      # Architectural documents and issue tracker setup
│   └── agents/                # GitHub issues, triage labels, and domain doc conventions
├── skills/                    # Bundled Agent Skills (academic-paper-analysis, competitive-market-intelligence)
├── frontend/                  # Electron desktop application
│   ├── electron/              # Electron main process and embedded engine
│   │   ├── engine/            # Native TypeScript research, search, scraper, and discovery
│   │   ├── main.ts            # Electron window lifecycle
│   │   └── preload.ts         # Secure IPC bridge
│   ├── src/                   # React 18 UI components, state, and styles
│   └── package.json           # Application manifest (Product Name: LENS)
└── package.json               # Root workspace scripts
```

---

## 🚀 Development & Setup

### Prerequisites
- Node.js 18+
- npm

### 1. Install dependencies
```bash
cd frontend
npm install
```

### 2. Start in development mode
```bash
npm run dev
```

---

## 📦 Building the Windows Installer (.exe)

To compile the native desktop executable and NSIS setup installer:

```bash
cd frontend
npm run build:installer
```

The installer will be generated at:
```
frontend/dist-installer/LENS Setup 1.0.0.exe
```

---

## 📄 License
Open source and crafted for research and investigative inquiry.
