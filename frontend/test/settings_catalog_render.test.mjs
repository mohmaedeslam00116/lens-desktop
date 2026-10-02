import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

/**
 * Track A — catalog-driven Settings, render proof (SPEC #155, ticket #156).
 *
 * Source pins prove deletions; this suite proves RENDERING: the pure
 * catalog components SSR-render every catalog entry — including a 9th Pi
 * id no hardcoded list ever named — with its Pi name and auth standing,
 * and the generic key input serves any catalog `keyField` with no
 * per-provider branches. Bundled at test time with the repo's esbuild;
 * no live engine, no network, fully deterministic.
 */

const NINTH_ID = 'xinfer';

const probeSource = (catalogPath) => `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderPills, SearchProviderKeyField } from ${JSON.stringify(catalogPath)};
const entries = [
  { id: 'google', name: 'Google', models: [], auth: { configured: true, source: 'file' } },
  { id: 'openai', name: 'OpenAI', models: [], auth: { configured: false, source: null } },
  { id: 'anthropic', name: 'Anthropic', models: [], auth: { configured: false, source: null } },
  { id: 'groq', name: 'Groq', models: [], auth: { configured: false, source: null } },
  { id: 'deepseek', name: 'DeepSeek', models: [], auth: { configured: false, source: null } },
  { id: 'openrouter', name: 'OpenRouter', models: [], auth: { configured: false, source: null } },
  { id: 'mistral', name: 'Mistral', models: [], auth: { configured: false, source: null } },
  { id: 'ollama', name: 'Ollama', models: [], auth: { configured: false, source: null } },
  { id: '${NINTH_ID}', name: 'Xinfer Future', models: [], auth: { configured: false, source: null } },
];
const pills = renderToStaticMarkup(
  React.createElement(ProviderPills, { entries, selectedId: '${NINTH_ID}', isArabic: false, onSelect: () => {} })
);
const keyed = renderToStaticMarkup(
  React.createElement(SearchProviderKeyField, {
    entry: { id: 'brave', name: 'Brave', badge: 'BYOK', descEn: '', descAr: '', keyField: 'brave' },
    value: '', isArabic: false, onChange: () => {},
  })
);
console.log(JSON.stringify({ pills, keyed }));
`;

let rendered = null;

before(() => {
  const dir = mkdtempSync(join(tmpdir(), 'lens-settings-catalog-'));
  const catalogPath = join(process.cwd(), 'src', 'components', 'SettingsCatalog.tsx');
  const entry = join(dir, 'probe.tsx');
  const outfile = join(dir, 'probe.cjs');
  writeFileSync(entry, probeSource(catalogPath.split('\\').join('/')));
  buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    jsx: 'automatic',
    logLevel: 'silent',
    absWorkingDir: process.cwd(),
    // node_modules stay external: the probe runs from a tmpdir outside the
    // package tree, so the child resolves them through NODE_PATH below.
    packages: 'external',
  });
  const out = execFileSync(process.execPath, [outfile], {
    encoding: 'utf-8',
    env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
  });
  rendered = JSON.parse(out);
});

describe('Catalog components render every entry (Track A render proof)', () => {
  it('a catalog provider outside the old 8 renders a pill with Pi name + standing', () => {
    assert.ok(rendered, 'the probe rendered');
    // NOTE: React strips `key={entry.id}` from static markup, so the proof
    // asserts rendered content (Pi name + standing), not the id string.
    assert.match(rendered.pills, /Xinfer Future/, 'the 9th entry renders its Pi name');
    assert.match(rendered.pills, /Needs key/, 'the pill carries auth standing');
    assert.match(rendered.pills, /Ready/, 'a configured entry renders its standing');
    for (const name of ['Google', 'OpenAI', 'Anthropic', 'Groq', 'DeepSeek', 'OpenRouter', 'Mistral', 'Ollama']) {
      assert.match(rendered.pills, new RegExp(name), `${name} still renders`);
    }
  });

  it('the generic key input serves any catalog keyField with no per-provider branch', () => {
    assert.ok(rendered, 'the probe rendered');
    assert.match(rendered.keyed, /Brave API Key/, 'the label names the catalog entry');
    assert.match(rendered.keyed, /brave\.\.\./, 'the placeholder derives from the keyField, not a literal map');
  });
});
