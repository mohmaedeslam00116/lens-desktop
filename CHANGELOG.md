# Changelog

All notable changes to the **LENS** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- **In-flight scraper cancellation**:
  - Added caller `AbortSignal` support to `PageScraper.scrape` combining caller cancellation with timeout signal to abort underlying `fetch`.
  - Forwarded caller cancellation `sig` through `BoundedScraperPool`.
  - Added regression test with local slow server verifying in-flight cancellation.
- **Skill import path traversal protection**:
  - Normalized and resolved extracted paths in `SkillManagerService.importSkill`.
  - Strictly rejected nested traversal (`nested/../../`), absolute paths, and Windows-drive paths escaping `destinationDir`.
  - Added comprehensive security traversal tests for nested traversal, absolute paths, and Windows-drive paths.
- **Numeric Markdown link preservation**:
  - Preserved valid Markdown links with numeric labels (e.g. `[1](url)`, `[12](url)`) in `CitationGroundingContract` without stripping or mistaking them for citations.
  - Continued robustly stripping ungrounded and malformed unlinked citation brackets.
  - Added tests covering numeric links, ordinary links, and malformed Markdown.
- **Wide-search cancellation**:
  - Added `AbortSignal` support through `WideResearchAgentDependencies.search`, `discoverUntilBudget`, and `MultiSearchProvider.search`.
  - Passed cancellation signal through to underlying provider requests.
  - Added regression test verifying an already-running search is aborted promptly.
- **Historical report telemetry isolation**:
  - Bound displayed telemetry in `MessageBox` to `activeReport` rather than global search state.
  - Persisted `wideTelemetry` and `wideExpansionHistory` on historical reports.
  - Added test selecting multiple historical reports and verifying per-report telemetry isolation.
- **Bounded export request body size**:
  - Added `MAX_JSON_REQUEST_SIZE` (2 MB) limit to `parseJsonBody` in embedded server.
  - Terminated stream and returned HTTP 413 Payload Too Large when request body exceeds limit while keeping valid exports operational.
  - Added test coverage for valid and oversized payloads.

### Added
- **Explicit Wide Research Completion ([#27](https://github.com/mohmaedeslam00116/lens-desktop/issues/27))**:
  - Dedicated `WideResearchAgent` with mandatory plan approval, a 100-source initial retrieval budget, evidence-gap-driven budget expansion capped at 200, hybrid evidence admission, hierarchical synthesis, and citation-grounding verification.
  - Visible Arabic/English Standard Research and Wide Research controls, an approved-plan budget summary, and live source-stage telemetry with the reason for every expansion.
  - Implemented desktop `POST /api/export/pdf` and `POST /api/export/docx` endpoints. PDF uses Chromium’s print engine; DOCX is a valid, bidirectional OOXML package generated without native dependencies.
  - Added deterministic tests for wide-agent boundaries, explicit mode routing, UI request construction, DOCX package contents, export HTTP responses, and malformed export payload rejection.
- **End-to-End Interoperability Suite & Four-Pillar Acceptance Gates ([#37](https://github.com/mohmaedeslam00116/lens-desktop/issues/37))**:
  - Automated Cross-Client Test Fixtures (`frontend/test/fixtures/skills/`):
    - `anthropic-reference-skill`: Anthropic-style skill package with complex YAML metadata, license declarations, and deeply nested reference documents (`references/nested/deep-methodology.md`, `references/citation-policy.md`).
    - `colon-description-skill`: Cursor / OpenAI-compatible skill format featuring unquoted colons in description fields verified through lenient YAML frontmatter parsing.
    - `adversarial-zipslip-skill`: Adversarial test fixtures with path traversal vectors (`../../etc/passwd`, `..\..\Windows\System32`, `subdir/../../etc/hosts`, bare `..`, null-byte injection) confirming strict rejection with `SECURITY_ACCESS_DENIED`.
  - Bit-for-Bit Round-Trip Qualification:
    - End-to-end `import (zip) -> SkillRegistry -> export (zip)` pipeline test verifying every text and binary package entry re-exports with identical bytes and no proprietary metadata (`.lens-meta`, `.lens-config`, `.git/`).
  - Deterministic Mock SSE Stream Fixtures (4 Supported Providers):
    - Google Gemini: simulated SSE `functionCall` part parsing and dynamic tool invocation loop.
    - OpenAI / OpenAI-Compatible: simulated SSE `tool_calls` with JSON arguments parsed and dispatched to `activate_skill`.
    - Anthropic Claude: simulated SSE `tool_use` content blocks with input schema parsing.
    - Ollama (Local): simulated controller-assisted pre-activation injecting shielded instructions into session context with tool schema exclusion.
    - Verified tool format schemas (`LLMToolDefinition`) across all 4 providers via `ModelClient.formatProviderTools`.
  - Four-Pillar Acceptance Gate Verification:
    - *Format Gate*: 100% compliance with `agentskills.io` specification across all on-disk fixtures and official launch skills (`academic-paper-analysis`, `competitive-market-intelligence`), rejecting missing names, missing descriptions, oversized descriptions (>1024 chars), and invalid tool names.
    - *Security Gate*: 100% rejection rate for a committed ZipSlip fixture (`../../`), absolute path escapes, null-byte injection, and un-sandboxed script package imports (`.py`, `.sh`, `.exe`, `.ps1`, `.bat`).
    - *Precision Gate*: query-driven activation of matching domain skills with 0% domain false positives on irrelevant queries, also verifying exclusion of disabled skills.
    - *Citation Fidelity Gate*: 100% verified citation retention across context compaction passes via `CompactionShield`, in-memory session snapshot isolation, and a full wide research run that strips hallucinated citation indices.
  - Test Suite Integration:
    - Added `frontend/test/interoperability_acceptance_gates.test.mjs` with 36 comprehensive tests integrated into `npm test` (`node --test`), keeping CI 100% green across 312 tests and 85 suites with zero native C++ dependencies.
- **Agent Skills Management UX, Non-Destructive Resolver & Launch Skills ([#36](https://github.com/mohmaedeslam00116/lens-desktop/issues/36))**:
  - Implemented Two Official Launch Skills (`skills/academic-paper-analysis/` & `skills/competitive-market-intelligence/`):
    - `academic-paper-analysis`: standardized scientific literature extraction with `SKILL.md`, `references/methodology-audit.md`, and `references/ablation-checklist.md`.
    - `competitive-market-intelligence`: commercial benchmarking with `SKILL.md`, `references/feature-matrix-template.md`, and `references/swot-framework.md`.
  - Pure Node.js Zero-Dependency PKZIP Archiver (`frontend/electron/engine/skills/zipArchive.ts`):
    - Pure TypeScript/Node.js PKZIP 2.0 archiver using built-in `node:zlib` (`deflateRawSync`/`inflateRawSync`) and standard CRC-32 table with zero external C++ native dependencies.
    - Strict Zip-Slip directory traversal attack defense rejecting `../`, absolute root escapes, and null-byte injection with `SECURITY_ACCESS_DENIED`.
    - Automatic exclusion of `.git/`, `.DS_Store`, `Thumbs.db`, `.env`, and sensitive files during export.
  - Non-Destructive Collision Resolver (`frontend/electron/engine/skills/collisionResolver.ts`):
    - Provides 3 explicit resolution strategies: `Keep Existing` (aborts import without disk writes), `Overwrite with Backup` (creates timestamped `.backup_<ISO_TIMESTAMP>` folder), and `Rename on Import` (auto-renames directory and rewrites frontmatter `name:`).
    - In-memory loaded snapshot isolation protecting active running research sessions from concurrent disk modifications.
  - Engine Skills Management Service & REST Endpoints (`frontend/electron/engine/skills/service.ts` & `frontend/electron/engine/server.ts`):
    - In-memory pre-inspection (`POST /api/skills/inspect`) extracting frontmatter, allowed tools, and scanning for executable scripts (`.sh`, `.bat`, `.ps1`, `.js`, etc.) with security warnings without disk writes.
    - 5-state lifecycle management (`Installed`, `Enabled`, `Selected`, `Active`, `Incompatible`).
    - 1-click enable/disable toggle (`POST /api/skills/toggle`), ZIP package import with collision resolution (`POST /api/skills/import`), and pristine export (`GET /api/skills/export`).
  - Skills Manager UI (`frontend/src/components/skills/SkillsManagerView.tsx`):
    - Primary navigation tab in `Sidebar.tsx` with `Sparkles` icon and full Arabic RTL / English LTR bilingual parity adhering to `BRAND.md` and `DESIGN.md` monochrome palette (`#111111`, `#191919`).
    - Drag-and-drop zone and file picker for `.zip` packages, telemetry header counters, and 5-state lifecycle status badges.
    - In-memory pre-inspection modal with script security warnings and interactive collision resolution dialog.
  - Architecture Decision Record & Documentation:
    - Recorded ADR-0006 (`docs/adr/0006-agent-skills-management-and-collision-resolution.md`).
    - 100% offline test coverage in `frontend/test/skills_management_resolver.test.mjs` verifying ZIP roundtrip fidelity, Zip-Slip rejection, collision resolution, pre-inspection, 5-state badges, and launch skills validation.
- **Report Evidence Inspection Drawer & Facet-Grouped Source Shelf UI ([#35](https://github.com/mohmaedeslam00116/lens-desktop/issues/35))**:
  - Implemented `EvidenceInspectionDrawer` (`frontend/src/components/research/EvidenceInspectionDrawer.tsx`):
    - Accessible slide-over drawer with backdrop scrim, keyboard Escape listener, focus trapping, and bidirectional LTR/RTL support.
    - Displays exact highlighted verbatim source passage, normalized relevance score (0..100%), relevance tier (`High`, `Medium`, `Standard`), academic credibility indicator, domain badge with favicon, canonical title, and direct external link.
    - Assigned plan milestone facet display with milestone badge and subquery rationale.
    - Sequential citation stepper navigation (`[← Prev]` / `[Next →]`) for hopping between cited sources.
    - Side-by-side bilingual claim-to-excerpt verification grounding Modern Standard Arabic report synthesis directly against English primary literature excerpts.
  - Implemented `FacetGroupedShelf` (`frontend/src/components/research/FacetGroupedShelf.tsx`):
    - Milestone-organized source explorer grouping admitted sources by approved plan milestones with fallback for general background research.
    - Header telemetry bar with aggregate metrics: Total Admitted, Cited in Report, Background Context, and Unique Domains.
    - 5-dimensional filtering: milestone facet tabs, source domain select, relevance tier dropdown, citation status toggle (`all`, `cited`, `background`), and instant keyword search.
    - Responsive source cards with domain favicons, relevance score pills, citation badges, excerpt preview, and 1-click `[Inspect Evidence]` action.
  - Pure Engine & Client Evidence Shelf Utilities (`frontend/electron/engine/evidenceShelf.ts` & `frontend/src/utils/evidenceShelf.ts`):
    - Multilingual citation index extraction (`extractCitationIndicesFromMarkdown`): extracts `[N]` references while protecting fenced code blocks, inline code, links (`[text](url)`), callout blocks (`[!NOTE]`, `[!WARNING]`), and task list checkboxes (`[ ]`, `[x]`). Normalizes Eastern Arabic numerals.
    - Source enrichment (`enrichSourcesWithCitations`): maps citation indices and cited status to source items.
    - Multi-dimensional filtering (`filterSources`): applies 5-filter predicate pipeline.
    - Facet grouping (`groupSourcesByMilestone`): groups sources by milestone ID, tracking cited/background counts.
    - Metrics computation (`computeShelfStats`): calculates total, cited, background, unique domains, and average relevance score.
  - UI Component Integration:
    - `CitationBadge` (`frontend/src/components/vane/CitationBadge.tsx`): Added `onInspect` callback enabling 1-click pill activation from inline report text, plus enhanced hover popovers with passage snippets and relevance scores.
    - `ReportRenderer` (`frontend/src/components/vane/ReportRenderer.tsx`): Bound `onInspectCitation` down to all `CitationBadge` instances; added "Sources Shelf" shortcut button in the reading stats bar.
    - `MessageBox` (`frontend/src/components/vane/MessageBox.tsx`): Added `shelf` view mode pill alongside `formatted` and `raw`, rendering `FacetGroupedShelf`, and embedded `EvidenceInspectionDrawer` overlay.
    - `AgentWorkspace` (`frontend/src/components/vane/AgentWorkspace.tsx`): Upgraded TAB 4 (`sources` tab) to render `FacetGroupedShelf` with active research plan milestones.
    - `App.tsx`: Preserved `plan` on `ReportData` and forwarded to `MessageBox`.
  - Localization & Domain Documentation:
    - Added bilingual translation dictionaries (`ar` and `en`) in `frontend/src/i18n/translations.ts` for all drawer and shelf UI controls.
    - Architecture Decision Record (`docs/adr/0005-report-evidence-inspection-drawer-and-source-shelf.md`): Documents Evidence Inspection Drawer & Facet-Grouped Source Shelf architecture.
    - Updated `CONTEXT.md` with domain definitions for `EvidenceInspectionDrawer` and `FacetGroupedShelf`.
    - Updated `README.md` with Key Capabilities entry for the Report Evidence Inspection Drawer & Facet-Grouped Source Shelf.
  - Verification Suite:
    - Comprehensive 32-test unit, edge-case, and 200-source scale stress suite (`frontend/test/evidence_shelf_drawer.test.mjs`) verifying citation extraction, markdown element protection, numeral normalization, enrichment, filtering (including citation index & hashtag search), range citation claim grounding, bilingual script predominance, milestone grouping, and drawer navigation.
- **Hierarchical Per-Facet Synthesis & Citation Grounding Contract ([#34](https://github.com/mohmaedeslam00116/lens-desktop/issues/34))**:
  - Implemented `HierarchicalSynthesis` (`frontend/electron/engine/synthesis.ts`):
    - Multi-stage hierarchical synthesis architecture: generates exhaustive, publication-grade analytical sections for each approved plan milestone from admitted evidence passages (<15k token prompt bounds), followed by an overarching Meta-Synthesis Pass.
    - Meta-synthesis pass generating executive overviews, strategic takeaway callouts (`> [!NOTE]`), cross-cutting comparison matrices contrasting milestones and metrics in GFM tables, and prioritized strategic recommendations (`> [!TIP]`).
    - Deterministic offline fallback mode constructing grounded sections, comparison matrices, and references even when external LLM providers are unavailable.
  - Implemented `CitationGroundingContract` (`frontend/electron/engine/synthesis.ts`):
    - Pre-allocates deterministic 1-based sequential citation indices (`[1]`, `[2]`...) to candidate passages prior to synthesis.
    - Automated post-synthesis regex verifier that scans generated text, cleans whitespace/punctuation, and strips or remaps any unmapped, out-of-bounds, or hallucinated citation brackets.
    - Comprehensive multilingual and academic citation delimiter support: recognizes semicolons (`[1; 99]`), Modern Standard Arabic commas (`[1، 99]`), Arabic-Indic and Persian numeral normalization (`[١]` -> `[1]`), Unicode dash range variants (em-dash `—`, minus sign `−`), and large multi-source range bounding up to 250 items.
    - Advanced post-strip punctuation normalization: collapses duplicate delimiters, removes orphaned commas/semicolons before terminal punctuation, and eliminates empty bracket pairs.
    - Strict protection for fenced and inline code blocks, `<skill_content>` tags, markdown links (`[text](url)`), callout badges (`[!NOTE]`, `[!WARNING]`), and task list checkboxes (`- [ ]`, `- [x]`) with newline preservation.
    - Mandatory secondary verification sweep guaranteeing `zeroHallucinationGuaranteed = true` across dossiers of any scale.
    - Internal bracket sanitization for verbatim snippets in Grounded References to prevent false citation leaks.
  - Empirical Contradiction Callouts:
    - Instructs models via system and milestone prompts to detect and call out empirical disagreements between admitted sources.
    - Standardized GFM alert format (`> [!WARNING]`) with full Modern Standard Arabic and English bilingual parity.
    - Automated heuristic detection (`detectMetricContradictions`) identifying >20% numerical variance between distinct domains, proactively alerting the synthesizer.
    - Extraction and parsing helper (`extractContradictionCallouts`) recovering structured claims and discrepancy analyses from report text.
  - Verification Suite & ADR:
    - Architecture Decision Record (`docs/adr/0004-hierarchical-synthesis-citation-grounding.md`): Documents the hierarchical synthesis architecture and zero-hallucination verification contract.
    - Comprehensive 26-test unit, scale, and multilingual edge-case suite (`frontend/test/hierarchical_synthesis_grounding.test.mjs`) verifying deterministic indexing, regex verification, element preservation, contradiction formatting, and zero hallucinated citations on 50-source and 200-source synthesized reports.
- **Dual-Path Skill Activation, Model Routing & Compaction Shield ([#33](https://github.com/mohmaedeslam00116/lens-desktop/issues/33))**:
  - Implemented `CompactionShield` (`frontend/electron/engine/skills/compactionShield.ts`):
    - Tags active skill instructions with `<skill_content name="..."> ... </skill_content>`.
    - Enforces strict exemption contracts: preserves active skill instructions untouched across recursive context summarization, multi-hop compaction, and context pruning passes.
    - Automatic placeholder extraction, restoration, and failsafe re-append guarantee zero skill context loss.
  - Implemented `HostToolMapper` (`frontend/electron/engine/skills/hostToolMapper.ts`):
    - Maps declared `allowed-tools` to native LENS runtime capabilities (`web_search`, `read_url`, `read_resource`, `record_evidence`).
    - Enforces zero privilege escalation: unmapped or unknown tools produce diagnostic notices rather than throwing errors or executing arbitrary commands.
  - Implemented `SkillActivationManager` (`frontend/electron/engine/skills/activation.ts`):
    - Path 1 (Controller-Assisted Pre-activation): Injects approved `ResearchPlan.suggestedSkills` directly into session prompt context, ensuring 100% activation reliability on models without tool-calling (e.g. Ollama / Llama 3.1).
    - Path 2 (Dynamic Tool Calling `activate_skill`): Registers standardized tool schema for tool-capable providers (Gemini, OpenAI, Claude), dynamically loading and returning shielded skill instructions at runtime.
    - Emits live telemetry event `skill_activated` with method, scope, and tool mappings.
  - Integrated with `DeepResearchAgent` (`frontend/electron/engine/agent.ts`):
    - Automatically pre-activates plan skills upon session execution and binds active skill rules into LLM synthesis prompts.
  - 17 comprehensive unit tests (`frontend/test/skill_activation_compaction_shield.test.mjs`) verifying compaction protection, tool mapping, dual-path activation, and agent integration.
- **Native Agent Skills Discovery, Validation & Path Sandboxing ([#32](https://github.com/mohmaedeslam00116/lens-desktop/issues/32))**:
  - Implemented 3-Tier `SkillRegistry` (`frontend/electron/engine/skills/registry.ts`):
    - Priority-based deterministic discovery hierarchy: Workspace (`<workspace>/.agents/skills/`, priority 1) > User Global (`%APPDATA%/LENS/skills/`, `~/.agents/skills/`, priority 2) > Built-in Bundle (`<resources>/skills/`, priority 3).
    - Deterministic precedence shadowing: Higher-priority scopes cleanly shadow duplicate skill names from lower scopes without collision or crash.
    - Lightweight Tier 1 catalog disclosure via `listSummaries()`, providing token-efficient metadata (`name`, `description`, `scope`, `allowedTools`) at session initialization.
    - Resilient discovery error handling: records diagnostic reports for invalid skill directories while continuing enumeration across valid skills.
  - Lenient YAML Frontmatter Parser (`frontend/electron/engine/skills/parser.ts`):
    - Recovers unquoted colons inside `description` fields without failing, ensuring full compatibility with community skills and URL references.
    - Strict validation: enforces lowercase alphanumeric naming (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`), non-empty description bounded to $\le 1024$ characters, and structured `allowed-tools` array normalization.
  - Strict Security Path Sandboxing (`frontend/electron/engine/skills/pathBoundary.ts`):
    - `SkillPathBoundary` enforcing normalized containment resolution (`path.resolve()`).
    - Rejects path traversal (`../../`), root escapes, null-byte poisoning (`\0`), and out-of-root symlink dereferencing by throwing `SECURITY_ACCESS_DENIED`.
    - Safe helper methods: `resolveSafePath()`, `readResource()`, `listFiles()`, and `existsSync()`.
  - Native Skill Package Loader (`frontend/electron/engine/skills/loader.ts`):
    - Validates `SKILL.md` / `skill.md` presence, extracts frontmatter, and provides safe secondary resource retrieval.
  - Comprehensive 22-test unit suite (`frontend/test/skills_discovery_sandboxing.test.mjs`) verifying lenient parsing, frontmatter validation, path traversal defense, symlink sandboxing, 3-tier precedence shadowing, and fault-tolerant catalog discovery.
- **Collaborative Research Plan Scoping & Approval UX ([#31](https://github.com/mohmaedeslam00116/lens-desktop/issues/31))**:
  - Implemented Phase 1 Plan Scoping Generator (`frontend/electron/engine/scoping.ts`):
    - Generates versioned 4-element structured `ResearchPlan` (`objective`, `milestones`, `suggestedSkills`, `estimatedScope`) for wide and storm research modes.
    - Native bilingual milestone decomposition: generates coherent Arabic subqueries and rationales for Arabic RTL queries and English technical milestones for English queries.
    - Contextual skill suggestion heuristic: recommends domain-specific agent skills (`academic-paper-analysis`, `empirical-data-extraction`, `comparative-synthesis`, `bilingual-cross-lingual-bridge`, `web-retrieval-curator`).
    - Plan regeneration engine (`regenerateResearchPlan`) supporting iterative user guidance and monotonic version incrementing (`v1` -> `v2`).
    - Robust plan schema validation (`validateResearchPlan`).
  - Enhanced Session Lifecycle Protocol (`frontend/electron/engine/sessionLifecycle.ts`):
    - Added `submitPlanProposed(plan)`: transitions session state to `awaiting_approval` and emits stamped `plan_proposed` event.
    - Live milestone and skill editing via `updatePlan(updatedPlan)` emitting `plan_updated`.
    - Plan trajectory authorization and freeze via `approvePlan(approvedPlan)` transitioning state to `running` and emitting `plan_approved`.
    - Graceful plan rejection via `rejectPlan(reason)` transitioning state to `cancelled` and emitting `plan_rejected`.
    - Retrieval authorization gatekeeper: `isPlanAuthorized()` strictly prevents unauthorized wide retrieval execution.
    - Architecture Decision Record (`docs/adr/0001-collaborative-plan-authorization-gate.md`): Documents the Phase 1 collaborative scoping gate and trajectory freezing rationale.
  - Retrieval Trajectory Freezing (`frontend/electron/engine/agent.ts`):
    - When an approved research plan is provided on `WideResearchRequest`, `DeepResearchAgent` skips independent LLM subquery decomposition and strictly binds initial subqueries to the approved milestone queries.
  - Interactive React Plan Approval Modal (`frontend/src/components/research/PlanApprovalModal.tsx`):
    - Full bilingual support (Arabic RTL and English LTR) conforming to `BRAND.md` monochrome neutral aesthetics (#111111 / #191919 / #FAFAF9, Inter and Cairo typography).
    - Milestone management: inline editing for subquery and rationale, milestone removal with minimum boundary guards, and dynamic "Add Milestone" form.
    - Suggested skill toggle pills with primary color inversion when active.
    - Scope summary indicators for target sources and maximum hops.
    - Action controls: `[Discard]` (`إلغاء`), `[Regenerate]` (`إعادة صياغة الخطة`), and `[Approve & Start]` (`اعتماد وبدء البحث`).
    - Full accessible keyboard navigation and focus trapping via `useDialogFocus`.
  - Embedded Server Protocol & WebSocket Actions (`frontend/electron/engine/server.ts`, `frontend/src/App.tsx`):
    - Standardized WebSocket bidirectional action handlers: `plan_approved`, `plan_rejected`, `plan_regenerate`.
    - Added fallback REST endpoints: `POST /api/research/plan/approve`, `POST /api/research/plan/reject`, `POST /api/research/plan/regenerate`.
    - Refactored frontend action dispatcher `sendPlanAction` eliminating duplicate communication logic.
  - Comprehensive 12-test unit suite (`frontend/test/plan_scoping_lifecycle.test.mjs`) covering 4-element schema generation, Arabic/English bilingual generation, schema validation, lifecycle state transitions, milestone editing, approval freezing, graceful rejection, DeepResearchAgent trajectory binding, and manager delegation.
- **Stratified Evidence Admission & Multi-Hop Coverage Audit ([#30](https://github.com/mohmaedeslam00116/lens-desktop/issues/30))**:
  - Implemented `StratifiedEvidenceAdmission` (`frontend/electron/engine/admission.ts`):
    - Guarantees minimum quota allocation $K_{\text{min}} = 8$ admitted candidate chunks per approved research plan milestone before allocating residual capacity by global hybrid relevance score.
    - Handles under-quota milestones gracefully by admitting all available candidates and returning spare quota slots to the residual pool.
    - Proportional fairness bounding when $N_{\text{milestones}} \times K_{\text{min}} > M_{\text{max}}$, preventing subtopic starvation.
    - Exposes granular milestone telemetry (`candidateCount`, `admittedQuotaCount`, `admittedResidualCount`, `totalAdmittedCount`, `quotaSatisfied`, `underQuotaShortfall`).
  - Seamless integration with mathematical evidence coverage auditing (`evidenceCoverage.ts`):
    - Multi-facet audit quantifying subquery topic coverage, empirical metric density, analytical perspective aspects (architecture, benchmarks, risks), and domain diversity.
    - Smart early exit when admitted evidence satisfies coverage quality threshold ($\ge 80\%$), transitioning directly to synthesis without redundant retrieval passes.
    - Adaptive multi-hop triggering synthesizing targeted gap queries when coverage $< 80\%$ and budget remains.
    - Honest budget exhaustion telemetry emitting `budget_exhausted` events with detailed coverage deficits and interactive `[Extend Research]` action payloads (`suggestedAdditionalSources: 20`, `suggestedAdditionalHops: 1`).
    - Full Arabic and English bilingual parity across recommendations, gap descriptions, and action buttons.
  - Comprehensive 9-test unit suite (`frontend/test/stratified_admission.test.mjs`) verifying quota guarantees, under-quota residual pooling, early exit behaviors, and honest budget exhaustion.
- **Bounded Parallel Ingestion & 3-Level Deduplication Engine ([#29](https://github.com/mohmaedeslam00116/lens-desktop/issues/29))**:
  - Implemented 3-level deduplication engine (`frontend/electron/engine/dedup.ts`):
    - Level 1: Canonical URL normalization (stripping tracking query parameters such as `utm_*`, `fbclid`, `ref`, stripping default ports and URL fragments, lowercasing hostname/protocol, sorting query parameters deterministically, and stripping trailing slashes).
    - Level 2: Exact SHA-256 content hashing invariant to whitespace, capitalization, and punctuation, preserving multilingual Unicode alphanumeric tokens across Arabic and English.
    - Level 3: 64-bit SimHash fingerprinting with term-frequency token weighting and Hamming distance threshold $\le 3$ for fast near-duplicate and syndicated content detection across Arabic and English.
  - Implemented `BoundedScraperPool` (`frontend/electron/engine/scraperPool.ts`):
    - Strict global concurrency ceiling ($C_{\text{global}} = 10$) and per-hostname concurrency ceiling ($C_{\text{host}} = 2$).
    - Configurable timeouts (10s default) with exponential backoff on HTTP 429/503 rate-limit responses.
    - Strict resident memory bounding, keeping 200 ingested sources under 10 MB RAM via per-page content length caps and streaming deduplication.
    - Sub-second cancellation via `AbortSignal`.
    - Integrated with `DeduplicationEngine` for pre-scraping URL checks and post-scraping content admission.
  - Comprehensive 18-test test suite (`frontend/test/bounded_scraper_dedup.test.mjs`) verifying all 3 deduplication tiers, concurrency throttles, rate limit backoff, sub-second cancellation, and a 200-source scale and memory footprint benchmark.
- **Domain Types, EventRingBuffer & Session Lifecycle ([#28](https://github.com/mohmaedeslam00116/lens-desktop/issues/28))**:
  - Declared core domain types in `frontend/electron/engine/types.ts`: `ResearchMode`, `SessionState`, `PlanMilestone`, `ResearchPlan`, `PartialEvidenceDraft`, `WideResearchRequest`, and `WideResearchResult`.
  - Implemented `EventRingBuffer` (`eventBuffer.ts`) with configurable capacity (default 300), strictly monotonic sequence numbering (`eventId: 1, 2, 3...`), circular FIFO eviction, and delta replay via `getEventsSince(lastEventId)` to guarantee seamless WebSocket reconnect recovery.
  - Implemented `SessionLifecycleManager` and `ResearchSession` (`sessionLifecycle.ts`) managing the 4-state lifecycle (`planning` -> `awaiting_approval` -> `running` -> `completed`/`cancelled`/`failed`), state transition enforcement, plan approval, and sub-second `<100ms` `AbortController` cancellation preserving partial collected evidence drafts.
  - Upgraded embedded engine server (`server.ts`) with `POST /api/research/cancel`, `POST /api/research/plan/approve`, and WebSocket delta event replays.
- **LENS Wide Research Mode Decision ([#11](https://github.com/mohmaedeslam00116/lens-desktop/issues/11))**: Formally established `LENS Wide Research` (`بحث استقصائي موسع`) as a dedicated multi-phase research mode (`ResearchMode = 'standard' | 'wide'`), distinct from standard depth tiers, and updated the domain model in `CONTEXT.md`.
- **Quality, Budget & Evaluation Contract Decision ([#18](https://github.com/mohmaedeslam00116/lens-desktop/issues/18))**: Defined 5-tier observable source metrics, flexible 50–200 source budget with smart early exit (>=80–85% coverage), honest budget exhaustion warnings with `[Extend Research]` action, and 200/500-source offline scale scenarios with zero-hallucinated citation integrity.
- **Multi-Phase Pipeline Architecture Decision ([#12](https://github.com/mohmaedeslam00116/lens-desktop/issues/12))**: Established dedicated `WideResearchAgent` orchestrator, defined 5-phase lifecycle with WebSocket plan approval checkpoint, and adopted 3-tier evidence architecture decoupling massive raw corpus storage from LLM generation context.
- **Session Lifecycle & Recovery Decision ([#20](https://github.com/mohmaedeslam00116/lens-desktop/issues/20))**: Formally specified 4-state session lifecycle, sub-second `AbortController` cancellation preserving partial evidence drafts, and bounded event ring buffer for reconnect delta replays.
- **Collaborative Research Plan UX Decision ([#14](https://github.com/mohmaedeslam00116/lens-desktop/issues/14))**: Designed 4-part plan schema, interactive UI controls (axis editing, skill toggles, Approve/Regenerate/Discard), and versioned WebSocket binding (`plan_approved`).
- **Massive Source Ingestion Architecture Decision ([#16](https://github.com/mohmaedeslam00116/lens-desktop/issues/16))**: Designed `BoundedScraperPool` (10 global / 2 per-host concurrency), 3-level deduplication (canonical URL, SHA-256 exact, 64-bit SimHash near-duplicate), stratified facet-aware evidence admission, and under 10 MB RAM footprint for 200 sources.
- **Evidence Provenance & Citation Grounding Decision ([#21](https://github.com/mohmaedeslam00116/lens-desktop/issues/21))**: Established hierarchical per-facet synthesis eliminating context degradation, pre-allocated deterministic citation catalogs with automated post-generation verifiers ensuring zero hallucinated citations, explicit contradiction callouts, and bilingual excerpt traceability.
- **Report Evidence Inspection Decision ([#23](https://github.com/mohmaedeslam00116/lens-desktop/issues/23))**: Designed the `EvidenceInspectionDrawer` for click-through citation verification with bilingual side-by-side excerpts, milestone-grouped source exploration via `FacetGroupedShelf`, and honest coverage gap reporting with interactive research extension.
- **Agent Skills Runtime Adoption Decision ([#24](https://github.com/mohmaedeslam00116/lens-desktop/issues/24))**: Evaluated Native TypeScript Integration vs Google ADK vs Vercel AI SDK vs Claude Agent SDK, selecting a zero-dependency Native TypeScript loader (`frontend/electron/engine/skills/`) to preserve 100% multi-provider parity (Gemini, OpenAI, Claude, Ollama) and implement the 3-tier progressive disclosure standard with compaction shielding.
- **Agent Skills Standard & Discovery Decision ([#25](https://github.com/mohmaedeslam00116/lens-desktop/issues/25))**: Established 3-tier discovery hierarchy (workspace `.agents/skills/` shadowing user AppData and built-in bundles), resilient lenient YAML frontmatter validation with diagnostics, and normalized path sandboxing preventing directory traversal escapes while transparently profiling script-dependent skills.
- **Agent Skills Activation & Tools Integration Decision ([#15](https://github.com/mohmaedeslam00116/lens-desktop/issues/15))**: Designed dual-path activation (collaborative plan pre-activation ensuring 100% reliability for local Ollama models plus dynamic `activate_skill` tool calling for cloud models), strict host tool mapping with non-escalating security contracts, compaction shielding for `<skill_content>`, and sub-second cancellation.
- **Agent Skills Management & Enablement UX Decision ([#22](https://github.com/mohmaedeslam00116/lens-desktop/issues/22))**: Designed safe drag-and-drop / zip package import with in-memory pre-inspection modals, canonical 5-state lifecycle transparency (`Installed`, `Enabled`, `Selected`, `Active`, `Incompatible`), non-destructive collision resolution with automated backups, and 1-click standard `.zip` export.
- **Official Launch Skills Specification Decision ([#17](https://github.com/mohmaedeslam00116/lens-desktop/issues/17))**: Selected and specified two official MIT-licensed launch skills (`academic-paper-analysis` for scientific literature and `competitive-market-intelligence` for commercial landscapes) with modular references and dual-condition controlled ablation evaluation protocols.
- **Agent Skills Interoperability & Acceptance Gates Decision ([#26](https://github.com/mohmaedeslam00116/lens-desktop/issues/26))**: Established multi-origin offline test fixtures with bit-for-bit round-trip export verification, multi-provider execution matrix with deterministic mock streams, and four-pillar release qualification gates (Format, Security, Precision, and Citation Fidelity).
- **LENS Wide Research & Open Agent Skills Formal Specification ([#27](https://github.com/mohmaedeslam00116/lens-desktop/issues/27))**: Synthesized all 14 architectural decisions into a comprehensive engineering specification (`docs/spec/wide-research-and-skills-spec.md`) labeled `ready-for-agent` covering collaborative scoping, bounded scraping, stratified evidence admission, citation grounding, interactive drawers, and the open Agent Skills standard.

---

## [1.0.1] - 2026-09-07

### Added
- **Ask-Matt Flow Routing & Guidelines in `AGENTS.md`**: Codified explicit skill routing (`/ask-matt`), specialized documentation skills (`/writing-for-agents`, `/domain-modeling`, `/research`), and enforced continuous documentation synchronization.
- **Continuous SemVer Release Policy in `AGENTS.md`**: Mandated periodic changelog maintenance and continuous releases for all codebase changes (including code/engine-only updates) alongside packaged desktop milestones.
- **LENS Domain Glossary Expansion in `CONTEXT.md`**: Added formal domain definitions for `BM25Index`, `ReciprocalRankFusion`, `ContextualChunk`, `MaximalMarginalRelevance`, `EvidenceCoverageAudit`, `EmbeddingCache`, and `CrossLingualQueryExpansion`.

---

## [1.0.0] - 2026-09-07

### Added

#### Multi-Stage Hybrid Retrieval & Reranking Engine
- **Pure TypeScript Okapi BM25 Index & Search Engine** ([#4](https://github.com/mohmaedeslam00116/lens-desktop/issues/4)):
  - Zero native C++ dependency Robertson-Spärck Jones Okapi BM25 indexer (`frontend/electron/engine/bm25.ts`).
  - Arabic text normalization: diacritic removal, tatweel removal, and canonical letter unification (`أ/إ/آ` $\to$ `ا`, `ة` $\to$ `ه`, `ى` $\to$ `ي`).
  - Arabic light clitic morphological stemming for prefixes (`ال`, `وال`, `فال`, `بال`, `لل`).
  - Tuned saturation parameter $k_1 = 1.2$ and document length normalization parameter $b = 0.75$.
  - Reciprocal Rank Fusion (RRF) with standard smoothing constant $k = 60$ fusing dense embeddings and BM25 lexical candidates into a single robust ranking.
- **Structure-Aware & Contextual Chunk Enrichment Pipeline** ([#5](https://github.com/mohmaedeslam00116/lens-desktop/issues/5)):
  - Hierarchical ATX heading extraction for Markdown (`chunker.ts`).
  - Semantic DOM tree parsing for web-scraped HTML documents using Cheerio (`readability.ts`).
  - Dual-layer chunk representation: enriched contextual representation `[Title > Section Path] + Content` for embedding and BM25 vector space, and clean content for LLM synthesis.
  - Hard boundary preservation at paragraph and Arabic punctuation marks (`.`, `،`, `؛`, `؟`).
- **Maximal Marginal Relevance (MMR) & Source Diversity Scorer** ([#6](https://github.com/mohmaedeslam00116/lens-desktop/issues/6)):
  - Pure TypeScript MMR selection engine with $\lambda = 0.7$ relevance-to-novelty balance (`mmr.ts`).
  - Quadratic penalty decay ($0.75^c$) for domain and source clustering to prevent single-domain over-representation.
  - Bilingual token Jaccard similarity fallback when vector representations are unavailable.
  - Strict caps on maximum passages per source and domain.
  - Emits real-time `diversityScore` metrics.
- **Evidence Coverage Heuristic & Adaptive Multi-Hop Retrieval** ([#7](https://github.com/mohmaedeslam00116/lens-desktop/issues/7)):
  - Mathematical Evidence Coverage formula combining Subquery Overlap ($S_{\text{subq}}$ 45%), Aspect Breadth ($S_{\text{aspect}}$ 25%), Metric Density ($S_{\text{metric}}$ 15%), and Domain Diversity ($S_{\text{div}}$ 15%) in `evidenceCoverage.ts`.
  - Quality threshold calibration: $\tau = 0.70$ for `deep` mode, $\tau = 0.75$ for `storm` mode.
  - Early-exit to synthesis when evidence coverage threshold is satisfied.
  - Strict depth tier guardrails: `quick` (0 hops), `deep` (max 1 hop), `storm` (max 2 hops).
  - Anchored gap query formulation targeting missing subqueries, quantitative metrics, system architecture, or security risks—zero unanchored query drift.
  - Bilingual UI telemetry streaming live localized Arabic and English `reflection` events.
- **Local Disk LRU Embedding Cache & Versioned Space Index** ([#8](https://github.com/mohmaedeslam00116/lens-desktop/issues/8)):
  - Persistent sharded filesystem cache under `userData/embedding-cache/` (`embeddingsCache.ts`).
  - Cache keys computed via SHA-256(`provider:model:embeddingSpaceVersion:text`).
  - Automatic model dimension migration validation: invalidates stale vector entries when switching models or dimension configurations.
  - Transparent `CachedEmbeddingWrapper` decorating `BaseEmbedding` with sub-millisecond local cache hits and batched retrieval.
  - Exposes hit/miss/eviction telemetry.
- **Bidirectional Cross-Lingual Query Expansion for BM25** ([#9](https://github.com/mohmaedeslam00116/lens-desktop/issues/9)):
  - Bilingual technical taxonomy mapping core scientific and engineering concepts between Arabic and English (`queryExpansion.ts`).
  - Morphological definite article resilience: queries with `ال` match canonical dictionary terms seamlessly.
  - Word-boundary regex protection preventing substring false-positives (e.g. `ai` inside `blockchain` or `training`).
  - Technical acronym bridge resolving terms like `RAG`, `LLM`, `PQC`, `QEC` bidirectionally.
  - Phonetic loanword bridge bridging transliterated terms (e.g. `كوانتم`, `ترانزمون`, `كيوبت`).
  - Weighted Okapi BM25 scoring (`BM25Index.searchWeighted`) scaling expanded terms with $1/\sqrt{M}$ decay while preserving primary query term authority.

#### Architectural Specifications & Benchmarks
- **100-Sample Bilingual IR Benchmark Specification** ([#2](https://github.com/mohmaedeslam00116/lens-desktop/issues/2)):
  - Comprehensive research specification in `docs/research/benchmark-dataset-spec.md` establishing a 100-query benchmark across 4 categories (Factual, Comparative, Temporal, Multi-hop) with 4-point Qrels grading, evaluating Recall@K, MRR@10, NDCG@10, and Citation Fidelity.
- **Cascading Reranker Execution Strategy** ([#3](https://github.com/mohmaedeslam00116/lens-desktop/issues/3)):
  - Architectural evaluation in `docs/research/reranker-execution-strategy.md` defining a two-tier cascading pipeline: Tier 1 instant RRF pruning ($50 \to 25$), followed by Tier 2 fast LLM listwise / local ONNX cross-encoder re-scoring ($25 \to 10\text{--}12$) with a strict $<1200\text{ ms}$ SLA.

#### Brand & Product Identity Alignment
- Full alignment to the **LENS** identity across English and Arabic interfaces:
  - Brand line: **Research, in focus.**
  - Arabic expression: **نظرة أعمق. فهم أوضح.**
  - Typography: Inter and Cairo.
  - Neutral monochrome palette (`#111111` / `#191919`).
  - Concentric lens brand mark.
  - Complete removal of unsupported "Pro" badge references.

#### Testing & Quality Assurance
- Pure TypeScript test suite comprising **78 automated unit and integration tests across 26 test suites** running with Node.js test runner in ~2.4 seconds with 100% pass rate.
- Zero external C++ native compilation dependencies.

---

[1.0.1]: https://github.com/mohmaedeslam00116/lens-desktop/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/mohmaedeslam00116/lens-desktop/releases/tag/v1.0.0
