# Methodology Audit Reference Guide

Guidelines for auditing methodological rigor and experimental integrity in scientific publications.

## 1. Experimental Controls & Baselines
- **Baseline Tuning**: Are competing methods tuned with comparable diligence, or do authors compare against unoptimized default baselines?
- **Compute Parity**: Was equivalent compute or inference budget allocated when measuring efficiency or throughput?
- **Hyperparameter Fair Play**: Were hyperparameters tuned on a held-out validation set rather than on the test set?

## 2. Dataset Hygiene & Leakage
- **Contamination / Leakage**: Was test data present in pretraining corpora or feature selection pipelines?
- **Class Balance & Distribution Shifts**: Does the evaluation account for long-tail distribution or synthetic distribution biases?
- **Synthetic Data Usage**: If synthetic data was generated for evaluation, is it independently validated against real-world distributions?

## 3. Statistical Validity
- **Seed Variance**: Were results averaged across at least 3–5 randomized seeds, and are standard deviations / confidence intervals disclosed?
- **Significance Testing**: Did the authors conduct paired t-tests, bootstrap significance tests, or Wilcoxon signed-rank tests for marginal improvements?
- **Effect Size**: Is the improvement practically meaningful ($\Delta > 1.0\%$) or within standard measurement noise?

## 4. Threats to Validity
- **Internal Validity**: Confounding variables, implementation bugs, or unacknowledged hardware dependencies.
- **External Validity**: Generalizability beyond the benchmark dataset to out-of-distribution domains.
- **Construct Validity**: Does the evaluation metric accurately measure the underlying capability claimed?
