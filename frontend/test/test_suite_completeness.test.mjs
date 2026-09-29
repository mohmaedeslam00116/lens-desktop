import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

/**
 * The suite is launched from an explicit file list in `package.json`, so a test
 * file that nobody added to that list would pass review and never run. This
 * guard keeps the manifest and the directory in lockstep in both directions.
 */
describe('npm test manifest completeness', () => {
  it('lists every test file in the directory and references no missing file', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    );
    const testScript = packageJson.scripts?.test;

    assert.equal(typeof testScript, 'string', 'package.json scripts.test must exist');

    const filesOnDisk = (await readdir(new URL('.', import.meta.url)))
      .filter((name) => name.endsWith('.test.mjs'))
      .sort();

    const listedFiles = [...testScript.matchAll(/test\/([A-Za-z0-9_.-]+\.test\.mjs)/g)]
      .map((match) => match[1])
      .sort();

    const neverRun = filesOnDisk.filter((name) => !listedFiles.includes(name));
    assert.deepEqual(neverRun, [], `Test files missing from the npm test manifest: ${neverRun.join(', ')}`);

    const missingFiles = listedFiles.filter((name) => !filesOnDisk.includes(name));
    assert.deepEqual(missingFiles, [], `npm test references missing files: ${missingFiles.join(', ')}`);

    const duplicates = listedFiles.filter((name, index) => listedFiles.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], `npm test lists a test file twice: ${duplicates.join(', ')}`);
  });
});

/**
 * A declared script is an entry point: CI and operators invoke it by name, so a
 * script whose file was never committed works on the machine that wrote it and
 * fails on every fresh clone. This asserts every local path a script hands to
 * Node actually exists, so the gap surfaces in the suite rather than in CI.
 */
describe('npm script entry points exist', () => {
  it('resolves every script file referenced by package.json', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    );

    const referenced = new Set();
    for (const command of Object.values(packageJson.scripts ?? {})) {
      for (const match of String(command).matchAll(
        /(?:^|\s)node\s+(?!-)(?:"([^"]+)"|'([^']+)'|([^\s&|;]+\.mjs|\/))(?=\s|$)/g
      )) {
        const target = match[1] ?? match[2] ?? match[3];
        if (target && !target.startsWith('-')) referenced.add(target);
      }
    }

    const missingFiles = [];
    for (const target of referenced) {
      if (target.includes('$')) continue; // inline -e/-p programs, not paths
      try {
        await readFile(new URL(`../${target}`, import.meta.url));
      } catch {
        missingFiles.push(target);
      }
    }

    assert.deepEqual(
      missingFiles.sort(),
      [],
      `package.json scripts reference files that do not exist: ${missingFiles.join(', ')}`
    );
  });
});
