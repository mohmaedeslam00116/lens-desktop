# 6. Agent Skills Management UX, Non-Destructive Collision Resolver & Launch Skills

## Context
1. In the LENS Wide Research and Open Agent Skills architecture, users and research organizations need a seamless, intuitive interface to discover, import, inspect, configure, and export specialized agent skill packages.
2. Skill packages can originate from multiple untrusted sources: downloaded community ZIP archives, corporate git repositories, or shared network folders. Blindly installing skills without inspection presents serious operational and security risks (such as unexpected executable scripts or duplicate naming collisions).
3. Overwriting existing skill packages silently can corrupt active research sessions, destroy local customizations, or cause irreversible data loss.
4. Exporting skills for external sharing must produce byte-for-byte portable standard PKZIP archives without leaking proprietary environment variables, credentials, or internal LENS application state.
5. Users require immediate out-of-the-box analytical capability for rigorous academic literature analysis and competitive corporate strategy without needing to write custom skills from scratch.

## Decision
1. **Dedicated Skills Manager View (`SkillsManagerView`)**:
   - Implemented in `frontend/src/components/skills/SkillsManagerView.tsx` and integrated into the primary application navigation rail (`Sidebar.tsx`) with full bilingual Arabic RTL and English LTR parity.
   - Features a Drag-and-Drop import zone accepting `.zip` archives or skill folders, paired with an explicit `[Import Skill]` file picker.
   - Telemetry overview tracking Total Installed, Enabled, Active in Current Session, and Incompatible skills.
   - 4-way scope filter (`All Scopes`, `Workspace`, `Global User`, `Built-in`) and real-time substring search.
   - 1-click enable/disable toggle dynamically updating the Tier 1 catalog enumeration disclosed to the LLM.

2. **In-Memory Pre-Inspection Modal**:
   - Inspects incoming skill archives entirely in-memory prior to touching local disk.
   - Extracts and renders YAML frontmatter: `name`, `description`, `license`, `compatibility`, `author`, and `allowed-tools`.
   - Scans for executable scripts (`.py`, `.sh`, `.js`, `.ts`, `.bat`, `.cmd`, `.exe`, `.ps1`), displaying an explicit security warning callout if scripts are present.
   - Offers a destination scope selector allowing the user to choose between Workspace (`.agents/skills/`) and Global User (`APPDATA/LENS/skills`).

3. **Non-Destructive Skill Collision Resolver (`SkillCollisionResolver`)**:
   - Implemented in `frontend/electron/engine/skills/collisionResolver.ts`.
   - When importing a skill whose name matches an existing installation, presents three deterministic choices:
     1. **`Keep Existing`**: Aborts the import, guaranteeing the existing package remains untouched.
     2. **`Overwrite with Backup`**: Safely moves the existing folder to a timestamped backup directory (`<name>.backup_<ISO_TIMESTAMP>`) before writing new files.
     3. **`Rename on Import`**: Rewrites the frontmatter `name:` field with a validated new identifier and installs into a distinct new directory.
   - Active running sessions maintain immutable loaded snapshots in memory, fully isolated from concurrent disk modifications.

4. **Zero-Dependency Portable PKZIP Archiver (`zipArchive.ts`)**:
   - Implemented in `frontend/electron/engine/skills/zipArchive.ts` using Node's standard `node:zlib` with standard PKZIP local headers, central directory records, and standard CRC-32 calculation.
   - Strictly enforces Zip-Slip defense against directory traversal attacks (`../../`).
   - Automatically excludes system files (`.DS_Store`, `Thumbs.db`), version control (`.git/`), and sensitive configuration (`.env`, `*.secret*`).
   - Powers 1-click `[Export .zip]` button producing pristine portable archives.

5. **Two Official Bundled Launch Skills (`skills/`)**:
   - **`academic-paper-analysis`**: Literature extraction with `methodology-audit.md` (peer review, baseline compute parity, dataset hygiene) and `ablation-checklist.md` (component isolation, delta metrics).
   - **`competitive-market-intelligence`**: Commercial landscape analysis with `feature-matrix-template.md` (cross-vendor capability comparison) and `swot-framework.md` (evidence-grounded SWOT requiring citations for every assertion).

## Consequences
- Researchers have complete visibility and control over their skill ecosystem with zero risk of silent overwrites.
- Community and custom skills can be shared and imported with 1-click ease through standard `.zip` files.
- Operates in 100% pure TypeScript and Node.js without requiring external C++ native build dependencies.
- Strictly complies with `BRAND.md` and `DESIGN.md` monochrome aesthetic guidelines.
