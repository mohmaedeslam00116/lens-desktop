# Architectural Research Report: Cline TypeScript Agent Core Decoupling & Host Adaptation

**Target Ticket**: [#54 Cline TypeScript Agent Core: Decoupling & Host Adaptation](https://github.com/mohmaedeslam00116/lens-desktop/issues/54)  
**Parent Map**: [#53 [Map] LENS 2.0.0 — Autonomous Developer Research & Coding Agent Harness](https://github.com/mohmaedeslam00116/lens-desktop/issues/53)  
**Status**: Resolved / Recommended Architecture Specification  
**Author**: LENS Architecture & Research Team  

---

## 1. Executive Summary

This research report specifies the technical blueprint for decoupling and adapting the open-source headless TypeScript agent core from **Cline** (`cline/cline`) and **Roo-Code** (`RooVetGit/Roo-Code`) into **LENS 2.0.0**'s embedded Node.js/Electron engine (`frontend/electron/engine/agent/`).

The adaptation strictly satisfies the security mandate set forth in the Map (#53) and CodeRabbit's Phase 1 Exit Gate:
1. **Dependency-Free Headless Runtime**: Zero direct imports of `vscode`, `electron`, `child_process`, or raw `fs` in the agent core.
2. **Hexagonal Ports & Adapters**: All external capabilities (repository inspection, research retrieval, telemetry streaming, policy validation) are mediated through typed ports.
3. **Privileged Policy Layer**: Every tool invocation is validated against session credentials, capability grants, and canonical path boundaries before execution.
4. **Phase 1 Read-Only Containment**: Prohibits file modifications, shell execution, and MCP execution in Phase 1, confining the core strictly to read-only codebase exploration and immutable research synthesis.

---

## 2. Upstream Cline & Roo-Code Architecture Analysis

### 2.1 Package Decomposition
Cline's architecture separates concerns into a layered SDK-first hierarchy:
- **`@cline/core` (`Cline.ts`, `Task.ts`)**: The central orchestrator managing conversation history, the ReAct loop, context window budgeting, and tool dispatching.
- **`@cline/agents`**: Browser/headless-compatible `AgentRuntime` implementing recursive model reasoning and tool-response observation cycles.
- **`@cline/llms`**: Multi-provider client handlers (Anthropic, OpenAI, OpenRouter, Ollama, Gemini) formatting system prompts, streaming token deltas, and serializing provider-specific tool schemas.
- **`@cline/shared`**: Shared message types, tool definitions, and serialization schemas.

### 2.2 Roo-Code Granular Mode System
Roo-Code extends Cline with a **Mode System** that enforces strict role-based tool scoping:
- **Architect / Research Mode**: Permitted tools are restricted to read-only operations (`read_file`, `list_files`, `web_search`).
- **Code Mode**: Permits mutating tools (`write_to_file`, `apply_diff`) only upon active user authorization.
- **Sticky Models**: Associates specialized models with modes (e.g. Claude 3.5 Sonnet / DeepSeek-V3 for architecture; fast local models for routine inspection).

### 2.3 Extension-Host Coupling & Decoupling Seams
In upstream VS Code extensions, the core is coupled to the host via:
1. `vscode.workspace.workspaceFolders`: Root path discovery and relative path normalization.
2. `vscode.window.showInformationMessage` / Webview Messaging: User approval prompts for tool execution.
3. `vscode.env.clipboard`: Clipboard reading/writing.
4. `vscode.workspace.fs`: File system reads and writes.

**The Decoupling Strategy for LENS**:
We eliminate the VS Code extension host entirely by replacing these couplings with native TypeScript interfaces (Ports) injected into `AgentRuntime` at instantiation time.

---

## 3. LENS 2.0.0 `AgentRuntime` Hexagonal Port Architecture

```
                    ┌─────────────────────────────────────────┐
                    │          Model Providers                │
                    │   (Anthropic / OpenAI / Gemini / Ollama)│
                    └────────────────────┬────────────────────┘
                                         │ StreamChunks / ToolCalls
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LENS 2.0.0 Headless AgentRuntime                         │
│                                                                             │
│  ┌───────────────────────┐   ┌───────────────────┐   ┌───────────────────┐  │
│  │    TaskController     │──▶│ ContextCompactor  │──▶│ ToolCallValidator │  │
│  │   (ReAct Loop v1)     │   │ (Shielded Excerpts│   │ (JSON Schema v1)  │  │
│  └───────────┬───────────┘   └───────────────────┘   └───────────────────┘  │
└──────────────┼─────────────────────────┼─────────────────────────┼──────────┘
               │                         │                         │
               ▼                         ▼                         ▼
      ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
      │RepoInspectionPort│      │ResearchRetrieval│       │  TelemetryPort  │
      │   (Read-Only)   │       │   (Untrusted)   │       │(EventRingBuffer)│
      └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
               │                         │                         │
               ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Privileged Policy Layer                               │
│  - Session Identity & Auth Token Check                                      │
│  - Canonical Workspace Path Boundary Check (No Symlink / Junction Escape)   │
│  - Active Capability Grant Verification                                     │
│  - Immutable Audit Trail Logger                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Port Specifications

#### 1. `RepoInspectionPort` (Read-Only)
```typescript
export interface RepoInspectionPort {
  listFiles(relativeDir: string, signal?: AbortSignal): Promise<FileInfo[]>;
  readFile(relativePath: string, signal?: AbortSignal): Promise<string>;
  searchFiles(query: string, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResult[]>;
  getRepoSnapshotHash(): Promise<string>;
}
```
- **Policy Enforcement**: Calls `SkillPathBoundary.resolveSafePath(workspaceRoot, relativePath)`. Rejects any path with null bytes, `../` traversal, drive-letter escapes, or external symlink dereferences by throwing `SECURITY_ACCESS_DENIED`.
- **Exclusion Filters**: Automatically respects `.gitignore`, `node_modules/`, `.git/`, binary files, and files exceeding 2 MB.

#### 2. `ResearchRetrievalPort` (Immutable Evidence Handoff)
```typescript
export interface ResearchRetrievalPort {
  queryResearch(topic: string, budget: number, signal?: AbortSignal): Promise<EvidenceBundle>;
  getCitationExcerpt(bundleId: string, citationIndex: number): Promise<VerifiedExcerpt>;
}
```
- **Untrusted Flag**: All ingested research content has `contentIsUntrusted: true`.
- **No Escalation**: The policy engine explicitly enforces that no text or directive extracted from an `EvidenceBundle` can create, expand, or bypass a capability grant.

#### 3. `TelemetryPort` (Event Streaming)
```typescript
export interface TelemetryPort {
  emitEvent(event: AgentLifecycleEvent): void;
  emitTokenDelta(delta: string): void;
}
```
- Bridges directly into LENS's existing `EventRingBuffer` and WebSocket broadcast system, enabling live UI updates and reconnect recovery without UI blocking.

#### 4. `CancellationPort`
```typescript
export interface CancellationPort {
  signal: AbortSignal;
  abort(reason: string): void;
}
```
- Propagates caller cancellation instantaneously down to active LLM HTTP streams, file read streams, and background indexing tasks.

---

## 4. Phase 1 Exit Gate Compliance Checklist

| Exit Gate Requirement | Architecture Solution |
| :--- | :--- |
| **1. Untrusted evidence cannot expand grants** | Policy layer acts as a firewall between `EvidenceBundle` text and the capability authorization engine. |
| **2. Loopback endpoints require authentication** | `server.ts` requires a per-launch high-entropy token (`X-LENS-Session-Token`) on all non-static requests. |
| **3. Renderer restricted from undeclared IPC** | Electron `contextIsolation: true`, `nodeIntegration: false`, and strictly typed IPC channels. |
| **4. Repo reads strictly contained in workspace** | Canonical path normalization and symlink target containment via `SkillPathBoundary`. |
| **5. Context compaction preserves authoritative state** | Policies, grants, file hashes, and audit records are excluded from compaction passes via `CompactionShield`. |
| **6. Cancellation leaves recoverable state** | Cooperative `AbortSignal` with snapshot preservation in `ResearchSession` and `CodingSession`. |
| **7. Dependency-free runtime testable in isolation** | Complete unit test suite using mock ports with 0 Electron / VS Code dependencies. |

---

## 5. Licensing, Attribution & Upstream Policy

1. **Licensing**:
   - Cline is licensed under the **Apache License 2.0**.
   - Roo-Code is licensed under the **Apache License 2.0**.
   - LENS adopts architectural patterns, schemas, and decoupled concepts while authoring native, clean-room TypeScript interfaces adhering to LENS's security standards.
2. **Attribution**:
   - An explicit notice acknowledging Cline and Roo-Code is preserved in `NOTICES.md` and relevant engine headers.
3. **Security Patch Ownership**:
   - Because LENS isolates the core behind typed ports and a privileged policy layer, upstream vulnerabilities related to VS Code webviews or unsanitized shell executions cannot compromise LENS.
   - Periodic upstream audits will monitor `@cline/core` release tags for algorithmic improvements to token budgeting and prompt optimization.

---

## 6. Resolution & Next Steps

Ticket [#54](https://github.com/mohmaedeslam00116/lens-desktop/issues/54) is resolved with the specification of this architecture.

**Frontier Progression**:
- Unblocks Ticket [#55 Dual-Loop Orchestration: Seamless Research-to-Code Pipeline](https://github.com/mohmaedeslam00116/lens-desktop/issues/55).
- Unblocks Ticket [#57 Terminal Execution, Shell Sandboxing & Security Capability Grants](https://github.com/mohmaedeslam00116/lens-desktop/issues/57).
- Directly guides implementation planning for Phase 1 code delivery (`frontend/electron/engine/agent/`).
