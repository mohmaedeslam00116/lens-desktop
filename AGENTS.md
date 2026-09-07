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

### Pull Request & Review Workflow
- **Pull Request Requirement**: After any specification (`/to-spec`) or issue implementation is completed and verified against the test suite, a Pull Request (PR) must be created (using `gh pr create`) instead of pushing directly to `main`.
- **Review Before Merge**: Every PR must undergo review (Standards Reviewer and Spec Reviewer) and have all tests pass green before it is merged into the project (`main`). Direct merges without PR review are prohibited.
