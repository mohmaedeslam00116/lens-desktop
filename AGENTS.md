# AGENTS.md

Operational guidelines, conventions, and context for AI agents working in this repository.

## Repository Overview

**LENS** is an autonomous desktop research workspace:
- **Product & Brand Authority**: Refer to `PRODUCT.md`, `BRAND.md`, and `DESIGN.md`.
- **Name**: **LENS** in both Arabic and English interfaces. Brand line: **Research, in focus.** Arabic expression: **نظرة أعمق. فهم أوضح.**
- **Desktop Runtime**: Electron 29 (`frontend/electron/`).
- **Frontend**: React 18, Tailwind CSS, Lucide Icons, Vite 5.
- **Embedded Research Engine**: Native Node.js/TypeScript pipeline (`frontend/electron/engine/`) handling search, multi-hop research, live topical discovery feeds (`discover.ts`), and multi-provider LLM synthesis on port 8000.

## Agent skills

### Skill Router
- **Flow Routing**: Consult `/ask-matt` (`.agents/skills/ask-matt/SKILL.md`) to route work along the standard flow: `idea` → `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` (TDD) → `/code-review` → PR.

### Documentation & Domain Skills
- **Writing for Agents (`/writing-for-agents`)**: Use when creating, editing, or auditing agent guidelines, skills, `AGENTS.md`, or architecture documents. Enforce strict information hierarchy, demand-driven completion criteria, and context pointer hygiene.
- **Domain Modeling (`/domain-modeling`)**: Use to continuously evolve `CONTEXT.md` with ubiquitous domain terminology and record significant, hard-to-reverse architectural choices in Architecture Decision Records (`docs/adr/`).
- **Research (`/research`)**: Delegate primary-source investigation and technical literature gathering to background research agents, saving findings as Markdown under `docs/research/`.

### Issue tracker
Issues and specs live as GitHub issues (using the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels
Canonical 5-role triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs
Single-context repository layout (`CONTEXT.md` at root). See `docs/agents/domain.md`.

## Key Directories

- `frontend/src/`: React frontend source (components, views, state).
- `frontend/electron/`: Electron main process, preload script, and native embedded engine (`electron/engine/`).
- `docs/`: Architectural documents, research notes, and agent configuration (`docs/agents/`).
- `dist-installer/`: Generated Windows NSIS setup packages (`LENS Setup 1.0.0.exe`).

## Guidelines

- Use domain terminology defined in `CONTEXT.md`.
- Strictly adhere to `BRAND.md` and `DESIGN.md`: monochrome neutral palette (#111111 / #191919), Inter and Cairo typography, concentric lens mark, no decorative gradients or unsupported "Pro" badge.
- Before committing UI changes, verify via `impeccable detect`.

### External Agent Skills & Tooling Integrity
- **Vendor Tooling Separation**: Files in `.agents/skills/` and agent configuration directories represent external vendor tools and agent skills, NOT project source code.
- **No Manual Modification of External Skills**: Do not manually modify, refactor, or rewrite installed external skills unless explicitly requested by the user.
- **Reviewer Scope Exclusion**: Automated review tools and linters (such as CodeRabbit) must exclude `.agents/**` and `skills-lock.json` from their review paths, ensuring review attention remains focused strictly on application and engine code.

### Continuous Documentation Updates
- **Lockstep Synchronization**: Documentation (`docs/`, `CONTEXT.md`, `README.md`, `PRODUCT.md`, `BRAND.md`, `DESIGN.md`) must be kept in continuous lockstep with codebase evolution.
- **No Orphaned Changes**: Whenever a new feature, architecture seam, or domain concept is introduced or modified, the corresponding documentation must be updated in the same PR. Stale documentation is considered a test failure.
- **Use Specialized Doc Skills**: Leverage `/writing-for-agents` for agent-facing guidelines and `/domain-modeling` for domain glossary terms and ADRs.

### Changelog & SemVer Release Management
- **Periodic Changelog Updates**: Maintain `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) standards. Every PR that introduces user-visible changes, engine enhancements, bug fixes, or architecture adjustments must update `CHANGELOG.md` under the appropriate version section (or `[Unreleased]`).
- **Quantify Changes via SemVer**: Measure and classify all changes according to standard Semantic Versioning (`MAJOR.MINOR.PATCH`):
  - **`MAJOR`**: Breaking public API changes, major engine pipeline overhauls, or breaking runtime contracts.
  - **`MINOR`**: Backwards-compatible feature additions, new retrieval algorithms, API expansions, or new engine capabilities (even if code/engine-only).
  - **`PATCH`**: Backwards-compatible bug fixes, performance optimizations, internal refactoring, or documentation maintenance.
- **Continuous Releases for Every Changelog Version**: A GitHub Release (`gh release create`) must be published for every version bump in `CHANGELOG.md`.
  - **Code-Only Releases**: Releases are required even when changes are **code-only** (e.g. embedded engine, retrieval algorithms, core logic, or backend pipelines) without packaging a full desktop installer (`.exe`). Tag the git commit and publish the release with comprehensive release notes.
  - **Packaged Releases**: When milestone desktop client builds are ready, attach the Windows installer executable (`LENS Setup x.x.x.exe`) to the GitHub Release.

### Pull Request & Review Workflow
- **Pull Request Requirement**: After any specification (`/to-spec`) or issue implementation is completed and verified against the test suite, a Pull Request (PR) must be created (using `gh pr create`) instead of pushing directly to `main`.
- **Review Before Merge**: Every PR must undergo review (Standards Reviewer and Spec Reviewer) and have all tests pass green before it is merged into the project (`main`). Direct merges without PR review are prohibited.
- **CodeRabbit Review Enforcement**: No PR may be merged until CodeRabbit completes its review on GitHub. Agents and maintainers must inspect CodeRabbit's review comments and walkthrough, address or resolve all findings (security, correctness, or performance), and verify that all review threads are resolved before merging into `main`.
