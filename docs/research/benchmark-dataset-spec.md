# Benchmark Dataset Specification for Bilingual Information Retrieval (LENS-IR-100)

<!-- matt-skills:research 1 -->

## Executive Summary

This document specifies the benchmark dataset architecture, query taxonomy, relevance judgment schema, metric formulations, and repository integration for evaluating **LENS**'s bilingual information retrieval and deep research engine. This resolves **Wayfinder Research Ticket #2** (part of parent issue **#1**).

LENS operates an embedded desktop research pipeline (`frontend/electron/engine/`) that transforms ambiguous natural-language inquiries into structured reports. Evaluating this system requires assessing not only classical dense/sparse retrieval stages (passage ranking against multi-perspective subqueries) but also the grounding fidelity of downstream report synthesis (linear citation mapping `[1]`, `[2]`, attribution completeness, and hallucination avoidance).

The proposed benchmark, **LENS-IR-100**, establishes:
1. A **100-sample stratified bilingual query suite** split equally between Arabic (`ar`) and English (`en`), balanced across four fundamental analytical query categories: **Factual**, **Comparative**, **Temporal**, and **Multi-Hop**.
2. A **concrete JSON Schema** capturing document corpora, segmented passage chunks, query metadata, STORM-inspired perspective decompositions, 4-point graded relevance judgments (Qrels), and atomic citation entailment spans.
3. Standardized mathematical definitions for retrieval metrics (**Recall@K**, **MRR@10**, **NDCG@10**) and report-level generation metrics (**Citation Fidelity**: Citation Recall, Citation Precision, and Citation Pointer Integrity).
4. A canonical repository home in `benchmarks/bilingual-ir-100/` with dual-format support (unified JSON and standard BEIR/TREC exports) and an automated Node.js test harness.

---

## 1. Analysis of Established IR Benchmark Formats

To ensure theoretical rigor and ecosystem compatibility, we analyze three primary IR benchmarking paradigms: **BEIR**, **MIRACL**, and **TREC**.

| Benchmark | Primary Focus | Strengths | Limitations for LENS Desktop |
| :--- | :--- | :--- | :--- |
| **BEIR** (Thakur et al., 2021) | Zero-shot dense & sparse retrieval across 18 English domains | Universal standard; decoupled format (`corpus.jsonl`, `queries.jsonl`, `qrels/test.tsv`); supported by BEIR, Ranx, and PyLate. | Monolingual English focus; ignores query perspective decomposition; lacks citation span attribution; no concept of temporal anchor validation. |
| **MIRACL** (Zhang et al., 2022/2023) | Multilingual retrieval across 18 languages including Arabic (`ar`) | High-quality native speaker relevance judgments; deep Arabic morphological coverage (Modern Standard Arabic); standardized splits. | Wikipedia-only corpus; binary relevance ($0/1$); does not capture complex multi-hop research workflows, comparative matrices, or generative citation tracking. |
| **TREC** (NIST DL & RAG Tracks, ALCE) | Large-scale shared tasks; graded relevance; attributed QA | 4-point graded relevance scale ($0..3$); ALCE (Attributed Language Evaluation) pioneers citation recall/precision metrics. | Traditional TREC format relies on legacy whitespace TSV (`topic_id 0 doc_id rel`); lacks structured metadata for multi-agent reasoning DAGs or local desktop RAG settings. |

### 1.1 Arabic Information Retrieval Peculiarities

Information retrieval in Arabic introduces distinct linguistic challenges that the benchmark must deliberately isolate and test:

1. **Morphological Complexity & Clitics**:
   Arabic words frequently combine base lemmas with proclitics (e.g., the definite article `الـ`, conjunction `وـ`, prepositions `بـ`, `لـ`, `كـ`, and future particle `سـ`) and enclitics (e.g., possessive and object pronouns `ـه`, `ـها`, `ـهم`). A surface-level sparse search for `بطاريات` (batteries) may fail to match `وببطارياتها` (and with its batteries) without specialized lemmatizers (e.g., Farasa or Khoja). Dense vector embeddings must map these morphologically distinct tokens to proximate points in embedding space.

2. **Orthographic Ambiguity & Normalization**:
   Real-world search queries frequently omit or conflate diacritical variants:
   - **Alif variations**: Conflation of `أ`, `إ`, `آ` into bare Alif `ا`.
   - **Taa Marbuta vs. Haa**: Conflation of `ة` and `ه` at word termination (e.g., `تقنية` vs. `تقنيه`).
   - **Alif Maqsura vs. Yaa**: Conflation of `ى` and `ي` (e.g., `علي` vs. `على`).
   - **Tashkeel (Vowel Diacritics)**: While scholarly texts occasionally contain Harakat (`َ ِ ُ ّ ْ ً ٍ ٌ`), web queries rarely include them. The benchmark includes both normalized and raw variants to verify that vector embedders are invariant to superficial orthography.

3. **Cross-Lingual Vocabulary & Concept Mismatch (AR $\rightarrow$ EN)**:
   A core capability of LENS is retrieving high-tier global research papers published in English when the researcher prompts in Arabic. In `frontend/test/benchmark_and_fallback.test.mjs`, this is proven with queries such as `ما هي كثافة الطاقة ومعدل الاحتفاظ بالسعة لبطاريات الحالة الصلبة؟` correctly retrieving English passages detailing `520 Wh/kg` and `1,200 fast charge cycles`. The benchmark must explicitly include cross-lingual query-document pairs where the query language is Arabic and target evidence passages are English.

---

## 2. Query Taxonomy & 100-Sample Stratification Matrix

To provide statistically reliable evaluations while remaining computationally practical for desktop CI testing, the benchmark consists of **100 curated query instances**. The suite is stratified across two dimensions: **Language** (50% Arabic, 50% English) and **Query Intent** (25% across 4 core categories).

```
                      +-------------------------------------------------------+
                      |               LENS-IR-100 BENCHMARK SUITE             |
                      |                     (100 Samples)                     |
                      +-------------------------------------------------------+
                                     /                         \
                                    /                           \
                        50 Arabic Queries                50 English Queries
                       (MSA / Cross-lingual)           (Monolingual / Deep Web)
                                  │                                 │
            ┌─────────────┬───────┴─────┬─────────────┐ ┌───────────┬───────┴─────┬─────────────┐
            ▼             ▼             ▼             ▼ ▼           ▼             ▼             ▼
         Factual     Comparative    Temporal     Multi-Hop Factual   Comparative    Temporal     Multi-Hop
         (12 Qs)       (13 Qs)       (12 Qs)      (13 Qs)  (13 Qs)     (12 Qs)       (13 Qs)      (12 Qs)
```

### 2.1 Category Taxonomy & Specifications

| Category | Samples | Characteristics | Target Failure Mode in Naive Search | Evaluation Focus |
| :--- | :---: | :--- | :--- | :--- |
| **1. Factual** | 25 (13 EN, 12 AR) | Discrete, pinpoint fact retrieval (numerical metrics, hardware specifications, protocol RFCs, molecular targets, chemical formulas). Ground truth resides in 1–2 isolated paragraphs. | **Prefix truncation**: The critical metric is located at character offset 3,500+ and is discarded by standard 2k character scrapers. | **MRR@10, Recall@3, Precision@1** |
| **2. Comparative** | 25 (12 EN, 13 AR) | Side-by-side evaluation of two or more architectures, algorithms, frameworks, or economic policies (e.g., `sqlite-vec` vs. `duckdb-vss`, `DeepSeek-V3` vs. `Llama-3.3-70B`). | **Single-source bias**: The retriever retrieves multiple passages for Entity A but starves Entity B, producing an unbalanced report. | **Recall@10, Source Diversity, NDCG@10** |
| **3. Temporal** | 25 (13 EN, 12 AR) | Inquiries containing explicit time bounds, historical vs. contemporary shifts, or recent regulatory and technical updates (e.g., 2026 post-quantum NIST standards, 2025/2026 EU AI Act enforcement phases). | **Temporal obsolescence**: Returning high-lexical-match historical articles from 2021 that state standards are "draft" when 2026 versions are finalized. | **Temporal Precision, NDCG@10** (penalizing outdated passages) |
| **4. Multi-Hop** | 25 (12 EN, 13 AR) | Complex inquiries requiring deductive chains where identifying the final fact requires resolving an intermediate entity (e.g., Query $\rightarrow$ Entity X $\rightarrow$ Property Y). | **Tunnel vision**: Retrieving only passages matching the initial surface terms without executing 2nd-hop reflection queries. | **Subquery Recall@K, Hop-2 Coverage, Graph Completion** |

### 2.2 Language Breakdown & Cross-Lingual Splits

- **Arabic Monolingual (AR $\rightarrow$ AR)**: 30 queries where both the inquiry and the target knowledge base are Arabic. Evaluates Arabic dense retrieval, morphological invariance, and regional topical relevance (e.g., MENA tech ecosystems, Arabic NLP benchmarks, local regulatory frameworks).
- **Arabic-to-English Cross-Lingual (AR $\rightarrow$ EN)**: 20 queries where the inquiry is written in Arabic, but authoritative evidence resides in international English-language scientific papers, RFCs, or technical specifications. Evaluates multilingual vector alignment (e.g., Gemini `text-embedding-004`, OpenAI `text-embedding-3-small`, Ollama `nomic-embed-text`).
- **English Monolingual (EN $\rightarrow$ EN)**: 40 queries where both query and corpus are English. Provides baseline alignment with established Western IR benchmarks.
- **English-to-Multilingual Cross-Lingual (EN $\rightarrow$ Multi/AR)**: 10 queries assessing international inquiries targeting Arabic primary documentation or global comparative studies.

---

## 3. Ground-Truth Relevance Judgments (Qrels)

Relevance judgments follow a standardized 4-point graded scale derived from TREC Deep Learning standards, enhanced with factual span annotations for citation verification.

### 3.1 4-Point Graded Scale

```
Grade 3: Key / Definitive Evidence
└── Directly answers the query. Contains the exact numerical parameter, hardware benchmark,
    or definitive finding. Indispensable for report synthesis.

Grade 2: Highly Relevant Context
└── Provides direct, substantive support. Covers one complete facet of a comparative query
    or one complete hop of a multi-hop reasoning chain.

Grade 1: Marginally Relevant / Topical Background
└── Topically related background information (e.g., general history of quantum computing
    when asked about Falcon-X 2026 fidelity). Does not contain the target answer.

Grade 0: Irrelevant / Distractor
└── Off-topic, false positive lexical overlap, or superseded/obsolete temporal information.
```

### 3.2 Qrel Attribution Schema Attributes

Each relevance entry links a specific query to a passage chunk and includes:
- `query_id`: Unique identifier (e.g., `lens_ar_fact_001`).
- `chunk_id`: Unique chunk identifier (e.g., `doc_042_c03`).
- `source_id`: Parent document index or identifier.
- `relevance_grade`: Integer `0`, `1`, `2`, or `3`.
- `is_key_evidence`: Boolean flag indicating if this chunk contains the indispensable core fact.
- `hop_level`: Integer indicating which reasoning hop this chunk satisfies (`1`, `2`, or `null` for single-hop).
- `comparison_facet`: Categorical flag (`"entity_a"`, `"entity_b"`, or `"synthesis"`) for comparative queries.
- `target_evidence_span`: The exact character substring within the chunk that substantiates the claim.

---

## 4. Formal JSON Schema Specification

The dataset is represented as a single canonical JSON document, validated by JSON Schema (Draft 7 / 2020-12). It models the full lifecycle of an investigation: documents, chunked passages, queries, perspective decompositions, qrels, and golden report assertions.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://lens.desktop/schemas/bilingual-ir-100.schema.json",
  "title": "LENS Bilingual Information Retrieval Benchmark (LENS-IR-100)",
  "description": "Standardized schema for 100-sample bilingual IR and citation fidelity evaluation in LENS desktop.",
  "type": "object",
  "required": ["metadata", "corpus", "queries", "qrels"],
  "properties": {
    "metadata": {
      "type": "object",
      "required": ["version", "benchmark_name", "created_at", "total_queries", "language_counts", "category_counts"],
      "properties": {
        "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
        "benchmark_name": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" },
        "total_queries": { "type": "integer", "const": 100 },
        "language_counts": {
          "type": "object",
          "required": ["ar", "en"],
          "properties": {
            "ar": { "type": "integer", "const": 50 },
            "en": { "type": "integer", "const": 50 }
          }
        },
        "category_counts": {
          "type": "object",
          "required": ["factual", "comparative", "temporal", "multi_hop"],
          "properties": {
            "factual": { "type": "integer", "const": 25 },
            "comparative": { "type": "integer", "const": 25 },
            "temporal": { "type": "integer", "const": 25 },
            "multi_hop": { "type": "integer", "const": 25 }
          }
        }
      }
    },
    "corpus": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["doc_id", "url", "title", "domain", "language", "chunks"],
        "properties": {
          "doc_id": { "type": "string" },
          "url": { "type": "string", "format": "uri" },
          "title": { "type": "string" },
          "domain": { "type": "string" },
          "language": { "type": "string", "enum": ["ar", "en", "multilingual"] },
          "published_date": { "type": "string", "format": "date" },
          "authority_score": { "type": "number", "minimum": 0, "maximum": 100 },
          "chunks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["chunk_id", "chunk_index", "content", "char_offset_start", "char_offset_end"],
              "properties": {
                "chunk_id": { "type": "string" },
                "chunk_index": { "type": "integer" },
                "content": { "type": "string", "minLength": 20 },
                "char_offset_start": { "type": "integer", "minimum": 0 },
                "char_offset_end": { "type": "integer", "minimum": 0 }
              }
            }
          }
        }
      }
    },
    "queries": {
      "type": "array",
      "minItems": 100,
      "maxItems": 100,
      "items": {
        "type": "object",
        "required": ["query_id", "category", "query_language", "target_language", "query_text", "perspectives", "golden_facts"],
        "properties": {
          "query_id": { "type": "string", "pattern": "^lens_(ar|en)_(fact|comp|temp|mhop)_\\d{3}$" },
          "category": { "type": "string", "enum": ["factual", "comparative", "temporal", "multi_hop"] },
          "query_language": { "type": "string", "enum": ["ar", "en"] },
          "target_language": { "type": "string", "enum": ["ar", "en", "cross_lingual"] },
          "query_text": { "type": "string", "minLength": 5 },
          "temporal_anchor": { "type": ["string", "null"] },
          "perspectives": {
            "type": "array",
            "items": { "type": "string" },
            "description": "STORM-compatible perspective personas decomposed for this query."
          },
          "expected_subqueries": {
            "type": "array",
            "items": { "type": "string" }
          },
          "golden_facts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["fact_id", "statement", "key_evidence_spans"],
              "properties": {
                "fact_id": { "type": "string" },
                "statement": { "type": "string" },
                "hop_index": { "type": ["integer", "null"] },
                "key_evidence_spans": {
                  "type": "array",
                  "items": { "type": "string" }
                }
              }
            }
          }
        }
      }
    },
    "qrels": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["query_id", "chunk_id", "doc_id", "relevance_grade"],
        "properties": {
          "query_id": { "type": "string" },
          "chunk_id": { "type": "string" },
          "doc_id": { "type": "string" },
          "relevance_grade": { "type": "integer", "minimum": 0, "maximum": 3 },
          "is_key_evidence": { "type": "boolean" },
          "hop_level": { "type": ["integer", "null"] },
          "comparison_facet": { "type": ["string", "null"], "enum": ["entity_a", "entity_b", "synthesis", null] },
          "target_evidence_span": { "type": ["string", "null"] },
          "rationale": { "type": "string" }
        }
      }
    }
  }
}
```

---

## 5. Concrete Sample Entries Across Categories & Languages

The following 4 concrete sample instances illustrate the schema across all 4 categories in Arabic and English.

### 5.1 Factual Sample (Cross-Lingual AR $\rightarrow$ EN)

```json
{
  "query": {
    "query_id": "lens_ar_fact_001",
    "category": "factual",
    "query_language": "ar",
    "target_language": "cross_lingual",
    "query_text": "ما هي كثافة الطاقة ومعدل الاحتفاظ بالسعة لبطاريات الحالة الصلبة بالسيراميك وفق أحدث الاختبارات؟",
    "temporal_anchor": null,
    "perspectives": ["مهندس نظم تخزين الطاقة", "محلل سلاسل توريد بطاريات السيارات الكهربائية"],
    "expected_subqueries": [
      "ceramic sulfide electrolyte solid-state battery energy density Wh/kg",
      "solid state battery capacity retention 1200 cycles fast charge",
      "كثافة الطاقة لبطاريات الحالة الصلبة"
    ],
    "golden_facts": [
      {
        "fact_id": "fact_001_a",
        "statement": "The ceramic sulfide electrolyte solid-state cell achieves 520 Wh/kg specific energy and retains 86.4% capacity after 1,200 fast-charge cycles at 4C.",
        "hop_index": null,
        "key_evidence_spans": ["520 Wh/kg specific energy", "retained 86.4% capacity after 1,200 fast-charge cycles"]
      }
    ]
  },
  "qrels": [
    {
      "query_id": "lens_ar_fact_001",
      "chunk_id": "doc_battery_01_c05",
      "doc_id": "doc_battery_01",
      "relevance_grade": 3,
      "is_key_evidence": true,
      "hop_level": null,
      "comparison_facet": null,
      "target_evidence_span": "The ceramic sulfide electrolyte silicon-anode solid-state cell achieved 520 Wh/kg specific energy and retained 86.4% capacity after 1,200 fast-charge cycles at 4C discharge rates.",
      "rationale": "Directly answers the Arabic inquiry with exact empirical metrics."
    },
    {
      "query_id": "lens_ar_fact_001",
      "chunk_id": "doc_battery_01_c01",
      "doc_id": "doc_battery_01",
      "relevance_grade": 1,
      "is_key_evidence": false,
      "hop_level": null,
      "comparison_facet": null,
      "target_evidence_span": null,
      "rationale": "Introductory discussion on global energy transition; no specific metrics."
    }
  ]
}
```

### 5.2 Comparative Sample (Monolingual Arabic)

```json
{
  "query": {
    "query_id": "lens_ar_comp_014",
    "category": "comparative",
    "query_language": "ar",
    "target_language": "ar",
    "query_text": "مقارنة معمارية بين معمارية Mixture of Experts في DeepSeek-V3 ونماذج Llama 3 من حيث استهلاك الذاكرة وتوزيع الخبراء",
    "temporal_anchor": null,
    "perspectives": ["مهندس ذكاء اصطناعي ونظم موزعة", "باحث معماريات النماذج اللغوية الكبيرة"],
    "expected_subqueries": [
      "معمارية DeepSeek-V3 MoE عدد الخبراء والذاكرة",
      "معمارية Llama 3 Dense vs MoE كفاءة الحوسبة",
      "مقارنة استهلاك الذاكرة بين DeepSeek-V3 و Llama 3"
    ],
    "golden_facts": [
      {
        "fact_id": "fact_014_a",
        "statement": "DeepSeek-V3 utilizes Multi-head Latent Attention (MLA) and DeepSeekMoE with 256 routed experts (8 active per token) reducing KV cache memory by over 80%.",
        "hop_index": null,
        "key_evidence_spans": ["Multi-head Latent Attention", "256 routed experts", "KV cache"]
      },
      {
        "fact_id": "fact_014_b",
        "statement": "Llama 3 employs a dense transformer architecture with standard Grouped-Query Attention (GQA), requiring full parameter activation per forward pass.",
        "hop_index": null,
        "key_evidence_spans": ["dense transformer architecture", "Grouped-Query Attention"]
      }
    ]
  },
  "qrels": [
    {
      "query_id": "lens_ar_comp_014",
      "chunk_id": "doc_deepseek_v3_c02",
      "doc_id": "doc_deepseek_v3",
      "relevance_grade": 3,
      "is_key_evidence": true,
      "hop_level": null,
      "comparison_facet": "entity_a",
      "target_evidence_span": "يعتمد DeepSeek-V3 على تقنية Multi-head Latent Attention لضغط ذاكرة KV بنسبة تتجاوز 80% مع تفعيل 8 خبراء فقط من أصل 256 خبيراً لكل رمز.",
      "rationale": "Provides exact architectural details for Entity A (DeepSeek-V3)."
    },
    {
      "query_id": "lens_ar_comp_014",
      "chunk_id": "doc_llama3_arch_c04",
      "doc_id": "doc_llama3_arch",
      "relevance_grade": 3,
      "is_key_evidence": true,
      "hop_level": null,
      "comparison_facet": "entity_b",
      "target_evidence_span": "تعتمد نماذج Llama 3 على معمارية محول كثيفة بالكامل حيث يتم تنشيط جميع المعاملات في كل تمريرة أمامية باستخدام آلية GQA.",
      "rationale": "Provides exact architectural details for Entity B (Llama 3)."
    }
  ]
}
```

### 5.3 Temporal Sample (English Monolingual)

```json
{
  "query": {
    "query_id": "lens_en_temp_021",
    "category": "temporal",
    "query_language": "en",
    "target_language": "en",
    "query_text": "What are the finalized NIST post-quantum cryptography standards published in 2024 and their mandated federal migration deadlines through 2026?",
    "temporal_anchor": "2024-2026",
    "perspectives": ["Cybersecurity Compliance Auditor", "Cryptographic Systems Engineer"],
    "expected_subqueries": [
      "NIST finalized PQC standards FIPS 203 204 205 August 2024",
      "federal post-quantum migration timeline deadlines 2026",
      "FIPS 203 ML-KEM FIPS 204 ML-DSA status"
    ],
    "golden_facts": [
      {
        "fact_id": "fact_021_a",
        "statement": "NIST officially finalized FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), and FIPS 205 (SLH-DSA) in August 2024, mandating initial enterprise zero-trust migration roadmaps by 2026.",
        "hop_index": null,
        "key_evidence_spans": ["FIPS 203 (ML-KEM)", "FIPS 204 (ML-DSA)", "FIPS 205 (SLH-DSA)"]
      }
    ]
  },
  "qrels": [
    {
      "query_id": "lens_en_temp_021",
      "chunk_id": "doc_nist_pqc_2024_c01",
      "doc_id": "doc_nist_pqc_2024",
      "relevance_grade": 3,
      "is_key_evidence": true,
      "hop_level": null,
      "comparison_facet": null,
      "target_evidence_span": "In August 2024, NIST released the finalized Federal Information Processing Standards: FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), and FIPS 205 (SLH-DSA). Federal agencies must establish zero-trust quantum-readiness plans before 2026.",
      "rationale": "Directly satisfies the 2024-2026 temporal constraints and specifies finalized standards."
    },
    {
      "query_id": "lens_en_temp_021",
      "chunk_id": "doc_nist_draft_2022_c03",
      "doc_id": "doc_nist_draft_2022",
      "relevance_grade": 0,
      "is_key_evidence": false,
      "hop_level": null,
      "comparison_facet": null,
      "target_evidence_span": null,
      "rationale": "TEMPORAL DISTRACTOR: Refers to 2022 draft candidate algorithms (Kyber, Dilithium) prior to formal FIPS standard finalization."
    }
  ]
}
```

### 5.4 Multi-Hop Sample (English Monolingual)

```json
{
  "query": {
    "query_id": "lens_en_mhop_032",
    "category": "multi_hop",
    "query_language": "en",
    "target_language": "en",
    "query_text": "What cooling technology is utilized by the supercomputer that trained Falcon 180B, and what is its Power Usage Effectiveness (PUE)?",
    "temporal_anchor": null,
    "perspectives": ["Datacenter Infrastructure Architect", "High-Performance Computing Engineer"],
    "expected_subqueries": [
      "supercomputer used to train Falcon 180B model TII",
      "Condor Galaxy-1 supercomputer liquid cooling PUE metric"
    ],
    "golden_facts": [
      {
        "fact_id": "fact_032_hop1",
        "statement": "Falcon 180B was trained on the Condor Galaxy 1 (CG-1) AI supercomputer developed by G42 and Cerebras.",
        "hop_index": 1,
        "key_evidence_spans": ["Condor Galaxy 1 (CG-1)", "G42 and Cerebras"]
      },
      {
        "fact_id": "fact_032_hop2",
        "statement": "The CG-1 supercomputer utilizes direct-to-chip liquid cooling achieving an operational PUE of 1.15.",
        "hop_index": 2,
        "key_evidence_spans": ["direct-to-chip liquid cooling", "PUE of 1.15"]
      }
    ]
  },
  "qrels": [
    {
      "query_id": "lens_en_mhop_032",
      "chunk_id": "doc_falcon_announcement_c04",
      "doc_id": "doc_falcon_announcement",
      "relevance_grade": 2,
      "is_key_evidence": true,
      "hop_level": 1,
      "comparison_facet": null,
      "target_evidence_span": "Falcon 180B was trained on 4,096 Wafer-Scale Engines across the Condor Galaxy 1 (CG-1) supercomputing cluster.",
      "rationale": "Satisfies Hop 1: Identifies the specific supercomputer (CG-1)."
    },
    {
      "query_id": "lens_en_mhop_032",
      "chunk_id": "doc_cg1_infrastructure_c02",
      "doc_id": "doc_cg1_infrastructure",
      "relevance_grade": 3,
      "is_key_evidence": true,
      "hop_level": 2,
      "comparison_facet": null,
      "target_evidence_span": "The CG-1 deployment implements direct closed-loop liquid cooling at the wafer level, maintaining an average data center PUE of 1.15 under full compute load.",
      "rationale": "Satisfies Hop 2: Discloses cooling technology and exact PUE."
    }
  ]
}
```

---

## 6. Mathematical Formulations of Benchmark Metrics

Evaluation evaluates two discrete stages of the LENS engine:
1. **Passage Ranking Engine** (`rankSourcePassages` in `embeddings.ts`): Evaluates retrieval accuracy against Qrels.
2. **Report Synthesizer & Copilot** (`DeepResearchAgent` in `agent.ts`): Evaluates grounding and citation fidelity in generated Markdown.

```
+-----------------------------------------------------------------------------------------------+
|                                      EVALUATION METRICS SUITE                                 |
+-----------------------------------------------------------------------------------------------+
                 │                                                              │
                 ▼                                                              ▼
    RETRIEVAL STAGE METRICS                                         SYNTHESIS STAGE METRICS
    - Recall@K (K = 3, 5, 10)                                       - Citation Recall (Attribution)
    - MRR@10 (Mean Reciprocal Rank)                                 - Citation Precision (Entailment)
    - NDCG@10 (Normalized Discounted Cumulative Gain)               - Citation Pointer Integrity
```

### 6.1 Retrieval Metrics

#### 6.1.1 Recall@K ($K \in \{3, 5, 10\}$)

Recall@K measures the proportion of all known relevant passages ($\text{grade} \ge 2$) retrieved within the top $K$ ranked results for query $q$:

$$\text{Recall}@K(q) = \frac{|\text{Retrieved}_K(q) \cap \text{Relevant}(q)|}{|\text{Relevant}(q)|}$$

Across all queries in benchmark set $Q$:

$$\text{Recall}@K = \frac{1}{|Q|} \sum_{q \in Q} \text{Recall}@K(q)$$

*Threshold*: Chunks with `relevance_grade >= 2` are considered relevant. For comparative queries, both entity facets must have at least one passage in top $K$ for full credit.

#### 6.1.2 Mean Reciprocal Rank at 10 (MRR@10)

MRR@10 assesses how quickly the retriever presents the first highly relevant or definitive passage ($\text{grade} \ge 2$):

$$\text{RR}(q) = \begin{cases} \frac{1}{\text{rank}_1(q)} & \text{if } \text{rank}_1(q) \le 10 \\ 0 & \text{if no relevant chunk found in top 10} \end{cases}$$

$$\text{MRR}@10 = \frac{1}{|Q|} \sum_{q \in Q} \text{RR}(q)$$

where $\text{rank}_1(q)$ is the 1-based rank position of the first passage satisfying $\text{grade} \ge 2$.

#### 6.1.3 Normalized Discounted Cumulative Gain at 10 (NDCG@10)

NDCG@10 measures the quality of the ranked list with non-binary graded relevance ($r_i \in \{0, 1, 2, 3\}$):

$$\text{DCG}@10(q) = \sum_{i=1}^{\min(10, |\text{Retrieved}(q)|)} \frac{2^{r_i} - 1}{\log_2(i + 1)}$$

$$\text{IDCG}@10(q) = \sum_{i=1}^{\min(10, |\text{Relevant}(q)|)} \frac{2^{r_i^*} - 1}{\log_2(i + 1)}$$

$$\text{NDCG}@10(q) = \begin{cases} \frac{\text{DCG}@10(q)}{\text{IDCG}@10(q)} & \text{if } \text{IDCG}@10(q) > 0 \\ 0 & \text{otherwise} \end{cases}$$

$$\text{NDCG}@10 = \frac{1}{|Q|} \sum_{q \in Q} \text{NDCG}@10(q)$$

where $r_i$ is the relevance grade of the passage at rank $i$, and $r_i^*$ is the relevance grade at rank $i$ in the ideal sort order.

---

### 6.2 Citation Fidelity Metrics (Synthesis Stage)

LENS synthesizes reports with inline bracket citations (`[1]`, `[2]`), where each number points to a source index (`citationId = sourceIndex + 1`). Based on the ALCE (Attributed Language Evaluation) framework, we define three automated metrics:

#### 6.2.1 Citation Recall (Attribution Completeness)

Evaluates whether factual claims asserted in the generated `LivingReport` are supported by citations:

$$\text{Citation Recall} = \frac{|\mathcal{S}_{\text{cited}}| + |\mathcal{S}_{\text{common-knowledge}}|}{|\mathcal{S}_{\text{total}}|}$$

where:
- $\mathcal{S}_{\text{total}}$ is the set of all atomic factual statements extracted from the synthesized report.
- $\mathcal{S}_{\text{cited}}$ is the set of statements that contain at least one inline citation `[k]`.
- A target score of $\ge 90\%$ ensures the report does not assert unreferenced claims.

#### 6.2.2 Citation Precision (Attribution Entailment)

Evaluates whether the cited source passage actually supports the claim made in the text, preventing citation hallucination:

$$\text{Citation Precision} = \frac{|\{(s, c) \in \mathcal{C} : \text{Entails}(\text{Passage}(c), s) = \text{True}\}|}{|\mathcal{C}|}$$

where:
- $\mathcal{C}$ is the set of all $(s, c)$ pairs where statement $s$ cites citation identifier $c$.
- $\text{Passage}(c)$ is the text of the source chunk assigned to identifier $c$.
- $\text{Entails}(P, s)$ evaluates whether premise $P$ logically entails or factually substantiates hypothesis $s$ (evaluated via NLI cross-encoder or structured LLM judge with temperature 0.0).

#### 6.2.3 Citation Pointer Integrity (Linear Mapping)

A hard deterministic check validating that every inline citation `[k]` in the Markdown body strictly maps to an existing source in the bibliography table (`sources[k - 1]`):

$$\text{Pointer Integrity} = \begin{cases} 1.0 & \text{if } \forall k \in \mathcal{K}_{\text{body}}: 1 \le k \le |\mathcal{K}_{\text{catalog}}| \\ 0.0 & \text{if any } k \notin [1, |\mathcal{K}_{\text{catalog}}|] \text{ or dangling pointers exist} \end{cases}$$

In `frontend/test/benchmark_and_fallback.test.mjs`, this is enforced across all test fixtures.

---

## 7. Repository Placement & Architecture Layout

The benchmark suite and its tooling reside in a top-level `benchmarks/` directory to preserve clean separation between runtime application code, developer tests, and large ground-truth corpora.

### 7.1 Directory Layout

```
lens-desktop/
├── benchmarks/
│   └── bilingual-ir-100/
│       ├── bilingual-ir-100.json        # Canonical single-file dataset (Schema v1.0.0)
│       ├── schema.json                  # Formal JSON Schema validator
│       ├── beir/                        # Standard BEIR/TREC export for external tooling
│       │   ├── corpus.jsonl             # {"_id": "...", "title": "...", "text": "..."}
│       │   ├── queries.jsonl            # {"_id": "...", "text": "...", "metadata": {...}}
│       │   └── qrels/
│       │       └── test.tsv             # query_id \t corpus_id \t score
│       ├── README.md                    # Benchmark documentation & baseline results
│       └── scripts/
│           ├── validate_schema.mjs      # Validates bilingual-ir-100.json against schema.json
│           └── export_beir.mjs          # Generates beir/ subfolder from bilingual-ir-100.json
├── frontend/
│   ├── electron/
│   │   └── engine/
│   │       ├── embeddings.ts            # Chunk ranking & cosine similarity pipeline
│   │       └── agent.ts                 # LivingReport synthesis and citation builder
│   └── test/
│       ├── benchmark_and_fallback.test.mjs  # Existing fallback & unit benchmark suite
│       └── benchmark_evaluator.test.mjs     # Automated benchmark runner (Recall, MRR, NDCG)
└── docs/
    └── research/
        ├── benchmark-dataset-spec.md        # This specification document
        ├── DEEP_RESEARCH_ARCHITECTURES.md
        └── OPEN_SOURCE_ECOSYSTEM.md
```

### 7.2 Interoperability Export (BEIR / TREC Tripartite Format)

To enable external evaluation using PyTerrier, Pyserini, Ranx, or BEIR, `export_beir.mjs` maps `bilingual-ir-100.json` into:
1. `corpus.jsonl`: Lines of `{"_id": chunk_id, "title": doc_title, "text": content}`.
2. `queries.jsonl`: Lines of `{"_id": query_id, "text": query_text, "metadata": {"category": category, "language": language}}`.
3. `qrels/test.tsv`: Tab-separated lines of `<query_id>\t<chunk_id>\t<relevance_grade>`.

---

## 8. Automated Test Harness & Verification Workflow

The benchmark test runner (`frontend/test/benchmark_evaluator.test.mjs`) integrates directly with the Node.js native test runner (`node --test`), matching the existing repository setup:

```bash
# Run existing unit tests and mock benchmarks
cd frontend
npm test

# Run the full 100-sample benchmark evaluation across configured embedding models
npm run test:benchmark
```

### 8.1 Performance Targets for LENS Providers

When running `LENS-IR-100` against the primary supported embedding providers (Gemini `text-embedding-004`, OpenAI `text-embedding-3-small`, and Ollama `nomic-embed-text`), the engine must satisfy the following minimum thresholds:

| Metric | Minimum Target (Monolingual EN) | Minimum Target (Monolingual AR) | Minimum Target (Cross-Lingual AR $\rightarrow$ EN) |
| :--- | :---: | :---: | :---: |
| **Recall@10** | $\ge 0.85$ | $\ge 0.80$ | $\ge 0.75$ |
| **MRR@10** | $\ge 0.70$ | $\ge 0.65$ | $\ge 0.60$ |
| **NDCG@10** | $\ge 0.75$ | $\ge 0.70$ | $\ge 0.65$ |
| **Citation Precision** | $\ge 0.85$ | $\ge 0.80$ | $\ge 0.80$ |
| **Citation Pointer Integrity** | $1.00$ ($100\%$) | $1.00$ ($100\%$) | $1.00$ ($100\%$) |

---

## 9. Conclusion & Next Steps

This specification establishes an empirical, reproducible foundation for measuring and improving information retrieval in LENS. By explicitly testing Arabic morphology, cross-lingual retrieval, deep-document fact extraction, and report citation fidelity, `LENS-IR-100` ensures that architectural changes to `embeddings.ts` and `agent.ts` can be validated with statistical confidence.

Next implementation steps:
1. Initialize directory `benchmarks/bilingual-ir-100/` and commit `schema.json`.
2. Populate the 100 queries, corpus, and qrels into `bilingual-ir-100.json`.
3. Implement `export_beir.mjs` and `benchmark_evaluator.test.mjs`.
4. Run baseline evaluation across Gemini, OpenAI, and local Ollama models, publishing baseline scorecard to `benchmarks/bilingual-ir-100/README.md`.
