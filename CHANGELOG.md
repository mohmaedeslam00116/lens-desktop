# Changelog

All notable changes to the **LENS** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
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
