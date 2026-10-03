import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPackage } from '@electron/asar';

/**
 * The packaged-artifact gate (`scripts/verify-package.mjs`) is only worth
 * running if it can fail. These cases drive it against synthetic archives built
 * on the spot, pinning the pass path and the failure codes instead of assuming
 * them: a gate that silently passes a stale artifact is worse than no gate,
 * because it launders staleness as proof.
 *
 * Both ways a stale artifact can still *look* current are covered. Its contract
 * names survive in comments (a note about what was removed), or they survive in
 * string literals (log lines, test fixtures, documentation strings) while the
 * behaviour is gone. Probes therefore read the parsed syntax tree, and the two
 * fixtures below are the proof: each one carries every contract name, keeps
 * every expected file present, and must still be rejected.
 *
 * Archives are built with the same `@electron/asar` the packager uses, so the
 * read path under test is the real one, not a stand-in.
 */

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const gateScript = join(projectRoot, 'scripts', 'verify-package.mjs');

// Every probe in the gate, present as executable code.
const COMPLETE_STUBS = {
  'dist-electron/main.js': [
    'const lock = app.requestSingleInstanceLock();',
    "app.on('second-instance', () => {});",
    "if (err.code === 'EADDRINUSE') { report(err); }",
    "ipcMain.handle('engine-endpoint', () => endpoint);",
  ].join('\n'),
  'dist-electron/engine/server.js': [
    "res.end(JSON.stringify({ engine: 'LENS embedded research engine', pid: process.pid, port: boundPort }));",
  ].join('\n'),
  'dist-electron/preload.js': [
    "contextBridge.exposeInMainWorld('lens', { engine: { endpoint: () => invoke('engine-endpoint') }, secret: () => invoke('secure-store-get') });",
  ].join('\n'),
  // Presence-only probe: the unified Pi search module rides the packaged
  // vendor tree (jiti-loaded at runtime, never in the compiled graph), so
  // the gate asserts the entry exists, not its syntax.
  'dist-electron/vendor/pi/web-access/gemini-search.ts': [
    'export async function search(query, options) {',
    '  return { provider: "duckduckgo", results: [] };',
    '}',
  ].join('\n'),
};

// The same probes, but every one of them survives only inside a comment: this
// is the shape of a stale artifact that still mentions the contract it lost.
const COMMENT_ONLY_STUBS = {
  'dist-electron/main.js': [
    '/* TODO: re-add app.requestSingleInstanceLock() */',
    "app.on('ready', () => {}); // second-instance focus handling was removed",
    '// EADDRINUSE handling removed',
    '// engine-endpoint bridge removed',
  ].join('\n'),
  'dist-electron/engine/server.js': [
    "res.end(JSON.stringify({ status: 'ok' })); // previously 'LENS embedded research engine'",
    '// pid: process.pid was dropped from the health payload',
    '// boundPort is no longer reported',
  ].join('\n'),
  'dist-electron/preload.js': [
    '// engine: { endpoint } and secure-store-get were dropped from the bridge',
  ].join('\n'),
};

// The same probes, every one of them surviving only inside a string literal:
// an artifact that kept the contract names for its logs, docs, or fixtures while
// the behaviour went away. Every file is still present, so nothing but the
// syntax-aware probes can catch it.
const STRING_ONLY_STUBS = {
  'dist-electron/main.js': [
    'const notes = [',
    '  "const lock = app.requestSingleInstanceLock();",',
    "  \"app.on('second-instance', () => {});\",",
    "  \"if (err.code === 'EADDRINUSE') { report(err); }\",",
    "  \"ipcMain.on('engine-endpoint', () => {});\",",
    "].join('\\n');",
  ].join('\n'),
  'dist-electron/engine/server.js': [
    'const notes = [',
    '  "res.end(JSON.stringify({ status: \'ok\', engine: \'LENS embedded research engine\', pid: process.pid, port: boundPort }));",',
    "].join('\\n');",
  ].join('\n'),
  'dist-electron/preload.js': [
    'const notes = "contextBridge.exposeInMainWorld(\'electronAPI\', { engine: { endpoint: engineEndpoint } })";',
    'const channels = "secure-store-get was exposed through ipcRenderer.invoke";',
  ].join('\n'),
};

describe('packaged-artifact gate (scripts/verify-package.mjs)', () => {
  let workDir;

  before(() => {
    workDir = mkdtempSync(join(tmpdir(), 'lens-package-gate-'));
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  async function buildStubArchive(name, files) {
    const root = join(workDir, name);
    const sourceDir = join(root, 'src');
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = join(sourceDir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    const asarPath = join(root, 'app.asar');
    await createPackage(sourceDir, asarPath);
    return asarPath;
  }

  function runGate(asarPath) {
    const result = spawnSync(process.execPath, [gateScript, asarPath], {
      encoding: 'utf8',
      cwd: projectRoot,
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('passes an archive that carries the declared behaviour in executable code', async () => {
    const asarPath = await buildStubArchive('complete', COMPLETE_STUBS);
    const { status, output } = runGate(asarPath);
    assert.equal(status, 0, `gate rejected a complete artifact:\n${output}`);
    assert.doesNotMatch(output, /\bMISS\b/);
    assert.match(output, /matches the declared behaviour/);
  });

  it('fails an archive whose probes survive only inside comments', async () => {
    const asarPath = await buildStubArchive('comment-only', COMMENT_ONLY_STUBS);
    const { status, output } = runGate(asarPath);
    assert.equal(status, 1, `gate passed a stale artifact:\n${output}`);
    assert.match(output, /10 expectation\(s\) missing/);
    assert.match(output, /MISS\s+single-instance lock/);
  });

  it('fails an archive whose probes survive only inside string literals', async () => {
    const asarPath = await buildStubArchive('string-only', STRING_ONLY_STUBS);
    const { status, output } = runGate(asarPath);
    assert.equal(status, 1, `gate passed an artifact that only names its contracts:\n${output}`);
    // Every expected file is present; only the behaviour is missing.
    assert.doesNotMatch(output, /MISSING/, `files should all be present:\n${output}`);
    assert.match(output, /10 expectation\(s\) missing/);
    assert.match(output, /MISS\s+single-instance lock/);
    assert.match(output, /MISS\s+engine identity payload/);
    assert.match(output, /MISS\s+secure store bridge/);
  });

  it('fails an archive that is missing a contract file', async () => {
    const asarPath = await buildStubArchive('missing-file', {
      'dist-electron/main.js': COMPLETE_STUBS['dist-electron/main.js'],
    });
    const { status, output } = runGate(asarPath);
    assert.equal(status, 1, `gate passed an incomplete artifact:\n${output}`);
    assert.match(output, /MISSING\s+dist-electron\/preload\.js/);
    assert.match(output, /MISSING\s+dist-electron\/engine\/server\.js/);
  });

  it('fails an archive carrying the behaviour but missing the vendor search module', async () => {
    // The compiled engine can look complete while the jiti-loaded vendor
    // tree never made it into the package — search would only fail when the
    // user tries it. The gate must catch that shape.
    const { ['dist-electron/vendor/pi/web-access/gemini-search.ts']: _dropped, ...withoutVendor } = COMPLETE_STUBS;
    const asarPath = await buildStubArchive('no-vendor-search', withoutVendor);
    const { status, output } = runGate(asarPath);
    assert.equal(status, 1, `gate passed an artifact without the vendor search module:\n${output}`);
    assert.match(output, /MISS.*unified Pi Web Access search module/);
  });

  it('fails loudly when no package exists yet', () => {
    const { status, output } = runGate(join(workDir, 'absent', 'app.asar'));
    assert.equal(status, 1);
    assert.match(output, /No packaged archive/);
    assert.match(output, /pack:unpacked/);
  });
});
