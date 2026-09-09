import * as path from 'path';
import * as fs from 'fs';
import { SkillError } from './types';

export const MAX_RESOURCE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Enforces strict filesystem sandboxing for an individual skill directory.
 * Prevents directory traversal, ZipSlip escapes, null-byte injection,
 * and out-of-root symlink dereferencing.
 */
export class SkillPathBoundary {
  public readonly rootDir: string;
  private readonly realRootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    try {
      this.realRootDir = fs.existsSync(this.rootDir)
        ? fs.realpathSync(this.rootDir)
        : this.rootDir;
    } catch {
      this.realRootDir = this.rootDir;
    }
  }

  /**
   * Resolves and verifies that a candidate target path strictly resides
   * within this skill's root directory boundary.
   * Throws SkillError with code 'SECURITY_ACCESS_DENIED' on any escape attempt.
   */
  public resolveSafePath(candidatePath: string): string {
    if (typeof candidatePath !== 'string') {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        'Path must be a valid string',
        candidatePath
      );
    }

    // 1. Guard against null-byte injection attacks
    if (candidatePath.includes('\0')) {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        'Null byte injection detected in path',
        candidatePath
      );
    }

    // 2. Resolve candidate path relative to root
    // Note: If candidatePath is absolute (e.g. /etc/passwd or C:\Windows),
    // path.resolve(rootDir, candidatePath) would jump to the root of the drive!
    // Therefore, if candidatePath starts with '/' or '\' or drive letter, treat it as relative or check escape!
    let sanitizedRel = candidatePath;
    if (path.isAbsolute(sanitizedRel)) {
      // Reject absolute paths that attempt to bypass rootDir
      if (!isContainedPath(this.rootDir, sanitizedRel)) {
        throw new SkillError(
          'SECURITY_ACCESS_DENIED',
          'Absolute path escapes skill root directory boundary',
          candidatePath
        );
      }
    }

    const resolved = path.resolve(this.rootDir, sanitizedRel);

    // 3. Verify lexical containment within rootDir
    if (!isContainedPath(this.rootDir, resolved)) {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        'Path traversal detected outside skill root directory boundary',
        candidatePath
      );
    }

    // 4. Verify canonical symlink containment if target or parent exists
    try {
      if (fs.existsSync(resolved)) {
        const realResolved = fs.realpathSync(resolved);
        if (!isContainedPath(this.realRootDir, realResolved)) {
          throw new SkillError(
            'SECURITY_ACCESS_DENIED',
            'Symlink dereferencing points outside skill root directory boundary',
            candidatePath
          );
        }
      } else {
        // If file doesn't exist yet, check its nearest existing ancestor directory
        let ancestor = path.dirname(resolved);
        while (ancestor.length >= this.rootDir.length && !fs.existsSync(ancestor)) {
          const parent = path.dirname(ancestor);
          if (parent === ancestor) break;
          ancestor = parent;
        }
        if (fs.existsSync(ancestor)) {
          const realAncestor = fs.realpathSync(ancestor);
          if (!isContainedPath(this.realRootDir, realAncestor)) {
            throw new SkillError(
              'SECURITY_ACCESS_DENIED',
              'Symlink ancestor points outside skill root directory boundary',
              candidatePath
            );
          }
        }
      }
    } catch (err: any) {
      if (err instanceof SkillError) {
        throw err;
      }
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        `Failed verifying canonical path boundary: ${err.message}`,
        candidatePath
      );
    }

    return resolved;
  }

  /**
   * Safely reads a file within the skill directory boundary.
   */
  public async readResource(relativePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    const safePath = this.resolveSafePath(relativePath);
    const stats = await fs.promises.stat(safePath);
    if (!stats.isFile()) {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        `Skill resource is not a regular file: ${safePath}`,
        safePath
      );
    }
    if (stats.size > MAX_RESOURCE_FILE_SIZE) {
      throw new SkillError(
        'SECURITY_ACCESS_DENIED',
        `Skill resource exceeds maximum permitted size of ${MAX_RESOURCE_FILE_SIZE} bytes: ${stats.size} bytes`,
        safePath
      );
    }
    return fs.promises.readFile(safePath, { encoding });
  }

  /**
   * Checks whether a safe file exists within the boundary.
   */
  public existsSync(relativePath: string): boolean {
    try {
      const safePath = this.resolveSafePath(relativePath);
      return fs.existsSync(safePath);
    } catch {
      return false;
    }
  }

  /**
   * Lists all files within a subdirectory of the skill, returned as relative paths.
   */
  public async listFiles(subDir = ''): Promise<string[]> {
    const safeDir = this.resolveSafePath(subDir);
    const results: string[] = [];

    const walk = async (currentDir: string, relBase: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;

        // Verify entry doesn't escape; if it does, skip it to list only safe files
        try {
          this.resolveSafePath(rel);
        } catch {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(full, rel);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    };

    if (fs.existsSync(safeDir)) {
      await walk(safeDir, subDir.replace(/^[/\\]+/, ''));
    }

    return results;
  }
}

/**
 * Checks whether child is contained within parent directory,
 * with case-insensitive normalization on Windows.
 */
function isContainedPath(parent: string, child: string): boolean {
  const normParent = path.normalize(parent);
  const normChild = path.normalize(child);
  if (process.platform === 'win32') {
    const p = normParent.toLowerCase();
    const c = normChild.toLowerCase();
    const sep = path.sep.toLowerCase();
    return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
  }
  return normChild === normParent || normChild.startsWith(normParent.endsWith(path.sep) ? normParent : normParent + path.sep);
}
