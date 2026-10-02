import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

/**
 * Budget-exhaustion terminal integrity (review findings #1–#2, #4).
 *
 * `budget_exhausted` is a MID-RUN retrieval warning from inside the fetch
 * wrapper — the run continues into its answer and explicit terminal. These
 * pins hold that law on both sides of the wire:
 *   - engine: only `finished`/`error`/`cancelled` evict the session, so the
 *     stream stays alive and every later event (answer chunks, the real
 *     terminal) is delivered;
 *   - feed: the reducer records the warning without freezing, so the run's
 *     real ending still lands;
 *   - researchers: concurrent fan-out lanes never mutate shared process.env.
 */

const { isAgenticRunTerminal } = await import('../dist-electron/engine/server.js');
const { createAgenticToolSurface } = await import('../dist-electron/engine/agenticSearch.js');
const { resetFetchLedger } = await import('../dist-electron/engine/fetchLedger.js');
const { reduceAgentRun, initialAgentRunState } = await import('../src/utils/agentRunFeed.mjs');

afterEach(() => {
  resetFetchLedger('s-budget-terminal');
});

describe('budget_exhausted is a mid-run warning, never a run terminal', () => {
  it('engine classification: only finished/error/cancelled evict the session', async () => {
    assert.equal(isAgenticRunTerminal('finished'), true);
    assert.equal(isAgenticRunTerminal('error'), true);
    assert.equal(isAgenticRunTerminal('cancelled'), true);
    assert.equal(isAgenticRunTerminal('budget_exhausted'), false, 'evicting on this drops the run’s real ending');
    assert.equal(isAgenticRunTerminal('report_chunk'), false);
    assert.equal(isAgenticRunTerminal('source'), false);
    assert.equal(isAgenticRunTerminal('status'), false);
  });

  it('a mid-run budget refusal does not swallow the answer or the finished terminal', async () => {
    resetFetchLedger('s-budget-terminal');
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };

    // Session router shaped exactly like the server's emitAgentEvent, but
    // evicting through the REAL production predicate — so this test pins the
    // production eviction rule, not a copy of it.
    const live = new Map([['s-budget-terminal', true]]);
    const delivered = [];
    const emitAgentEvent = (sessionId, event) => {
      if (!live.has(sessionId)) return;
      delivered.push(event);
      if (isAgenticRunTerminal(event.type)) live.delete(sessionId);
    };

    const surface = createAgenticToolSurface({
      sessionId: 's-budget-terminal',
      state,
      maxFetches: 1,
      emit: (event) => emitAgentEvent('s-budget-terminal', event),
      search: async () => [],
      fetchPage: async (url) => ({ url, title: url, text: `content for ${url}` }),
    });

    const first = await surface.handler({ name: 'fetch_content', arguments: { url: 'https://budget.example/one' } });
    assert.equal(first.success, true, 'the first fetch consumes the budget');
    const second = await surface.handler({ name: 'fetch_content', arguments: { url: 'https://budget.example/two' } });
    assert.equal(second.success, false, 'the second fetch is refused');
    assert.match(second.error ?? '', /budget/i);

    assert.ok(
      delivered.some((e) => e.type === 'budget_exhausted'),
      'the refusal is a visible mid-run warning'
    );

    // The run is NOT over: the answer streams and the runner terminates.
    emitAgentEvent('s-budget-terminal', { type: 'report_chunk', sessionId: 's-budget-terminal', chunk: 'The final answer.' });
    emitAgentEvent('s-budget-terminal', {
      type: 'finished', sessionId: 's-budget-terminal', state: 'completed',
      report: 'The final answer.', sources: [],
    });

    const types = delivered.map((e) => e.type);
    assert.ok(types.includes('report_chunk'), 'answer chunks after the warning are delivered');
    assert.ok(types.includes('finished'), 'the real terminal after the warning is delivered');
  });

  it('feed reducer: budget_exhausted records without freezing; the terminal still lands', async () => {
    let feed = reduceAgentRun(initialAgentRunState('s1'), { type: 'started', sessionId: 's1' });
    feed = reduceAgentRun(feed, { type: 'report_chunk', sessionId: 's1', chunk: 'partial ' });
    feed = reduceAgentRun(feed, { type: 'budget_exhausted', sessionId: 's1', message: 'cap reached' });
    assert.notEqual(feed.phase, 'budget_exhausted', 'the warning is not a phase');
    assert.equal(feed.phase, 'running', 'the run stays live through the warning');
    feed = reduceAgentRun(feed, { type: 'report_chunk', sessionId: 's1', chunk: 'answer.' });
    assert.equal(feed.reportText, 'partial answer.', 'later chunks still accumulate');
    feed = reduceAgentRun(feed, { type: 'finished', sessionId: 's1' });
    assert.equal(feed.phase, 'finished', 'the explicit terminal lands after the warning');
  });
});

describe('concurrent researchers never touch shared process.env', () => {
  it('two lanes with different proxy leases see a clean environment mid-run', async () => {
    const { runRehostedResearcher } = await import('../dist-electron/engine/researcherAgent.js');
    const previous = {};
    const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
    // One sentinel for all four: on Windows the upper/lower case variants
    // alias the SAME slot (case-insensitive env), so distinct per-name values
    // would collide at setup time, before any code under test runs.
    const SENTINEL = 'sentinel-shared-proxy-env';
    for (const name of names) previous[name] = process.env[name];
    const seen = [];
    try {
      for (const name of names) process.env[name] = SENTINEL;
      const decorate = (session, facet) => {
        session.agent.streamFunction = async () => {
          // Observation point DURING the run: the old per-lane env injection
          // was active here (set before construction, restored after the run).
          seen.push({ facet, env: Object.fromEntries(names.map((n) => [n, process.env[n]])) });
          const message = {
            role: 'assistant', api: 'scripted', provider: 'scripted', model: 'scripted-1',
            usage: { input: 1, output: 1, total: 2 },
            content: [{ type: 'text', text: `Answer for ${facet}.` }],
            stopReason: 'stop',
          };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'done', reason: 'stop', message };
            },
            async result() {
              return message;
            },
          };
        };
      };
      const lane = (i, facet) =>
        runRehostedResearcher(
          `s-proxy-${i}`,
          () => {},
          {
            researcherId: `researcher_s-proxy_${i}`,
            facetIndex: i,
            facet,
            facetCount: 2,
            milestoneId: `m${i + 1}`,
            milestoneTitle: facet,
            toolPackages: true,
            agentDir: mkdtempSync(join(tmpdir(), 'lens-agent-')),
            proxyBaseUrl: `http://127.0.0.1:9/proxy-lane-${i}`,
            compressionProxyUrl: `http://127.0.0.1:9/proxy-lane-${i}`,
          },
          { query: 'Q', report_type: 'quick', language: 'en', api_keys: {} },
          undefined,
          (session) => decorate(session, facet)
        );
      const [r0, r1] = await Promise.all([lane(0, 'facet alpha'), lane(1, 'facet beta')]);
      assert.ok(r0 && r1, 'both lanes complete');
      assert.equal(seen.length, 2, 'both transports were observed mid-run');
      for (const { facet, env } of seen) {
        for (const name of names) {
          assert.equal(env[name], SENTINEL, `${facet}: shared env untouched mid-run (${name})`);
        }
      }
      for (const name of names) {
        assert.equal(process.env[name], SENTINEL, `shared env intact after the fan-out (${name})`);
      }
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      resetFetchLedger('s-proxy-0');
      resetFetchLedger('s-proxy-1');
    }
  });
});


