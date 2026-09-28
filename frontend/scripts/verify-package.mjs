/**
 * Asserts that a packaged LENS build actually contains the behaviour the
 * sources declare, before the operator smoke test drives it.
 *
 * Reading the sources proves nothing about the artifact: electron-builder packs
 * whatever `dist/` and `dist-electron/` held at build time, so a stale or
 * partial package can still launch and look healthy. These probes read the
 * packaged bytes directly (the same app.asar the installed client loads) and
 * fail loudly when a build-staleness or packaging gap would otherwise be
 * discovered at runtime.
 *
 * `@electron/asar` lists entries with backslashes on Windows and resolves them
 * with backslashes too, but rejects a leading separator, so entries are
 * normalized to `a\b\c` form before extraction.
 */
import { existsSync } from 'node:fs';
import { extractFile, listPackage } from '@electron/asar';

const asarPath = process.argv[2] ?? 'dist-installer/win-unpacked/resources/app.asar';

if (!existsSync(asarPath)) {
  console.error(`No packaged archive at ${asarPath}. Run "npm run pack:unpacked" first.`);
  process.exit(1);
}

const entries = listPackage(asarPath);
const read = (needle) => {
  const entry = entries.find(
    (candidate) => candidate.replace(/\\/g, '/').replace(/^\//, '') === needle
  );
  if (!entry) return null;
  return extractFile(asarPath, entry.replace(/^[\\/]/, '')).toString();
};

const expectations = [
  {
    file: 'dist-electron/main.js',
    desc: 'Electron main process',
    probes: [
      ['single-instance lock (a second launch cannot start a rival engine)', /requestSingleInstance/],
      ['second-instance focus handler', /second-instance/],
      ['port ownership surfaced instead of assumed (EADDRINUSE)', /EADDRINUSE/],
      ['IPC bridge for the engine endpoint', /engine-endpoint/],
    ],
  },
  {
    file: 'dist-electron/engine/server.js',
    desc: 'embedded research engine',
    probes: [
      ['engine identity payload', /LENS embedded research engine/],
      ['health response reports owning pid', /pid:\s*process\.pid/],
      ['bound port reported from the live address', /boundPort/],
    ],
  },
  {
    file: 'dist-electron/preload.js',
    desc: 'preload bridge',
    probes: [
      ['renderer receives the real engine endpoint', /engine\s*:\s*\{[\s\S]{0,120}?endpoint/],
      ['secure store bridge', /secure-store-get/],
    ],
  },
];

let missing = 0;
for (const { file, desc, probes } of expectations) {
  const source = read(file);
  if (source === null) {
    console.error(`MISSING  ${file} (${desc}) is not in the package`);
    missing += 1;
    continue;
  }
  console.log(`${file} — ${desc} (${source.length} bytes)`);
  for (const [label, pattern] of probes) {
    const found = pattern.test(source);
    if (!found) missing += 1;
    console.log(`  ${found ? 'OK  ' : 'MISS'} ${label}`);
  }
}

console.log(
  missing === 0
    ? '\nPackaged artifact matches the declared behaviour.'
    : `\n${missing} expectation(s) missing from the packaged artifact.`
);
process.exit(missing === 0 ? 0 : 1);
