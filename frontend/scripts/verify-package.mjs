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
 * Probes are structural, not textual. Matching regexes against the extracted
 * text meant a package could satisfy every probe while implementing none of the
 * contracts: the names only had to survive somewhere in the file, and a stale
 * artifact that still *mentions* what it lost — in a comment, or in a string
 * kept for a log line — looks exactly like a working one. The probes below walk
 * the parsed syntax tree instead and require the construct the running code
 * needs: a real call, a real comparison, a real object literal in the shape the
 * engine reads back. Comments never become nodes and a bare string literal
 * satisfies nothing, so `test/package_gate.test.mjs` can build comment-only and
 * string-only archives and watch both be rejected.
 *
 * `@electron/asar` lists entries with backslashes on Windows and resolves them
 * with backslashes too, but rejects a leading separator, so entries are
 * normalized to `a\b\c` form before extraction.
 */
import { existsSync } from 'node:fs';
import { extractFile, listPackage } from '@electron/asar';
import ts from 'typescript';

const asarPath = process.argv[2] ?? 'dist-installer/win-unpacked/resources/app.asar';

if (!existsSync(asarPath)) {
  console.error(`No packaged archive at ${asarPath}. Run "npm run pack:unpacked" first.`);
  process.exit(1);
}

const entries = listPackage(asarPath);
/** Parses a packaged entry, or returns null when the package does not carry it. */
function parseEntry(needle) {
  const entry = entries.find(
    (candidate) => candidate.replace(/\\/g, '/').replace(/^\//, '') === needle
  );
  if (!entry) return null;
  const source = extractFile(asarPath, entry.replace(/^[\\/]/, '')).toString();
  return ts.createSourceFile(needle, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** The name a call is made through: `foo()` or `holder.foo()`. */
function calleeName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

/** True when the file calls a function or method by this name. */
function callsNamed(file, name) {
  let found = false;
  walk(file, (node) => {
    if (found || !ts.isCallExpression(node)) return;
    if (calleeName(node.expression) === name) found = true;
  });
  return found;
}

/**
 * True when some call receives this exact string as its first argument — the
 * shape every IPC channel name has, whatever method carries it.
 */
function callsWithChannel(file, channel) {
  let found = false;
  walk(file, (node) => {
    if (found || !ts.isCallExpression(node) || node.arguments.length === 0) return;
    const first = node.arguments[0];
    if (ts.isStringLiteral(first) && first.text === channel) found = true;
  });
  return found;
}

/** True when the file compares against this string, e.g. `code !== 'EADDRINUSE'`. */
function comparesAgainst(file, literal) {
  const equality = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken];
  let found = false;
  walk(file, (node) => {
    if (found || !ts.isBinaryExpression(node)) return;
    if (!equality.includes(node.operatorToken.kind)) return;
    const sides = [node.left, node.right];
    if (sides.some((side) => ts.isStringLiteral(side) && side.text === literal)) found = true;
  });
  return found;
}

/**
 * True when a payload handed to `JSON.stringify` carries this property with the
 * required initializer. Anchoring to the serialized object is what makes the
 * health contract real: a `pid` identifier anywhere else in the file, or the
 * same words inside a string, cannot satisfy it.
 */
function jsonPayloadCarries(file, propertyName, expected) {
  let found = false;
  walk(file, (node) => {
    if (found || !ts.isCallExpression(node)) return;
    if (node.expression.getText(file) !== 'JSON.stringify' || node.arguments.length === 0) return;
    const payload = node.arguments[0];
    if (!ts.isObjectLiteralExpression(payload)) return;
    for (const property of payload.properties) {
      if (!ts.isPropertyAssignment(property) || property.name.getText(file) !== propertyName) continue;
      const initializer = property.initializer;
      if (expected.string !== undefined && ts.isStringLiteral(initializer) && initializer.text === expected.string) {
        found = true;
      }
      if (expected.identifier !== undefined && ts.isIdentifier(initializer) && initializer.text === expected.identifier) {
        found = true;
      }
      if (
        expected.propertyAccess !== undefined &&
        ts.isPropertyAccessExpression(initializer) &&
        initializer.getText(file) === expected.propertyAccess
      ) {
        found = true;
      }
    }
  });
  return found;
}

/**
 * True when the preload exposes this nested path on the renderer bridge, e.g.
 * `exposeInMainWorld('electronAPI', { engine: { endpoint: ... } })`.
 */
function bridgeExposes(file, path) {
  let found = false;
  walk(file, (node) => {
    if (found || !ts.isCallExpression(node)) return;
    if (calleeName(node.expression) !== 'exposeInMainWorld') return;
    let current = node.arguments[1];
    for (const step of path) {
      if (!ts.isObjectLiteralExpression(current)) return;
      const property = current.properties.find(
        (candidate) => ts.isPropertyAssignment(candidate) && candidate.name.getText(file) === step
      );
      if (!property) return;
      current = property.initializer;
    }
    found = true;
  });
  return found;
}





const expectations = [
  {
    file: 'dist-electron/main.js',
    desc: 'Electron main process',
    probes: [
      ['single-instance lock (a second launch cannot start a rival engine)', (file) => callsNamed(file, 'requestSingleInstanceLock')],
      ['second-instance focus handler', (file) => callsWithChannel(file, 'second-instance')],
      ['port ownership surfaced instead of assumed (EADDRINUSE)', (file) => comparesAgainst(file, 'EADDRINUSE')],
      ['IPC bridge for the engine endpoint', (file) => callsWithChannel(file, 'engine-endpoint')],
    ],
  },
  {
    file: 'dist-electron/engine/server.js',
    desc: 'embedded research engine',
    probes: [
      ['engine identity payload', (file) => jsonPayloadCarries(file, 'engine', { string: 'LENS embedded research engine' })],
      ['health response reports owning pid', (file) => jsonPayloadCarries(file, 'pid', { propertyAccess: 'process.pid' })],
      ['bound port reported from the live address', (file) => jsonPayloadCarries(file, 'port', { identifier: 'boundPort' })],
    ],
  },
  {
    file: 'dist-electron/preload.js',
    desc: 'preload bridge',
    probes: [
      ['renderer receives the real engine endpoint', (file) => bridgeExposes(file, ['engine', 'endpoint'])],
      ['secure store bridge', (file) => callsWithChannel(file, 'secure-store-get')],
    ],
  },
];

let missing = 0;

// File-presence probes: entries that must exist in the package whatever
// their content (the syntax probes above cannot see them — e.g. the
// vendored Pi sources load through jiti at runtime, never through the
// compiled engine graph, so only presence is assertable here).
const requiredEntries = [
  {
    entry: 'dist-electron/vendor/pi/web-access/gemini-search.ts',
    desc: 'unified Pi Web Access search module in the packaged vendor tree',
  },
];
for (const { entry, desc } of requiredEntries) {
  const found = entries.some(
    (candidate) => candidate.replace(/\\/g, '/').replace(/^\//, '') === entry
  );
  if (!found) missing += 1;
  console.log(`  ${found ? 'OK  ' : 'MISS'} ${desc} (${entry})`);
}

for (const { file: entryPath, desc, probes } of expectations) {
  const file = parseEntry(entryPath);
  if (file === null) {
    console.error(`MISSING  ${entryPath} (${desc}) is not in the package`);
    missing += 1;
    continue;
  }
  console.log(`${entryPath} — ${desc} (${file.getFullText().length} bytes)`);
  for (const [label, probe] of probes) {
    let found = false;
    try {
      found = probe(file);
    } catch (err) {
      // A probe that cannot run against the packaged syntax is a miss, not a
      // pass: the gate exists to fail loudly, never to fail open.
      console.error(`  FAIL ${label}: probe could not run against the packaged syntax (${err.message})`);
    }
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
