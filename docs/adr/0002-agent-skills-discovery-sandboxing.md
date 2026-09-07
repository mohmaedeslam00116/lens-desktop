# 2. Agent Skills Discovery Hierarchy & Filesystem Sandbox Boundary

## Context
LENS supports native Agent Skills (`SKILL.md`) enabling specialized retrieval, filtering, and analysis capabilities across deep and wide research tasks. Because skills may be contributed by users, bundled in the application, or located within opened workspace projects, the runtime must:
1. Guarantee deterministic discovery and precedence resolution when identical skill names exist across multiple scopes.
2. Prevent malicious or malformed skills from accessing or exfiltrating arbitrary filesystem paths outside their designated skill root folder.
3. Tolerate real-world markdown and YAML syntax variations (such as unquoted colons in descriptions) without aborting workspace indexing.

## Decision
1. **Three-Tier Scope Precedence**:
   Skills are resolved across three strictly ordered tiers:
   - **Workspace Scope (`priority 1`)**: `<workspace>/.agents/skills/{skill}/SKILL.md` (and alias `.lens/skills/`).
   - **User Global Scope (`priority 2`)**: `%APPDATA%/LENS/skills/{skill}/SKILL.md` and `~/.agents/skills/`.
   - **Built-in Bundle (`priority 3`)**: `<resources>/skills/` or bundled system skills.
   
   A skill discovered in a higher-priority tier deterministically shadows any skill with the same normalized name in lower-priority tiers. Shadowed skills are tracked and exposed via telemetry diagnostics rather than throwing collision errors.

2. **Filesystem Path Sandboxing (`SkillPathBoundary`)**:
   - Every skill operates within a strictly contained directory root (`rootDir = path.resolve(folderPath)`).
   - Any access outside this root—via relative escapes (`../../`), absolute path overrides, null-byte injection (`\0`), or out-of-boundary symlinks—is strictly blocked, throwing `SECURITY_ACCESS_DENIED`.
   - The boundary helper methods (`resolveSafePath`, `readResource`, `listFiles`, `existsSync`) guarantee that secondary resources (e.g. scripts, templates, schemas) cannot breach the skill container.

3. **Fault-Tolerant Lenient YAML Frontmatter Parsing**:
   - Top-level YAML frontmatter delimiter (`---`) is parsed with automatic line-by-line recovery.
   - Values with unquoted colons (e.g. `description: Query PubMed: Biomedical literature`) are reconstructed rather than failing with standard YAML syntax errors.
   - Frontmatter validation enforces lowercase alphanumeric naming (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) and bounded description length ($\le 1024$ characters).

## Consequences
- Workspace project authors can override built-in or user skills locally by matching the skill name in `<workspace>/.agents/skills/`.
- Malicious skills cannot traverse the local filesystem or escape the application sandbox.
- Skill catalog indexing is fault-tolerant: a single malformed or unauthorized skill does not crash or invalidate the rest of the discovered catalog.
