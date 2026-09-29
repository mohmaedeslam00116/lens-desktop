import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The report view is reachable only once a run has produced a report, but the
 * markdown pipeline behind it (react-markdown plus micromark/mdast/hast) was
 * carried in the initial bundle by a single static import in `MessageBox`. That
 * work is split behind `React.lazy` in `components/vane/ReportCanvas.tsx`, and
 * the split is invisible to every other check in this suite: one ordinary
 * `import` of the report module from anywhere the shell reaches statically
 * would fold the whole pipeline back into the initial bundle, with no test,
 * type error, or build failure to show for it.
 *
 * These assertions pin the source-level invariant that keeps the split honest.
 */
// `fileURLToPath` (not `.pathname`) because the checkout path contains spaces,
// which `.pathname` leaves percent-encoded and `readdir` then cannot open.
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
    } else if (/\.(tsx?|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('deferred report chunk', () => {
  it('keeps the markdown pipeline out of the initial bundle', async () => {
    const files = await collectSourceFiles(sourceRoot);
    assert.ok(files.length > 0, 'expected to find renderer source files');

    const staticPipelineImporters = [];
    const staticReportImporters = [];
    const dynamicReportImporters = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Ignore comments so documentation of the split is not read as an import.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const shortName = file.replace(/\\/g, '/').split('/src/')[1];

      if (/^\s*import\s[^;]*from\s+['"](react-markdown|remark-gfm)['"]/m.test(code)) {
        staticPipelineImporters.push(shortName);
      }
      if (/^\s*import\s[^;]*from\s+['"][^'"]*ReportRenderer['"]/m.test(code)) {
        staticReportImporters.push(shortName);
      }
      if (/import\(\s*['"][^'"]*ReportRenderer['"]\s*\)/.test(code)) {
        dynamicReportImporters.push(shortName);
      }
    }

    // Only the report component itself may pull in the markdown pipeline, and it
    // is reachable exclusively through the lazy boundary below.
    assert.deepEqual(
      staticPipelineImporters,
      ['components/vane/ReportRenderer.tsx'],
      `The markdown pipeline must be imported only by its own component; found: ${staticPipelineImporters.join(', ')}`
    );

    // A static import from any other module would re-inline the pipeline into
    // whatever chunk that module belongs to.
    assert.deepEqual(
      staticReportImporters,
      [],
      `ReportRenderer must be loaded lazily, but is imported statically by: ${staticReportImporters.join(', ')}`
    );

    assert.deepEqual(
      dynamicReportImporters,
      ['components/vane/ReportCanvas.tsx'],
      `The lazy report boundary must be the single dynamic importer; found: ${dynamicReportImporters.join(', ')}`
    );
  });

  it('routes the report surface through the lazy boundary', async () => {
    const files = await collectSourceFiles(sourceRoot);

    const directRenderers = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const shortName = file.replace(/\\/g, '/').split('/src/')[1];
      if (shortName === 'components/vane/ReportCanvas.tsx') continue; // renders it for real
      // Match a JSX mount only: `<ReportRenderer ... />`, `<ReportRenderer>`, or
      // `<ReportRenderer/>`. A bare `<ReportRenderer` also matches the type
      // `ReportRendererProps`, which is a declaration rather than a mount.
      if (/<\s*ReportRenderer[\s/>]/.test(source)) {
        directRenderers.push(shortName);
      }
    }

    assert.deepEqual(
      directRenderers,
      [],
      `The report surface must mount ReportCanvas so the pipeline stays deferred; direct mounts found in: ${directRenderers.join(', ')}`
    );
  });
});
