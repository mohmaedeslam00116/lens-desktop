import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { WideResearchAgent, sanitizeCitationIndices } from '../dist-electron/engine/wideAgent.js';
import { MultiSearchProvider } from '../dist-electron/engine/search.js';

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

  it('aborts an already-running search when signal is aborted', async () => {
    const events = [];
    const controller = new AbortController();
    let searchStarted = false;
    let searchAborted = false;

    const dependencies = {
      search: async (query, provider, apiKeys, maxResults, signal) => {
        searchStarted = true;
        return new Promise((resolve, reject) => {
          if (signal?.aborted) {
            searchAborted = true;
            return reject(new DOMException('Aborted', 'AbortError'));
          }
          signal?.addEventListener('abort', () => {
            searchAborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    };

    const agent = new WideResearchAgent('wide-cancel-running', event => events.push(event), dependencies);

    const runPromise = agent.run({
      query: 'In-flight search cancellation',
      mode: 'wide',
      language: 'en',
      plan: approvedPlan,
    }, controller.signal);

    // Wait until search is actively running
    while (!searchStarted) {
      await new Promise(r => setImmediate(r));
    }
    assert.equal(searchStarted, true);

    // Abort the running search
    controller.abort('user cancellation');

    const result = await runPromise;
    assert.equal(result, undefined);
    assert.equal(searchAborted, true);
    assert.equal(events.some(event => event.type === 'finished'), false);
  });

  it('cancels searchDuckDuckGo promptly when response body stalls after headers', async () => {
    let headersSent = false;
    let serverAborted = false;
    let onHeadersSent;
    const headersSentPromise = new Promise((resolve) => { onHeadersSent = resolve; });
    let onServerAbort;
    const serverAbortedPromise = new Promise((resolve) => { onServerAbort = resolve; });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!DOCTYPE html><html><body><div class="result">');
      headersSent = true;
      onHeadersSent();

      req.on('close', () => {
        if (!res.writableEnded) {
          serverAborted = true;
          onServerAbort();
        }
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const endpoint = `http://127.0.0.1:${port}/search`;

    const controller = new AbortController();
    let searchError = null;
    const searchPromise = MultiSearchProvider.searchDuckDuckGo('quantum computing', 5, controller.signal, endpoint).catch((err) => {
      searchError = err;
    });

    await headersSentPromise;
    assert.equal(headersSent, true);

    controller.abort();

    await Promise.race([
      serverAbortedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Server abort timed out')), 2000)),
    ]);
    assert.equal(serverAborted, true);

    await searchPromise;
    assert.ok(searchError, 'Expected search to reject with AbortError');
    assert.ok(searchError.name === 'AbortError' || searchError.message?.includes('aborted'));

    await new Promise((resolve) => server.close(resolve));
  });

  it('preserves numeric Markdown links like [12](url) end-to-end in Wide Research when references count is small', async () => {
    const events = [];
    const dependencies = {
      search: async () => [
        { title: 'Doc 1', url: 'https://doc1.example/page', snippet: 'Evidence 1' },
      ],
      createPool: () => ({
        scrapeAll: async () => [
          {
            url: 'https://doc1.example/page',
            title: 'Doc 1',
            domain: 'doc1.example',
            content: 'Content about architecture and benchmarks. '.repeat(10),
            credibilityScore: 90,
          },
        ],
        getDeduplicationStats: () => ({
          totalSeen: 1,
          canonicalUnique: 1,
          exactDuplicates: 0,
          nearDuplicates: 0,
        }),
      }),
      synthesize: async () => ({
        report: 'According to [12](https://example.com/source), the architecture scales. Valid citation: [1]. Out of bounds: [99]. Normal link: [Docs](https://lens.dev).',
        references: [
          { index: 1, url: 'https://doc1.example/page', title: 'Doc 1', domain: 'doc1.example' },
        ],
        groundingVerification: {
          hallucinatedIndices: [],
          validIndices: [1],
          citedIndices: [1],
          deterministicVerification: true,
          zeroHallucinationGuaranteed: true,
        },
      }),
    };

    const agent = new WideResearchAgent('wide-md-links', event => events.push(event), dependencies);
    const result = await agent.run({
      query: 'Architecture benchmark',
      mode: 'wide',
      language: 'en',
      plan: approvedPlan,
    });

    assert.ok(result);
    // [12](https://example.com/source) must be preserved intact (not turned into (https://example.com/source))
    assert.ok(result.report.includes('[12](https://example.com/source)'), `Expected [12](https://example.com/source) in report, got: ${result.report}`);
    assert.ok(result.report.includes('[1]'), `Expected valid citation [1] in report, got: ${result.report}`);
    assert.ok(result.report.includes('[Docs](https://lens.dev)'), `Expected [Docs](https://lens.dev) in report, got: ${result.report}`);
    // Out-of-bounds unlinked [99] must be stripped
    assert.ok(!result.report.includes('[99]'), `Expected [99] to be stripped, got: ${result.report}`);
  });
});
