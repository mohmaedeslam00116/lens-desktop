# 3. Dual-Path Skill Activation & Compaction Shielding

## Context
LENS supports diverse LLM deployment topologies ranging from local offline inference (e.g. Llama 3.1 via Ollama) to multi-modal cloud frontier APIs (Google Gemini, OpenAI, Anthropic Claude).
1. Local models often lack stable, robust tool/function-calling capabilities or experience schema formatting failures when presented with dynamic tool definitions.
2. In multi-hop research sessions involving dozens or hundreds of scraped pages, iterative context compaction and summarization risk compressing or pruning away domain instructions provided by active Agent Skills (`SKILL.md`).
3. Skills declaring `allowed-tools` must map cleanly to desktop engine capabilities without granting dangerous system or shell privileges.

## Decision
1. **Dual-Path Hybrid Activation Architecture**:
   - **Path 1 (Controller-Assisted Pre-activation)**:
     When a research investigation starts with an approved `ResearchPlan`, any skills designated in `plan.suggestedSkills` (or `request.skills`) are pre-activated directly by the controller. Their full instructions are parsed, shielded, and injected into the prompt context prior to retrieval. This guarantees 100% activation reliability even on tool-incapable local LLMs.
   - **Path 2 (Dynamic Tool Calling `activate_skill`)**:
     For tool-capable providers (Gemini, OpenAI, Claude), the engine registers an `activate_skill(name)` tool schema. The model can selectively activate skills on demand during execution by inspecting Tier 1 catalog summaries.
   - In both paths, a `skill_activated` live telemetry event is emitted to inform the frontend and audit log.

2. **Compaction Shielding (`CompactionShield`)**:
   - All active skill instructions are enclosed in `<skill_content name="..."> ... </skill_content>` tags.
   - Context compression and summarization routines are mandated to extract these blocks prior to compaction, execute reduction solely on unshielded evidence, and re-inject the shielded blocks intact.
   - If an aggressive external summarizer drops the block placeholder, the shield safety mechanism re-appends the missing `<skill_content>` blocks, guaranteeing zero skill rule degradation across long-running research sessions.

3. **Zero Privilege Escalation Host Tool Mapping (`HostToolMapper`)**:
   - Skill `allowed-tools` declarations are mapped strictly to native LENS capabilities (`web_search`, `read_url`, `read_resource`, `record_evidence`).
   - Any unrecognized or unmapped tools emit informative diagnostic notices and are safely omitted without granting arbitrary execution rights or elevating privileges.

## Consequences
- Local Ollama research sessions reliably follow specialized skill workflows without needing tool calling.
- Advanced cloud models retain dynamic flexibility to activate specialized skills as new facets emerge during deep retrieval.
- Context window compaction cannot prune away active skill constraints or guidelines.
- Skills cannot execute arbitrary shell commands or breach the host application sandbox.
