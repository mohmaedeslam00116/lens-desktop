import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildResearchStartPayload } from '../src/utils/researchRequest.mjs';

describe('Wide Research UI contract', () => {
  it('builds an explicit wide request with a server-bounded maximum', () => {
    const wide = buildResearchStartPayload({
      query: 'Test wide request',
      mode: 'wide',
      depth: 'deep',
      perspective: 'balanced',
      language: 'en',
    });
    assert.equal(wide.mode, 'wide');
    assert.equal(wide.maxSources, 200);
    assert.equal(wide.report_type, 'deep');

    const standard = buildResearchStartPayload({
      query: 'Test standard request',
      mode: 'standard',
      depth: 'storm',
      perspective: 'storm',
      language: 'en',
    });
    assert.equal(standard.mode, 'standard');
    assert.equal('maxSources' in standard, false);
  });

  it('exposes distinct Wide Research controls and the 100-to-200 guidance', async () => {
    const composer = await readFile(new URL('../src/components/vane/EmptyChatMessageInput.tsx', import.meta.url), 'utf8');
    assert.match(composer, /Wide Research/);
    assert.match(composer, /البحث الموسع/);
    assert.match(composer, /Starts with 100 sources and automatically expands to 200/);
    assert.match(composer, /يبدأ بـ 100 مصدر/);
  });
});
