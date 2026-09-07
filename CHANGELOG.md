# Changelog

All notable changes to the **LENS** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **LENS Wide Research Mode Decision ([#11](https://github.com/mohmaedeslam00116/lens-desktop/issues/11))**: Formally established `LENS Wide Research` (`بحث استقصائي موسع`) as a dedicated multi-phase research mode (`ResearchMode = 'standard' | 'wide'`), distinct from standard depth tiers, and updated the domain model in `CONTEXT.md`.

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
