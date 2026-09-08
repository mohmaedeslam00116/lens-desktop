/**
 * LENS Agent Skills — Non-Destructive Collision Resolver
 * Tracer 9 (Issue #36): Safely handles destination name collisions when importing
 * agent skills, providing Keep, Overwrite (with timestamped .backup), and Rename options.
 */

import * as fs from 'fs';
import * as path from 'path';
import { validateSkillName, parseSkillFrontmatter } from './parser';
import { SkillError } from './types';

export type CollisionAction = 'keep' | 'overwrite' | 'rename';

export interface CollisionResolutionResult {
  action: CollisionAction;
  destinationDir: string;
  finalSkillName: string;
  backupDir?: string;
  modifiedSkillContent?: string;
}

export class SkillCollisionResolver {
  /**
   * Checks if a target skill folder already exists in the given scope directory.
   */
  public static checkCollision(scopeDir: string, skillName: string): boolean {
    const targetFolder = path.join(scopeDir, skillName.toLowerCase());
    return fs.existsSync(targetFolder);
  }

  /**
   * Resolves collision according to the selected user action:
   * - 'keep': Keeps the existing skill directory untouched; does not overwrite.
   * - 'overwrite': Renames existing folder to timestamped backup `.backup_<timestamp>` and clears path for new files.
   * - 'rename': Renames target folder to `renameTo`, validating name rules and rewriting SKILL.md frontmatter.
   */
  public static async resolve(
    scopeDir: string,
    skillName: string,
    action: CollisionAction,
    renameTo?: string,
    rawSkillContent?: string
  ): Promise<CollisionResolutionResult> {
    const normalizedOriginalName = skillName.trim().toLowerCase();
    const originalTargetDir = path.join(scopeDir, normalizedOriginalName);

    // 1. Keep Existing
    if (action === 'keep') {
      return {
        action: 'keep',
        destinationDir: originalTargetDir,
        finalSkillName: normalizedOriginalName
      };
    }

    // 2. Overwrite with Backup
    if (action === 'overwrite') {
      let backupDir: string | undefined;

      if (fs.existsSync(originalTargetDir)) {
        // Create timestamped backup folder
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupDir = `${originalTargetDir}.backup_${timestamp}`;
        await fs.promises.rename(originalTargetDir, backupDir);
      }

      await fs.promises.mkdir(originalTargetDir, { recursive: true });

      return {
        action: 'overwrite',
        destinationDir: originalTargetDir,
        finalSkillName: normalizedOriginalName,
        backupDir
      };
    }

    // 3. Rename on Import
    if (action === 'rename') {
      const targetNewName = (renameTo || `${normalizedOriginalName}-imported`).trim().toLowerCase();
      validateSkillName(targetNewName);

      const newDestinationDir = path.join(scopeDir, targetNewName);
      if (fs.existsSync(newDestinationDir)) {
        throw new SkillError(
          'INVALID_SKILL_NAME',
          `Cannot rename to "${targetNewName}": directory already exists at ${newDestinationDir}`
        );
      }

      await fs.promises.mkdir(newDestinationDir, { recursive: true });

      // If rawSkillContent provided, rewrite the `name:` frontmatter field
      let modifiedSkillContent: string | undefined;
      if (rawSkillContent) {
        modifiedSkillContent = this.rewriteSkillName(rawSkillContent, targetNewName);
      }

      return {
        action: 'rename',
        destinationDir: newDestinationDir,
        finalSkillName: targetNewName,
        modifiedSkillContent
      };
    }

    throw new Error(`UNKNOWN_COLLISION_ACTION: Unsupported action "${action}"`);
  }

  /**
   * Rewrites the name field in the YAML frontmatter of a SKILL.md document.
   */
  public static rewriteSkillName(skillContent: string, newName: string): string {
    const match = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      return skillContent;
    }

    const frontmatterBlock = match[1];
    let updatedFrontmatter: string;

    if (/^name\s*:\s*.+$/m.test(frontmatterBlock)) {
      updatedFrontmatter = frontmatterBlock.replace(/^name\s*:\s*.+$/m, `name: ${newName}`);
    } else {
      updatedFrontmatter = `name: ${newName}\n${frontmatterBlock}`;
    }

    return skillContent.replace(
      /^---\r?\n[\s\S]*?\r?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );
  }
}
