import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  parseLenientYamlFrontmatter
} from '../dist-electron/engine/skills/parser.js';
import {
  SkillPathBoundary
} from '../dist-electron/engine/skills/pathBoundary.js';
import {
  loadSkillPackage,
  loadSkillResource
} from '../dist-electron/engine/skills/loader.js';
import {
  SkillRegistry
} from '../dist-electron/engine/skills/registry.js';
import {
  SkillError
} from '../dist-electron/engine/skills/types.js';

describe('Agent Skills Discovery, Validation & Path Sandboxing (Tracer 5)', () => {
  let tmpBaseDir;

  before(() => {
    tmpBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-skills-test-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Lenient YAML Frontmatter Parser (parser.ts)', () => {
    it('parses valid frontmatter and extracts markdown body', () => {
      const content = `---
name: academic-paper-analysis
description: Extracts scholarly findings and methodologies.
license: MIT
compatibility: lens>=1.0
disable-model-invocation: true
allowed-tools:
  - web-search
  - academic-scraper
---

# Academic Literature Analysis
This is the markdown instruction body.`;

      const { frontmatter, body } = parseLenientYamlFrontmatter(content, 'test.md');

      assert.equal(frontmatter.name, 'academic-paper-analysis');
      assert.equal(frontmatter.description, 'Extracts scholarly findings and methodologies.');
      assert.equal(frontmatter.license, 'MIT');
      assert.equal(frontmatter.compatibility, 'lens>=1.0');
      assert.equal(frontmatter.disableModelInvocation, true);
      assert.deepEqual(frontmatter.allowedTools, ['web-search', 'academic-scraper']);
      assert.ok(body.includes('# Academic Literature Analysis'));
    });

    it('recovers unquoted colons in description fields without failing', () => {
      const content = `---
name: paper-evaluator
description: In-depth evaluation: methodology, ablation tables: metrics, and citations: https://arxiv.org/abs/2301.00000
license: Apache-2.0
---
Instructions here.`;

      const { frontmatter } = parseLenientYamlFrontmatter(content, 'test.md');

      assert.equal(frontmatter.name, 'paper-evaluator');
      assert.equal(
        frontmatter.description,
        'In-depth evaluation: methodology, ablation tables: metrics, and citations: https://arxiv.org/abs/2301.00000'
      );
    });

    it('handles bracketed and comma-separated allowed-tools', () => {
      const bracketed = `---
name: tool-test-1
description: Testing bracketed tools
allowed-tools: [tool-a, tool-b, tool-c]
---
Body`;
      const commaSeparated = `---
name: tool-test-2
description: Testing comma separated tools
allowed-tools: tool-x, tool-y
---
Body`;

      const res1 = parseLenientYamlFrontmatter(bracketed);
      assert.deepEqual(res1.frontmatter.allowedTools, ['tool-a', 'tool-b', 'tool-c']);

      const res2 = parseLenientYamlFrontmatter(commaSeparated);
      assert.deepEqual(res2.frontmatter.allowedTools, ['tool-x', 'tool-y']);
    });

    it('parses multi-line block scalar descriptions (> and |)', () => {
      const content = `---
name: multi-line-skill
description: >
  This is a long description that spans
  across multiple lines in the frontmatter
  and should be concatenated cleanly.
---
Body`;

      const { frontmatter } = parseLenientYamlFrontmatter(content);
      assert.ok(frontmatter.description.includes('long description that spans'));
      assert.ok(frontmatter.description.includes('concatenated cleanly'));
    });

    it('rejects invalid skill names', () => {
      const invalidNames = [
        'UppercaseSkill',
        'snake_case_name',
        '-leading-hyphen',
        'trailing-hyphen-',
        'space in name',
        'special!symbol',
        'tool.with.dots',
        ''
      ];

      for (const badName of invalidNames) {
        const content = `---
name: ${badName}
description: Valid description text
---
Body`;
        assert.throws(
          () => parseLenientYamlFrontmatter(content, 'test.md'),
          (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_NAME',
          `Should reject invalid name: "${badName}"`
        );
      }
    });

    it('rejects invalid description (empty or > 1024 characters)', () => {
      // Empty description
      const emptyContent = `---
name: valid-name
description: ""
---
Body`;
      assert.throws(
        () => parseLenientYamlFrontmatter(emptyContent),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_DESCRIPTION'
      );

      // Oversized description (> 1024 chars)
      const oversizedContent = `---
name: valid-name
description: ${'A'.repeat(1025)}
---
Body`;
      assert.throws(
        () => parseLenientYamlFrontmatter(oversizedContent),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_DESCRIPTION'
      );
    });

    it('rejects missing or malformed frontmatter delimiters', () => {
      const noFences = `# Just a markdown file without frontmatter`;
      assert.throws(
        () => parseLenientYamlFrontmatter(noFences),
        (err) => err instanceof SkillError && err.code === 'MISSING_FRONTMATTER'
      );

      const unclosedFences = `---
name: test-skill
description: Missing closing fence
# No closing delimiter`;
      assert.throws(
        () => parseLenientYamlFrontmatter(unclosedFences),
        (err) => err instanceof SkillError && err.code === 'MISSING_FRONTMATTER'
      );
    });
  });

  describe('SkillPathBoundary Security Sandboxing (pathBoundary.ts)', () => {
    let skillDir;

    before(() => {
      skillDir = path.join(tmpBaseDir, 'sandbox-skill');
      fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: sandbox-skill\ndescription: Test\n---\nBody');
      fs.writeFileSync(path.join(skillDir, 'references', 'guide.md'), '# Reference Guide');
    });

    it('resolves valid internal paths within the skill root boundary', () => {
      const boundary = new SkillPathBoundary(skillDir);

      const resolvedSkill = boundary.resolveSafePath('SKILL.md');
      assert.equal(resolvedSkill, path.resolve(skillDir, 'SKILL.md'));

      const resolvedGuide = boundary.resolveSafePath('references/guide.md');
      assert.equal(resolvedGuide, path.resolve(skillDir, 'references', 'guide.md'));
    });

    it('safely reads valid internal resources', async () => {
      const boundary = new SkillPathBoundary(skillDir);
      const content = await boundary.readResource('references/guide.md');
      assert.equal(content, '# Reference Guide');
    });

    it('throws SECURITY_ACCESS_DENIED on relative directory traversal (../../)', () => {
      const boundary = new SkillPathBoundary(skillDir);

      const maliciousPaths = [
        '../../etc/passwd',
        '../sibling-file.txt',
        'references/../../outside.txt',
        'references/../../../escape.txt',
        '..\\..\\windows\\system32'
      ];

      for (const badPath of maliciousPaths) {
        assert.throws(
          () => boundary.resolveSafePath(badPath),
          (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED',
          `Should block traversal: "${badPath}"`
        );
      }
    });

    it('throws SECURITY_ACCESS_DENIED on null byte injection', () => {
      const boundary = new SkillPathBoundary(skillDir);
      assert.throws(
        () => boundary.resolveSafePath('references/guide.md\0.exe'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );
    });

    it('throws SECURITY_ACCESS_DENIED on absolute paths escaping root', () => {
      const boundary = new SkillPathBoundary(skillDir);
      const outsideAbsolute = path.resolve(tmpBaseDir, 'unauthorized.txt');

      assert.throws(
        () => boundary.resolveSafePath(outsideAbsolute),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );
    });

    it('throws SECURITY_ACCESS_DENIED on out-of-root symlinks', () => {
      const boundary = new SkillPathBoundary(skillDir);
      const outsideFile = path.join(tmpBaseDir, 'outside-target.txt');
      fs.writeFileSync(outsideFile, 'Secret outside content');

      const symlinkPath = path.join(skillDir, 'references', 'malicious-symlink.txt');
      try {
        fs.symlinkSync(outsideFile, symlinkPath, 'file');
      } catch {
        // Skip symlink test if running without symlink permissions on Windows
        return;
      }

      assert.throws(
        () => boundary.resolveSafePath('references/malicious-symlink.txt'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED',
        'Must block symlink escaping skill directory'
      );
    });

    it('lists only files contained within the safe boundary', async () => {
      const boundary = new SkillPathBoundary(skillDir);
      const files = await boundary.listFiles();

      assert.ok(files.some(f => f.includes('SKILL.md')));
      assert.ok(files.some(f => f.includes('guide.md')));
      assert.ok(files.every(f => !f.startsWith('..')));
    });
  });

  describe('SkillLoader (loader.ts)', () => {
    it('loads a valid skill package and verifies frontmatter and body', async () => {
      const testSkillDir = path.join(tmpBaseDir, 'loader-skill');
      fs.mkdirSync(testSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(testSkillDir, 'SKILL.md'),
        `---
name: data-extraction
description: Extracts tabular data from PDFs and HTML.
allowed-tools:
  - table-extractor
---
# Data Extraction Instructions`
      );

      const pkg = await loadSkillPackage(testSkillDir, 'workspace');

      assert.equal(pkg.name, 'data-extraction');
      assert.equal(pkg.scope, 'workspace');
      assert.equal(pkg.frontmatter.description, 'Extracts tabular data from PDFs and HTML.');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['table-extractor']);
      assert.ok(pkg.rawBody.includes('# Data Extraction Instructions'));
      assert.ok(pkg.parsedAt > 0);
    });

    it('throws MISSING_FRONTMATTER when SKILL.md is missing', async () => {
      const emptyDir = path.join(tmpBaseDir, 'empty-skill-dir');
      fs.mkdirSync(emptyDir, { recursive: true });

      await assert.rejects(
        async () => loadSkillPackage(emptyDir, 'workspace'),
        (err) => err instanceof SkillError && err.code === 'MISSING_FRONTMATTER'
      );
    });

    it('safely loads secondary resources via loadSkillResource', async () => {
      const pkgDir = path.join(tmpBaseDir, 'resource-skill');
      fs.mkdirSync(path.join(pkgDir, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), '---\nname: resource-skill\ndescription: Test\n---\nBody');
      fs.writeFileSync(path.join(pkgDir, 'templates', 'output.json'), '{"format": "json"}');

      const pkg = await loadSkillPackage(pkgDir, 'workspace');
      const resource = await loadSkillResource(pkg, 'templates/output.json');
      assert.equal(resource, '{"format": "json"}');

      // Attempt traversal via loadSkillResource
      await assert.rejects(
        async () => loadSkillResource(pkg, '../../secret.txt'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );
    });
  });

  describe('SkillRegistry 3-Tier Discovery & Deterministic Precedence (registry.ts)', () => {
    let workspaceDir;
    let userDir;
    let builtinDir;
    let registry;

    before(() => {
      workspaceDir = path.join(tmpBaseDir, 'workspace-root');
      userDir = path.join(tmpBaseDir, 'user-root');
      builtinDir = path.join(tmpBaseDir, 'builtin-root');

      // 1. Workspace scope (.agents/skills/)
      const wsSkillA = path.join(workspaceDir, '.agents', 'skills', 'common-skill');
      const wsSkillB = path.join(workspaceDir, '.agents', 'skills', 'workspace-exclusive');
      fs.mkdirSync(wsSkillA, { recursive: true });
      fs.mkdirSync(wsSkillB, { recursive: true });
      fs.writeFileSync(
        path.join(wsSkillA, 'SKILL.md'),
        `---
name: common-skill
description: Workspace version of common skill (priority 1)
license: Apache-2.0
---
Workspace version instructions`
      );
      fs.writeFileSync(
        path.join(wsSkillB, 'SKILL.md'),
        `---
name: workspace-exclusive
description: Exclusive to workspace
---
Workspace exclusive instructions`
      );

      // 2. User scope (userDir)
      const userSkillA = path.join(userDir, 'common-skill');
      const userSkillC = path.join(userDir, 'user-exclusive');
      fs.mkdirSync(userSkillA, { recursive: true });
      fs.mkdirSync(userSkillC, { recursive: true });
      fs.writeFileSync(
        path.join(userSkillA, 'SKILL.md'),
        `---
name: common-skill
description: User version of common skill (priority 2)
---
User version instructions`
      );
      fs.writeFileSync(
        path.join(userSkillC, 'SKILL.md'),
        `---
name: user-exclusive
description: Exclusive to user global
---
User exclusive instructions`
      );

      // 3. Built-in bundle (builtinDir)
      const builtinSkillA = path.join(builtinDir, 'common-skill');
      const builtinSkillD = path.join(builtinDir, 'builtin-exclusive');
      fs.mkdirSync(builtinSkillA, { recursive: true });
      fs.mkdirSync(builtinSkillD, { recursive: true });
      fs.writeFileSync(
        path.join(builtinSkillA, 'SKILL.md'),
        `---
name: common-skill
description: Builtin version of common skill (priority 3)
---
Builtin version instructions`
      );
      fs.writeFileSync(
        path.join(builtinSkillD, 'SKILL.md'),
        `---
name: builtin-exclusive
description: Builtin official skill
---
Builtin exclusive instructions`
      );

      registry = new SkillRegistry({
        workspaceDir,
        userGlobalDir: userDir,
        builtinDir
      });
    });

    it('discovers skills across all 3 tiers with deterministic precedence shadowing', async () => {
      const skills = await registry.discoverAll();

      // Total distinct skills should be 4: common-skill, workspace-exclusive, user-exclusive, builtin-exclusive
      assert.equal(skills.size, 4);

      // 1. common-skill MUST resolve to workspace scope, shadowing user and builtin!
      const commonSkill = registry.getSkill('common-skill');
      assert.ok(commonSkill);
      assert.equal(commonSkill.scope, 'workspace', 'Workspace scope must shadow User and Builtin scopes');
      assert.equal(commonSkill.frontmatter.description, 'Workspace version of common skill (priority 1)');
      assert.ok(commonSkill.rawBody.includes('Workspace version instructions'));

      // 2. Scope-exclusive skills must be correctly mapped to their respective scopes
      const wsExclusive = registry.getSkill('workspace-exclusive');
      assert.ok(wsExclusive);
      assert.equal(wsExclusive.scope, 'workspace');

      const userExclusive = registry.getSkill('user-exclusive');
      assert.ok(userExclusive);
      assert.equal(userExclusive.scope, 'user');

      const builtinExclusive = registry.getSkill('builtin-exclusive');
      assert.ok(builtinExclusive);
      assert.equal(builtinExclusive.scope, 'builtin');
    });

    it('provides case-insensitive skill lookup via getSkill', () => {
      const skill1 = registry.getSkill('COMMON-SKILL');
      const skill2 = registry.getSkill('common-skill');
      assert.ok(skill1);
      assert.equal(skill1, skill2);
    });

    it('generates lightweight Tier 1 catalog summaries via listSummaries', () => {
      const summaries = registry.listSummaries();
      assert.equal(summaries.length, 4);

      const commonSummary = summaries.find(s => s.name === 'common-skill');
      assert.ok(commonSummary);
      assert.equal(commonSummary.scope, 'workspace');
      assert.equal(commonSummary.description, 'Workspace version of common skill (priority 1)');
      // Summary should NOT leak rawBody
      assert.equal(commonSummary.rawBody, undefined);
    });

    it('records diagnostics for shadowed skills without failing', () => {
      const diagnostics = registry.getDiagnostics();
      const shadowedDiag = diagnostics.find(d => d.error.includes('Shadowed by higher-priority'));
      assert.ok(shadowedDiag, 'Should record shadowing diagnostics');
    });

    it('resiliently handles invalid skill folders without interrupting discovery', async () => {
      // Add an invalid skill folder in workspace with bad name
      const brokenFolder = path.join(workspaceDir, '.agents', 'skills', 'Broken_Skill_Name');
      fs.mkdirSync(brokenFolder, { recursive: true });
      fs.writeFileSync(
        path.join(brokenFolder, 'SKILL.md'),
        `---
name: INVALID_UPPERCASE
description: Should be skipped
---
Body`
      );

      // Re-run discovery
      await registry.discoverAll();

      // Registry still has the valid skills
      assert.equal(registry.hasSkill('common-skill'), true);
      assert.equal(registry.hasSkill('invalid_uppercase'), false);

      // Diagnostic recorded for the broken folder
      const diags = registry.getDiagnostics();
      const invalidDiag = diags.find(d => d.path.includes('Broken_Skill_Name'));
      assert.ok(invalidDiag, 'Should record diagnostic for invalid skill package');
    });
  });

  describe('Committed Adversarial Fixtures & Strict Validation', () => {
    const fixturesDir = path.resolve('test', 'fixtures', 'skills');

    it('loads valid-skill from committed fixture and reads safe sub-resource', async () => {
      const validDir = path.join(fixturesDir, 'valid-skill');
      const pkg = await loadSkillPackage(validDir, 'workspace');

      assert.equal(pkg.name, 'valid-skill');
      assert.equal(pkg.frontmatter.license, 'MIT');
      assert.equal(pkg.frontmatter.compatibility, 'LENS >= 1.0.0');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['web_search', 'read_url']);
      assert.equal(pkg.frontmatter.metadata?.domain, 'science');

      const resource = await loadSkillResource(pkg, 'references/guide.md');
      assert.ok(resource.includes('Reference Guide'));
    });

    it('blocks directory traversal escape on fixture package', async () => {
      const validDir = path.join(fixturesDir, 'valid-skill');
      const pkg = await loadSkillPackage(validDir, 'workspace');

      await assert.rejects(
        () => loadSkillResource(pkg, '../../package.json'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );
    });

    it('parses colon-description-skill fixture with unquoted colons across continuation lines', async () => {
      const colonDir = path.join(fixturesDir, 'colon-description-skill');
      const pkg = await loadSkillPackage(colonDir, 'workspace');

      assert.equal(pkg.name, 'colon-description-skill');
      assert.ok(pkg.frontmatter.description.includes('Search PubMed: queries: clinical trials: results'));
      assert.ok(pkg.frontmatter.description.includes('Source: National Center for Biotechnology Information: NCBI'));
      assert.ok(pkg.frontmatter.description.includes('Note: unquoted: colons: everywhere'));
    });

    it('rejects invalid-name-skill fixture with INVALID_SKILL_NAME', async () => {
      const invalidNameDir = path.join(fixturesDir, 'invalid-name-skill');
      await assert.rejects(
        () => loadSkillPackage(invalidNameDir, 'workspace'),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_NAME'
      );
    });

    it('rejects oversized-desc-skill fixture with INVALID_SKILL_DESCRIPTION', async () => {
      const oversizedDir = path.join(fixturesDir, 'oversized-desc-skill');
      await assert.rejects(
        () => loadSkillPackage(oversizedDir, 'workspace'),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_DESCRIPTION'
      );
    });

    it('rejects invalid-tools-skill fixture with INVALID_SKILL_ALLOWED_TOOLS', async () => {
      const invalidToolsDir = path.join(fixturesDir, 'invalid-tools-skill');
      await assert.rejects(
        () => loadSkillPackage(invalidToolsDir, 'workspace'),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_ALLOWED_TOOLS'
      );
    });

    it('validates license length limit', () => {
      const oversizedLicense = `---
name: test-license
description: Valid description
license: ${'A'.repeat(101)}
---
Body`;
      assert.throws(
        () => parseLenientYamlFrontmatter(oversizedLicense),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_LICENSE'
      );
    });

    it('validates compatibility length limit', () => {
      const oversizedCompat = `---
name: test-compat
description: Valid description
compatibility: ${'B'.repeat(501)}
---
Body`;
      assert.throws(
        () => parseLenientYamlFrontmatter(oversizedCompat),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_COMPATIBILITY'
      );
    });

    it('validates metadata format (must be object map)', () => {
      const invalidMeta = `---
name: test-meta
description: Valid description
metadata:
  - list item 1
  - list item 2
---
Body`;
      // When metadata is parsed as array or invalid, it throws INVALID_SKILL_METADATA
      const rawMetaText = `---
name: test-meta-2
description: Valid description
metadata: "not an object"
---
Body`;
      assert.throws(
        () => parseLenientYamlFrontmatter(rawMetaText),
        (err) => err instanceof SkillError && err.code === 'INVALID_SKILL_METADATA'
      );
    });

    it('supports multi-directory userGlobalDirs scanning in SkillRegistry', async () => {
      const userDir1 = path.join(tmpBaseDir, 'user-scope-1');
      const userDir2 = path.join(tmpBaseDir, 'user-scope-2');
      fs.mkdirSync(path.join(userDir1, 'user-tool-1'), { recursive: true });
      fs.mkdirSync(path.join(userDir2, 'user-tool-2'), { recursive: true });

      fs.writeFileSync(
        path.join(userDir1, 'user-tool-1', 'SKILL.md'),
        '---\nname: user-tool-1\ndescription: Tool from user dir 1\n---\nBody'
      );
      fs.writeFileSync(
        path.join(userDir2, 'user-tool-2', 'SKILL.md'),
        '---\nname: user-tool-2\ndescription: Tool from user dir 2\n---\nBody'
      );

      const reg = new SkillRegistry({
        workspaceDir: path.join(tmpBaseDir, 'empty-ws'),
        userGlobalDirs: [userDir1, userDir2],
        builtinDir: path.join(tmpBaseDir, 'empty-builtin')
      });

      const discovered = await reg.discoverAll();
      assert.ok(discovered.has('user-tool-1'));
      assert.ok(discovered.has('user-tool-2'));
      assert.equal(discovered.get('user-tool-1')?.scope, 'user');
      assert.equal(discovered.get('user-tool-2')?.scope, 'user');
    });

    it('covers boundary and loader non-existent directory edge cases', async () => {
      const nonExistentDir = path.join(tmpBaseDir, 'does-not-exist');
      const boundary = new SkillPathBoundary(nonExistentDir);
      assert.equal(boundary.rootDir, path.resolve(nonExistentDir));

      // resolveSafePath rejects non-string
      assert.throws(
        () => boundary.resolveSafePath(null),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );

      // loadSkillPackage rejects non-existent dir
      await assert.rejects(
        () => loadSkillPackage(nonExistentDir, 'workspace'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );

      // registry loadResource on missing skill throws SECURITY_ACCESS_DENIED
      const reg = new SkillRegistry();
      await assert.rejects(
        () => reg.loadResource('non-existent-skill', 'some-file.txt'),
        (err) => err instanceof SkillError && err.code === 'SECURITY_ACCESS_DENIED'
      );
    });

    it('supports scanAliases: false option in SkillRegistry', async () => {
      const regNoAliases = new SkillRegistry({
        workspaceDir: tmpBaseDir,
        scanAliases: false,
        builtinDir: path.join(tmpBaseDir, 'empty-builtin')
      });
      const roots = regNoAliases['resolveWorkspaceRoots']();
      assert.equal(roots.length, 1);
      assert.ok(roots[0].includes('.agents'));
    });
  });
});
