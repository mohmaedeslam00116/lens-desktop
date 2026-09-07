# Evidence Coverage Heuristic & Adaptive Multi-Hop Retrieval Triggering

**Specification & Architectural Decision Record for LENS Autonomous Desktop Research Engine**  
*Resolves GitHub Issue [#7](https://github.com/mohmaedeslam00116/lens-desktop/issues/7) under Map [#1](https://github.com/mohmaedeslam00116/lens-desktop/issues/1)*

---

## 1. Executive Summary

In autonomous multi-agent deep research systems, one of the most critical failure modes is **uncontrolled multi-hop retrieval**:
1. **Latency Blowup**: Naive iterative agents spawn arbitrary search queries indefinitely, causing user wait times to skyrocket from seconds to several minutes.
2. **Hallucinated Query Branching / Query Drift**: When an LLM is asked open-endedly "what else should we search for?", each successive hop drifts further from the user's primary intent, pulling in peripheral distractors.
3. **Premature Termination**: Conversely, a purely static 1-hop search frequently fails to retrieve crucial empirical data (e.g. 2025/2026 benchmarks, quantitative percentages, or risk evaluations) when initial search hits are marketing fluff or uninformative landing pages.

This specification defines **LENS's Evidence Coverage Heuristic** and **Adaptive Multi-Hop Triggering Engine**—a lightweight, pure TypeScript, mathematically bounded controller that audits gathered evidence before final LLM synthesis, quantifies missing information facets, and triggers at most 1–2 strictly targeted follow-up queries with zero external dependencies.

---

## 2. Multi-Facet Evidence Quantification Model

To decide whether a collection of retrieved documents is sufficient for a comprehensive, publication-grade research report, LENS evaluates **four orthogonal facets**:

### Facet 1: Subquery Topic Coverage ($S_{\text{subquery}}$)
During the initial planning stage, the agent decomposes the user query into $K$ distinct research subqueries $\{q_1, q_2, \dots, q_K\}$. For each subquery $q_k$, LENS computes the lexical and morphological term presence across the gathered document collection $D$:

$$cov(q_k) = \min\left(1.0, \frac{\sum_{t \in \text{tokens}(q_k)} \mathbb{I}(t \in D)}{|\text{tokens}(q_k)|}\right)$$

$$S_{\text{subquery}} = \frac{1}{K} \sum_{k=1}^K cov(q_k)$$

Any subquery with $cov(q_k) < \tau_{\text{facet}}$ (default: $0.40$) is formally flagged as an **Uncovered Facet Gap**.

### Facet 2: Empirical & Quantitative Density ($S_{\text{metric}}$)
Authoritative research requires verified numbers, statistics, percentages, dates, and quantitative units. LENS scans the gathered text for empirical data markers using high-speed regular expressions:
- Percentages: `\d+(?:\.\d+)?%`
- Currencies and financial figures: `[\$€£¥]\s*\d+(?:,\d+)*(?:\.\d+)?`
- Temporal benchmark stamps: `\b(202[456]|2030)\b`
- Engineering & scientific metrics: `\b(ms|GHz|TFLOPS|parameters|tokens/sec|accuracy|latency|F1|qubits|dB)\b`

$$S_{\text{metric}} = \min\left(1.0, \frac{\text{Count}(\text{EmpiricalMatches})}{M_{\text{expected}}}\right)$$
where $M_{\text{expected}} = 8$ for deep research dossiers.

### Facet 3: Perspective & Aspect Breadth ($S_{\text{aspect}}$)
A rigorous technical dossier must balance multiple perspectives. Depending on the research mode, LENS audits for the presence of 3 essential analytical pillars:
1. **Mechanics & Architecture**: `architecture|mechanism|implementation|framework|pipeline|خوارزمية|معمارية|آلية`
2. **Empirical Benchmarks & Results**: `benchmark|evaluation|performance|throughput|accuracy|مقارنة|أداء|تقييم`
3. **Risks, Challenges & Constraints**: `limitation|challenge|risk|drawback|bottleneck|vulnerability|تحديات|مخاطر|قيود`

$$S_{\text{aspect}} = \frac{\text{PresentAspects}}{3.0}$$

### Facet 4: Domain Diversity & Corroboration ($S_{\text{diversity}}$)
Claims must not rely exclusively on a single source or corporate website. LENS computes domain distribution across extracted passages:

$$S_{\text{diversity}} = \min\left(1.0, \frac{\text{UniqueDomains}}{D_{\text{target}}}\right)$$
where $D_{\text{target}} = 4$ unique second-level domains.

---

## 3. Composite Evidence Coverage Formula

The overall **Evidence Coverage Score** ($\text{CoverageScore} \in [0.0, 1.0]$) is computed as a weighted combination:

$$\text{CoverageScore} = w_{\text{subq}} \cdot S_{\text{subquery}} + w_{\text{aspect}} \cdot S_{\text{aspect}} + w_{\text{metric}} \cdot S_{\text{metric}} + w_{\text{div}} \cdot S_{\text{diversity}}$$

### Calibrated Weights
- $w_{\text{subq}} = 0.45$ (Primary research intent and sub-facets)
- $w_{\text{aspect}} = 0.25$ (Analytical depth and multi-perspective balance)
- $w_{\text{metric}} = 0.15$ (Quantitative grounding and empirical statistics)
- $w_{\text{div}} = 0.15$ (Cross-domain corroboration)

Sum of weights = $0.45 + 0.25 + 0.15 + 0.15 = 1.00$.

---

## 4. Adaptive Multi-Hop Triggering & Guardrails

### Decision Thresholds by Research Mode

| Research Mode | Max Adaptive Hops | Coverage Threshold ($\tau$) | Latency SLA | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **`quick`** | **0** | N/A | $\le 8\text{s}$ | **Zero multi-hop**: strictly single-pass retrieval for instant response. |
| **`deep`** | **1** | **0.70** (70%) | $\le 25\text{s}$ | At most **1 targeted hop** if coverage $< 0.70$. |
| **`comprehensive`** | **2** | **0.75** (75%) | $\le 45\text{s}$ | At most **2 targeted hops** if coverage $< 0.75$. |

### Stopping Criteria
An adaptive hop is **triggered** if and only if all of the following conditions hold:
1. `currentHop < maxHops`
2. $\text{CoverageScore} < \tau_{\text{threshold}}$
3. Total scraped sources count $< \text{maxSourcesBudget}$ (e.g. 12 sources for deep mode)
4. Identified at least one concrete missing facet (uncovered subquery, missing metrics, or missing risks).

If $\text{CoverageScore} \ge \tau$, the agent executes an **Early Exit** and proceeds immediately to synthesis.

---

## 5. Targeted Gap Query Generation (Zero Hallucination)

To eliminate **Query Drift**, LENS never asks an unconstrained LLM to "suggest more topics". Instead, adaptive queries are deterministically synthesized directly from the identified gaps:

1. **Uncovered Subquery Gap**:
   If subquery $q_k$ has coverage $< 0.40$, LENS generates a focused reformulation:
   - Arabic: `"${uncoveredSubq} تفاصيل معمارية وإحصائيات"`
   - English: `"${uncoveredSubq} detailed architecture and analysis"`
2. **Missing Quantitative Metrics Gap**:
   If $S_{\text{metric}} < 0.40$:
   - `"${primaryQuery} benchmark performance metrics numbers 2025 2026"`
3. **Missing Risks & Limitations Gap**:
   If risk aspect is missing:
   - `"${primaryQuery} limitations drawbacks security risks challenges"`

A maximum of **1 to 2 targeted queries** are executed per adaptive hop.

---

## 6. Architecture & System Seam

The Evidence Coverage Engine sits directly between **Initial Web Scraping (Step 4)** and **Final LLM Synthesis (Step 6)** in `DeepResearchAgent`:

```
[User Query] 
     │
     ▼
[Step 3: Subqueries (q1, q2, q3)]
     │
     ▼
[Step 4: Primary Hop Search & Scrape]
     │
     ▼
[Step 5: Evidence Coverage Audit] 
     │  ├── Subquery Term Overlap (S_subq)
     │  ├── Quantitative Metric Density (S_metric)
     │  ├── Perspective Aspect Breadth (S_aspect)
     │  └── Domain Diversity (S_div)
     │
     ├── CoverageScore >= 0.70 or maxHops reached ──► [Step 6: Final LLM Synthesis]
     │                                                      ▲
     └── CoverageScore < 0.70 & canHop ──► [Adaptive Hop]  │
                 │                                │         │
                 └── Targeted Gap Queries ────────┴─────────┘
```

---

## 7. Telemetry & User Transparency

The audit results are streamed to the frontend via the standard `LiveEvent` bus:
- `event.type = 'reflection'`:
  - `reflection`: Human-readable summary of coverage and detected gaps.
  - `reflections`: Array of bulleted gap diagnoses and adaptive actions.
  - `coverage`: Detailed scores (`coverageScore`, `subqueryCoverage`, `metricDensity`, `domainDiversity`, `uncoveredFacets`).
- Visual indicators in LENS UI render coverage status and notify the user when an adaptive hop is initiated to guarantee dossier completeness.
