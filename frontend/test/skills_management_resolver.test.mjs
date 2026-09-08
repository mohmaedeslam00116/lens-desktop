import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  createZipArchive,
  readZipArchive,
  computeCrc32
} from '../dist-electron/engine/skills/zipArchive.js';
import {
  SkillCollisionResolver
} from '../dist-electron/engine/skills/collisionResolver.js';
import {
  SkillManagerService
} from '../dist-electron/engine/skills/service.js';
import {
  SkillRegistry
} from '../dist-electron/engine/skills/registry.js';
import {
  loadSkillPackage,
  loadSkillResource
} from '../dist-electron/engine/skills/loader.js';
import {
  SkillActivationManager
} from '../dist-electron/engine/skills/activation.js';

describe('Tracer 9: Agent Skills Management, Non-Destructive Resolver & Launch Skills', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lens-skills-mgr-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe('Pure Node.js Zero-Dependency PKZIP Archiver (zipArchive)', () => {
    it('creates and extracts standard ZIP archives with byte-for-byte roundtrip fidelity', () => {
      const files = [
        { relativePath: 'SKILL.md', content: '---\nname: test-skill\ndescription: Test description\n---\n# Test Body' },
        { relativePath: 'references/guide.md', content: '# Internal Guide\nVerified reference content.' },
        { relativePath: 'data/sample.json', content: JSON.stringify({ key: 'value', count: 42 }, null, 2) }
      ];

      const zipBuffer = createZipArchive(files);
      assert.ok(Buffer.isBuffer(zipBuffer));
      assert.ok(zipBuffer.length > 100);

      // Verify PK header signatures
      assert.equal(zipBuffer.readUInt32LE(0), 0x04034b50, 'Must start with local file header signature');

      // Extract and verify contents
      const extracted = readZipArchive(zipBuffer);
      assert.equal(extracted.length, 3);

      const skillFile = extracted.find(f => f.relativePath === 'SKILL.md');
      assert.ok(skillFile);
      assert.equal(skillFile.content.toString('utf8'), files[0].content);

      const guideFile = extracted.find(f => f.relativePath === 'references/guide.md');
      assert.ok(guideFile);
      assert.equal(guideFile.content.toString('utf8'), files[1].content);
    });

    it('computes CRC-32 checksum accurately', () => {
      const buf = Buffer.from('123456789', 'utf8');
      const crc = computeCrc32(buf);
      // Known CRC32 of ASCII '123456789' is 0xcbf43926 (3421780262 in unsigned decimal)
      assert.equal(crc, 0xcbf43926);
    });

    it('automatically excludes .git, system files, and secret environment files from export', () => {
      const files = [
        { relativePath: 'SKILL.md', content: '---\nname: safe-skill\ndescription: Safe\n---\n# Body' },
        { relativePath: '.git/config', content: '[core]\nrepositoryformatversion = 0' },
        { relativePath: '.DS_Store', content: 'system-metadata' },
        { relativePath: 'Thumbs.db', content: 'thumbnail-cache' },
        { relativePath: '.env', content: 'API_KEY=secret123' },
        { relativePath: 'id_rsa.secret', content: 'private-key' }
      ];

      const zipBuffer = createZipArchive(files);
      const extracted = readZipArchive(zipBuffer);

      assert.equal(extracted.length, 1);
      assert.equal(extracted[0].relativePath, 'SKILL.md');
    });

    it('blocks Zip-Slip directory traversal attempts with SECURITY_ACCESS_DENIED', () => {
      // Craft a malicious ZIP with path traversal entry
      const maliciousFiles = [
        { relativePath: '../../etc/passwd', content: 'malicious-payload' }
      ];

      const zipBuffer = createZipArchive(maliciousFiles);
      assert.throws(
        () => readZipArchive(zipBuffer),
        (err) => {
          assert.ok(err.message.includes('SECURITY_ACCESS_DENIED'));
          assert.ok(err.message.includes('Zip-Slip traversal attempt'));
          return true;
        }
      );
    });
  });

  describe('Non-Destructive SkillCollisionResolver', () => {
    it('detects existing skill folders accurately via checkCollision', async () => {
      const skillDir = path.join(tempDir, 'existing-skill');
      await fs.promises.mkdir(skillDir, { recursive: true });

      assert.equal(SkillCollisionResolver.checkCollision(tempDir, 'existing-skill'), true);
      assert.equal(SkillCollisionResolver.checkCollision(tempDir, 'non-existent-skill'), false);
    });

    it('handles "keep" action by preserving existing directory and skipping changes', async () => {
      const skillDir = path.join(tempDir, 'my-skill');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), 'original content');

      const res = await SkillCollisionResolver.resolve(tempDir, 'my-skill', 'keep');
      assert.equal(res.action, 'keep');
      assert.equal(res.finalSkillName, 'my-skill');

      const content = await fs.promises.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
      assert.equal(content, 'original content');
    });

    it('handles "overwrite" action with automated timestamped backup creation', async () => {
      const skillDir = path.join(tempDir, 'my-skill');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), 'v1-original-content');

      const res = await SkillCollisionResolver.resolve(tempDir, 'my-skill', 'overwrite');
      assert.equal(res.action, 'overwrite');
      assert.ok(res.backupDir, 'Must generate backupDir');
      assert.ok(fs.existsSync(res.backupDir), 'Backup directory must exist on disk');

      const backupContent = await fs.promises.readFile(path.join(res.backupDir, 'SKILL.md'), 'utf8');
      assert.equal(backupContent, 'v1-original-content');

      // The original target folder exists fresh and empty
      assert.ok(fs.existsSync(res.destinationDir));
    });

    it('handles "rename" action by rewriting SKILL.md frontmatter name and creating new dir', async () => {
      const originalSkillContent = '---\nname: base-skill\ndescription: Base description\nlicense: MIT\n---\n# Body';
      const res = await SkillCollisionResolver.resolve(
        tempDir,
        'base-skill',
        'rename',
        'custom-renamed-skill',
        originalSkillContent
      );

      assert.equal(res.action, 'rename');
      assert.equal(res.finalSkillName, 'custom-renamed-skill');
      assert.ok(res.destinationDir.endsWith('custom-renamed-skill'));
      assert.ok(fs.existsSync(res.destinationDir));

      assert.ok(res.modifiedSkillContent);
      assert.ok(res.modifiedSkillContent.includes('name: custom-renamed-skill'));
    });

    it('rejects invalid names when renaming during collision resolution', async () => {
      await assert.rejects(
        () => SkillCollisionResolver.resolve(tempDir, 'base-skill', 'rename', 'INVALID_NAME_UPPERCASE'),
        (err) => {
          assert.equal(err.code, 'INVALID_SKILL_NAME');
          return true;
        }
      );
    });
  });

  describe('In-Memory Pre-Inspection & Lifecycle Management (SkillManagerService)', () => {
    let registry;
    let service;

    beforeEach(async () => {
      registry = new SkillRegistry({ workspaceDir: tempDir });
      await registry.discoverAll();
      service = new SkillManagerService(registry);
    });

    it('pre-inspects valid package in-memory without writing to disk', () => {
      const files = [
        {
          path: 'SKILL.md',
          content: '---\nname: preinspect-skill\ndescription: In-memory pre-inspection test\nlicense: Apache-2.0\nallowed-tools: [PageScraper]\nmetadata:\n  author: Academic Team\n---\n# Body'
        },
        { path: 'references/doc.md', content: 'Doc' }
      ];

      const inspection = service.inspectPackage(files, 'workspace', tempDir);
      assert.equal(inspection.valid, true);
      assert.equal(inspection.name, 'preinspect-skill');
      assert.equal(inspection.description, 'In-memory pre-inspection test');
      assert.equal(inspection.author, 'Academic Team');
      assert.equal(inspection.license, 'Apache-2.0');
      assert.deepEqual(inspection.allowedTools, ['PageScraper']);
      assert.equal(inspection.hasScripts, false);
      assert.equal(inspection.hasCollision, false);

      // Verify no files were written to disk
      assert.equal(fs.existsSync(path.join(tempDir, 'preinspect-skill')), false);
    });

    it('flags executable scripts with warning telemetry in pre-inspection', () => {
      const files = [
        {
          path: 'SKILL.md',
          content: '---\nname: script-skill\ndescription: Skill with scripts\n---\n# Body'
        },
        { path: 'scripts/evaluate.py', content: 'print("Evaluating")' },
        { path: 'scripts/run.sh', content: '#!/bin/bash\necho "Running"' }
      ];

      const inspection = service.inspectPackage(files, 'workspace', tempDir);
      assert.equal(inspection.valid, true);
      assert.equal(inspection.hasScripts, true);
      assert.equal(inspection.scriptFiles.length, 2);
      assert.ok(inspection.scriptFiles.includes('scripts/evaluate.py'));
      assert.ok(inspection.scriptFiles.includes('scripts/run.sh'));
    });

    it('detects naming collisions against existing registry packages', () => {
      const files = [
        {
          path: 'SKILL.md',
          content: '---\nname: collision-skill\ndescription: First install\n---\n# Body'
        }
      ];

      // Simulate existing skill folder in tempDir
      const existingFolder = path.join(tempDir, '.agents', 'skills', 'collision-skill');
      fs.mkdirSync(existingFolder, { recursive: true });
      fs.writeFileSync(path.join(existingFolder, 'SKILL.md'), files[0].content);

      const inspection = service.inspectPackage(files, 'workspace', path.join(tempDir, '.agents', 'skills'));
      assert.equal(inspection.hasCollision, true);
    });

    it('manages 5-state lifecycle badges and 1-click enable/disable toggle', async () => {
      // Create a test skill on disk
      const skillDir = path.join(tempDir, '.agents', 'skills', 'lifecycle-test');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: lifecycle-test\ndescription: Lifecycle badge testing\n---\n# Body'
      );

      await registry.discoverAll();
      assert.ok(registry.hasSkill('lifecycle-test'));

      // 1. Initial states: installed + enabled
      let detailed = await service.listSkillsDetailed();
      let item = detailed.find(s => s.name === 'lifecycle-test');
      assert.ok(item);
      assert.ok(item.states.includes('installed'));
      assert.ok(item.states.includes('enabled'));
      assert.equal(item.isEnabled, true);

      // 2. Toggle disable
      const newEnabled = service.toggleSkillEnabled('lifecycle-test');
      assert.equal(newEnabled, false);
      detailed = await service.listSkillsDetailed();
      item = detailed.find(s => s.name === 'lifecycle-test');
      assert.equal(item.isEnabled, false);
      assert.ok(!item.states.includes('enabled'));

      // 3. Update contextual states: selected and active
      service.updateContextualStates(['lifecycle-test'], ['lifecycle-test']);
      detailed = await service.listSkillsDetailed();
      item = detailed.find(s => s.name === 'lifecycle-test');
      assert.ok(item.states.includes('selected'));
      assert.ok(item.states.includes('active'));
    });

    it('imports skill successfully and exports clean standard .zip archive', async () => {
      const files = [
        {
          path: 'SKILL.md',
          content: '---\nname: exportable-skill\ndescription: Exportable skill package\n---\n# Body\nAnalytical instructions.'
        },
        { path: 'references/matrix.md', content: '# Matrix\nRow 1' }
      ];

      const zipBuf = createZipArchive(files.map(f => ({ relativePath: f.path, content: f.content })));

      // Import into workspace
      const importResult = await service.importSkill(zipBuf, {
        scope: 'workspace',
        collisionAction: 'overwrite',
        workspaceDir: tempDir
      });

      assert.equal(importResult.success, true);
      assert.equal(importResult.skillName, 'exportable-skill');

      // Export from service
      const exportResult = await service.exportSkill('exportable-skill');
      assert.equal(exportResult.filename, 'exportable-skill.zip');
      assert.ok(Buffer.isBuffer(exportResult.buffer));

      // Re-read exported zip
      const reExtracted = readZipArchive(exportResult.buffer);
      assert.equal(reExtracted.length, 2);
      const reSkill = reExtracted.find(f => f.relativePath === 'SKILL.md');
      assert.ok(reSkill);
      assert.ok(reSkill.content.toString('utf8').includes('name: exportable-skill'));
    });

    it('dynamically excludes disabled skills from Tier 1 catalog summaries and prevents activation', async () => {
      // 1. Register a skill
      const skillDir = path.join(tempDir, 'active-disable-test');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: active-disable-test\ndescription: Test skill for disable\n---\n# Guide'
      );

      const pkg = await loadSkillPackage(skillDir, 'workspace');
      registry.registerDynamic(pkg);

      // Initially enabled: listed in Tier 1 summaries
      const initialSummaries = registry.listSummaries();
      assert.ok(initialSummaries.some(s => s.name === 'active-disable-test'));

      // Toggle disabled via service
      service.toggleSkillEnabled('active-disable-test', false);
      assert.equal(registry.isSkillEnabled('active-disable-test'), false);

      // Dynamically excluded from Tier 1 catalog summaries
      const filteredSummaries = registry.listSummaries();
      assert.ok(!filteredSummaries.some(s => s.name === 'active-disable-test'));

      // Can still be retrieved if explicitly including disabled
      const allSummaries = registry.listSummaries({ includeDisabled: true });
      assert.ok(allSummaries.some(s => s.name === 'active-disable-test'));

      // ActivationManager rejects activation of disabled skills
      const activationManager = new SkillActivationManager(registry);
      const preActivated = await activationManager.preActivateSkills(['active-disable-test']);
      assert.equal(preActivated.length, 0);

      const res = await activationManager.handleActivateSkillToolCall({ name: 'active-disable-test' });
      assert.equal(res.success, false);
      assert.equal(res.error, 'SKILL_DISABLED');
    });

    it('ensures active running sessions remain isolated from on-disk collision modifications via in-memory snapshots', async () => {
      // 1. Create a skill on disk with a reference doc
      const skillDir = path.join(tempDir, 'running-session-skill');
      const refsDir = path.join(skillDir, 'references');
      await fs.promises.mkdir(refsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: running-session-skill\ndescription: Running session skill\n---\n# Original Version 1'
      );
      await fs.promises.writeFile(
        path.join(refsDir, 'guide.md'),
        '# Original Guide V1: Critical analytical procedures'
      );

      const pkg = await loadSkillPackage(skillDir, 'workspace');
      registry.registerDynamic(pkg);

      // 2. Active session activates the skill
      const activationManager = new SkillActivationManager(registry);
      const preActivated = await activationManager.preActivateSkills(['running-session-skill']);
      assert.equal(preActivated.length, 1);
      assert.ok(preActivated[0].shieldedContent.includes('Original Version 1'));

      // Read resource once to snapshot into in-memory cache
      const initialResource = await loadSkillResource(pkg, 'references/guide.md');
      assert.ok(initialResource.includes('Original Guide V1'));

      // Service records active snapshot
      service.snapshotActiveSkill(pkg);

      // 3. User performs a collision overwrite on disk while session is running
      const collisionResult = await SkillCollisionResolver.resolve(
        tempDir,
        'running-session-skill',
        'overwrite'
      );
      assert.ok(collisionResult.backupDir);

      // Mutate or write completely different content to the overwritten folder on disk
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: running-session-skill\ndescription: Completely new V2\n---\n# Overwritten V2'
      );
      await fs.promises.mkdir(path.join(skillDir, 'references'), { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'references', 'guide.md'),
        '# Overwritten Guide V2'
      );

      // 4. Verify running session remains isolated: reads from in-memory snapshot
      const isolatedResource = await loadSkillResource(pkg, 'references/guide.md');
      assert.equal(isolatedResource, '# Original Guide V1: Critical analytical procedures');
      assert.ok(preActivated[0].shieldedContent.includes('Original Version 1'));

      const sessionSnapshot = service.getSessionSnapshot('running-session-skill');
      assert.ok(sessionSnapshot);
      assert.equal(sessionSnapshot.name, 'running-session-skill');
    });
  });

  describe('Official Bundled Launch Skills Validation', () => {
    const rootSkillsDir = path.resolve(__dirname, '..', '..', 'skills');

    it('validates academic-paper-analysis launch skill package and references', async () => {
      const skillPath = path.join(rootSkillsDir, 'academic-paper-analysis');
      assert.ok(fs.existsSync(skillPath), 'skills/academic-paper-analysis must exist');

      const pkg = await loadSkillPackage(skillPath, 'builtin');
      assert.equal(pkg.name, 'academic-paper-analysis');
      assert.ok(pkg.frontmatter.description.length > 20);
      assert.equal(pkg.frontmatter.license, 'Apache-2.0');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['PageScraper', 'MultiSearchProvider']);
      assert.equal(pkg.frontmatter.metadata?.category, 'science');

      // Check references
      const methodologyDoc = await loadSkillResource(pkg, 'references/methodology-audit.md');
      assert.ok(methodologyDoc.length > 100);
      assert.ok(methodologyDoc.includes('Experimental Controls & Baselines'));

      const ablationDoc = await loadSkillResource(pkg, 'references/ablation-checklist.md');
      assert.ok(ablationDoc.length > 100);
      assert.ok(ablationDoc.includes('Ablation Study Verification Checklist'));
    });

    it('validates competitive-market-intelligence launch skill package and references', async () => {
      const skillPath = path.join(rootSkillsDir, 'competitive-market-intelligence');
      assert.ok(fs.existsSync(skillPath), 'skills/competitive-market-intelligence must exist');

      const pkg = await loadSkillPackage(skillPath, 'builtin');
      assert.equal(pkg.name, 'competitive-market-intelligence');
      assert.ok(pkg.frontmatter.description.length > 20);
      assert.equal(pkg.frontmatter.license, 'Apache-2.0');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['PageScraper', 'MultiSearchProvider']);
      assert.equal(pkg.frontmatter.metadata?.category, 'business');

      // Check references
      const featureMatrixDoc = await loadSkillResource(pkg, 'references/feature-matrix-template.md');
      assert.ok(featureMatrixDoc.length > 100);
      assert.ok(featureMatrixDoc.includes('Competitive Feature Matrix Template'));

      const swotDoc = await loadSkillResource(pkg, 'references/swot-framework.md');
      assert.ok(swotDoc.length > 100);
      assert.ok(swotDoc.includes('Evidence-Grounded SWOT Analysis Framework'));
    });
  });
});
