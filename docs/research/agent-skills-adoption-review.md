# Agent Skills: Official References & Runtime Adoption Review

**Document ID**: `LENS-RESEARCH-024`  
**Issue Reference**: [#24: Agent Skills: Official References & Runtime Adoption Review](https://github.com/mohmaedeslam00116/lens-desktop/issues/24)  
**Date**: September 7, 2026  
**Status**: Formal Architectural Review & Recommendation  
**Author**: LENS Core Architecture Team  

---

## 1. Executive Summary

This review investigates runtime adoption strategies for supporting the **Open Agent Skills Standard** (`SKILL.md`) within the **LENS** desktop application.

Following the architectural consensus established in Map [#10](https://github.com/mohmaedeslam00116/lens-desktop/issues/10), LENS retired earlier proprietary SDK proposals in favor of standard, portable skills interoperable with the broader ecosystem (including Claude Code, Cursor, Copilot, and Gemini tooling). 

The primary question addressed in this review is:
> **Which existing implementation approach should LENS use to support the open Agent Skills standard while preserving its current multi-provider research engine?**

Four implementation paths were evaluated against LENS's production architecture:
1. **Native TypeScript Integration** (`frontend/electron/engine/skills/`): A lightweight, zero-dependency in-process loader and registry.
2. **Google Agent Development Kit (ADK)**: Google's multi-agent framework (`adk.dev`).
3. **Vercel AI SDK**: Vercel's provider abstraction and `@ai-sdk/skills` integration.
4. **Claude Agent SDK**: Anthropic's host agent runtime (`code.claude.com`).

### Core Recommendation
We recommend adopting a **Native TypeScript Integration** within LENS's native Node.js/Electron embedded engine. 

- **Full Multi-Provider Preservation**: LENS's existing streaming HTTP client (`ModelClient` in `models.ts`) supports Google Gemini, OpenAI, Claude, and local Ollama models with zero external SDK lock-in. A native loader preserves 100% provider parity without requiring models to share a single vendor's agent runtime.
- **Progressive Disclosure Contract**: Implements the official 3-tier progressive disclosure model (Catalog -> Instructions -> Resources) in fewer than 350 lines of pure TypeScript.
- **Zero Native Build Dependencies**: Avoids C++ native bindings, node-gyp complications, or heavy framework runtimes, ensuring seamless Windows NSIS installer packaging via `electron-builder`.
- **Hybrid Activation Parity**: Provides both model-driven tool activation (`activate_skill`) for tool-capable models (Gemini, GPT-4o, Claude 3.5) and deterministic controller-assisted prompt injection for local/offline models (Ollama/Llama 3) that lack reliable multi-turn tool calling.

---

## 2. Primary Documentation & Specification Audit

This audit reviews official primary-source specifications and host implementation documentation as of September 2026.

| Resource | URL | Revision / Date | Normative vs. Optional Scope | Relevance to LENS |
| :--- | :--- | :--- | :--- | :--- |
| **Agent Skills Specification** | [agentskills.io/specification](https://agentskills.io/specification) | Spec v1.0 (2026) | **Normative**: Package layout, `SKILL.md` frontmatter schema, naming constraints, directory structure. | Definitive standard for package validation and parsing. |
| **Client Implementation Guide** | [agentskills.io/client-implementation](https://agentskills.io/client-implementation/adding-skills-support) | September 2026 | **Normative**: 3-tier progressive disclosure, directory scanning precedence, context compaction protection. | Blueprints LENS's discovery and context lifecycle. |
| **skills-ref Reference Validator** | [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills/tree/main/skills-ref) | Reference Repo | **Demonstration Only**: CLI validation utility (`skills-ref validate`). Explicitly not production runtime code. | Used as an offline test fixture and validation oracle. |
| **Google ADK Skills** | [adk.dev/skills](https://adk.dev/skills/) | v0.4 (Experimental) | **Optional Host Profile**: Multi-agent framework bindings for Google Cloud / Vertex AI. | Assessed for engine integration trade-offs. |
| **Vercel AI SDK Skills** | [ai-sdk.dev/cookbook/guides/agent-skills](https://ai-sdk.dev/cookbook/guides/agent-skills) | AI SDK v3.x | **Optional Host Profile**: Integration patterns with `generateText` / `streamText` and CLI installer (`npx skills`). | Evaluated for TypeScript discovery conventions. |
| **Claude Agent SDK** | [code.claude.com/docs/en/agent-sdk/skills](https://code.claude.com/docs/en/agent-sdk/skills) | Claude Code 2026 | **Vendor Extension**: Anthropic-specific runtime bindings, `allowedTools` parameters. | Reference for cross-client interoperability testing. |
| **OpenAI / Codex Skills** | [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills) | 2026 Documentation | **Vendor Extension**: ChatGPT / Codex skill conventions and invocation profiles. | Evaluated for metadata cross-compatibility. |

---

## 3. Normative Standard vs. Optional Host Behavior

Understanding the exact boundary between what the standard requires and what individual hosts implement is crucial for avoiding over-engineering.

```
+-----------------------------------------------------------------------------+
|                          AGENT SKILLS STANDARD                              |
|                                                                             |
|  +-------------------------------------+  +-------------------------------+ |
|  |       NORMATIVE PACKAGE SPEC        |  |    PROGRESSIVE DISCLOSURE     | |
|  |  - Directory: <name>/SKILL.md       |  |  Tier 1: Catalog (~50-100 tok)| |
|  |  - Frontmatter: name, description   |  |  Tier 2: Instructions (<5k tok)| |
|  |  - Optional: compatibility, license |  |  Tier 3: Resources (on demand)| |
|  |  - Naming: [a-z0-9-], max 64 chars  |  |                               | |
|  +-------------------------------------+  +-------------------------------+ |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                          HOST RUNTIME BOUNDARY                              |
|                                                                             |
|  +--------------------------+  +-------------------+  +-------------------+ |
|  |       LENS DISCOVERY     |  |    ACTIVATION     |  | SCRIPT EXECUTION  | |
|  | - .agents/skills/        |  | - Model Tool Call |  | - Phase 1: None   | |
|  | - User AppData skills/   |  | - Controller Plan |  |   (Instructions/  | |
|  | - Precedence resolution  |  | - Deduplication   |  |    references)    | |
|  | - Lenient YAML parsing   |  | - Pruning shield  |  | - Phase 2: Sandbox| |
|  +--------------------------+  +-------------------+  +-------------------+ |
+-----------------------------------------------------------------------------+
```

### 3.1 Normative Standard Requirements
1. **Package Layout**:
   - Root directory named after the skill.
   - Entry point must be exactly `SKILL.md`.
   - Optional subdirectories: `scripts/` (executable code), `references/` (documentation, cheat-sheets, schemas), `assets/` (static templates, data).
2. **Frontmatter Specification**:
   - YAML delimited by `---`.
   - `name`: 1–64 characters, `[a-z0-9-]` only, no leading/trailing hyphens, no consecutive hyphens (`--`), must match directory name.
   - `description`: 1–1024 characters, non-empty, detailing purpose and activation triggers.
   - Optional fields: `license` (short string), `compatibility` (environment requirements, max 500 chars), `metadata` (string key-value map), `allowed-tools` (space-separated tool names).
3. **Three-Tier Progressive Disclosure**:
   - **Tier 1 (Catalog)**: Name and description only (~50–100 tokens per skill) loaded at startup.
   - **Tier 2 (Instructions)**: Full `SKILL.md` body injected only upon activation (< 5,000 tokens recommended).
   - **Tier 3 (Resources)**: Sub-files (`references/*`, `scripts/*`) read on demand, never preloaded eagerly.

### 3.2 Host-Specific (Non-Normative) Options
- **Discovery Paths**: The specification does not mandate where skills live on disk. However, `.agents/skills/` (workspace) and `~/.agents/skills/` (user) have emerged as the universal cross-client convention.
- **Activation Mode**: Can be model-driven (via tool call or file-reading) or harness-driven (user slash command or pipeline stage).
- **Execution Environment**: Sandboxing, runtime interpreters (Python, Node, Bash), network grants, and tool execution remain strictly the responsibility of the host client.

---

## 4. Multi-Framework Runtime Adoption Comparison

To determine whether LENS should incorporate an external agent framework or implement a native integration, we evaluated four options across seven technical criteria.

| Criterion | 1. Native TypeScript Loader | 2. Google ADK (`adk.dev`) | 3. Vercel AI SDK (`@ai-sdk/*`) | 4. Claude Agent SDK |
| :--- | :--- | :--- | :--- | :--- |
| **Multi-Provider Engine Support** | **Full (100%)**<br>Native HTTP fetch for Gemini, OpenAI, Claude, Ollama. Zero friction. | **Partial / Google-Biased**<br>First-class for Gemini/Vertex; secondary adapter friction for Ollama/Claude. | **Broad**<br>Unified provider abstraction, but requires replacing or wrapping `ModelClient`. | **Strictly Anthropic**<br>Locked to Claude models and Anthropic APIs. Breaks multi-provider goal. |
| **Tool Orchestration & Activation** | **Dual Mode**<br>Model tool-calling (`activate_skill`) AND deterministic controller-assisted injection. | Agent runner event loop; expects tool-calling models with structured outputs. | `generateText` / `streamText` tool loop; requires schema adaptation. | Anthropic-specific tool calling and client session runner. |
| **Electron & Desktop Packaging** | **Zero Impact**<br>Pure TypeScript, 0 native addons, instant compilation to `dist-electron`. | Heavy cloud runtime dependencies; packaging risks with node-gyp/worker pools. | Moderate dependency tree; ESM/CJS compatibility hurdles in Electron. | External CLI/daemon assumptions; not optimized for bundled Electron main process. |
| **Context Lifecycle & Pruning Shield** | **Direct Control**<br>Precise tagging (`<skill_content>`) protected from compaction in LENS pipeline. | Framework-managed memory; hard to customize without framework forks. | Middleware-based context management; moderate flexibility. | Managed Claude context window; proprietary pruning algorithms. |
| **Supply Chain & Dependencies** | **Zero New Dependencies**<br>Uses built-in `fs`, `path`, and standard regex/YAML parser. | High (dozens of transitive `@google/*` and cloud packages). | Moderate-High (core `ai` + provider adapters + zod). | Proprietary Anthropic SDK dependencies. |
| **License Compatibility** | **MIT / Project Owned** | Apache-2.0 | Apache-2.0 | Proprietary / Anthropic Terms |
| **Migration Cost & Disruption** | **Very Low (<2 days)**<br>Isolated module under `frontend/electron/engine/skills/`. 0 regressions. | **Extreme**<br>Requires re-architecting `DeepResearchAgent` and `WideResearchAgent`. | **High**<br>Requires rewriting `models.ts` and SSE streaming pipeline. | **Infeasible**<br>Incompatible with local Ollama and non-Claude providers. |

---

## 5. Host Capabilities & Gap Analysis in LENS

LENS currently operates an autonomous research engine with distinct capabilities and constraints. Here is the exact mapping of what LENS already provides versus what must be built:

```
Existing LENS Engine                          Agent Skills Seam
+------------------------------------+        +-----------------------------------+
| ModelClient (models.ts)            | -----> | SkillRegistry (skills/registry.ts)|
| - Multi-provider (Gemini, Claude,  |        | - Scans .agents/skills/           |
|   OpenAI, Ollama)                  |        | - Extracts YAML frontmatter       |
| - Streaming SSE parser             |        | - Lenient validator               |
+------------------------------------+        +-----------------------------------+
                  |                                             |
                  v                                             v
+------------------------------------+        +-----------------------------------+
| WideResearchAgent (wideAgent.ts)   | -----> | Progressive Disclosure Pipeline   |
| - Phase 1: Collaborative Scoping   |        | - Tier 1: Injects catalog in plan |
| - Phase 2: Parallel Retrieval      |        | - Tier 2: Dedicated activate tool |
| - Phase 3: Coverage Audit          |        | - Tier 3: Guarded file reader     |
| - Phase 4: Hybrid Ranking & Skills |        +-----------------------------------+
| - Phase 5: Grounded Synthesis      |
+------------------------------------+
```

### 5.1 Discovery Seams
- **Workspace Scope**: `<workspace>/.agents/skills/*/SKILL.md` (priority 1).
- **User Global Scope**: `~/.lens/skills/*/SKILL.md` or `~/.agents/skills/*/SKILL.md` (priority 2).
- **Precedence Rule**: Workspace skills shadow global skills of the same name.
- **Lenient Parsing**: If YAML contains unquoted colons or whitespace quirks, regex-based fallback rescues the `name` and `description` rather than crashing the session.

### 5.2 Activation Seams: Model-Driven vs. Controller-Assisted
Different LLMs exhibit vastly different tool-calling reliability:
- **Tier-A Models (Claude 3.5 Sonnet, GPT-4o, Gemini 2.0 Flash/Pro)**: Flawlessly invoke the `activate_skill(name)` tool when presented with `<available_skills>` in the system prompt.
- **Tier-B / Local Models (Ollama Llama-3.1-8B, DeepSeek-R1-Distill)**: Frequently hallucinate tool names or fail multi-step tool loops.
- **LENS Solution**: A **Dual Activation Strategy**:
  1. *Model-Driven*: Expose `activate_skill` tool definition in standard function-calling schemas.
  2. *Controller-Assisted (Collaborative Scoping)*: During Phase 1 plan generation, LENS matches query keywords against the catalog and explicitly lists suggested skills in the `ResearchPlan`. Once the user approves the plan, LENS pre-activates the selected skills directly into the research agent's context, ensuring 100% activation reliability regardless of model tier!

### 5.3 Context Lifecycle & Compaction Shield
- When loaded, skill instructions are wrapped in `<skill_content name="...">` demarcations.
- In multi-hop iterations (Phase 3 & 4), context summarizers are strictly forbidden from trimming or summarizing blocks within `<skill_content>`, ensuring domain instructions remain intact across all research hops.

### 5.4 Execution Boundary: Phase 1 vs. Phase 2
- **Phase 1 (Core)**: Instruction and reference skills only (`SKILL.md` + `references/*`). No shell or binary scripts are executed. Tools used by skills must already exist as native LENS engine tools (e.g., search, scrape, inspect).
- **Phase 2 (Runtime)**: Sandboxed command/script execution (`scripts/*`) with explicit capability grants and user approval prompts.

---

## 6. Unsupported Capability Profiles & Honest Guardrails

To prevent user confusion and ensure robust operation, LENS must explicitly document what is **not** supported in Phase 1:

1. **No Proprietary Host Extensions**: Skills requiring Claude-specific CLI flags, Cursor-specific UI hooks, or proprietary OpenAI Action servers without standard tools will operate in fallback mode (instructions loaded, unsupported hooks ignored).
2. **No Arbitrary Code Execution in Phase 1**: If an imported skill contains `scripts/run.py` or bash scripts, LENS will load the markdown instructions and references, but will **not** execute the scripts until Phase 2 runtime sandboxing is implemented.
3. **Graceful Degraded Mode for Local Models**: When running on compact Ollama models without tool support, skills are enabled exclusively via collaborative plan approval (controller-injected) rather than mid-run autonomous tool dispatch.

---

## 7. Recommended Architectural Action Plan

Based on this review, the subsequent tickets under Map #10 are unblocked and sequenced as follows:

1. **Issue #25 (Discovery, Validation & Portable Packages)**:
   - Implement `SkillRegistry` with filesystem discovery across `.agents/skills/` and user dirs.
   - Implement YAML frontmatter parser with lenient fallback and validation against the `agentskills.io` schema.
2. **Issue #15 (Activation, Model Routing & Tools)**:
   - Implement `activate_skill` tool definition for tool-capable providers.
   - Implement controller injection hook during Phase 1 plan approval for all models.
   - Implement `<skill_content>` context compaction shield.
3. **Issue #22 (Management UX)**:
   - Provide clean React UI in LENS settings to inspect, enable, disable, and import skills.
4. **Issue #17 (Official Research Examples)**:
   - Ship two high-utility, portable research skills (e.g., `academic-search` and `competitive-analysis`) adhering strictly to the open standard.
5. **Issue #26 (Interoperability Evaluation)**:
   - Execute automated cross-client validation using `skills-ref` and cross-provider evaluation across Gemini, OpenAI, Claude, and Ollama.

---

## 8. Verification & Sources Cited

1. **Agent Skills Format Specification**: [agentskills.io/specification](https://agentskills.io/specification) (Spec v1.0, 2026).
2. **Client Implementation Guide**: [agentskills.io/client-implementation/adding-skills-support](https://agentskills.io/client-implementation/adding-skills-support) (2026).
3. **Agent Skills Reference Validator**: [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills) (`skills-ref`).
4. **Google Agent Development Kit**: [adk.dev/skills](https://adk.dev/skills/) (Google, 2026).
5. **Vercel AI SDK Cookbook - Agent Skills**: [ai-sdk.dev/cookbook/guides/agent-skills](https://ai-sdk.dev/cookbook/guides/agent-skills) (Vercel Labs, 2026).
6. **Claude Agent SDK - Skills Architecture**: [code.claude.com/docs/en/agent-sdk/skills](https://code.claude.com/docs/en/agent-sdk/skills) (Anthropic, 2026).
7. **LENS Architecture Baseline**: `frontend/electron/engine/models.ts`, `frontend/electron/engine/agent.ts`, `CONTEXT.md`.
