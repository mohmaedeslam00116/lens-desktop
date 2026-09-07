# Massive Source Ingestion: Parallel Retrieval & Memory Architecture for LENS Wide Research

**Document ID**: `docs/research/massive-source-ingestion-architecture.md`  
**Related Ticket**: [#16 Massive Source Ingestion: Parallel Retrieval & Memory Architecture](https://github.com/mohmaedeslam00116/lens-desktop/issues/16)  
**Parent Map**: [[Map #10] LENS Advanced Research: Wide Research, Verifiable Reports & Skills Roadmap](https://github.com/mohmaedeslam00116/lens-desktop/issues/10)  
**Status**: Authoritative Architectural Specification & Feasibility Report  
**Date**: September 2026  

---

## 1. Executive Summary & Problem Formulation

In standard research mode (`quick`, `deep`, `storm`), LENS processes 4 to 16 sources sequentially with an 8-second caller timeout. While fast and lightweight for simple queries, this sequential pipeline fails when scaled to **LENS Wide Research**, which requires investigating **100 to 200+ sources** across dozens of domains:
1. **Latency Blowup**: 150 sequential HTTP scrapes at an average latency of 1.8s would consume **270 seconds (4.5 minutes)** in scraping alone, with worst-case timeouts reaching 20 minutes.
2. **Socket & Host Saturation**: Unbounded `Promise.all` across 150 URLs overwhelms desktop network sockets, risks DNS resolution failures, and triggers HTTP 429 (Too Many Requests) or Cloudflare bans.
3. **Memory Footprint**: While raw text (150 sources × 6,000 characters = ~900 KB) is negligible in V8 memory, concurrent Cheerio HTML DOM parsing trees consume 50–120 KB per page. Parsing 150 pages simultaneously would create transient memory spikes exceeding 150 MB.
4. **Facet Starvation (Early Prefix Bias)**: In a naive retrieval loop with global chunk caps, early subqueries fill the entire evidence buffer, completely starving later investigative milestones of representation in LLM synthesis.

This document specifies the bounded, memory-efficient ingestion and retrieval architecture for LENS Wide Research, providing sub-30s retrieval across 100–200 sources within desktop resource limits.

---

## 2. Ingestion Pipeline Architecture

```
                                [Approved Research Plan]
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2.1: Multi-Engine Query Fanout & Pagination                                      │
│ - 3–5 Milestones × (Search Providers + SKILL.md Search Tools)                            │
│ - Automatic pagination (offset/page 1..3) acquiring 40–60 raw URLs per milestone        │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Raw Candidate URLs (200–300)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2.2: URL Normalization & Domain Deduplication                                    │
│ - Strip tracking parameters (utm_*, ref, fbclid, gclid, session IDs)                   │
│ - Canonicalize protocols (https), lowercase hostnames, strip trailing slashes           │
│ - Host Politeness Limiter: max 4 candidate URLs per second-level domain                 │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Canonical Unique URLs (150–220)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2.3: Bounded Concurrency Scraping Worker Pool (`BoundedScraperPool`)             │
│ - Global Concurrency: C_global = 10 parallel HTTP workers                              │
│ - Per-Host Concurrency: C_host = 2 parallel connections per hostname                    │
│ - AbortController timeout: 6,000ms per request with exponential backoff on HTTP 429     │
│ - Immediate Cheerio DOM teardown (releasing AST immediately after text extraction)     │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Scraped Raw Pages (100–180)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2.4: Content-Based Deduplication (Exact & Near-Duplicate Filter)                  │
│ - Exact Match: SHA-256 of normalized alphanumeric text                                  │
│ - Near-Duplicate: 64-bit SimHash (Hamming distance <= 3) filtering syndicated articles │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │ Unique Raw Corpus (Tier 1)
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2.5: Stratified Facet-Aware Chunking & Admitted Evidence Selection (Tier 2)       │
│ - Structure-aware contextual chunking ([Title > Section Path] + Content)                │
│ - Stratified Quota: K_facet = 15 chunks reserved per approved milestone                 │
│ - Hybrid Dense + BM25 RRF Ranking with MMR novelty diversification                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Concurrency Model & Network Politeness

### 3.1 Worker Pool Design (`BoundedScraperPool`)
To maximize throughput without socket exhaustion or server bans, scraping is managed through a bounded asynchronous token queue:

```typescript
export interface ScraperPoolOptions {
  globalConcurrency: number;     // Default: 10
  perHostConcurrency: number;    // Default: 2
  timeoutMs: number;             // Default: 6000ms
  maxRetries: number;            // Default: 1 (with backoff)
  maxBytesPerPage: number;       // Default: 2 MB raw HTML cap
}
```

- **Global Concurrency ($C_{\text{global}} = 10$)**: Limits active outbound TCP sockets in Node.js to 10. At average 1.5s page latency, 150 pages finish in:
  $$T_{\text{scrape}} = \frac{150 \times 1.5\text{s}}{10} \approx 22.5\text{ seconds}$$
- **Per-Host Concurrency ($C_{\text{host}} = 2$)**: Ensures no single origin domain receives more than 2 concurrent HTTP requests, avoiding rate-limit triggers.
- **Backpressure & Queue Fairness**: Queue priority is round-robin interleaved across milestones so all plan facets retrieve pages concurrently.

### 3.2 Network Failure & Timeout Strategy
- Requests abort strictly after 6,000ms.
- Failed or timed-out requests log an unavailable notice (`Content unavailable from ...`) and do not block the queue.
- HTTP 429 responses trigger a single retry after an exponential backoff jitter ($1000\text{ms} + \text{random}(0, 500)\text{ms}$). If 429 recurs, the host is skipped.

---

## 4. Deduplication Hierarchy: URL, Exact & Near-Duplicate

Syndicated press releases, cross-posted articles, and mirrored documentation frequently appear in large web crawls. LENS implements a 3-level deduplication hierarchy:

### Level 1: Canonical URL Normalization
1. Lowercase hostname and scheme.
2. Strip default ports (`:80`, `:443`).
3. Strip tracking and session query parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `ref`, `fbclid`, `gclid`, `_ga`, `spJobID`).
4. Strip fragment identifiers (`#section`).
5. Strip trailing slashes (`/path/` $\rightarrow$ `/path`).

### Level 2: Exact Content Deduplication (SHA-256)
- Normalize text: lowercase, strip all non-alphanumeric characters and collapse whitespace.
- Compute `SHA-256` of normalized text.
- If hash exists in the session filter, discard page as an exact duplicate and increment duplicate telemetry.

### Level 3: Near-Duplicate Detection (64-bit SimHash)
For pages that share 90%+ text but differ by ads, timestamps, or headers:
- Tokenize text into 3-grams.
- Compute 64-bit SimHash vector fingerprint.
- Check against existing session fingerprints using bitwise XOR (`Hamming distance <= 3`).
- If match found, retain the higher credibility score page and discard the near-duplicate.

---

## 5. Memory Footprint & Desktop Resource Budget

### 5.1 In-Memory Arithmetic (200 Sources)
| Data Asset | Quantity | Size per Unit | Total RAM Footprint |
| :--- | :--- | :--- | :--- |
| Raw Clean Text | 200 sources | 6,000 chars (~12 KB UTF-16) | **~2.4 MB** |
| Document Metadata | 200 sources | URLs, titles, domains, scores | **~0.3 MB** |
| Contextual Chunks | 800 chunks | 800 chars (~1.6 KB) | **~1.3 MB** |
| Dense Vector Cache (in RAM) | 800 vectors | 768 floats (float32) | **~2.5 MB** |
| In-Flight Cheerio DOMs | Max 10 active | ~80 KB per DOM | **~0.8 MB** (transient) |
| Event Ring Buffer | 300 events | JSON metadata | **~0.5 MB** |
| **Total In-Memory Working Set** | — | — | **~7.8 MB** |

**Conclusion**: 200 sources require **under 10 MB of RAM**, well within Electron's 4 GB heap headroom. Even scaling to 500 sources consumes less than 25 MB of RAM.

### 5.2 Spill-to-Disk Policy
- **In-Memory Default**: All parsed clean text and contextual chunks live in the session memory pool for maximum search speed.
- **Session Scratch Spill**: If a session exceeds 250 sources or is backgrounded, raw page text is flushed to `userData/sessions/<sessionId>/corpus.jsonl` using streaming JSON lines, keeping V8 heap flat.

---

## 6. Stratified Facet-Aware Evidence Admission

To prevent early subqueries from monopolizing the synthesis context:

```typescript
export interface FacetQuota {
  milestoneId: string;
  minChunks: number;  // Guaranteed minimum representation (default: 8)
  maxChunks: number;  // Hard ceiling per milestone (default: 20)
}
```

1. **Independent Facet Retrieval**: Chunks are initially indexed in `BM25Index` and vector store with their originating milestone tags.
2. **Stratified Allocation**: Each approved milestone is guaranteed a minimum quota ($K_{\text{min}} = 8$) of admitted chunks in Tier 2.
3. **Global MMR Fusion**: Remaining chunk slots (up to the total admitted cap of 60–80 chunks) are selected globally using Reciprocal Rank Fusion (RRF) and MMR diversity scoring.
4. **Result**: The final synthesis prompt contains balanced, high-density evidence spanning every single research objective approved by the user.

---

## 7. Offline Scale Evaluation Scenarios (200 & 500 Sources)

To verify the ingestion engine without paid API calls or live network variability, LENS introduces two deterministic offline test fixtures under `test/fixtures/ingestion/`:

### Scenario A: 200-Source Wide Research Baseline
- **Composition**:
  - 160 valid distinct informative articles (bilingual English/Arabic).
  - 20 exact/near-duplicate syndicated articles.
  - 10 slow responses (2,000ms delayed mock).
  - 10 HTTP error/timeout cases (404, 500, timeout).
- **Acceptance Gates**:
  - Total processing time: $< 2.5\text{s}$ (with mock network).
  - Peak memory increase: $< 15\text{ MB}$.
  - Correctly drops 20 duplicates and reports 10 failures.
  - Generates balanced Tier 2 admitted passages across all milestones.

### Scenario B: 500-Source Capacity Stress Test
- **Composition**:
  - 400 distinct articles across 80 synthetic domains.
  - 50 duplicate articles.
  - 50 failed/timed-out requests.
- **Acceptance Gates**:
  - Zero unhandled promise rejections or socket leak warnings.
  - Peak memory increase: $< 35\text{ MB}$.
  - Verified heap garbage collection recovery after session termination.

---

## 8. Architectural Seams & Module Placement

The implementation creates one new module and enriches existing interfaces:

1. **`frontend/electron/engine/scraperPool.ts` [NEW]**:
   - Implements `BoundedScraperPool` with global and per-host concurrency limits, timeout handling, and exponential backoff.
2. **`frontend/electron/engine/dedup.ts` [NEW]**:
   - Implements URL canonicalization, normalized SHA-256 exact matching, and 64-bit SimHash near-duplicate filtering.
3. **`frontend/electron/engine/scraper.ts` [MODIFY]**:
   - Integrates with `BoundedScraperPool` and releases Cheerio DOM memory immediately after string extraction.
4. **`frontend/electron/engine/wideAgent.ts` [NEW]**:
   - Uses `BoundedScraperPool` and stratified facet-aware chunk selection in Phase 2.

---

## 9. Next Steps
Resolution of Issue #16 unblocks **Issue #21** (`Evidence Provenance, Citation Grounding & Synthesis Strategy`), providing the grounded evidence foundation for long-form dossier generation.
