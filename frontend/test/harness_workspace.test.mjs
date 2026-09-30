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

describe('Lens harness shell contract', () => {
  it('connects the copied shell to existing research callbacks and the conditional inspector', async () => {
    const harness = await readFile(
      new URL('../src/components/harness/LensHarnessWorkspace.tsx', import.meta.url),
      'utf8',
    );

    assert.match(harness, /data-testid="lens-harness"/);
    // Ticket #145: the composer routes by interaction kind — agentic default,
    // Deep Research opt-in — instead of the single onStartResearch entry.
    assert.match(harness, /onStartAgentRun/);
    assert.match(harness, /onStartDeepResearch/);
    assert.match(harness, /onSelectReport/);
    assert.match(harness, /HarnessArtifactInspector/);
    assert.match(harness, /isRailOpen/);
    assert.match(harness, /Toggle research history/);
    assert.doesNotMatch(harness, /Antigravity|Pull request|Terminal|Repository|Open IDE/);
  });

  it('defines wide, drawer, and narrow harness geometry with logical boundaries', async () => {
    const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

    assert.match(styles, /\.lens-harness/);
    assert.match(styles, /\.harness-rail/);
    assert.match(styles, /min-width:\s*1280px/);
    assert.match(styles, /border-inline-end/);
  });
});

describe('Harness default-workspace integration contract (ticket #145)', () => {
  it('makes the harness workspace the default surface and keeps retry visibility without synthetic agents', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const sidebar = await readFile(new URL('../src/components/vane/Sidebar.tsx', import.meta.url), 'utf8');

    assert.match(app, /<LensHarnessWorkspace/);
    assert.match(app, /updateNonTerminalAgentStatus\('retrying'\)/);
    assert.doesNotMatch(sidebar, /onOpenHarness|Workspace preview/);
  });

  it('keeps settings, command palette, and plan approval overlays available in the default workspace', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

    assert.match(app, /<SettingsModal/);
    assert.match(app, /<CommandPalette/);
    assert.match(app, /<PlanApprovalModal/);
  });

  it('terminates rejected live sessions and prevents mixed history state during a run', async () => {
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const harness = await readFile(new URL('../src/components/harness/LensHarnessWorkspace.tsx', import.meta.url), 'utf8');

    assert.doesNotMatch(app, /if \(ev\.code === 1008\) return/);
    assert.match(app, /ev\.code === 1008[\s\S]{0,500}setIsSearching\(false\)/);
    assert.match(app, /if \(isSearching\) return;/);
    assert.match(harness, /disabled=\{loading\}/);
  });
});
