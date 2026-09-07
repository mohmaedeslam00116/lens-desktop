# AGENTS.md

Operational guidelines, conventions, and context for AI agents working in this repository.

## Repository Overview

**KASHIF Pro | كاشف** is an autonomous desktop deep research assistant built with:
- **Desktop Runtime**: Electron 29 (TypeScript backend embedded in `frontend/electron/`).
- **Frontend**: React 18, Tailwind CSS, Lucide Icons, Vite 5.
- **Embedded Research Engine**: Native Node.js/TypeScript pipeline (`frontend/electron/engine/`) handling search, multi-hop research, live topical discovery feeds (`discover.ts`), and multi-provider LLM synthesis.

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
- `dist-installer/`: Generated Windows NSIS setup packages.

## Guidelines

- Use domain terminology defined in `CONTEXT.md`.
- Maintain clean, minimal, borderless UI following `/impeccable` design principles.
- Before committing UI changes, verify via `impeccable detect`.
