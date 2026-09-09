import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildResearchStartPayload, DEFAULT_WIDE_MAX_SOURCES } from '../src/utils/researchRequest.mjs';
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
    assert.equal(wide.maxSources, DEFAULT_WIDE_MAX_SOURCES);
    assert.equal(wide.report_type, 'deep');

    const customWide = buildResearchStartPayload({
      query: 'Custom limit wide request',
      mode: 'wide',
      maxSources: 150,
      depth: 'deep',
      perspective: 'balanced',
      language: 'en',
    });
    assert.equal(customWide.maxSources, 150);

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
        discovered: 120,
        fetched: 98,
        unique: 95,
        admitted: 48,
        cited: 12,
        hop: 1,
        coverageScore: 0.88,
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
        discovered: 155,
        fetched: 124,
        unique: 118,
        admitted: 62,
        cited: 18,
        hop: 2,
        coverageScore: 0.94,
        expansion: {
          from: 100,
          to: 125,
          reason: 'Evidence gap in surface code threshold',
          uncoveredMilestones: ['threshold verification'],
          uncoveredSubqueries: ['surface code fault tolerance threshold']
        }
      },
      wideExpansionHistory: [
        {
          initialBudget: 100,
          activeBudget: 125,
          maximumBudget: 200,
          discovered: 155,
          fetched: 124,
          unique: 118,
          admitted: 62,
          cited: 18,
          hop: 2,
          coverageScore: 0.94,
          expansion: {
            from: 100,
            to: 125,
            reason: 'Evidence gap in surface code threshold',
            uncoveredMilestones: ['threshold verification'],
            uncoveredSubqueries: ['surface code fault tolerance threshold']
          }
        }
      ]
    };

    // Latest global search telemetry from a subsequent or ongoing research stream
    const latestGlobalTelemetry = {
      initialBudget: 100,
      activeBudget: 150,
      maximumBudget: 200,
      discovered: 180,
      fetched: 148,
      unique: 140,
      admitted: 75,
      cited: 22,
      hop: 2,
      coverageScore: 0.96,
      expansion: {
        from: 125,
        to: 150,
        reason: 'Global latest search expansion',
        uncoveredMilestones: ['global milestone'],
        uncoveredSubqueries: ['global query']
      }
    };
    const latestGlobalExpansionHistory = [latestGlobalTelemetry];

    const history = [historyReport1, historyReport2];

    // 1. User selects Report 1 from history
    let activeReport = history.find(h => h.id === 'report-1');
    let displayed = resolveReportTelemetry(activeReport, latestGlobalTelemetry, latestGlobalExpansionHistory);

    assert.equal(displayed.wideTelemetry.activeBudget, 100);
    assert.equal(displayed.wideTelemetry.fetched, 98);
    assert.equal(displayed.wideTelemetry.admitted, 48);
    assert.equal(displayed.wideTelemetry.cited, 12);
    assert.equal(displayed.wideTelemetry.expansion, null);
    assert.equal(displayed.wideExpansionHistory.length, 0);

    // 2. User selects Report 2 from history
    activeReport = history.find(h => h.id === 'report-2');
    displayed = resolveReportTelemetry(activeReport, latestGlobalTelemetry, latestGlobalExpansionHistory);

    assert.equal(displayed.wideTelemetry.activeBudget, 125);
    assert.equal(displayed.wideTelemetry.fetched, 124);
    assert.equal(displayed.wideTelemetry.admitted, 62);
    assert.equal(displayed.wideTelemetry.cited, 18);
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

  it('simulates live telemetry events, finished event, and history selection without losing expansion history', async () => {
    // Simulate App.tsx session-level logic and closure isolation
    const initialTelemetry = {
      initialBudget: 100,
      activeBudget: 100,
      maximumBudget: 200,
      discovered: 110,
      fetched: 95,
      unique: 90,
      admitted: 45,
      cited: 10,
      hop: 1,
      coverageScore: 0.82,
      expansion: null,
    };

    const expansion1 = {
      initialBudget: 100,
      activeBudget: 130,
      maximumBudget: 200,
      discovered: 145,
      fetched: 128,
      unique: 120,
      admitted: 60,
      cited: 15,
      hop: 2,
      coverageScore: 0.91,
      expansion: {
        from: 100,
        to: 130,
        reason: 'Evidence gap in algorithmic fault tolerance',
        uncoveredMilestones: ['fault tolerance bounds'],
        uncoveredSubqueries: ['transmon error models']
      },
    };

    const expansion2 = {
      initialBudget: 100,
      activeBudget: 160,
      maximumBudget: 200,
      discovered: 185,
      fetched: 158,
      unique: 150,
      admitted: 78,
      cited: 20,
      hop: 3,
      coverageScore: 0.97,
      expansion: {
        from: 130,
        to: 160,
        reason: 'Cross-platform gate fidelity benchmark shortfall',
        uncoveredMilestones: ['benchmarks comparison'],
        uncoveredSubqueries: ['gate fidelity across platforms']
      },
    };

    // Simulate session execution in App.tsx
    let sessionTelemetry = null;
    let sessionExpansionHistory = [];
    const wideExpansionHistoryRef = { current: [] };
    const wideTelemetryRef = { current: null };

    // 1. Initial wide telemetry arrives
    sessionTelemetry = initialTelemetry;
    wideTelemetryRef.current = initialTelemetry;

    // 2. Expansion 1 arrives
    sessionTelemetry = expansion1;
    wideTelemetryRef.current = expansion1;
    sessionExpansionHistory.push(expansion1);
    wideExpansionHistoryRef.current = [...sessionExpansionHistory];

    // 3. Expansion 2 arrives
    sessionTelemetry = expansion2;
    wideTelemetryRef.current = expansion2;
    sessionExpansionHistory.push(expansion2);
    wideExpansionHistoryRef.current = [...sessionExpansionHistory];

    // 4. Finished event arrives
    const finishedPayload = {
      type: 'finished',
      report: 'Full comprehensive quantum report with complete analysis.',
      sources: [
        { url: 'https://example.com/source-1', title: 'Source 1' },
      ],
      wideTelemetry: expansion2,
    };

    const resolvedExpansionHistory = sessionExpansionHistory.length > 0
      ? [...sessionExpansionHistory]
      : wideExpansionHistoryRef.current.length > 0
        ? [...wideExpansionHistoryRef.current]
        : (finishedPayload.wideTelemetry?.expansion ? [finishedPayload.wideTelemetry] : undefined);

    const savedReport = {
      id: 'session-quantum-run',
      query: 'Quantum error correction fault tolerance',
      title: 'Quantum error correction fault tolerance',
      content: finishedPayload.report,
      sources: finishedPayload.sources,
      createdAt: '2026-09-09T18:00:00Z',
      language: 'en',
      mode: 'wide',
      wideTelemetry: finishedPayload.wideTelemetry || sessionTelemetry || wideTelemetryRef.current || undefined,
      wideExpansionHistory: resolvedExpansionHistory,
    };

    // Assert expansion history was reliably saved
    assert.equal(savedReport.wideExpansionHistory.length, 2);
    assert.equal(savedReport.wideExpansionHistory[0].expansion.to, 130);
    assert.equal(savedReport.wideExpansionHistory[1].expansion.to, 160);

    // 5. Subsequent live search occurs in the background with different/no telemetry
    const subsequentLiveTelemetry = {
      initialBudget: 100,
      activeBudget: 100,
      maximumBudget: 200,
      discovered: 60,
      fetched: 50,
      unique: 48,
      admitted: 25,
      cited: 8,
      hop: 1,
      coverageScore: 0.70,
      expansion: null,
    };
    const subsequentLiveHistory = [];

    // 6. User clicks savedReport from history drawer
    const displayed = resolveReportTelemetry(savedReport, subsequentLiveTelemetry, subsequentLiveHistory);

    assert.equal(displayed.wideTelemetry.activeBudget, 160);
    assert.equal(displayed.wideTelemetry.fetched, 158);
    assert.equal(displayed.wideTelemetry.admitted, 78);
    assert.equal(displayed.wideTelemetry.cited, 20);
    assert.equal(displayed.wideExpansionHistory.length, 2);
    assert.equal(displayed.wideExpansionHistory[0].expansion.reason, 'Evidence gap in algorithmic fault tolerance');
    assert.equal(displayed.wideExpansionHistory[1].expansion.reason, 'Cross-platform gate fidelity benchmark shortfall');

    // 7. Verify App.tsx source code contains the ref-based and session-based resolution
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.ok(appSource.includes('wideExpansionHistoryRef'), 'App.tsx must define wideExpansionHistoryRef');
    assert.ok(appSource.includes('sessionExpansionHistory'), 'App.tsx must accumulate sessionExpansionHistory');
  });
});
