import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  SkillDiscoveryOptions,
  SkillError,
  SkillPackage,
  SkillScope,
  SkillSummary
} from './types';
import { loadSkillPackage, loadSkillResource } from './loader';

export class SkillRegistry {
  private skills: Map<string, SkillPackage> = new Map();
  private shadowedSkills: Map<SkillScope, Map<string, SkillPackage>> = new Map([
    ['workspace', new Map()],
    ['user', new Map()],
    ['builtin', new Map()]
  ]);
  private diagnostics: Array<{ path: string; error: string }> = [];
  private options: SkillDiscoveryOptions;

  constructor(options: SkillDiscoveryOptions = {}) {
    this.options = options;
  }

  /**
   * Clears the current in-memory registry.
   */
  public clear(): void {
    this.skills.clear();
    for (const scopeMap of this.shadowedSkills.values()) {
      scopeMap.clear();
    }
    this.diagnostics = [];
  }

  /**
   * Discovers and registers all agent skills across 3 tiers with strict precedence:
   * 1. Workspace: workspace/.agents/skills/{skill}/SKILL.md (priority 1)
   * 2. User Global: %APPDATA%/LENS/skills/{skill}/SKILL.md and ~/.agents/skills/ (priority 2)
   * 3. Built-in Bundle: resources/skills/ (priority 3)
   */
  public async discoverAll(): Promise<Map<string, SkillPackage>> {
    this.clear();

    // 1. Scan Workspace Scope (Priority 1)
    const workspaceRoots = this.resolveWorkspaceRoots();
    for (const root of workspaceRoots) {
      await this.scanScopeDirectory(root, 'workspace');
    }

    // 2. Scan User Global Scope (Priority 2)
    const userRoots = this.resolveUserGlobalRoots();
    for (const root of userRoots) {
      await this.scanScopeDirectory(root, 'user');
    }

    // 3. Scan Built-in Bundle Scope (Priority 3)
    const builtinRoots = this.resolveBuiltinRoots();
    for (const root of builtinRoots) {
      await this.scanScopeDirectory(root, 'builtin');
    }

    return this.skills;
  }

  /**
   * Retrieves an active skill package by its unique lowercase name.
   */
  public getSkill(name: string): SkillPackage | undefined {
    return this.skills.get(name.toLowerCase());
  }

  /**
   * Checks if a skill is registered.
   */
  public hasSkill(name: string): boolean {
    return this.skills.has(name.toLowerCase());
  }

  /**
   * Returns all active skill packages ordered by name.
   */
  public listSkills(): SkillPackage[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns Tier 1 lightweight skill summaries (~50-100 tokens each)
   * suitable for model catalog disclosure at session start.
   */
  public listSummaries(): SkillSummary[] {
    return this.listSkills().map(pkg => ({
      name: pkg.name,
      description: pkg.frontmatter.description,
      scope: pkg.scope,
      rootPath: pkg.rootPath,
      allowedTools: pkg.frontmatter.allowedTools,
      disableModelInvocation: pkg.frontmatter.disableModelInvocation
    }));
  }

  /**
   * Safely loads an auxiliary resource belonging to a skill package.
   * Throws 'SECURITY_ACCESS_DENIED' on directory traversal or escape attempts.
   */
  public async loadResource(skillName: string, relativePath: string): Promise<string> {
    const pkg = this.getSkill(skillName);
    if (!pkg) {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        `Skill not found in registry: "${skillName}"`
      );
    }
    return loadSkillResource(pkg, relativePath);
  }

  /**
   * Manually registers a dynamic skill package (e.g. for testing or memory-injected skills).
   */
  public registerDynamic(pkg: SkillPackage): void {
    const normalizedName = pkg.name.toLowerCase();
    this.skills.set(normalizedName, pkg);
  }

  /**
   * Returns diagnostics recorded during discovery (skipped invalid packages).
   */
  public getDiagnostics(): Array<{ path: string; error: string }> {
    return [...this.diagnostics];
  }

  /**
   * Scans a target directory for subdirectories containing SKILL.md.
   */
  private async scanScopeDirectory(targetDir: string, scope: SkillScope): Promise<void> {
    if (!fs.existsSync(targetDir)) {
      return;
    }

    try {
      const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillFolder = path.join(targetDir, entry.name);

        try {
          const pkg = await loadSkillPackage(skillFolder, scope);
          const normalizedName = pkg.name.toLowerCase();

          if (this.skills.has(normalizedName)) {
            // Already registered by a higher-priority scope! Record as shadowed.
            const existing = this.skills.get(normalizedName)!;
            this.shadowedSkills.get(scope)?.set(normalizedName, pkg);
            // Log diagnostic info
            this.diagnostics.push({
              path: skillFolder,
              error: `Shadowed by higher-priority ${existing.scope} scope package`
            });
          } else {
            this.skills.set(normalizedName, pkg);
          }
        } catch (err: any) {
          // If directory simply lacks SKILL.md, skip silently without logging error
          if (err instanceof SkillError && err.code === 'MISSING_FRONTMATTER') {
            continue;
          }
          this.diagnostics.push({
            path: skillFolder,
            error: err.message || String(err)
          });
        }
      }
    } catch (err: any) {
      this.diagnostics.push({
        path: targetDir,
        error: `Failed to read scope directory: ${err.message}`
      });
    }
  }

  private resolveWorkspaceRoots(): string[] {
    const ws = this.options.workspaceDir || process.cwd();
    const roots = [path.join(ws, '.agents', 'skills')];
    if (this.options.scanAliases !== false) {
      roots.push(path.join(ws, '.lens', 'skills'));
    }
    return roots;
  }

  private resolveUserGlobalRoots(): string[] {
    const roots: string[] = [];

    if (this.options.userGlobalDirs && Array.isArray(this.options.userGlobalDirs)) {
      roots.push(...this.options.userGlobalDirs);
    } else if (this.options.userGlobalDir) {
      roots.push(this.options.userGlobalDir);
    } else {
      const appData = process.env.APPDATA;
      if (appData) {
        roots.push(path.join(appData, 'LENS', 'skills'));
      }

      const homeDir = os.homedir();
      if (homeDir) {
        roots.push(path.join(homeDir, '.agents', 'skills'));
        roots.push(path.join(homeDir, '.lens', 'skills'));
      }
    }

    return roots;
  }

  private resolveBuiltinRoots(): string[] {
    if (this.options.builtinDir) {
      return [this.options.builtinDir];
    }

    const candidates: string[] = [];

    // Electron process.resourcesPath has top priority for packaged distribution
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, 'skills'));
    }

    // Development fallbacks
    candidates.push(
      path.resolve(__dirname, '..', '..', 'resources', 'skills'),
      path.resolve(__dirname, '..', '..', 'skills'),
      path.resolve(__dirname, 'builtin'),
      path.resolve(process.cwd(), 'skills')
    );

    return candidates.filter(p => fs.existsSync(p));
  }
}
