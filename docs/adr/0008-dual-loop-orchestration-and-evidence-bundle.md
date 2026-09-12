# 8. Dual-Loop Orchestration, Immutable EvidenceBundle & Workspace Fingerprinting for LENS 2.0.0

## Context
Transforming LENS into an autonomous developer research and coding harness creates a critical security and context-management boundary:
1. Pumping raw, open-ended web research (web pages, GitHub READMEs, issues, RFCs) directly into coding prompts risks context window blowout ("lost-in-the-middle" degradation) and exposes the coding loop to indirect prompt-injection attacks.
2. If the user edits workspace files externally while the agent is formulating a code plan, blindly writing diffs risks silent merge conflicts and code corruption.
3. Overloading the existing `ResearchSession` with coding state creates an entangled, unmaintainable state machine.

## Decision
We establish a four-part dual-loop orchestration contract:

1. **Stratified On-Demand Claims via `EvidenceBundle`**:
   - The research loop synthesizes an immutable, versioned `EvidenceBundle` containing verified claims, SHA-256 content hashes, excerpt character offsets, and source citations, flagged with `contentIsUntrusted: true`.
   - The coding agent receives only an initial architectural claim index (~1,000 tokens). Detailed excerpts and API signatures are queried on-demand via `get_evidence_detail(claimId)` strictly for the active coding milestone.
   - The policy engine enforces that no text within an `EvidenceBundle` can create or expand capability grants.

2. **Pre-Execution Workspace Fingerprinting (`RepoSnapshotHash`)**:
   - When generating a code plan, LENS records `repoSnapshotHash` (combining git HEAD commit and SHA-256 hashes of tracked uncommitted files).
   - Before proposing diffs or executing tests, the engine re-checks the fingerprint. If files were modified externally, it halts and prompts for re-verification to prevent stale-plan collisions.

3. **Composite Workspace Session Model**:
   - We separate `ResearchSession` from `CodingSession`.
   - A `ProjectSession` binds an overarching engineering effort under `<workspace>/.lens/sessions/` to a versioned `ResearchSession` and multiple branching `CodingSession` tasks, allowing research evidence to be reused across multiple code modifications.

4. **Hybrid Lexical BM25 + Ripgrep Indexing**:
   - For repository inspection, LENS adapts its pure TypeScript Okapi BM25 indexer for workspace symbol and file retrieval on folder open, backed by instant Ripgrep regex search, avoiding heavy C++ bindings and expensive upfront embeddings.

## Consequences
- The coding agent context remains lean, clean, and shielded from prompt-injection vectors.
- Code modifications are protected from external workspace drift through fingerprint verification.
- Research sessions can be reused across multiple coding tasks without repeated web scraping.
- Repository indexing is instant, memory-efficient, and cross-platform without native C++ compilation dependencies.
