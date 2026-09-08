---
name: academic-paper-analysis
description: Specialized deep analytical extraction for academic literature, peer-reviewed publications, and scientific preprints with systematic methodology audits and ablation checklists.
license: Apache-2.0
compatibility: LENS >= 1.0
allowed-tools:
  - PageScraper
  - MultiSearchProvider
metadata:
  category: science
  version: 1.0.0
  author: LENS Academic Workgroup
---

# Academic Paper Analysis & Systematic Literature Extraction

Use this skill when analyzing scientific preprints, peer-reviewed articles, and technical research literature across computer science, physics, biology, and medicine.

## Objectives & Core Directives

1. **Empirical Grounding**: Extract quantitative benchmark metrics, exact dataset splits, baseline comparisons, and statistical significance values directly from primary papers.
2. **Methodological Scrutiny**: Audit experimental design against [references/methodology-audit.md](references/methodology-audit.md), examining controls, data leakage, and statistical rigor.
3. **Ablation Table Dissection**: Parse ablation tables systematically using [references/ablation-checklist.md](references/ablation-checklist.md), identifying which individual architecture or algorithmic choices account for reported gains.
4. **Reproducibility Extraction**: Record hyperparameters, hardware compute requirements (GPU hours, batch sizes), seed counts, and code/artifact availability.

## Step-by-Step Analytical Protocol

### Step 1: Bibliographic & Experimental Metadata Extraction
Extract and summarize:
- **Title, Authors, Affiliations, and Venue** (or preprint archive identifier).
- **Core Hypothesis**: The explicit scientific question or bottleneck the authors claim to solve.
- **Dataset Hierarchy**: Training, validation, and test partition numbers, including data distribution characteristics.

### Step 2: Methodology & Control Audit
Audit the experimental setup against `references/methodology-audit.md`:
- Are baseline comparisons tested on equal compute budgets?
- Are benchmark evaluation splits protected against training set contamination?
- Did the authors report confidence intervals, error margins, or standard deviations over multiple randomized seeds?

### Step 3: Ablation & Contribution Dissection
Reference `references/ablation-checklist.md` to evaluate reported gains:
- Isolate the delta ($\Delta$) contributed by each architectural component.
- Verify whether improvements stem from algorithmic novelty or hyperparameter tuning.
- Note any negative results or trade-offs (e.g., latency, memory footprint, or domain brittleness).

### Step 4: Grounded Synthesis Formatting
Present findings in clear, publication-grade Markdown tables:
- Include a Comparative Performance Matrix contrasting the proposed approach against previous state-of-the-art baselines.
- Highlight threats to validity and open questions for follow-up investigation.
- Use deterministic bracketed citations `[N]` referencing exact source excerpts for all empirical claims.
