/**
 * Scope origin for an Agent Skill package.
 * Precedence hierarchy: workspace (1) > user (2) > builtin (3).
 */
export type SkillScope = 'workspace' | 'user' | 'builtin';

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, any>;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
}

export interface SkillPackage {
  name: string;
  scope: SkillScope;
  rootPath: string;
  skillFilePath: string;
  frontmatter: SkillFrontmatter;
  rawBody: string;
  parsedAt: number;
  boundary?: any;
}

/**
 * Lightweight summary disclosed during Tier 1 catalog enumeration (~50-100 tokens).
 */
export interface SkillSummary {
  name: string;
  description: string;
  scope: SkillScope;
  rootPath: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
}

export interface SkillDiscoveryOptions {
  workspaceDir?: string;
  userGlobalDir?: string;
  userGlobalDirs?: string[];
  builtinDir?: string;
  scanAliases?: boolean;
}

export type SkillValidationErrorCode =
  | 'INVALID_SKILL_NAME'
  | 'INVALID_SKILL_DESCRIPTION'
  | 'INVALID_SKILL_LICENSE'
  | 'INVALID_SKILL_COMPATIBILITY'
  | 'INVALID_SKILL_METADATA'
  | 'INVALID_SKILL_ALLOWED_TOOLS'
  | 'MISSING_FRONTMATTER'
  | 'INVALID_FRONTMATTER_SYNTAX'
  | 'SECURITY_ACCESS_DENIED';

export class SkillError extends Error {
  public readonly code: SkillValidationErrorCode;
  public readonly path?: string;

  constructor(code: SkillValidationErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
    this.path = path;
    Object.setPrototypeOf(this, SkillError.prototype);
  }
}
