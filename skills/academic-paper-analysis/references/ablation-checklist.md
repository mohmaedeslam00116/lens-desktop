# Ablation Study Verification Checklist

Framework for auditing ablation tables and isolating individual scientific contributions.

## Verification Checklist

- [ ] **Component Isolation**: Does each row in the ablation table isolate exactly one component, or are multiple alterations bundled together?
- [ ] **Baseline Grounding**: Is row 0 a clean, reproducible baseline without any novel components?
- [ ] **Additive vs. Subtractive**: Did the authors test both adding the component to the baseline and removing it from the full proposed system?
- [ ] **Delta Quantification**: Is the contribution metric delta ($\Delta$) explicitly calculated and tested for statistical significance?
- [ ] **Parameter & Compute Overhead**: Does the ablation table report parameter count, FLOPS, and latency alongside accuracy metrics for each variation?
- [ ] **Failure Case Disclosure**: Are negative ablations or configurations where the component degraded performance transparently analyzed?

## Standard Ablation Schema

| Component Configuration | Accuracy / F1 | $\Delta$ over Baseline | Latency (ms) | Parameter Count |
|:------------------------|:--------------|:-----------------------|:-------------|:----------------|
| Baseline System         | Baseline      | -                      | Base         | Base            |
| + Module A              | $+x.x\%$      | $+x.x\%$               | $+y$ ms      | $+p$ M          |
| + Module B              | $+x.x\%$      | $+x.x\%$               | $+y$ ms      | $+p$ M          |
| Full Proposed System    | Final         | $+\text{Total}$        | Final        | Final           |
