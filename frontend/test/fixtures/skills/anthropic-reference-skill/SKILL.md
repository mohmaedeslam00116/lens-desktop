---
name: anthropic-reference-skill
description: "Anthropic-style skill with nested references and complex YAML structure"
license: Apache-2.0
compatibility: "LENS >= 1.0.0"
metadata:
  author: Anthropic Research Team
  category: science
  version: 2
  citation_policy: strict
allowed-tools:
  - web_search
  - read_url
  - read_resource
---

# Anthropic Reference Skill

This skill demonstrates Anthropic's recommended skill format with nested references.

## Instructions

1. Always verify citations against primary sources before including them.
2. Cross-reference findings with the methodology audit checklist.
3. Use the ablation verification protocol for experimental claims.

## Reference Documents

- See `references/nested/deep-methodology.md` for the full audit protocol.
- See `references/citation-policy.md` for citation verification rules.
