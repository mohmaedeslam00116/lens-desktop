import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Ticket #140 — the engine hosts the official Pi AgentSession in-process per
 * ADR-0014. The seam under test is the single construction point: sessions are
 * built with the research-tools-only allow-list, LENS-owned discovery surfaces
 * (agent dir under userData, offline model runtime, keys as runtime overrides),
 * and an in-memory session manager. A guard test makes a second agent runtime
 * or a second construction call site a CI failure.
 *
 * The suite imports `dist-electron/` (repo law: build:electron precedes
 * `npm test`), so the host is exercised as the compiled artifact the app runs.
 */

const engineRoot = fileURLToPath(new URL('../dist-electron/engine/', import.meta.url));

// The seam under test. Fails (module not found) until the host exists.
const { __testSeams } = await import(pathToFileURL(join(engineRoot, 'agentSessionHost.js')).href);

const host = __testSeams.host;
const loadPiRuntime = __testSeams.loadPiRuntime;

// Research tools the session may be granted; the pi todo tool joins them.
const RESEARCH_TOOLS = ['web_search', 'source_check', 'fetch_content', 'get_search_content', 'todo'];
// Pi coding tools that must NEVER be granted to a research session.
const FORBIDDEN_TOOLS = ['read', 'write', 'edit', 'bash'];

describe('AgentSession host — ADR-0014 construction contract', () => {
  it('exposes exactly one construction seam', async () => {
    assert.equal(typeof host.createResearchSession, 'function');
    assert.equal(typeof host.SESSION_CONSTRUCTION_CALL_SITES, 'number');
    assert.ok(host.SESSION_CONSTRUCTION_CALL_SITES >= 1);
  });

  it('builds sessions through the pi runtime without network model access', async () => {
    const runtime = await loadPiRuntime();
    // allowModelNetwork must be false (the PI_OFFLINE equivalent): LENS
    // provisions providers itself and the runtime must never refresh catalogs.
    assert.equal(runtime.__offline, true);
  });

  it('grants only research tools — never coding tools', async () => {
    const granted = host.researchToolAllowList();
    assert.deepEqual([...granted].sort(), [...RESEARCH_TOOLS].sort());
    for (const tool of FORBIDDEN_TOOLS) {
      assert.equal(granted.includes(tool), false, `coding tool "${tool}" must never be granted`);
    }
  });

  it('keeps discovery under userData — never the user home pi dir', () => {
    const dir = host.resolveAgentDir();
    const home = homedir();
    assert.ok(dir.length > home.length);
    assert.ok(dir.startsWith(home + '\\' + '.lens') || dir.startsWith(home + '/.lens') || dir.includes('lens'),
      `agent dir must live under LENS-owned app data, got: ${dir}`);
    assert.equal(dir, join(home, '.lens', 'pi-agent'));
    assert.notEqual(dir, join(home, '.pi', 'agent'));
  });

  it('uses an in-memory session manager per construction', async () => {
    // Construct first: the probe reads the facts the last construction recorded.
    await host.createResearchSession({ sessionId: 't140-mem' });
    const probe = await host.describeLastConstruction();
    assert.equal(probe.sessionManagerKind, 'inMemory');
    assert.ok(probe.agentDir.includes('lens'));
    assert.equal(probe.modelNetwork, false);
  });

  it('constructs a real AgentSession end-to-end (no provider needed)', async () => {
    const hosted = await host.createResearchSession({
      sessionId: 't140-real',
      // No provider key: construction must not require one (admission guard is
      // a start-time concern, not a construction-time one).
    });
    assert.ok(hosted?.session, 'host returned no session');
    assert.equal(typeof hosted.session.subscribe, 'function');
    assert.equal(typeof hosted.session.prompt, 'function');
    assert.equal(typeof hosted.session.abort, 'function');
    assert.equal(typeof hosted.session.steer, 'function');
    // Truth-in-tests: what the runtime actually granted on the live session,
    // not what the allow-list constant declares. With no tool surface passed,
    // the granted set may be empty — but coding tools must be absent from
    // whatever IS granted (the absolute construction invariant).
    for (const tool of FORBIDDEN_TOOLS) {
      assert.equal(
        hosted.tools.includes(tool),
        false,
        `coding tool "${tool}" was actually granted on the live session`
      );
    }
  });
});

describe('AgentSession host - Pi ids drive the session (P2 Pi-only auth)', () => {
  it('exposes no LENS-to-Pi translation seam', async () => {
    assert.equal(typeof host.translateLensProviderId, 'undefined', 'the P2 cutover deletes the id-translation seam');
  });

  it("a Pi-stored 'google' key drives the session - never the preflight placeholder", async () => {
    // P2 regression shape: auth lives in Pi's `auth.json` (persisted via
    // `piAuth.savePiChatKey`), requests carry Pi ids only. The session pins
    // to the requested Pi provider and the stored key arms it — no
    // per-request overrides, no LENS `gemini` id anywhere.
    const ambient = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-agent-'));
    try {
      const { __testSeams: authSeams } = await import(
        pathToFileURL(join(engineRoot, 'piAuth.js')).href
      );
      await authSeams.savePiChatKey('google', 'test-key-sentinel', agentDir);
      const hosted = await host.createResearchSession({
        sessionId: 't-key-landing',
        agentDir,
        provider: 'google',
      });
      const model = hosted.session?.model ?? hosted.session?.agent?.state?.model;
      assert.ok(model, 'the live session carries a model');
      assert.equal(model.provider, 'google', "the session runs the REQUESTED provider, not ambient auth's pick");
      assert.notEqual(model.provider, 'lens-offline', 'a stored Pi key must not resolve to the offline placeholder');
      const facts = await host.describeLastConstruction();
      assert.equal(facts.offlineFallback, false, 'a stored Pi key counts as a configured provider');
      const auth = await host.describeLastAuth();
      assert.equal(auth.provider, model.provider, 'the probe reports the selected model provider');
      assert.equal(auth.keySource, 'existing', 'the stored Pi key arms the provider - not the preflight placeholder');
    } finally {
      if (ambient.GEMINI_API_KEY !== undefined) process.env.GEMINI_API_KEY = ambient.GEMINI_API_KEY;
      if (ambient.GOOGLE_API_KEY !== undefined) process.env.GOOGLE_API_KEY = ambient.GOOGLE_API_KEY;
    }
  });

  it('an explicit model name resolves inside the requested Pi provider', async () => {
    const ambient = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_API_KEY: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-agent-'));
    try {
      const { __testSeams: authSeams } = await import(
        pathToFileURL(join(engineRoot, 'piAuth.js')).href
      );
      await authSeams.savePiChatKey('google', 'test-key-sentinel', agentDir);
      const hosted = await host.createResearchSession({
        sessionId: 't-model-pick',
        agentDir,
        provider: 'google',
        modelName: 'gemini-2.5-flash',
      });
      const model = hosted.session?.model ?? hosted.session?.agent?.state?.model;
      assert.ok(model, 'the live session carries a model');
      assert.equal(model.provider, 'google');
      assert.match(String(model.id), /gemini-2\.5-flash/, 'the requested model id wins over provider defaults');
    } finally {
      if (ambient.GEMINI_API_KEY !== undefined) process.env.GEMINI_API_KEY = ambient.GEMINI_API_KEY;
      if (ambient.GOOGLE_API_KEY !== undefined) process.env.GOOGLE_API_KEY = ambient.GOOGLE_API_KEY;
    }
  });

  it('the LENS `gemini` id pins nothing (no translation backdoor)', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-agent-'));
    const hosted = await host.createResearchSession({
      sessionId: 't-no-translation',
      agentDir,
      provider: 'gemini',
    });
    const model = hosted.session?.model ?? hosted.session?.agent?.state?.model;
    assert.ok(model, 'the live session carries a model');
    assert.notEqual(model.provider, 'google', 'an untranslated LENS id must not resolve to the Pi provider');
  });
});

describe('pi-only guard — the sole agent runtime', () => {
  const srcRoot = fileURLToPath(new URL('../electron/', import.meta.url));

  async function collectSourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectSourceFiles(fullPath)));
      } else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  // Any import of a second agent/orchestration runtime under the engine source
  // is a spec violation the guard catches at CI time.
  const FORBIDDEN_RUNTIMES = [
    'langgraph', 'langchain', 'crewai', 'autogen', 'agent-sdk', 'openai-agents',
    'claude-agent-sdk', 'llamaindex', 'smolagents', 'pi-coding-agent/legacy',
  ];

  it('no engine source imports a second agent or orchestration runtime', async () => {
    const files = await collectSourceFiles(srcRoot);
    const offenders = [];
    for (const file of files) {
      const text = await readFileSync(file, 'utf8');
      for (const runtime of FORBIDDEN_RUNTIMES) {
        const specifier = new RegExp(`(from\\s*['"]|import\\s*\\(\\s*['"])\\S*${runtime}`, 'i');
        if (specifier.test(text)) offenders.push(`${file} -> ${runtime}`);
      }
    }
    assert.deepEqual(offenders, [], `second agent runtime imported:\n${offenders.join('\n')}`);
  });

  it('the session-construction seam is the only createAgentSession call site', async () => {
    const files = await collectSourceFiles(srcRoot);
    const offenders = [];
    for (const file of files) {
      if (file.endsWith('agentSessionHost.ts')) continue; // the seam itself
      const text = await readFileSync(file, 'utf8');
      if (/createAgentSession(FromServices|Services)?\s*\(/.test(text)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], `createAgentSession called outside the seam:\n${offenders.join('\n')}`);
  });

  it('the pi runtime loads through the ESM dynamic-import seam, not static import', async () => {
    const seamText = await readFileSync(join(srcRoot, 'engine', 'agentSessionHost.ts'), 'utf8');
    assert.match(seamText, /import\(/, 'the seam must dynamic-import the ESM-only runtime');
    assert.doesNotMatch(seamText, /from\s+['"]@earendil-works\/pi-coding-agent['"]/,
      'no static import of the ESM-only package from CJS-compiled engine');
  });
});
