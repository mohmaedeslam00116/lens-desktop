/**
 * Vendors the three TypeScript pi ecosystem packages from node_modules into
 * frontend/electron/vendor/pi/<pkg>/ so the embedded engine can load them
 * through Node's native type stripping (Node refuses to strip types under
 * node_modules). Run after `npm install`:
 *
 *   node scripts/vendor-pi-packages.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nm = path.join(frontend, 'node_modules');
// Emit into dist-electron (the compiled engine's runtime tree) so the
// packaged desktop app and the test suite both resolve `../vendor/pi/` from
// dist-electron/engine/piPackages.js. The directory is git-ignored; the
// vendor step runs as part of `build:electron`.
const outRoot = path.join(frontend, 'dist-electron', 'vendor', 'pi');

const IGNORED = new Set([
  'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md',
  'banner.png', 'pi-web-fetch-demo.mp4', 'docs', 'test', 'tests',
]);

const MANIFEST = ['pi-web-access', 'pi-subagents', '@juicesharp/rpiv-todo'];

const result = {};

function copyTree(src, dst, stats) {
  const base = path.basename(src);
  if (IGNORED.has(base) || base.startsWith('.')) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      copyTree(path.join(src, e.name), path.join(dst, e.name), stats);
    }
    return;
  }
  if (!(src.endsWith('.ts') || src.endsWith('.mjs'))) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const data = fs.readFileSync(src);
  fs.writeFileSync(dst, data);
  stats.copied += 1;
  stats.bytes += data.length;
}

for (const pkg of MANIFEST) {
  const srcRoot = path.join(nm, pkg);
  // `web-access`, `subagents`, `rpiv-todo` — strip the npm `pi-` prefix so the
  // engine uses stable short entry paths independent of the npm package name.
  const rel = pkg.startsWith('@') ? pkg.slice(pkg.indexOf('/') + 1) : pkg.replace(/^pi-/, '');
  const dstRoot = path.join(outRoot, rel);
  const stats = { copied: 0, bytes: 0 };
  copyTree(srcRoot, dstRoot, stats);
  result[pkg] = stats;
  // Mark the vendored tree as ESM so the loader treats intra-package `.ts`
  // files (which use top-level await) as modules.
  fs.writeFileSync(path.join(dstRoot, 'package.json'), JSON.stringify({ type: 'module' }) + '\n');
}

console.log(JSON.stringify(result, null, 2));
console.log(`vendored under ${outRoot}`);