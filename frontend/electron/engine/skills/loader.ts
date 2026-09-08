import * as path from 'path';
import * as fs from 'fs';
import { SkillError, SkillPackage, SkillScope } from './types';
import { SkillPathBoundary } from './pathBoundary';
import { parseLenientYamlFrontmatter } from './parser';

/**
 * Loads and validates an Agent Skill package from its directory.
 */
export async function loadSkillPackage(
  skillDirPath: string,
  scope: SkillScope
): Promise<SkillPackage> {
  const boundary = new SkillPathBoundary(skillDirPath);

  if (!fs.existsSync(boundary.rootDir)) {
    throw new SkillError(
      'SECURITY_ACCESS_DENIED',
      `Skill directory does not exist: ${skillDirPath}`,
      skillDirPath
    );
  }

  // Find SKILL.md or skill.md
  let skillFileName = 'SKILL.md';
  if (!boundary.existsSync('SKILL.md')) {
    if (boundary.existsSync('skill.md')) {
      skillFileName = 'skill.md';
    } else {
      throw new SkillError(
        'MISSING_FRONTMATTER',
        `No SKILL.md found in skill directory: ${skillDirPath}`,
        skillDirPath
      );
    }
  }

  const skillFilePath = boundary.resolveSafePath(skillFileName);
  const rawContent = await boundary.readResource(skillFileName, 'utf8');

  const { frontmatter, body } = parseLenientYamlFrontmatter(rawContent, skillFilePath);

  const skillPackage: SkillPackage = {
    name: frontmatter.name,
    scope,
    rootPath: boundary.rootDir,
    skillFilePath,
    frontmatter,
    rawBody: body,
    parsedAt: Date.now(),
    boundary
  };

  return skillPackage;
}

/**
 * Safely loads a secondary resource file (e.g. references, templates)
 * belonging to an installed skill package.
 */
export async function loadSkillResource(
  pkg: SkillPackage,
  relativeResourcePath: string
): Promise<string> {
  const normalizedKey = relativeResourcePath.replace(/\\/g, '/').toLowerCase();
  if (pkg.resourceSnapshot && pkg.resourceSnapshot.has(normalizedKey)) {
    return pkg.resourceSnapshot.get(normalizedKey)!;
  }
  const boundary: SkillPathBoundary = pkg.boundary || new SkillPathBoundary(pkg.rootPath);
  const content = await boundary.readResource(relativeResourcePath, 'utf8');
  if (!pkg.resourceSnapshot) {
    pkg.resourceSnapshot = new Map();
  }
  pkg.resourceSnapshot.set(normalizedKey, content);
  return content;
}
