import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  availableHarnessArtifacts,
  defaultHarnessArtifact,
  deriveHarnessSessionCard,
} = await jiti.import('../src/utils/harnessWorkspace.ts');

describe('Harness workspace model', () => {
  it('exposes only artifacts backed by research data', () => {
    const input = {
      plan: null,
      sources: [{ url: 'https://example.com', title: 'Source' }],
      report: '',
      graphNodes: [],
    };

    assert.deepEqual(availableHarnessArtifacts(input), ['evidence']);
    assert.equal(defaultHarnessArtifact(input), 'evidence');
  });

  it('orders available artifacts from plan through graph', () => {
    const input = {
      plan: { id: 'plan-1', objective: 'Verify the claim', milestones: [], suggestedSkills: [], estimatedScope: { targetSources: 1, maxHops: 1 } },
      sources: [{ url: 'https://example.com', title: 'Source' }],
      report: 'A sourced report',
      graphNodes: [{ id: 'root', label: 'Question', type: 'root', status: 'active' }],
    };

    assert.deepEqual(availableHarnessArtifacts(input), ['plan', 'evidence', 'report', 'graph']);
    assert.equal(defaultHarnessArtifact(input), 'plan');
  });

  it('derives retrying and failed session cards from actual renderer state', () => {
    assert.equal(
      deriveHarnessSessionCard({ loading: true, status: 'Reconnecting to live research…', error: '' })?.status,
      'retrying',
    );
    assert.equal(
      deriveHarnessSessionCard({ loading: false, status: '', error: 'Connection failed' })?.status,
      'failed',
    );
  });
});

describe('Harness artifact inspector contract', () => {
  it('renders only real artifact tabs and exposes a close action', async () => {
    const inspector = await readFile(
      new URL('../src/components/harness/HarnessArtifactInspector.tsx', import.meta.url),
      'utf8',
    );

    assert.match(inspector, /availableTabs\.map/);
    assert.match(inspector, /onClose/);
    assert.doesNotMatch(inspector, /Antigravity|Pull request|Terminal|Repository/);
  });
});
