import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Retrieval reliability — bounded fallback + provider propagation.
 *
 * The plane runs every query through an explicit, deterministic attempt
 * plan (requested → Pi `auto` → keyless DDG, duplicates skipped): a DDG
 * failure reaches `auto` instead of terminating research, and only joint
 * failure is terminal. The researcher/agentic/wide paths preserve the
 * selected provider and all search options into the plane.
 *
 * All legs run against stubbed transports with the REAL plane modules —
 * no fetch mocks of the plane itself, no synthetic plane responses.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const realFetch = globalThis.fetch;
const realTavilyKey = process.env.TAVILY_API_KEY;

// Extension-tier isolation: point the vendored graph at an empty dir so no
// test reads ambient operator config. Keys travel per call (caller override
// or ambient env set explicitly per test), never through the extension tier.
const EXTENSION_ISOLATION_DIR = mkdtempSync(join(tmpdir(), 'lens-resil-ext-'));
process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;

const DDG_ONE_RESULT = `
<html><body>
<div class="result">
  <a class="result__a" href="https://fusion.example/tokamak">Tokamak benchmark</a>
  <a class="result__snippet" href="https://fusion.example/tokamak">Steady-state Q&gt;1 sustained.</a>
</div>
</body></html>`;

const TAVILY_ONE_RESULT = (title = 'Tavily deep hit', url = 'https://tavily.example/deep') =>
  JSON.stringify({
    answer: 'provider-side draft (ignored by LENS)',
    results: [{ url, title, raw_content: 'A provider-routed passage.' }],
  });

afterEach(async () => {
  globalThis.fetch = realFetch;
  process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;
  if (realTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = realTavilyKey;
  const { resetSearchPlane } = await importEngine('searchPlane.js');
  resetSearchPlane();
});

describe('attempt plan + error classification (pure)', () => {
  it('plans are bounded and cycle-free', async () => {
    const { planSearchAttempts } = await importEngine('searchPlane.js');
    assert.deepEqual(planSearchAttempts('duckduckgo'), ['duckduckgo', 'auto']);
    assert.deepEqual(planSearchAttempts('auto'), ['auto', 'duckduckgo']);
    assert.deepEqual(planSearchAttempts('tavily'), ['tavily', 'auto', 'duckduckgo']);
    assert.deepEqual(planSearchAttempts('serper'), ['serper', 'auto', 'duckduckgo']);
  });

  it('one source of truth for the default provider', async () => {
    const { resolveDefaultSearchProvider, DEFAULT_SEARCH_PROVIDER } = await importEngine('searchPlane.js');
    assert.equal(resolveDefaultSearchProvider(), 'duckduckgo');
    assert.equal(DEFAULT_SEARCH_PROVIDER, 'duckduckgo');
    const server = await importEngine('server.js');
    assert.equal(server.DEFAULT_AGENTIC_SEARCH_PROVIDER, 'duckduckgo');
  });

  it('classifies failures instead of collapsing them', async () => {
    const { classifySearchError } = await importEngine('searchPlane.js');
    assert.equal(classifySearchError(new DOMException('aborted', 'AbortError')), 'cancelled');
    assert.equal(classifySearchError(new Error('Tavily API error 401: down')), 'auth-missing');
    assert.equal(classifySearchError(new Error('no parseable results here')), 'parse');
    assert.equal(classifySearchError(new Error('fetch failed')), 'network');
    assert.equal(classifySearchError(new Error('No search provider available')), 'unavailable');
  });

  it('rejects unusable results (missing title, bad URL)', async () => {
    const { isUsableSearchResult } = await importEngine('searchPlane.js');
    assert.equal(isUsableSearchResult({ title: 'T', url: 'https://x.example/a' }), true);
    assert.equal(isUsableSearchResult({ title: '', url: 'https://x.example/a' }), false);
    assert.equal(isUsableSearchResult({ title: 'T', url: 'not-a-url' }), false);
    assert.equal(isUsableSearchResult({ title: 'T', url: 'ftp://x.example/a' }), false);
  });
});

describe('resilient search plane (real modules, stubbed transport)', () => {
  it('Test 1 — DDG success returns results with no fallback', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    globalThis.fetch = (async () => new Response(DDG_ONE_RESULT, { status: 200 }));
    const out = await searchViaExtension('tokamak benchmarks', {
      provider: 'duckduckgo',
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.provider, 'duckduckgo');
    assert.equal(out.attempts?.length, 1);
    assert.equal(out.attempts?.[0].status, 'success');
  });

  it('Test 2 — falls back when the explicit keyless provider fails (DDG fails, Auto succeeds)', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    process.env.TAVILY_API_KEY = 'good-ambient-key';
    let fetches = 0;
    globalThis.fetch = (async (url, init) => {
      fetches += 1;
      if (String(url).includes('api.tavily.com')) {
        return new Response(TAVILY_ONE_RESULT(), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('no parseable results here', { status: 200 });
    });
    const out = await searchViaExtension('tokamak benchmarks', {
      provider: 'duckduckgo',
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.ok(out.results.length > 0, 'auto served after the DDG failure');
    assert.equal(out.attempts?.[0].provider, 'duckduckgo');
    assert.equal(out.attempts?.[0].status, 'failed');
    assert.ok(out.attempts?.some((a) => a.status === 'success'), 'the trail records the recovery');
    assert.ok(fetches <= 4, `bounded attempts, not a retry loop (fetches: ${fetches})`);
  });

  it('Test 3 — DDG failure plus Auto failure is terminal with diagnostics', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    delete process.env.TAVILY_API_KEY;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response('no parseable results here', { status: 200 });
    });
    const err = await searchViaExtension('tokamak benchmarks', {
      provider: 'duckduckgo',
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    }).then(
      () => null,
      (e) => e
    );
    assert.ok(err, 'joint failure throws');
    assert.equal(err.name, 'SearchPlaneTerminalError');
    assert.match(err.message, /temporarily unavailable/);
    assert.ok(!/no parseable/i.test(err.message), 'raw provider internals stay out of the user message');
    assert.equal(err.attempts.length, 2, 'DDG → Auto, then terminal (no recursion)');
    assert.ok(fetches <= 3, `no infinite retry (fetches: ${fetches})`);
  });

  it('Test 4 — explicit Tavily success serves without fallback', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    globalThis.fetch = (async (url) => {
      if (String(url).includes('api.tavily.com')) {
        return new Response(TAVILY_ONE_RESULT(), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('keyed query', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.equal(out.results[0].url, 'https://tavily.example/deep');
    assert.equal(out.attempts?.length, 1, 'no fallback on success');
  });

  it('Test 5 — explicit provider failure reaches Auto (keyed fail, Auto succeeds)', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    process.env.TAVILY_API_KEY = 'good-ambient-key';
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('api.tavily.com')) {
        const auth = init?.headers?.Authorization ?? init?.headers?.authorization;
        if (auth === 'Bearer good-ambient-key') {
          return new Response(TAVILY_ONE_RESULT('Tavily auto hit', 'https://tavily.example/auto'), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('Tavily API error 401: down', { status: 401 });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('keyed query', {
      provider: 'tavily',
      apiKeys: { tavily: 'bad-caller-key' },
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.ok(out.results.length > 0, 'auto recovered the keyed failure');
    assert.equal(out.attempts?.[0].provider, 'tavily');
    assert.equal(out.attempts?.[0].status, 'failed');
    assert.doesNotMatch(JSON.stringify(out.attempts), /bad-caller-key/, 'no key material in diagnostics');
  });

  it('Test 6 — keyed failure plus Auto failure reaches DDG', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    delete process.env.TAVILY_API_KEY;
    globalThis.fetch = (async (url) => {
      if (String(url).includes('api.tavily.com')) {
        return new Response('Tavily API error 401: down', { status: 401 });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('keyed query', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.equal(out.results[0].url, 'https://fusion.example/tokamak', 'the keyless chain served last');
    assert.deepEqual(
      out.attempts?.map((a) => a.provider),
      ['tavily', 'auto', 'duckduckgo'],
      'explicit, bounded, deterministic order'
    );
  });

  it('empty provider output runs the fallback policy (never a fake success)', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    delete process.env.TAVILY_API_KEY;
    globalThis.fetch = (async (url) => {
      if (String(url).includes('api.tavily.com')) {
        return new Response(JSON.stringify({ answer: 'draft', results: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('keyed query', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.ok(out.results.length > 0, 'empty keyed output fell through to the keyless chain');
    assert.equal(out.attempts?.[0].kind, 'empty');
  });

  it('malformed items are filtered, usable ones survive', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    globalThis.fetch = (async (url) => {
      if (String(url).includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [
              { url: 'https://good.example/a', title: 'Good', raw_content: 'x' },
              { url: 'not-a-url', title: 'Bad', raw_content: 'x' },
              { url: 'https://notitle.example/', title: '', raw_content: 'x' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('keyed query', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    // The vendored Tavily mapping backfills an empty title (`Source N`) —
    // normalization, not fabrication — while the unparseable URL is dropped.
    assert.equal(out.results.length, 2);
    assert.ok(out.results.some((r) => r.url === 'https://good.example/a'));
    assert.ok(!out.results.some((r) => r.url === 'not-a-url'), 'unusable URLs never leave the plane');
  });
});

describe('provider + options propagation', () => {
  it('Test 7 — agentic providerOverride is preserved through the tool surface', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-resil-override',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'tavily',
      search: async (query, provider, opts) => {
        seen.push([query, provider, opts]);
        return [{ url: 'https://o.example/1', title: 'O', snippet: 'S' }];
      },
      fetchPage: async () => null,
    });
    await surface.handler({ name: 'web_search', arguments: { query: 'q', provider: 'serper' } });
    assert.equal(seen[0][1], 'serper', 'per-call override wins');
    await surface.handler({ name: 'web_search', arguments: { query: 'q' } });
    assert.equal(seen[1][1], 'tavily', 'session selection rides the call otherwise');
  });

  it('Test 8 — researcher preserves the requested search provider', async () => {
    const { runRehostedResearcher } = await importEngine('researcherAgent.js');
    const harness = await importEngine('parityHarness.js');
    const { resetFetchLedger } = await importEngine('fetchLedger.js');
    const { __testSeams: scrapeSeams } = await importEngine('scrapePlane.js');
    scrapeSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    try {
      const facet = 'tokamak benchmarks';
      const pageUrl = 'https://fusion.example/tokamak-article';
      const fixture = {
        name: 'resil-researcher-provider',
        query: 'Tokamak',
        language: 'en',
        plan: { status: 'approved' },
        report: '# R\n\nDone.',
        searchHtml: {
          [facet]:
            `<html><body><div class="result"><a class="result__a" href="${pageUrl}">Tokamak article</a>` +
            `<a class="result__snippet" href="${pageUrl}">Steady-state plasma.</a></div></body></html>`,
        },
        pageHtml: {
          [pageUrl]:
            `<html><head><title>Tokamak article</title></head><body><article>` +
            [
              `The Tokamak investigation reports on steady-state plasma: detailed evidence shows measurable progress and reproducible results across independent measurements, with the framework and its protocol holding under controlled conditions.`,
              `Additional analysis of steady-state plasma confirms the reported trends: the architecture, its implementation, and the algorithm each hold under controlled comparison, with performance metrics recorded per run and reproducible results across independent measurements.`,
              `Further findings on confinement: benchmark evaluation shows precision at 88.8%, duplicate fetches dropped by 45%, and average audit time of 12 seconds across the comparison suite, documented under controlled conditions.`,
              `The benchmark suite also documents the known limitations and risks of magnetic confinement: bypass attempts are a real challenge, the bottleneck is the single enforcement point, and the trade-off favors one enforcement point, with the vulnerability surface staying minimal.`,
              `Evaluation metrics for the campaign: throughput reaches 120 Mbps, latency drops by 42%, accuracy stands at 99.9%, the comparison score improves by 15%, and the noise margin is 7 dB under controlled conditions, with reproducible results across every independent run.`,
            ].map((p) => `<p>${p}</p>`).join('') +
            `</article></body></html>`,
        },
      };
      const fixtureFetch = harness.makeFixtureFetch(fixture);
      let tavilyAttempted = false;
      globalThis.fetch = (async (url, init) => {
        if (String(url).includes('api.tavily.com')) {
          tavilyAttempted = true;
          return new Response('Tavily API error 401: down', { status: 401 });
        }
        return fixtureFetch(url, init);
      });
      const emitted = [];
      const decorate = (session) => {
        session.agent.streamFunction = harness.makeResearcherLegTransport('# R\n\nDone.', [pageUrl], facet, []);
      };
      // Provision the requested provider's key through the researcher's own
      // agentDir file (the production key path): without it the vendored
      // module refuses before any transport, and preservation would be
      // unobservable. The stubbed 401 then proves the fallback still serves.
      const researcherDir = mkdtempSync(join(tmpdir(), 'lens-resil-'));
      writeFileSync(join(researcherDir, 'web-search.json'), JSON.stringify({ tavilyApiKey: 'tvly-researcher-key' }), 'utf-8');
      const result = await runRehostedResearcher(
        'resil-researcher-session',
        (e) => emitted.push(e),
        {
          researcherId: 'researcher_resil_1',
          facetIndex: 0,
          facet,
          facetCount: 1,
          milestoneId: 'm1',
          milestoneTitle: facet,
          toolPackages: true,
          agentDir: researcherDir,
        },
        {
          query: 'Tokamak', report_type: 'quick', language: 'en', llm_provider: 'openai',
          model_name: 'test-model', search_provider: 'tavily', embedding_enabled: false,
        },
        undefined,
        decorate
      );
      assert.ok(tavilyAttempted, 'the requested provider reached the plane (never silently dropped to default)');
      assert.ok(result.findings.length >= 1, 'fallback evidence still admitted through the normal pipeline');
    } finally {
      scrapeSeams.setLookupOverride(null);
      const { resetFetchLedger: reset } = await importEngine('fetchLedger.js');
      reset('resil-researcher-session');
      void resetFetchLedger;
    }
  });

  it('Test 9 — recency survives surface → plane → provider transport', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-resil-recency',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'duckduckgo',
      search: async (query, provider, opts) => {
        seen.push(opts);
        return [];
      },
      fetchPage: async () => null,
    });
    await surface.handler({ name: 'web_search', arguments: { query: 'latest benchmarks', recencyFilter: 'week' } });
    assert.equal(seen[0]?.recencyFilter, 'week', 'surface forwards the recency selection');

    const { searchViaExtension } = await importEngine('searchPlane.js');
    const bodies = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('api.tavily.com')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(TAVILY_ONE_RESULT(), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const out = await searchViaExtension('latest benchmarks', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      recencyFilter: 'week',
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.equal(out.recencyFilter, 'week', 'the forwarded recency is echoed');
    assert.equal(bodies[0]?.time_range, 'week', 'recency rides the provider transport');
  });

  it('Test 10 — domain filters survive surface → plane → provider transport', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-resil-domain',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'duckduckgo',
      search: async (query, provider, opts) => {
        seen.push(opts);
        return [];
      },
      fetchPage: async () => null,
    });
    await surface.handler({ name: 'web_search', arguments: { query: 'q', domainFilter: ['fusion.example'] } });
    assert.deepEqual(seen[0]?.domainFilter, ['fusion.example']);

    const { searchViaExtension } = await importEngine('searchPlane.js');
    const bodies = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('api.tavily.com')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(TAVILY_ONE_RESULT(), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    await searchViaExtension('q', {
      provider: 'tavily',
      apiKeys: { tavily: 'k-test' },
      domainFilter: ['fusion.example'],
      agentDir: mkdtempSync(join(tmpdir(), 'lens-resil-')),
    });
    assert.ok(
      (bodies[0]?.include_domains ?? []).includes('fusion.example'),
      `domain filter rides the transport — body: ${JSON.stringify(bodies[0])}`
    );
  });

  it('Test 11 — cancellation reaches the plane with no fallback retrieval', async () => {
    const { searchViaExtension } = await importEngine('searchPlane.js');
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(
      searchViaExtension('q', { provider: 'duckduckgo', signal: ctrl.signal }),
      /abort/i,
      'aborted callers reject, never serve'
    );
    assert.equal(fetches, 0, 'no retrieval after cancellation');
  });

  it('Test 12 — numResults is preserved to the provider transport', async () => {
    const { primarySearchPlane } = await importEngine('searchPlane.js');
    const bodies = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('api.tavily.com')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(TAVILY_ONE_RESULT(), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-resil-'));
    await primarySearchPlane('q', 'tavily', { tavily: 'k-test' }, 5, undefined, agentDir);
    assert.equal(bodies[0]?.max_results, 5, 'the requested count rides the transport');
  });
});
