# LENS Semantic Embedding Retrieval System

## Overview

LENS integrates a vector embedding and semantic chunk retrieval subsystem adapted from reference architecture (`vane-temp`). It bridges the gap between raw web scraping and report synthesis by chunking scraped documents into bounded passages, generating dense vector embeddings, and ranking passages against the user's research query and subqueries.

---

## When Embeddings Help

1. **Information Buried Deep in Long Articles**:
   Standard extraction slices the first 2,000 characters of a web page. For in-depth research papers, long analysis pieces, or technical documentation, critical findings, methodologies, and benchmarks often appear in the body or conclusion. Semantic chunk ranking locates and extracts these relevant passages regardless of their position in the document.

2. **Multi-Query Perspective Alignment**:
   LENS decomposes research queries into 3–4 subqueries (perspectives). Embeddings match document chunks across both the primary inquiry and exploratory angles using weighted cosine similarity, pulling excerpts that directly address nuanced aspects of the prompt.

3. **Source Diversity with Numbered Citation Integrity**:
   The passage ranking pipeline enforces a diversity constraint: each scraped source is guaranteed representative excerpts before filling the remaining token budget. Chunks retain their parent source index (`citationId = sourceIndex + 1`), ensuring citations `[1]`, `[2]` in synthesized reports correspond directly to verified sources in the reference catalog.

---

## Supported Providers & Setup

Embedding settings are persisted in Studio Settings (`Settings > Embedding Models` / `نماذج التضمين الدلالي`):

| Provider | Default Model | Dimensions | Setup / Requirements |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `text-embedding-004` | 768 dims | Cloud API key (inherits from Gemini Chat key if enabled, or dedicated key) |
| **OpenAI** | `text-embedding-3-small` | 1536 dims | Cloud API key (`sk-...`, supports `text-embedding-3-large` 3072 dims) |
| **Ollama (Local)** | `nomic-embed-text` | 768 dims | Local server endpoint (`http://localhost:11434`), zero telemetry |

### Legacy Settings Migration
Existing installations without embedding settings automatically migrate on launch. If a Gemini or OpenAI key is already present in chat settings, LENS configures that provider as the default embedding provider with `use_chat_key: true`. If no credentials exist, research continues uninterrupted using standard excerpt extraction.

---

## Omitted Adapters & Architecture Rationale

- **Anthropic Claude**: Anthropic's public API does not provide a text embedding endpoint (only completion/chat generation).
- **Groq LPU**: Groq provides ultra-fast LLM inference but does not offer dedicated vector embedding endpoints.
- **Local Transformers Pipeline (`@huggingface/transformers`)**: Omitted to prevent mandatory multi-gigabyte weight downloads and ONNX runtime overhead during desktop startup. Local users can run Ollama with lightweight vector models (e.g. `nomic-embed-text` ~270MB) instead.

---

## Fault Tolerance & Fallback

- **Bounded Batching & Timeouts**: Chunk embedding requests are batched (16–32 items) with strict timeouts (12–15 seconds) and `AbortSignal` support.
- **Validation**: All vector responses are checked for finite values, consistent dimensions, and expected counts.
- **Graceful Fallback**: If an embedding provider experiences network failure, quota exhaustion, or timeouts, the research agent emits a visible status note and seamlessly falls back to standard source excerpt extraction (`fallbackEvidence`). Research never fails due to an embedding issue.

---

## What Remains Unbenchmarked

- **End-to-End Synthesis Quality**: No human-in-the-loop blind evaluation has been benchmarked between standard 2k prefix extraction vs. vector passage ranking on long-form reports.
- **Language Nuance (Arabic vs. English)**: Cross-lingual retrieval performance and tokenization efficiency between Arabic queries and multilingual web sources remain unbenchmarked across models.
- **Latency & Cost Overhead**: Vector generation introduces additional HTTP roundtrips before synthesis. Optimal chunk overlap and dimension truncation trade-offs have not been quantified.
