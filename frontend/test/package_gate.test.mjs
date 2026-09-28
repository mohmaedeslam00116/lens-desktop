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
 * on the spot, pinning the pass path, the comment-stripping rule, and the
 * failure codes instead of assuming them: a gate that silently passes a stale
 * artifact is worse than no gate, because it launders staleness as proof.
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
    assert.match(output, /9 expectation\(s\) missing/);
    assert.match(output, /MISS\s+single-instance lock/);
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

  it('fails loudly when no package exists yet', () => {
    const { status, output } = runGate(join(workDir, 'absent', 'app.asar'));
    assert.equal(status, 1);
    assert.match(output, /No packaged archive/);
    assert.match(output, /pack:unpacked/);
  });
});
