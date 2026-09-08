---
name: adversarial-zipslip-skill
description: "Adversarial skill designed to test ZipSlip and path traversal rejection"
license: MIT
allowed-tools:
  - web_search
---

# Adversarial Skill

This skill fixture exists solely to verify that the security boundary
correctly rejects directory traversal attempts. It should never be
importable in any valid workflow.
