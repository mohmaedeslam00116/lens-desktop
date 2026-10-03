/**
 * Fails the build early when the unified Pi Web Access search module is
 * missing from the packaged vendor tree — instead of letting the app start
 * and only revealing the gap when the user tries to search.
 *
 * Run as part of `build:electron` (after vendor-pi-packages.mjs).
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorRoot = join(frontend, 'dist-electron', 'vendor', 'pi', 'web-access');

const REQUIRED = ['gemini-search.ts'];

let missing = 0;
for (const entry of REQUIRED) {
  const abs = join(vendorRoot, entry);
  if (!existsSync(abs)) {
    console.error(
      `[verify-vendor-search] MISSING ${abs} — Pi Web Access search module missing from packaged vendor tree. Run node scripts/vendor-pi-packages.mjs.`
    );
    missing += 1;
  } else {
    console.log(`[verify-vendor-search] OK ${entry}`);
  }
}

if (missing > 0) {
  console.error(`[verify-vendor-search] ${missing} required vendor search module(s) missing.`);
  process.exit(1);
}
console.log('[verify-vendor-search] packaged vendor search tree complete.');
