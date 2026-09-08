import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WideResearchAgent } from '../dist-electron/engine/wideAgent.js';

const approvedPlan = {
  id: 'wide-plan-1',
  version: 1,
  objective: 'Test a wide research run',
  milestones: [
    { id: 'm-1', query: 'wide research architecture', rationale: 'architecture', status: 'pending' },
    { id: 'm-2', query: 'wide research evidence', rationale: 'evidence', status: 'pending' },
  ],
  suggestedSkills: [],
  estimatedScope: { targetSources: 100, maxHops: 2 },
  status: 'approved',
};

function createPage(index) {
  return {
    url: `https://source-${index}.example/article-${index}`,
    title: `Source ${index}`,
    domain: `source-${index}.example`,
    credibilityScore: 80 + (index % 20),
    content: `Evidence ${index} about wide research architecture and evidence coverage. `.repeat(20),
  };
}

function createDependencies({ coverageScore = 0.95, sourceCount = 200 } = {}) {
  const poolCalls = [];
  let searchCall = 0;
  const pages = Array.from({ length: sourceCount }, (_, index) => createPage(index + 1));

  return {
    poolCalls,
    dependencies: {
      search: async () => {
        const start = searchCall++ * 25;
        return pages.slice(start, start + 25).map(page => ({
          url: page.url,
          title: page.title,
          snippet: page.content.slice(0, 80),
        }));
      },
      createPool: () => ({
        scrapeAll: async (urls, { onProgress } = {}) => {
          poolCalls.push(urls);
          const result = pages.filter(page => urls.includes(page.url));
          result.forEach((page, index) => onProgress?.(index + 1, urls.length, page));
          return result;
        },
        getDeduplicationStats: () => ({
          urlDuplicates: 0,
          exactContentDuplicates: 0,
          nearDuplicates: 0,
          admitted: sourceCount,
        }),
      }),
      rankPassages: async (sources, milestones) => sources.map((source, index) => ({
        id: `chunk-${index + 1}`,
        milestoneId: milestones[index % milestones.length].id,
        text: source.content.slice(0, 500),
        sourceUrl: source.url,
        sourceDomain: source.domain,
        score: 1 - index / 1000,
      })),
      admitEvidence: (candidates, milestones) => ({
        admittedChunks: candidates.slice(0, 24),
        coverageAudit: {
          overallScore: coverageScore,
          subqueryScore: coverageScore,
          aspectScore: coverageScore,
          metricScore: coverageScore,
          diversityScore: coverageScore,
          uncoveredSubqueries: coverageScore < 0.8 ? [milestones[0].query] : [],
        },
      }),
      synthesize: async ({ plan, evidence }) => ({
        report: `Grounded report for ${plan.objective} [1] [999]`,
        references: evidence.map((item, index) => ({
          index: index + 1,
          title: item.sourceDomain,
          url: item.sourceUrl,
          domain: item.sourceDomain,
          snippet: item.text,
          cited: index === 0,
        })),
        groundingVerification: {
          totalFoundInReport: 2,
          validCitations: 1,
          hallucinatedStripped: 1,
          deterministicVerification: true,
          citedIndices: [1],
        },
      }),
    },
  };
}

describe('WideResearchAgent', () => {
  it('rejects a missing approved plan before retrieval starts', async () => {
    let searched = false;
    const agent = new WideResearchAgent('wide-no-plan', () => {}, {
      search: async () => { searched = true; return []; },
    });

    await assert.rejects(
      agent.run({ query: 'No plan', mode: 'wide', language: 'en' }),
      /approved plan/i,
    );
    assert.equal(searched, false);
  });

  it('starts at 100 sources and completes without expansion when coverage is sufficient', async () => {
    const events = [];
    const { dependencies, poolCalls } = createDependencies({ coverageScore: 0.95 });
    const agent = new WideResearchAgent('wide-100', event => events.push(event), dependencies);

    const result = await agent.run({
      query: 'Wide run',
      mode: 'wide',
      language: 'en',
      plan: approvedPlan,
    });

    assert.equal(poolCalls.length, 1);
    assert.ok(poolCalls[0].length <= 100);
    const telemetry = events.filter(event => event.type === 'wide_telemetry');
    assert.equal(telemetry[0].wideTelemetry.initialBudget, 100);
    assert.equal(telemetry[0].wideTelemetry.activeBudget, 100);
    assert.equal(telemetry[0].wideTelemetry.maximumBudget, 200);
    assert.equal(telemetry.some(event => event.wideTelemetry.expansion), false);
    const finished = events.find(event => event.type === 'finished');
    assert.ok(finished);
    assert.equal(events.filter(event => event.type === 'finished').length, 1);
    assert.doesNotMatch(finished.report, /\[999\]/);
    assert.equal(result.report, finished.report);
    assert.deepEqual(result.telemetry, finished.wideTelemetry);
  });

  it('expands only for an evidence gap and never exceeds 200 sources', async () => {
    const events = [];
    const { dependencies, poolCalls } = createDependencies({ coverageScore: 0.45 });
    const agent = new WideResearchAgent('wide-expand', event => events.push(event), dependencies);

    await agent.run({
      query: 'Wide expansion',
      mode: 'wide',
      language: 'en',
      plan: approvedPlan,
    });

    assert.ok(poolCalls.length > 1);
    assert.ok(poolCalls.reduce((total, batch) => total + batch.length, 0) <= 200);
    const expansion = events.find(event => event.type === 'wide_telemetry' && event.wideTelemetry.expansion);
    assert.ok(expansion);
    assert.equal(expansion.wideTelemetry.expansion.from, 100);
    assert.ok(expansion.wideTelemetry.expansion.to <= 200);
    assert.ok(expansion.wideTelemetry.expansion.reason.length > 0);
  });

  it('does not emit a finished event after cancellation', async () => {
    const events = [];
    const { dependencies } = createDependencies();
    const controller = new AbortController();
    controller.abort('test cancellation');
    const agent = new WideResearchAgent('wide-cancelled', event => events.push(event), dependencies);

    const result = await agent.run({
      query: 'Cancelled wide run', mode: 'wide', language: 'en', plan: approvedPlan,
    }, controller.signal);

    assert.equal(result, undefined);
    assert.equal(events.some(event => event.type === 'finished'), false);
  });
});
