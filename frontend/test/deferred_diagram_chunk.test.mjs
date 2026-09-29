import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The renderer's initial payload is dominated by the mermaid diagram runtimes,
 * which no session needs until it actually renders a diagram. That work is
 * split behind `React.lazy` in `components/vane/DiagramCanvas.tsx`, and the
 * split is invisible to every other check in this suite: a single ordinary
 * `import` of the diagram module from anywhere the shell reaches statically
 * would quietly fold ~680 KB back into the initial bundle, with no test, type
 * error, or build failure to show for it.
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

describe('deferred diagram chunk', () => {
  it('keeps the mermaid engine out of the initial bundle', async () => {
    const files = await collectSourceFiles(sourceRoot);
    assert.ok(files.length > 0, 'expected to find renderer source files');

    const staticMermaidImporters = [];
    const staticDiagramImporters = [];
    const dynamicDiagramImporters = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Ignore comments so documentation of the split is not read as an import.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const shortName = file.replace(/\\/g, '/').split('/src/')[1];

      if (/^\s*import\s[^;]*from\s+['"]mermaid['"]/m.test(code)) {
        staticMermaidImporters.push(shortName);
      }
      if (/^\s*import\s[^;]*from\s+['"][^'"]*MermaidDiagram['"]/m.test(code)) {
        staticDiagramImporters.push(shortName);
      }
      if (/import\(\s*['"][^'"]*MermaidDiagram['"]\s*\)/.test(code)) {
        dynamicDiagramImporters.push(shortName);
      }
    }

    // Only the diagram component itself may pull in the mermaid engine, and it
    // is reachable exclusively through the lazy boundary below.
    assert.deepEqual(
      staticMermaidImporters,
      ['components/vane/MermaidDiagram.tsx'],
      `The mermaid engine must be imported only by its own component; found: ${staticMermaidImporters.join(', ')}`
    );

    // A static import from any other module would re-inline the engine into
    // whatever chunk that module belongs to.
    assert.deepEqual(
      staticDiagramImporters,
      [],
      `MermaidDiagram must be loaded lazily, but is imported statically by: ${staticDiagramImporters.join(', ')}`
    );

    assert.deepEqual(
      dynamicDiagramImporters,
      ['components/vane/DiagramCanvas.tsx'],
      `The lazy diagram boundary must be the single dynamic importer; found: ${dynamicDiagramImporters.join(', ')}`
    );
  });

  it('routes every diagram surface through the lazy boundary', async () => {
    const files = await collectSourceFiles(sourceRoot);

    const directRenderers = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const shortName = file.replace(/\\/g, '/').split('/src/')[1];
      if (shortName === 'components/vane/DiagramCanvas.tsx') continue; // renders it for real
      // Match a JSX mount only: `<MermaidDiagram ... />`, `<MermaidDiagram>`, or
      // `<MermaidDiagram/>`. A bare `<MermaidDiagram` also matches the type
      // `MermaidDiagramProps`, which is a declaration rather than a mount.
      if (/<\s*MermaidDiagram[\s/>]/.test(source)) {
        directRenderers.push(shortName);
      }
    }

    assert.deepEqual(
      directRenderers,
      [],
      `Diagram surfaces must mount DiagramCanvas so the engine stays deferred; direct mounts found in: ${directRenderers.join(', ')}`
    );
  });
});
