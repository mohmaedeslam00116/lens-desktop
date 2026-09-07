# Domain Model: LENS

<!-- matt-skills:domain-model 1 -->

## Glossary

### ResearchSession
A bounded, stateful investigation triggered by a user query. It tracks research depth, selected analytical perspectives, discovered web sources, decomposed subqueries, live telemetry logs, and the resulting synthesized document.

### Perspective
An analytical lens or expert persona (derived from the Stanford STORM methodology) applied to decompose a complex topic into multidimensional inquiries:
- **Technical & Architectural**: Focuses on mechanisms, protocols, benchmarks, code implementations, and specifications.
- **Market & Commercial**: Focuses on industry dynamics, leading companies, economic valuation, adoption trends, and business models.
- **Critical & Skeptical**: Focuses on vulnerabilities, limitations, trade-offs, controversies, and counter-arguments.
- **Balanced & Comprehensive**: General-purpose cross-sectional investigation combining all facets.

### Subquery
A targeted, search-engine-optimized boolean or semantic query dynamically synthesized by the agent to investigate a specific facet of a perspective.

### Source & Evidence
An external digital document scraped and analyzed by the agent. Each source carries a canonical URL, extracted title, domain authority score (0–100%), relevance snippet, and publication timestamp when available.

### Reflection & Gap Analysis
An intermediate reasoning phase (derived from Open Deep Research) where the agent pauses after initial web exploration to audit its findings, identify unanswered sub-questions or conflicting data points, and formulate targeted second-hop inquiries.

### LivingReport
The final synthesized deliverable formatted in clean, human-readable Markdown. It includes an Executive Summary, structured chapters with in-line academic citations (`[1]`, `[2]`), a comparative analysis matrix, and a verified bibliography.

### ResearchGraph
A directed acyclic graph (DAG) representing the agent's exploration path: Root Query -> Perspectives -> Subqueries -> Visited Sources -> Synthesized Sections.

### FollowupCopilot
A grounded conversational agent operating adjacent to the LivingReport that answers user inquiries, drafts comparison tables, and interrogates the research findings strictly against the acquired source evidence.

### AIProvider
An inference provider or model gateway (e.g., Google Gemini, OpenAI, Anthropic, Groq, DeepSeek, Ollama, OpenRouter, Mistral). Each provider declares required authentication keys, base endpoints, and available model families.

### ModelDescriptor
A metadata record characterizing an AI model: its canonical identifier (`id`), user-facing label (`name`), maximum context window length (e.g., `128k`, `1M`, `200k`), capability badges (`Reasoning`, `Speed`, `Vision`, `Local`), and whether it is a local offline model.

### ProviderRegistry
A deep backend module responsible for maintaining the catalog of known models across all providers, dynamically discovering models from local Ollama instances (`/api/tags`) or remote gateways (OpenRouter), and executing live connection tests with latency metrics.

### ConnectionTest
A real-time diagnostic ping validating whether the user's API key or local Ollama endpoint is functional before committing to an expensive research run, returning latency in milliseconds and detailed error diagnostics if rejected.

### BM25Index
A pure TypeScript, zero-native-compilation lexical search engine based on the Robertson-Spärck Jones Okapi BM25 formulation. It features bilingual tokenization, Arabic diacritic stripping, letter normalization, and prefix clitic morphological stemming (`ال`, `وال`, `فال`, `بال`, `لل`), with tuned saturation $k_1 = 1.2$ and document length penalization $b = 0.75$.

### ReciprocalRankFusion (RRF)
A non-parametric rank fusion algorithm combining dense neural vector rankings and sparse BM25 lexical rankings into a unified score using standard rank smoothing ($k=60$):
$$\text{RRF}(d) = \sum_{r \in \mathcal{R}} \frac{1}{k + r(d)}$$

### ContextualChunk
A structure-aware document segment enriched with hierarchical ATX Markdown or HTML DOM heading paths (`[Document Title > Section Path] + Clean Content`). The contextual header ensures dense embeddings and BM25 indices capture topical provenance, while the clean content is supplied to LLM synthesis.

### MaximalMarginalRelevance (MMR)
A greedy selection algorithm balancing relevance against novelty ($\lambda = 0.7$) to eliminate passage redundancy from the same website or section, incorporating quadratic domain clustering decay penalties ($0.75^c$).

### EvidenceCoverageAudit
A multi-facet mathematical heuristic assessing research completeness before synthesis:
$$\text{CoverageScore} = 0.45 \cdot S_{\text{subq}} + 0.25 \cdot S_{\text{aspect}} + 0.15 \cdot S_{\text{metric}} + 0.15 \cdot S_{\text{div}}$$
It governs early exit transitions to synthesis and triggers adaptive multi-hop hops with strict depth tier guardrails and anchored gap queries.

### EmbeddingCache
A persistent, sharded local filesystem LRU cache stored under `userData/embedding-cache/`. Vector embeddings are indexed by `SHA-256(provider:model:embeddingSpaceVersion:text)` and automatically validate dimension lengths to prevent stale vectors across model migrations.

### CrossLingualQueryExpansion
A bidirectional technical taxonomy and acronym mapper that bridges Arabic and English lexical queries in BM25 without requiring neural cross-encoders, applying morphological definite article stripping and multi-token expansion weight scaling.

### ResearchMode
The operational workflow mode of a research session:
- **`standard`**: Direct, single-turn research execution across configured depth tiers (`quick`, `deep`, `storm`).
- **`wide`**: Multi-phase autonomous investigation featuring collaborative scoping, user-approved research plans, massive source retrieval across hundreds of websites, Agent Skills standard integration, and verifiable citation-grounded synthesis.

### WideResearch
An advanced autonomous investigation workflow in LENS (Arabic: **بحث استقصائي موسع**) designed to explore complex topics across dozens to hundreds of sources with explicit scoping, verifiable evidence provenance, and open-standard skill integration.

### WideResearchAgent
A dedicated autonomous orchestrator class (`frontend/electron/engine/wideAgent.ts`) that executes the 5-phase Wide Research lifecycle: (1) Collaborative scoping and research plan approval, (2) Parallel wide retrieval, (3) Iterative audit and adaptive hops, (4) Hybrid evidence ranking and skill injection, and (5) Verifiable citation-grounded synthesis. It operates independently from `DeepResearchAgent` while reusing core retrieval and scraping modules.

### ThreeTierEvidence
An evidence architecture decoupling massive raw corpus capacity from the LLM generation context budget:
- **Tier 1 (Raw Session Corpus)**: In-memory/temp storage of all retrieved web pages for complete source inspection.
- **Tier 2 (Admitted Passages Index)**: Top 40–80 contextual chunks selected via RRF (Dense + BM25) and MMR diversification spanning all plan facets.
- **Tier 3 (Synthesis Prompt Context)**: Clean admitted excerpts supplied to the LLM with stable citation identifiers `[x]`, supporting hierarchical section synthesis.

### SessionLifecycle
The state machine governing research sessions: `planning` -> `awaiting_approval` -> `running` -> terminal states (`completed`, `cancelled`, `budget_exhausted`, `failed`). Supports immediate `<1s` cancellation via `AbortController` while safely retaining gathered evidence as an inspectable partial draft.

### EventRingBuffer
A bounded circular memory buffer maintained by the engine on port 8000 storing the last 200–300 sequential events (`eventId: 1, 2, 3...`) per active session, enabling deterministic delta replay to the React frontend on WebSocket reconnects.

### ResearchPlan
A versioned, 4-element structured research blueprint generated in Phase 1 (`frontend/electron/engine/scoping.ts`) containing the strategic `objective`, investigation `milestones` (subqueries and rationales), `suggestedSkills` (`SKILL.md`), and realistic `estimatedScope` (`targetSources`, `maxHops`). It is presented in the UI for user inspection and modification before retrieval begins.

### CollaborativeApproval
The versioned human-in-the-loop checkpoint (`plan_proposed` -> `plan_approved`) facilitated by `PlanApprovalModal` (`frontend/src/components/research/PlanApprovalModal.tsx`) and `sessionLifecycle.ts` where the user edits subqueries, toggles skills, and explicitly authorizes execution, binding the engine's retrieval trajectory and budget limits to the approved plan version. Retrieval is strictly gated until `isPlanAuthorized()` is satisfied.

### BoundedScraperPool
An asynchronous scraping worker queue (`frontend/electron/engine/scraperPool.ts`) that enforces global concurrency limits ($C_{\text{global}} = 10$) and per-host limits ($C_{\text{host}} = 2$) with request timeouts and non-blocking exponential backoff, enabling parallel ingestion of 100–200 sources in ~22 seconds without triggering HTTP 429 bans or socket saturation.

### ThreeLevelDeduplication
A hierarchical filtering pipeline operating across 3 distinct tiers to eliminate redundant evidence at ingestion time:
- **Level 1 (Canonical URL Normalization)**: Strips tracking query parameters (`utm_*`, `fbclid`, `ref`), removes URL fragments and default ports, lowercases protocol and hostname, sorts query parameters deterministically, and normalizes trailing slashes.
- **Level 2 (Exact Content Hashing)**: SHA-256 cryptographic hashing over whitespace-normalized text to catch identical syndicated pages across distinct URLs.
- **Level 3 (SimHash Near-Duplicate Detection)**: 64-bit locality-sensitive SimHash fingerprinting with term-frequency token weighting and Hamming distance threshold $\le 3$ to detect near-identical documents with minor ad banners, author lines, or timestamp variations.

### DeduplicationEngine
The central deduplication coordinator (`frontend/electron/engine/dedup.ts`) maintaining in-memory indexes of seen canonical URLs, exact SHA-256 hashes, and 64-bit SimHash signatures to filter duplicates before and after network fetches, exposing real-time telemetry stats.

### SimHashFingerprint
A 64-bit locality-sensitive integer projection computed from token frequency distributions, where the bitwise Hamming distance between two fingerprints is mathematically proportional to the cosine distance between their underlying text vectors.

### StratifiedEvidenceAdmission
A facet-aware passage selection strategy implemented in `frontend/electron/engine/admission.ts` that guarantees a minimum quota of admitted chunks per approved milestone ($K_{\text{min}} = 8$) before allocating residual capacity by global hybrid relevance score ($M_{\text{max}} = 60\text{--}80$). Automatically handles under-quota milestones by returning spare slots to the residual pool, dynamically enforces proportional fairness when milestone count times $K_{\text{min}}$ exceeds $M_{\text{max}}$, and interfaces with mathematical coverage auditing to trigger smart early exit ($\ge 80\%$) or honest budget exhaustion.

### ResearchExtensionPayload
A structured, interactive action payload emitted when retrieval limits (max hops or source budget) are reached while coverage remains below the quality threshold ($< 80\%$), containing suggestions for additional sources (+20) and hops (+1), identified coverage deficits, and bilingual action buttons (`[Extend Research]` / `[توسيع نطاق البحث]`) to give the user explicit steering authority over budget expansion.

### HierarchicalSynthesis
A multi-stage synthesis strategy where each approved research milestone is first synthesized into a detailed analytical section from its admitted evidence, followed by a meta-synthesis pass generating executive summaries, cross-cutting comparison matrices, and conclusions, preventing context degradation.

### CitationGroundingContract
An evidence provenance mechanism where candidate excerpts are pre-allocated immutable citation indices (`[1]`, `[2]`...) prior to synthesis, paired with an automated post-generation verifier that validates every bracketed anchor against the source catalog, guaranteeing zero hallucinated citations.

### EvidenceInspectionDrawer
An interactive slide-over inspector component that surfaces the verbatim source passage, source metadata, URL, and side-by-side bilingual original excerpts whenever a user clicks any citation badge `[x]` in the report view, without breaking the reading flow.

### FacetGroupedShelf
A structured source explorer view that organizes the 100–200 ingested research sources into distinct tabs/sections corresponding to approved research plan milestones, providing instant filtering between cited-only and all ingested pages.

### ProgressiveDisclosure
The standard 3-tier loading mechanism for Agent Skills (`agentskills.io`): Tier 1 (Catalog, ~50–100 tokens per skill at session start), Tier 2 (Instructions, `<5000` tokens loaded on activation), and Tier 3 (Resources, referenced documentation and static assets loaded strictly on demand).

### CompactionShield
A context management protection policy that tags activated skill instructions with `<skill_content>` delimiters and exempts them from pruning or summarization during multi-hop research passes, ensuring domain instructions remain intact across the research lifecycle.

### SkillRegistry
The discovery and catalog management subsystem (`frontend/electron/engine/skills/registry.ts`) that scans project `.agents/skills/`, user AppData, and bundled locations, parses YAML frontmatter with lenient error recovery, and maintains in-memory metadata catalogs for prompt injection.

### SkillPrecedencePolicy
The deterministic shadowing hierarchy governing duplicate skill names across scopes: workspace skills (`<workspace>/.agents/skills/`) override user-level skills (`%APPDATA%/LENS/skills/`), which in turn override application-bundled skills.

### SkillPathBoundary
A security enforcement mechanism ensuring all secondary file lookups (`references/*`, `assets/*`) resolve strictly within the parent skill root directory via normalized path validation, preventing directory traversal escapes and unauthorized filesystem access.

### DualActivationStrategy
A hybrid activation model providing deterministic controller pre-activation during collaborative plan approval for all models (including local Ollama models), combined with dynamic tool-driven activation (`activate_skill`) for tool-capable cloud providers (Gemini, OpenAI, Claude).

### HostToolMapper
The integration seam that bridges standard skill `allowed-tools` declarations to native LENS engine primitives (`MultiSearchProvider`, `PageScraper`, `read_resource`), providing transparent advisory notices for unmapped tools while strictly preventing unauthorized privilege escalation.

### SkillLifecycleState
The canonical 5-state representation of an Agent Skill in LENS (`Installed`, `Enabled`, `Selected`, `Active`, `Incompatible`), providing explicit visibility over catalog availability, plan inclusion, context injection, and dependency status.

### SkillCollisionResolver
The non-destructive conflict handling mechanism invoked when an imported package shares the name of an existing skill, prompting the user with explicit choices (`Keep Existing`, `Overwrite with Backup`, `Rename on Import`) while isolating running sessions from disk modifications.

### AcademicPaperSkill
An official launch skill (`skills/academic-paper-analysis/`) standardizing the deep extraction of scientific methodologies, ablation studies, quantitative benchmark matrices, and bilingual terminology alignment from peer-reviewed literature.

### MarketIntelligenceSkill
An official launch skill (`skills/competitive-market-intelligence/`) guiding the strategic synthesis of competitive landscape reports, feature matrices, pricing models, and SWOT assessments from corporate filings and industry evidence.

### CrossClientRoundTrip
An interoperability verification standard requiring imported Agent Skills packages to be parsed, validated, and re-exported as byte-identical packages without injecting proprietary metadata or vendor locks.

### FourPillarAcceptanceGate
The comprehensive release qualification standard enforcing 100% compliance across four critical dimensions: Format Compliance (`agentskills.io`), Security & Path Boundary Defense, Triggering Precision (0% false positives), and Grounded Citation Fidelity (0% hallucinated citations).
