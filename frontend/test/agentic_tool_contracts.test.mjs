import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Track D — honest tool surface (SPEC #155, #159).
 *
 * The agentic surface exposed only `{query}`/`{url}` shapes while the
 * allow-list (and upstream) named the full verification/content contract.
 * These tests pin the served contracts: full parameter shapes, loud refusals
 * for retired/unsupported shapes, real fan-out/storage/verification behavior
 * through stub injects (no network, no LLM), and allow-list parity.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
const { ANSWER_MODE_UNSUPPORTED_MESSAGE } = await importEngine('piPackages.js');
const { RESEARCH_TOOL_ALLOW_LIST } = await importEngine('agentSessionHost.js');

const stubContext = (overrides = {}) => ({
  sessionId: 's-trackd',
  state: { sources: [], reportChunks: [], fetchesUsed: 0 },
  maxFetches: 5,
  emit: () => {},
  searchProvider: 'duckduckgo',
  search: async () => [],
  fetchPage: async (url) => ({ url, title: url, text: `body of ${url}` }),
  ...overrides,
});

const paramKeys = (definitions, name) => {
  const def = definitions.find((d) => d.name === name);
  assert.ok(def, `serves ${name}`);
  return Object.keys(def.parameters?.properties ?? {});
};

describe('Track D — served tool names match the allow-list contract', () => {
  it('the agentic surface serves exactly the four research tools (todo stays researcher-side)', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const names = surface.definitions.map((d) => d.name);
    assert.deepEqual(names, ['web_search', 'fetch_content', 'source_check', 'get_search_content']);
    for (const name of names) {
      assert.ok(
        [...RESEARCH_TOOL_ALLOW_LIST].includes(name),
        `${name} is allow-listed — no shadow tool survives`
      );
    }
    assert.ok([...RESEARCH_TOOL_ALLOW_LIST].includes('todo'), 'todo remains allow-listed for the researcher path');
  });

  it('web_search exposes the full upstream-compatible contract', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const keys = paramKeys(surface.definitions, 'web_search');
    for (const field of ['query', 'queries', 'provider', 'numResults', 'recencyFilter', 'domainFilter', 'includeContent']) {
      assert.ok(keys.includes(field), `web_search exposes ${field}`);
    }
  });

  it('fetch_content exposes url(s), mode, and video fields', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const keys = paramKeys(surface.definitions, 'fetch_content');
    for (const field of ['url', 'urls', 'mode', 'prompt', 'timestamp']) {
      assert.ok(keys.includes(field), `fetch_content exposes ${field}`);
    }
  });

  it('source_check and get_search_content expose their contracts', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const scKeys = paramKeys(surface.definitions, 'source_check');
    for (const field of ['claim', 'queries', 'numResults', 'fetchContent', 'recencyFilter', 'domainFilter', 'provider']) {
      assert.ok(scKeys.includes(field), `source_check exposes ${field}`);
    }
    const gscKeys = paramKeys(surface.definitions, 'get_search_content');
    for (const field of ['responseId', 'offset', 'limit', 'findText', 'findMode', 'url', 'urlIndex', 'queryIndex']) {
      assert.ok(gscKeys.includes(field), `get_search_content exposes ${field}`);
    }
  });
});

describe('Track D — retired and unsupported shapes fail loudly', () => {
  it('web_search without query/queries is a refusal, not an empty search', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({ name: 'web_search', arguments: {} });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /query/i);
  });

  it('web_search rejects an unknown recency filter instead of silently ignoring it', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({ name: 'web_search', arguments: { query: 'q', recencyFilter: 'decade' } });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /recency/i);
  });

  it('fetch_content without url(s) is a refusal', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({ name: 'fetch_content', arguments: {} });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /url/i);
  });

  it('fetch_content answer mode is refused with the ownership guidance', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'https://refused.example/', mode: 'answer' },
    });
    assert.equal(out.success, false);
    assert.equal(out.error, ANSWER_MODE_UNSUPPORTED_MESSAGE);
  });

  it('fetch_content video-analysis fields are refused as unsupported mechanism', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'https://video.example/v', prompt: 'summarize', timestamp: '1:23' },
    });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /unsupported/i);
  });

  it('source_check without a claim is a refusal', async () => {
    const surface = createAgenticToolSurface(stubContext());
    const out = await surface.handler({ name: 'source_check', arguments: {} });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /claim/i);
  });

  it('get_search_content refuses unknown ids, dangling findMode, and fuzzy matching', async () => {
    const surface = createAgenticToolSurface(stubContext({ sessionId: 's-trackd-unknown' }));
    const unknown = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId: 'no-such-id' },
    });
    assert.equal(unknown.success, false);
    assert.match(unknown.error ?? '', /responseId|unknown|not found/i);

    const dangling = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId: 'no-such-id', findMode: 'exact' },
    });
    assert.equal(dangling.success, false);

    const fuzzy = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId: 'no-such-id', findText: 'x', findMode: 'fuzzy' },
    });
    assert.equal(fuzzy.success, false);
    assert.match(fuzzy.error ?? '', /fuzzy|unsupported/i);
  });
});

describe('Track D — web_search fan-out, scoping, and stored retrieval', () => {
  it('queries fan out with the provider and options, dedupe by URL, and store a responseId', async () => {
    const seen = [];
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-fanout',
      state,
      searchProvider: 'duckduckgo',
      search: async (query, provider, opts) => {
        seen.push({ query, provider, opts });
        if (query === 'q1') {
          return [
            { url: 'https://shared.example/a', title: 'Shared', snippet: 'S1' },
            { url: 'https://q1.example/only', title: 'Q1 only', snippet: 'S2' },
          ];
        }
        return [
          { url: 'https://shared.example/a', title: 'Shared', snippet: 'S1' },
          { url: 'https://q2.example/only', title: 'Q2 only', snippet: 'S3' },
        ];
      },
    }));
    const out = await surface.handler({
      name: 'web_search',
      arguments: { queries: ['q1', 'q2'], provider: 'tavily', numResults: 5, recencyFilter: 'week', domainFilter: ['example'] },
    });
    assert.equal(out.success, true);
    assert.equal(seen.length, 2, 'one plane call per query');
    for (const call of seen) {
      assert.equal(call.provider, 'tavily', 'the per-call provider overrides the surface default');
      assert.equal(call.opts?.numResults, 5);
      assert.equal(call.opts?.recencyFilter, 'week');
      assert.deepEqual(call.opts?.domainFilter, ['example']);
    }
    assert.equal(state.sources.length, 3, 'the shared URL admits once');
    const match = String(out.result).match(/responseId:\s*(\S+)/);
    assert.ok(match, 'the result names its stored responseId');
  });

  it('includeContent fetches hit pages inside the budget and stops at exhaustion', async () => {
    const fetched = [];
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-budget',
      state,
      maxFetches: 1,
      search: async () => [
        { url: 'https://inc.example/1', title: 'One', snippet: 'S1' },
        { url: 'https://inc.example/2', title: 'Two', snippet: 'S2' },
      ],
      fetchPage: async (url) => {
        fetched.push(url);
        return { url, title: url, text: `full text of ${url}` };
      },
    }));
    const out = await surface.handler({
      name: 'web_search',
      arguments: { query: 'q', includeContent: true },
    });
    assert.equal(out.success, true);
    assert.equal(fetched.length, 1, 'the second page stops at the exhausted budget');
    assert.match(String(out.result), /budget/i, 'the shortfall is reported, not silent');
    assert.equal(state.fetchesUsed, 1);
  });

  it('stored results round-trip through get_search_content with paging and find', async () => {
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-roundtrip',
      state,
      search: async () => [{ url: 'https://rt.example/needle', title: 'Needle title', snippet: 'plain snippet' }],
      fetchPage: async (url) => ({ url, title: url, text: 'the needle content lives here verbatim' }),
    }));
    const searched = await surface.handler({ name: 'web_search', arguments: { query: 'q', includeContent: true } });
    const responseId = String(searched.result).match(/responseId:\s*(\S+)/)?.[1];
    assert.ok(responseId, 'a responseId is issued');

    const page = await surface.handler({ name: 'get_search_content', arguments: { responseId, limit: 20 } });
    assert.equal(page.success, true);
    // The limit bounds stored content; the continuation suffix rides after it.
    assert.match(String(page.result), /re-run with offset 20/, 'the suffix names the next page');
    assert.ok(String(page.result).length <= 20 + 80, `paging bounds the body, got ${String(page.result).length}`);

    const found = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId, findText: 'needle content' },
    });
    assert.equal(found.success, true);
    assert.match(String(found.result), /needle content/);

    const byUrl = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId, url: 'https://rt.example/needle' },
    });
    assert.equal(byUrl.success, true);
    assert.match(String(byUrl.result), /needle content lives here/);
  });
});

describe('Track D — source_check verifies without inferring', () => {
  it('a claim returns ranked sources with passages and admits them, verdict-free', async () => {
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-sc',
      state,
      search: async () => [{ url: 'https://sc.example/claim', title: 'Claim page', snippet: 'supports it' }],
      fetchPage: async (url) => ({ url, title: url, text: 'exact passage backing the claim' }),
    }));
    const out = await surface.handler({
      name: 'source_check',
      arguments: { claim: 'tokamaks sustain Q>1', fetchContent: true },
    });
    assert.equal(out.success, true);
    assert.match(String(out.result), /tokamaks sustain/);
    assert.match(String(out.result), /exact passage backing the claim/);
    assert.doesNotMatch(String(out.result), /supported|contradicted|verdict/i, 'no semantic inference — artifact only');
    assert.ok(state.sources.some((s) => s.url === 'https://sc.example/claim'), 'checked sources admit as evidence');
    assert.equal(state.fetchesUsed, 1, 'verification fetches ride the same budget');
  });

  it('fetchContent:false checks without touching the fetch budget', async () => {
    let fetched = 0;
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-sc-nofetch',
      search: async () => [{ url: 'https://sc.example/x', title: 'X', snippet: 'S' }],
      fetchPage: async (url) => {
        fetched += 1;
        return { url, title: url, text: 't' };
      },
    }));
    const out = await surface.handler({
      name: 'source_check',
      arguments: { claim: 'a claim', fetchContent: false },
    });
    assert.equal(out.success, true);
    assert.equal(fetched, 0);
  });
});

describe('Track D — fetch_content multi-URL honesty', () => {  it('serves each URL, reports per-URL failures inline, and threads raw mode', async () => {
    const seenModes = [];
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-multi',
      fetchPage: async (url, opts) => {
        seenModes.push([url, opts?.mode]);
        if (url.includes('down')) return null;
        return { url, title: url, text: `text of ${url}` };
      },
    }));
    const out = await surface.handler({
      name: 'fetch_content',
      arguments: { urls: ['https://ok.example/a', 'https://down.example/b'], mode: 'raw' },
    });
    assert.equal(out.success, true, 'one served page suffices');
    assert.match(String(out.result), /text of https:\/\/ok\.example\/a/);
    assert.match(String(out.result), /down\.example\/b/, 'the failure is reported inline, not terminal');
    assert.deepEqual(seenModes, [
      ['https://ok.example/a', 'raw'],
      ['https://down.example/b', 'raw'],
    ]);
  });

  it('total failure is an explicit failure, never an empty success', async () => {
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-allfail',
      fetchPage: async () => null,
    }));
    const out = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'https://down.example/only' },
    });
    assert.equal(out.success, false);
  });

  it('non-string domain entries are refused, never silently dropped', async () => {
    const surface = createAgenticToolSurface(stubContext({ sessionId: 's-trackd-baddomain' }));
    const out = await surface.handler({
      name: 'web_search',
      arguments: { query: 'q', domainFilter: ['example', 42] },
    });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /domainFilter/i);
  });
});

describe('Track D review — bounds, modes, and slices are proven, not trusted', () => {
  it('readable strips boilerplate the raw mode keeps (vendored mode honored)', async () => {
    const { primaryScrapePlane, __testSeams, resetScrapePlane } = await importEngine('scrapePlane.js');
    __testSeams.setLookupOverride(async () => [{ address: '93.184.216.34', family: 4 }]);
    const realFetch = globalThis.fetch;
    const html = '<html><head><title>T</title><script>var a=1;</script></head><body><nav>nav junk link link</nav><article><h1>Real headline</h1><p>' + 'Dense evidence content. Verdant pastures. '.repeat(60) + '</p></article></body></html>';
    globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    try {
      const readable = await primaryScrapePlane('http://mode.example/readable');
      const raw = await primaryScrapePlane('http://mode.example/raw', 8000, undefined, 'raw');
      assert.ok(readable.content.length > 0 && raw.content.length > 0, 'both modes serve');
      assert.notEqual(readable.content, raw.content, 'the mode reaches the mechanism — outputs diverge');
      assert.equal(readable.content.includes('nav junk'), false, 'readable strips boilerplate');
      assert.equal(raw.content.includes('nav junk'), true, 'raw keeps the unprocessed source');
    } finally {
      globalThis.fetch = realFetch;
      __testSeams.setLookupOverride(null);
      resetScrapePlane();
    }
  });

  it('stored page text is capped per hit with a truncation marker', async () => {
    const big = 'x'.repeat(20000);
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-hitcap',
      search: async () => [{ url: 'https://big.example/p', title: 'Big', snippet: 'S' }],
      fetchPage: async (url) => ({ url, title: url, text: big }),
    }));
    const searched = await surface.handler({ name: 'web_search', arguments: { query: 'q', includeContent: true } });
    const responseId = String(searched.result).match(/responseId:\s*(\S+)/)?.[1];
    assert.ok(responseId);
    const got = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId, url: 'https://big.example/p', limit: 16000 },
    });
    assert.equal(got.success, true);
    assert.ok(String(got.result).length <= 12000 + 100, `per-hit cap holds, got ${String(got.result).length}`);
    assert.match(String(got.result), /truncated/);
  });

  it('source_check slices page by queryIndex with real content', async () => {
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-sc-slice',
      search: async (query) => [{ url: `https://${query}.example/p`, title: `${query} page`, snippet: `${query} snippet` }],
      fetchPage: async (url) => ({ url, title: url, text: `passage for ${url}` }),
    }));
    const checked = await surface.handler({
      name: 'source_check',
      arguments: { claim: 'c', queries: ['alpha', 'beta'], fetchContent: true },
    });
    const responseId = String(checked.result).match(/responseId:\s*(\S+)/)?.[1];
    assert.ok(responseId);
    const slice = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId, queryIndex: 1 },
    });
    assert.equal(slice.success, true);
    assert.match(String(slice.result), /beta/, 'the second slice names its query');
    assert.match(String(slice.result), /passage for https:\/\/beta\.example\/p/, 'slices carry fetched passages');
    const bad = await surface.handler({
      name: 'get_search_content',
      arguments: { responseId, queryIndex: 7 },
    });
    assert.equal(bad.success, false, 'out-of-range queryIndex is a refusal');
  });

  it('the session store evicts oldest-first past its bound', async () => {
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-evict',
      search: async (query) => [{ url: `https://${query}.example/`, title: query, snippet: 'S' }],
    }));
    let firstId = '';
    for (let i = 0; i < 21; i += 1) {
      const out = await surface.handler({ name: 'web_search', arguments: { query: `evict-${i}` } });
      const id = String(out.result).match(/responseId:\s*(\S+)/)?.[1];
      if (i === 0) firstId = id;
    }
    assert.ok(firstId);
    const gone = await surface.handler({ name: 'get_search_content', arguments: { responseId: firstId } });
    assert.equal(gone.success, false, 'the oldest entry evicted past the 20-entry bound');
    assert.match(gone.error ?? '', /unknown responseId/);
  });

  it('an offset past the stored text is a refusal, not an empty success', async () => {
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-trackd-offset',
      search: async () => [{ url: 'https://off.example/', title: 'T', snippet: 'short' }],
    }));
    const searched = await surface.handler({ name: 'web_search', arguments: { query: 'q' } });
    const responseId = String(searched.result).match(/responseId:\s*(\S+)/)?.[1];
    const out = await surface.handler({ name: 'get_search_content', arguments: { responseId, offset: 10 ** 9 } });
    assert.equal(out.success, false);
    assert.match(out.error ?? '', /offset/i);
  });
});
