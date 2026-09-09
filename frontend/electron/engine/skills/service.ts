/**
 * LENS Agent Skills Management Service
 * Tracer 9 (Issue #36): Orchestrates skills inspection, non-destructive import,
 * pristine ZIP export, 5-state lifecycle management, and enable/disable toggling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillRegistry } from './registry';
import { SkillPackage, SkillScope, SkillFrontmatter } from './types';
import { parseSkillFrontmatter } from './parser';
import { createZipArchive, readZipArchive, ZipArchiveFile } from './zipArchive';
import { SkillCollisionResolver, CollisionAction } from './collisionResolver';

export type SkillLifecycleState = 'installed' | 'enabled' | 'selected' | 'active' | 'incompatible';

export interface DetailedSkillItem {
  name: string;
  scope: SkillScope;
  rootPath: string;
  skillFilePath: string;
  frontmatter: SkillFrontmatter;
  states: SkillLifecycleState[];
  isEnabled: boolean;
  isSelected?: boolean;
  isActive?: boolean;
  isIncompatible?: boolean;
  hasScripts: boolean;
  scriptFiles: string[];
  referenceFiles: string[];
  incompatibilityReason?: string;
}

export interface SkillPreInspectionResult {
  valid: boolean;
  name: string;
  description: string;
  author?: string;
  license?: string;
  compatibility?: string;
  allowedTools: string[];
  hasScripts: boolean;
  scriptFiles: string[];
  totalFiles: number;
  hasCollision: boolean;
  collidingScope?: SkillScope;
  error?: string;
}

export interface SkillImportOptions {
  scope: 'workspace' | 'user';
  collisionAction: CollisionAction;
  renameTo?: string;
  workspaceDir?: string;
  userGlobalDir?: string;
}

export class SkillManagerService {
  private registry: SkillRegistry;
  private workspaceDir: string;
  private userGlobalDir?: string;
  private disabledSkills: Set<string> = new Set();
  private activeSessionSkills: Set<string> = new Set();
  private selectedPlanSkills: Set<string> = new Set();
  private sessionSnapshots: Map<string, SkillPackage> = new Map();

  constructor(registry: SkillRegistry, workspaceDir: string = process.cwd(), userGlobalDir?: string) {
    this.registry = registry;
    this.workspaceDir = workspaceDir;
    this.userGlobalDir = userGlobalDir;
  }

  /**
   * Preserves an in-memory snapshot of an active skill package for running research sessions,
   * isolating active execution from concurrent on-disk imports, renames, or overwrites.
   */
  public snapshotActiveSkill(pkg: SkillPackage): void {
    const norm = pkg.name.toLowerCase();
    this.sessionSnapshots.set(norm, {
      ...pkg,
      resourceSnapshot: new Map(pkg.resourceSnapshot || [])
    });
  }

  /**
   * Retrieves an in-memory session snapshot if one exists.
   */
  public getSessionSnapshot(name: string): SkillPackage | undefined {
    return this.sessionSnapshots.get(name.toLowerCase());
  }

  /**
   * Sets currently selected plan skills and currently active execution skills.
   */
  public updateContextualStates(selectedSkills: string[] = [], activeSkills: string[] = []): void {
    this.selectedPlanSkills = new Set(selectedSkills.map((s) => s.toLowerCase()));
    this.activeSessionSkills = new Set(activeSkills.map((s) => s.toLowerCase()));
  }

  /**
   * Returns all discovered skills with 5-state lifecycle analysis and file telemetry.
   */
  public async listSkillsDetailed(): Promise<DetailedSkillItem[]> {
    const packages = this.registry.listSkills();
    const items: DetailedSkillItem[] = [];

    for (const pkg of packages) {
      const normName = pkg.name.toLowerCase();
      const isEnabled = !this.disabledSkills.has(normName);
      const isSelected = this.selectedPlanSkills.has(normName);
      const isActive = this.activeSessionSkills.has(normName);

      // Scan root folder for scripts and references
      const { scriptFiles, referenceFiles } = await this.scanFolderFiles(pkg.rootPath);
      const hasScripts = scriptFiles.length > 0;

      // Incompatibility checks (e.g. tools or format)
      let isIncompatible = false;
      let incompatibilityReason: string | undefined;

      if (!pkg.frontmatter.name || !pkg.frontmatter.description) {
        isIncompatible = true;
        incompatibilityReason = 'Missing mandatory frontmatter fields';
      }

      const states: SkillLifecycleState[] = ['installed'];
      if (isEnabled && !isIncompatible) states.push('enabled');
      if (isSelected) states.push('selected');
      if (isActive) states.push('active');
      if (isIncompatible) states.push('incompatible');

      items.push({
        name: pkg.name,
        scope: pkg.scope,
        rootPath: pkg.rootPath,
        skillFilePath: pkg.skillFilePath,
        frontmatter: pkg.frontmatter,
        states,
        isEnabled,
        isSelected,
        isActive,
        isIncompatible,
        hasScripts,
        scriptFiles,
        referenceFiles,
        incompatibilityReason
      });
    }

    return items;
  }

  /**
   * 1-Click enable/disable toggle dynamically updating the Tier 1 catalog.
   */
  public toggleSkillEnabled(name: string, enabled?: boolean): boolean {
    const norm = name.trim().toLowerCase();
    if (!this.registry.hasSkill(norm)) {
      throw new Error(`SKILL_NOT_FOUND: Skill "${name}" is not registered`);
    }

    const currentEnabled = this.registry.isSkillEnabled(norm);
    const newEnabled = enabled !== undefined ? enabled : !currentEnabled;

    if (newEnabled) {
      this.disabledSkills.delete(norm);
    } else {
      this.disabledSkills.add(norm);
    }

    this.registry.setSkillEnabled(norm, newEnabled);
    return newEnabled;
  }

  /**
   * Pre-inspects a skill package in-memory from a ZIP buffer or file entries without touching disk.
   */
  public inspectPackage(
    payload: Buffer | Array<{ path: string; content: Buffer | string }>,
    targetScope: 'workspace' | 'user' = 'workspace',
    customScopeDir?: string
  ): SkillPreInspectionResult {
    let files: Array<{ path: string; content: Buffer }>;

    if (Buffer.isBuffer(payload)) {
      try {
        const extracted = readZipArchive(payload);
        files = extracted.map((e) => ({ path: e.relativePath, content: e.content }));
      } catch (err: any) {
        return {
          valid: false,
          name: '',
          description: '',
          allowedTools: [],
          hasScripts: false,
          scriptFiles: [],
          totalFiles: 0,
          hasCollision: false,
          error: `Failed to decompress archive: ${err.message}`
        };
      }
    } else {
      files = payload.map((f) => ({
        path: f.path.replace(/\\/g, '/').replace(/^\/+/, ''),
        content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8')
      }));
    }

    // Locate SKILL.md (exact or nested e.g. skill-folder/SKILL.md)
    const skillFileEntry = files.find((f) => {
      const lower = f.path.toLowerCase();
      return lower === 'skill.md' || lower.endsWith('/skill.md');
    });

    if (!skillFileEntry) {
      return {
        valid: false,
        name: '',
        description: '',
        allowedTools: [],
        hasScripts: false,
        scriptFiles: [],
        totalFiles: files.length,
        hasCollision: false,
        error: 'MISSING_FRONTMATTER: Package contains no SKILL.md file'
      };
    }

    try {
      const rawBody = skillFileEntry.content.toString('utf8');
      const parsed = parseSkillFrontmatter(rawBody);

      // Detect executable scripts
      const scriptExtensions = ['.py', '.sh', '.bash', '.js', '.mjs', '.ts', '.exe', '.bat', '.cmd', '.ps1'];
      const scriptFiles = files
        .map((f) => f.path)
        .filter((p) => {
          const ext = path.posix.extname(p).toLowerCase();
          return scriptExtensions.includes(ext);
        });

      // Check collision against target scope directory on disk
      const normName = parsed.frontmatter.name.toLowerCase();
      let targetScopeDir: string;
      if (customScopeDir) {
        targetScopeDir = customScopeDir;
      } else if (targetScope === 'workspace') {
        targetScopeDir = path.join(this.workspaceDir, '.agents', 'skills');
      } else {
        targetScopeDir =
          this.userGlobalDir ||
          (process.env.APPDATA
            ? path.join(process.env.APPDATA, 'LENS', 'skills')
            : path.join(os.homedir(), '.agents', 'skills'));
      }

      const diskCollision = SkillCollisionResolver.checkCollision(targetScopeDir, normName);
      const existingInRegistry = this.registry.getSkill(normName);
      const hasCollision = diskCollision || (existingInRegistry !== undefined && existingInRegistry.scope === targetScope);
      const collidingScope = hasCollision ? (existingInRegistry?.scope || targetScope) : undefined;

      return {
        valid: true,
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        author: parsed.frontmatter.metadata?.author || undefined,
        license: parsed.frontmatter.license,
        compatibility: parsed.frontmatter.compatibility,
        allowedTools: parsed.frontmatter.allowedTools || [],
        hasScripts: scriptFiles.length > 0,
        scriptFiles,
        totalFiles: files.length,
        hasCollision,
        collidingScope
      };
    } catch (err: any) {
      return {
        valid: false,
        name: '',
        description: '',
        allowedTools: [],
        hasScripts: false,
        scriptFiles: [],
        totalFiles: files.length,
        hasCollision: false,
        error: err.message || String(err)
      };
    }
  }

  /**
   * Imports a skill package to disk with non-destructive collision resolution.
   */
  public async importSkill(
    payload: Buffer | Array<{ path: string; content: Buffer | string }>,
    options: SkillImportOptions
  ): Promise<{ success: boolean; skillName: string; destinationDir: string; backupDir?: string }> {
    // 1. Pre-inspect in memory
    const inspection = this.inspectPackage(payload, options.scope);
    if (!inspection.valid) {
      throw new Error(`CANNOT_IMPORT_INVALID_SKILL: ${inspection.error}`);
    }
    if (inspection.hasScripts) {
      throw new Error(
        `CANNOT_IMPORT_UNSANDBOXED_SCRIPTS: Package contains executable files: ${inspection.scriptFiles.join(', ')}`
      );
    }

    // Determine target root scope directory
    const baseWorkspace = options.workspaceDir || process.cwd();
    const scopeDir = options.scope === 'workspace'
      ? (baseWorkspace.includes('.agents') ? baseWorkspace : path.join(baseWorkspace, '.agents', 'skills'))
      : (options.userGlobalDir || path.join(process.env.APPDATA || process.cwd(), 'LENS', 'skills'));

    await fs.promises.mkdir(scopeDir, { recursive: true });

    // 2. Resolve collisions
    let files: Array<{ path: string; content: Buffer }>;
    if (Buffer.isBuffer(payload)) {
      const extracted = readZipArchive(payload);
      files = extracted.map((e) => ({ path: e.relativePath, content: e.content }));
    } else {
      files = payload.map((f) => ({
        path: f.path.replace(/\\/g, '/').replace(/^\/+/, ''),
        content: Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8')
      }));
    }

    // Strip top-level directory prefix if files are nested in an archive root folder
    const skillFile = files.find((f) => f.path.toLowerCase() === 'skill.md' || f.path.toLowerCase().endsWith('/skill.md'))!;
    let prefixToStrip = '';
    if (skillFile.path.includes('/')) {
      prefixToStrip = skillFile.path.substring(0, skillFile.path.lastIndexOf('/') + 1);
    }

    const rawSkillContent = skillFile.content.toString('utf8');

    const resolution = await SkillCollisionResolver.resolve(
      scopeDir,
      inspection.name,
      options.collisionAction,
      options.renameTo,
      rawSkillContent
    );

    if (resolution.action === 'keep') {
      return {
        success: false,
        skillName: inspection.name,
        destinationDir: resolution.destinationDir
      };
    }

    // 3. Write files into resolution.destinationDir
    const destDir = path.resolve(resolution.destinationDir);
    for (const f of files) {
      let relativePath = f.path;
      if (prefixToStrip && relativePath.startsWith(prefixToStrip)) {
        relativePath = relativePath.substring(prefixToStrip.length);
      }
      if (!relativePath) continue;

      // Reject absolute paths (POSIX and Windows drive paths)
      if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
        continue;
      }

      // Normalize and resolve candidate file path against destination directory
      const normalizedRel = path.normalize(relativePath);
      const targetPath = path.resolve(destDir, normalizedRel);

      // Reject any resolved target that is outside resolution.destinationDir
      const rel = path.relative(destDir, targetPath);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        continue;
      }

      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

      // If this is SKILL.md and was modified (renamed), write modified content
      if (relativePath.toLowerCase() === 'skill.md' && resolution.modifiedSkillContent) {
        await fs.promises.writeFile(targetPath, resolution.modifiedSkillContent, 'utf8');
      } else {
        await fs.promises.writeFile(targetPath, f.content);
      }
    }

    // 4. Rediscover skills in registry
    await this.registry.discoverAll();

    return {
      success: true,
      skillName: resolution.finalSkillName,
      destinationDir: resolution.destinationDir,
      backupDir: resolution.backupDir
    };
  }

  /**
   * Generates a pristine, standard PKZIP archive of a skill without proprietary LENS keys.
   */
  public async exportSkill(name: string): Promise<{ filename: string; buffer: Buffer }> {
    const pkg = this.registry.getSkill(name);
    if (!pkg) {
      throw new Error(`SKILL_NOT_FOUND: Skill "${name}" does not exist in registry`);
    }

    const filesToArchive: ZipArchiveFile[] = [];

    const collectFilesRecursively = async (dir: string, baseDir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          // Skip git, node_modules, backups
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.includes('.backup')) {
            continue;
          }
          await collectFilesRecursively(fullPath, baseDir);
        } else if (entry.isFile()) {
          const content = await fs.promises.readFile(fullPath);
          filesToArchive.push({
            relativePath: relPath,
            content
          });
        }
      }
    };

    await collectFilesRecursively(pkg.rootPath, pkg.rootPath);

    const zipBuffer = createZipArchive(filesToArchive);

    return {
      filename: `${pkg.name}.zip`,
      buffer: zipBuffer
    };
  }

  private async scanFolderFiles(rootPath: string): Promise<{ scriptFiles: string[]; referenceFiles: string[] }> {
    const scriptExtensions = ['.py', '.sh', '.bash', '.js', '.mjs', '.ts', '.exe', '.bat', '.cmd', '.ps1'];
    const scriptFiles: string[] = [];
    const referenceFiles: string[] = [];

    const scan = async (dir: string) => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const rel = path.relative(rootPath, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (entry.name !== '.git' && entry.name !== 'node_modules') {
              await scan(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.posix.extname(entry.name).toLowerCase();
            if (scriptExtensions.includes(ext)) {
              scriptFiles.push(rel);
            } else if (rel.startsWith('references/')) {
              referenceFiles.push(rel);
            }
          }
        }
      } catch {
        // Ignored if directory cannot be read
      }
    };

    await scan(rootPath);
    return { scriptFiles, referenceFiles };
  }
}
