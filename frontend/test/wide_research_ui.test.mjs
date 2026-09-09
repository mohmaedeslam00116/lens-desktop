import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildResearchStartPayload } from '../src/utils/researchRequest.mjs';
import { resolveReportTelemetry } from '../src/utils/reportTelemetry.mjs';

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

  it('exposes distinct Wide Research controls and transparent 100-to-200 budget guidance', async () => {
    const composer = await readFile(new URL('../src/components/vane/EmptyChatMessageInput.tsx', import.meta.url), 'utf8');
    assert.match(composer, /Wide Research/);
    assert.match(composer, /البحث الموسع/);
    assert.match(composer, /initial retrieval budget is up to 100 sources and may rise to 200/);
    assert.match(composer, /ميزانية الاسترجاع الأولية تصل إلى 100 مصدر/);
    assert.match(composer, /telemetry shows actual counts/);
  });

  it('selects two historical reports and verifies each displays its own telemetry instead of global telemetry', async () => {
    const historyReport1 = {
      id: 'report-1',
      query: 'Quantum computing hardware',
      content: 'Report 1 content',
      sources: [],
      createdAt: '2026-09-01T10:00:00Z',
      language: 'en',
      wideTelemetry: {
        initialBudget: 100,
        activeBudget: 100,
        maximumBudget: 200,
        retrievedCount: 98,
        expansion: null
      },
      wideExpansionHistory: []
    };

    const historyReport2 = {
      id: 'report-2',
      query: 'Topological quantum error correction',
      content: 'Report 2 content',
      sources: [],
      createdAt: '2026-09-02T10:00:00Z',
      language: 'en',
      wideTelemetry: {
        initialBudget: 100,
        activeBudget: 125,
        maximumBudget: 200,
        retrievedCount: 124,
        expansion: { from: 100, to: 125, reason: 'Evidence gap in surface code threshold' }
      },
      wideExpansionHistory: [
        {
          initialBudget: 100,
          activeBudget: 125,
          maximumBudget: 200,
          retrievedCount: 124,
          expansion: { from: 100, to: 125, reason: 'Evidence gap in surface code threshold' }
        }
      ]
    };

    // Latest global search telemetry from a subsequent or ongoing research stream
    const latestGlobalTelemetry = {
      initialBudget: 100,
      activeBudget: 150,
      maximumBudget: 200,
      retrievedCount: 148,
      expansion: { from: 125, to: 150, reason: 'Global latest search expansion' }
    };
    const latestGlobalExpansionHistory = [latestGlobalTelemetry];

    const history = [historyReport1, historyReport2];

    // 1. User selects Report 1 from history
    let activeReport = history.find(h => h.id === 'report-1');
    let displayed = resolveReportTelemetry(activeReport, latestGlobalTelemetry, latestGlobalExpansionHistory);

    assert.equal(displayed.wideTelemetry.activeBudget, 100);
    assert.equal(displayed.wideTelemetry.retrievedCount, 98);
    assert.equal(displayed.wideTelemetry.expansion, null);
    assert.equal(displayed.wideExpansionHistory.length, 0);

    // 2. User selects Report 2 from history
    activeReport = history.find(h => h.id === 'report-2');
    displayed = resolveReportTelemetry(activeReport, latestGlobalTelemetry, latestGlobalExpansionHistory);

    assert.equal(displayed.wideTelemetry.activeBudget, 125);
    assert.equal(displayed.wideTelemetry.retrievedCount, 124);
    assert.equal(displayed.wideTelemetry.expansion?.to, 125);
    assert.equal(displayed.wideExpansionHistory.length, 1);
    assert.equal(displayed.wideExpansionHistory[0].expansion?.reason, 'Evidence gap in surface code threshold');

    // 3. Verify App.tsx binds telemetry to activeReport
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.ok(
      appSource.includes('resolveReportTelemetry(activeReport'),
      'App.tsx must bind wideTelemetry to activeReport instead of global state'
    );
  });
});
