# Architecture Research: Autonomous Deep Research Agents

<!-- matt-skills:research 1 -->

## Executive Summary
This document captures an empirical analysis of open-source deep research systems—specifically **Stanford STORM**, **Hugging Face Open Deep Research**, and **GPT Researcher**—and synthesizes their proven techniques into a unified, production-grade architecture for our desktop agent.

---

## 1. High-Trust Open Source Benchmarks

### 1.1 Stanford STORM (Synthesis of Topic Outlines from Related Minds)
* **Core Philosophy**: Single-query search suffers from *tunnel vision* and *confirmation bias*. Real human research panels consult multiple expert viewpoints before drafting.
* **Mechanism**:
  1. Simulates 3–5 distinct AI personas (e.g., *Systems Engineer*, *Venture Capitalist*, *Security Auditor*, *Policy Skeptic*).
  2. Each persona formulates questions targeting their specific concerns.
  3. Pre-writing outline generator merges perspectives into a comprehensive hierarchical table of contents.
  4. Final report synthesis cross-references perspectives into an academic-grade Wikipedia-style document with full citations.
* **Adoption in our Agent**: Multi-perspective selector (`technical`, `market`, `critical`, `storm`) and perspective-guided subquery formulation.

### 1.2 Hugging Face Open Deep Research
* **Core Philosophy**: Search is non-linear and iterative. Static RAG fails on open-ended investigative problems because unknown facts reveal new questions.
* **Mechanism**:
  1. *Lead Orchestrator* creates a multi-step investigation plan.
  2. *Retriever & Scraper Workers* execute initial parallel web queries.
  3. *Reflection & Self-Correction*: The orchestrator inspects the scraped knowledge corpus and asks: *"What questions remain unaddressed? Are there conflicting claims between sources?"*
  4. *Second-Hop Targeted Retrieval*: The agent launches targeted follow-up queries specifically aimed at resolving ambiguities and filling identified knowledge gaps.
  5. *Synthesizer & Verifier*: Verifies citations and formats the final report.
* **Adoption in our Agent**: Multi-hop reflection step (`reflection` event) between first-round web exploration and report drafting.

### 1.3 GPT Researcher (Assaf Elovic)
* **Core Philosophy**: Speed, parallel scraping, and flexible multi-provider support.
* **Mechanism**:
  - Headless crawler that scrapes, cleans, and chunks up to 20 sources concurrently.
  - Multi-retriever fallbacks: DuckDuckGo (free, zero-API-key local default) and Tavily/Serper for high-speed deterministic indexing.
  - LLM agnostic (OpenAI, Gemini, Anthropic, Groq, Ollama).
* **Adoption in our Agent**: FastAPI sidecar architecture wrapping GPT Researcher with real-time WebSocket telemetry.

---

## 2. Synthesized Architecture for Deep Research Studio 2.0

```
+---------------------------------------------------------------------------------------+
|                                  USER QUERY / OBJECTIVE                               |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 1: SCOPING & PERSPECTIVE SIMULATION (STORM)         |
             | - Technical Architecture                                  |
             | - Market & Commercial Dynamics                            |
             | - Critical Vulnerabilities & Counter-Arguments            |
             +───────────────────────────────────────────────────────────+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 2: DIVERSE QUERY GENERATION                         |
             | - Boolean search-engine optimized strings                 |
             | - Emits `subqueries` & updates visual Research Graph      |
             +───────────────────────────────────────────────────────────+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 3: CONCURRENT SCRAPING & EVIDENCE SCORING           |
             | - Parallel crawling via DuckDuckGo / Tavily               |
             | - Clean text extraction & domain authority scoring (0-100)|
             | - Emits `source` events with real domain favicons         |
             +───────────────────────────────────────────────────────────+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 4: REFLECTION & GAP ANALYSIS (Open Deep Research)   |
             | - Audits knowledge completeness                           |
             | - Generates targeted 2nd-hop queries for missing facts    |
             | - Resolves contradictions between sources                 |
             +───────────────────────────────────────────────────────────+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 5: MULTI-PERSPECTIVE LIVING REPORT SYNTHESIS        |
             | - Executive Summary + Takeaways                           |
             | - In-depth Chapter Analyses with Inline Citations [1], [2]|
             | - Comparative Matrix & Risk Evaluation                    |
             | - Verified Bibliography with direct links                 |
             +───────────────────────────────────────────────────────────+
                                           │
                                           ▼
             +───────────────────────────────────────────────────────────+
             | Phase 6: GROUNDED FOLLOW-UP COPILOT CHAT                  |
             | - Interrogates the Living Report in real-time             |
             | - Formulates comparison tables & extracts targeted quotes |
             +───────────────────────────────────────────────────────────+
```

---

## 3. UI/UX Translation (Impeccable Standards)
- **High-density 5-pane IDE layout** (TitleBar 35px, ActivityBar 48px, Explorer 240px, Editor Canvas, Composer 380px, StatusBar 22px).
- **Zero AI slop**: 1px micro-borders, clean monochrome surfaces with intentional semantic accents (electric blue, emerald, amber), zero nested cards.
- **Interactive Multi-Tab Editor Canvas**:
  - `report.md`: Prose view with 72ch measure and sticky outline.
  - `graph.view`: Visual interactive node tree representing the multi-hop reasoning DAG.
  - `sources.json`: Structured source credibility matrix.
  - `telemetry.log`: Raw agent execution stream.
