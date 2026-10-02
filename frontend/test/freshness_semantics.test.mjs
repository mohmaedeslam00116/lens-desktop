import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Track E — freshness semantics (SPEC #155, #160).
 *
 * Temporal-intent detection (AR/EN), provider-side recency application,
 * date-aware query variants, publishedAt retention on admitted sources,
 * stale-result penalization in ranking, and claim-level verification via
 * source_check before citation.
 *
 * Stub-only except the plane-threading proof, which runs the real vendored
 * DDG transport against an HTML fixture (no live network).
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const readSrc = async (rel) =>
  readFileSync(join(process.cwd(), 'electron', 'engine', rel), 'utf8');

const {
  detectTemporalIntent,
  resolveRecencyForQuery,
  buildDateAwareVariants,
  parsePublishedAt,
  freshnessMultiplier,
  verifyTemporalGrounding,
  FRESHNESS_BOUNDS,
} = await importEngine('freshness.js');

const realFetch = globalThis.fetch;

const DDG_ONE_RESULT = `
<html><body>
<div class="result">
  <h2 class="result__a" href="https://fusion.example/tokamak">Tokamak benchmark</h2>
  <a class="result__snippet" href="https://fusion.example/tokamak">Steady-state Q&gt;1 sustained.</a>
</div>
</body></html>`;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Track E — temporal-intent detection (EN)', () => {
  it('detects latest/current/today/breaking/new-model/announcement markers', async () => {
    for (const q of [
      'latest LLM benchmarks',
      'current gold prices today',
      'breaking tokamak news',
      'new model announcement from OpenAI',
      'recent advances in fusion',
    ]) {
      const intent = detectTemporalIntent(q);
      assert.equal(intent.isTemporal, true, `"${q}" is temporal`);
      assert.ok(intent.matchedTerms.length > 0, 'names the marker it fired on');
    }
  });

  it('maps urgency to provider recency: breaking/today → day, latest/current → week, announcement/recent → month', async () => {
    assert.equal(detectTemporalIntent('breaking tokamak news').suggestedRecency, 'day');
    assert.equal(detectTemporalIntent('gold prices today').suggestedRecency, 'day');
    assert.equal(detectTemporalIntent('latest LLM benchmarks').suggestedRecency, 'week');
    assert.equal(detectTemporalIntent('current gold prices').suggestedRecency, 'week');
    assert.equal(detectTemporalIntent('new model announcement').suggestedRecency, 'month');
    assert.equal(detectTemporalIntent('recent advances in fusion').suggestedRecency, 'month');
  });

  it('treats an explicit year as a temporal anchor for the year window', async () => {
    const intent = detectTemporalIntent('GPT-5 capabilities 2026');
    assert.equal(intent.isTemporal, true);
    assert.equal(intent.suggestedRecency, 'year');
  });

  it('leaves timeless queries alone', async () => {
    for (const q of ['history of quantum computing', 'explain Bayes theorem', 'tokamak plasma physics']) {
      const intent = detectTemporalIntent(q);
      assert.equal(intent.isTemporal, false, `"${q}" is not temporal`);
      assert.equal(intent.suggestedRecency, undefined);
    }
  });
});

describe('Track E — temporal-intent detection (AR)', () => {
  it('detects Arabic freshness markers', async () => {
    for (const q of [
      'آخر تطورات الذكاء الاصطناعي اليوم',
      'أحدث نماذج اللغة الكبيرة',
      'خبر عاجل عن الاندماج النووي',
      'إعلان نموذج جديد من أوبن إيه آي',
      'آخر المستجدات في أسعار الذهب',
    ]) {
      const intent = detectTemporalIntent(q);
      assert.equal(intent.isTemporal, true, `"${q}" is temporal`);
    }
  });

  it('maps Arabic urgency the same way: اليوم/عاجل → day, الأحدث/الحالي → week, إعلان/جديد → month', async () => {
    assert.equal(detectTemporalIntent('أسعار الذهب اليوم').suggestedRecency, 'day');
    assert.equal(detectTemporalIntent('خبر عاجل عن الاندماج').suggestedRecency, 'day');
    assert.equal(detectTemporalIntent('أحدث نماذج اللغة').suggestedRecency, 'week');
    assert.equal(detectTemporalIntent('الوضع الحالي للأسواق').suggestedRecency, 'week');
    assert.equal(detectTemporalIntent('إعلان نموذج جديد').suggestedRecency, 'month');
  });

  it('leaves timeless Arabic queries alone', async () => {
    for (const q of ['شرح مفاهيم الحوسبة الكمومية', 'تاريخ الفلسفة اليونانية']) {
      assert.equal(detectTemporalIntent(q).isTemporal, false, `"${q}" is not temporal`);
    }
  });
});

describe('Track E — recency resolution and date-aware variants', () => {
  it('an explicit recency always wins over intent', async () => {
    assert.equal(resolveRecencyForQuery('breaking news today', 'year'), 'year');
    assert.equal(resolveRecencyForQuery('history of chess', 'month'), 'month');
  });

  it('temporal queries resolve to the intent suggestion; timeless resolve to undefined (no silent scoping)', async () => {
    assert.equal(resolveRecencyForQuery('breaking tokamak news'), 'day');
    assert.equal(resolveRecencyForQuery('latest LLM benchmarks'), 'week');
    assert.equal(resolveRecencyForQuery('آخر تطورات الذكاء الاصطناعي اليوم'), 'day');
    assert.equal(resolveRecencyForQuery('history of quantum computing'), undefined);
    assert.equal(resolveRecencyForQuery('شرح مفاهيم الحوسبة الكمومية'), undefined);
  });

  it('temporal queries gain date-aware variants (year + language-local latest); timeless stay single', async () => {
    const variants = buildDateAwareVariants('latest LLM benchmarks', new Date('2026-06-15T00:00:00Z'));
    assert.ok(variants.length > 1 && variants.length <= 3, 'fan-out stays bounded');
    assert.equal(variants[0], 'latest LLM benchmarks', 'the base query leads');
    assert.ok(variants.some((v) => v.includes('2026')), 'one variant anchors the current year');
    assert.deepEqual(buildDateAwareVariants('history of quantum computing'), ['history of quantum computing']);
    const ar = buildDateAwareVariants('أحدث نماذج اللغة', new Date('2026-06-15T00:00:00Z'));
    assert.ok(ar.some((v) => v.includes('2026')), 'Arabic variants anchor the year too');
  });

  it('never duplicates a year the query already names', async () => {
    const variants = buildDateAwareVariants('GPT-5 capabilities 2026', new Date('2026-06-15T00:00:00Z'));
    for (const v of variants) {
      assert.equal((v.match(/2026/g) ?? []).length, 1, 'no doubled year');
    }
  });
});

describe('Track E — publishedAt parsing and freshness scoring', () => {
  it('keeps valid provider dates as ISO, drops garbage (never invents)', async () => {
    assert.equal(parsePublishedAt('2026-05-01T12:00:00Z'), '2026-05-01T12:00:00.000Z');
    assert.ok(parsePublishedAt('15 June 2024')?.startsWith('2024-06'), 'human dates normalize');
    assert.equal(parsePublishedAt('not a date'), undefined);
    assert.equal(parsePublishedAt(''), undefined);
    assert.equal(parsePublishedAt(undefined), undefined);
    assert.equal(parsePublishedAt(42), undefined);
  });

  it('fresh temporal evidence scores ~1, stale temporal evidence is penalized, undated is neutral-ish', async () => {
    const now = new Date('2026-10-02T00:00:00Z').getTime();
    const fresh = freshnessMultiplier(new Date('2026-09-20T00:00:00Z').toISOString(), now, true);
    const stale = freshnessMultiplier(new Date('2021-03-01T00:00:00Z').toISOString(), now, true);
    const undated = freshnessMultiplier(undefined, now, true);
    const timeless = freshnessMultiplier(new Date('2021-03-01T00:00:00Z').toISOString(), now, false);
    assert.ok(fresh >= 0.95, `fresh keeps its weight, got ${fresh}`);
    assert.ok(stale <= 0.6, `stale is penalized, got ${stale}`);
    assert.ok(undated < fresh && undated > stale, `undated sits between, got ${undated}`);
    assert.ok(timeless > stale, 'timeless queries penalize less than temporal ones');
    assert.ok(FRESHNESS_BOUNDS.staleAfterDays > 0, 'the staleness horizon is a named bound');
  });
});

describe('Track E — stale penalization in the real ranking seam (MMR)', () => {
  it('a stale high-rank result loses to a fresh official source under temporal intent', async () => {
    const { selectPassagesWithMMR } = await importEngine('mmr.js');
    const now = new Date('2026-10-02T00:00:00Z').getTime();
    const candidates = [
      {
        id: 'stale-blog',
        score: 1.0,
        content: 'tokamak results tokamak results plasma confinement',
        sourceId: 'stale-blog',
        domain: 'random-blog.example',
        credibilityScore: 1.0,
        publishedAt: new Date('2021-03-01T00:00:00Z').toISOString(),
      },
      {
        id: 'fresh-official',
        score: 0.6,
        content: 'tokamak results tokamak results plasma confinement record Q',
        sourceId: 'fresh-official',
        domain: 'iter.org',
        credibilityScore: 1.2,
        publishedAt: new Date('2026-09-20T00:00:00Z').toISOString(),
      },
    ];
    const temporal = selectPassagesWithMMR(candidates, {
      maxPassages: 2,
      temporalIntent: true,
      now,
      similarityFn: () => 0,
    });
    assert.equal(temporal.selected[0].id, 'fresh-official', 'fresh official wins under temporal intent');

    const control = selectPassagesWithMMR(candidates, {
      maxPassages: 2,
      similarityFn: () => 0,
    });
    assert.equal(control.selected[0].id, 'stale-blog', 'without intent the raw scores hold (penalty is the cause)');
  });
});

describe('Track E — publishedAt retention on admitted sources', () => {
  const stubContext = (overrides = {}) => ({
    sessionId: 's-tracke',
    state: { sources: [], reportChunks: [], fetchesUsed: 0 },
    maxFetches: 5,
    emit: () => {},
    searchProvider: 'duckduckgo',
    search: async () => [],
    fetchPage: async (url) => ({ url, title: url, text: `body of ${url}` }),
    ...overrides,
  });

  it('web_search admits provider dates onto sources and into the stored artifact', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-tracke-dates',
      state,
      search: async () => [
        { url: 'https://dated.example/fresh', title: 'Fresh', snippet: 'S', publishedAt: '2026-09-20T00:00:00.000Z' },
        { url: 'https://dated.example/plain', title: 'Plain', snippet: 'S' },
      ],
    }));
    const out = await surface.handler({ name: 'web_search', arguments: { query: 'tokamak results' } });
    assert.equal(out.success, true);
    assert.equal(state.sources.find((s) => s.url === 'https://dated.example/fresh')?.publishedAt, '2026-09-20T00:00:00.000Z');
    assert.equal(state.sources.find((s) => s.url === 'https://dated.example/plain')?.publishedAt, undefined);
    assert.match(String(out.result), /2026-09-20/, 'the artifact shows the date where the provider supplied it');
  });

  it('temporal web_search auto-applies the intent recency provider-side and says so', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-tracke-auto',
      search: async (query, provider, opts) => {
        seen.push({ query, provider, opts });
        return [];
      },
    }));
    const out = await surface.handler({ name: 'web_search', arguments: { query: 'latest LLM benchmarks' } });
    assert.equal(out.success, true);
    assert.equal(seen[0].opts?.recencyFilter, 'week', 'intent week threads provider-side');
    assert.match(String(out.result), /recency/i, 'the auto-application is reported, never silent');
  });

  it('an explicit recency is forwarded verbatim with no auto note', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface(stubContext({
      sessionId: 's-tracke-explicit',
      search: async (query, provider, opts) => {
        seen.push({ query, provider, opts });
        return [];
      },
    }));
    const out = await surface.handler({
      name: 'web_search',
      arguments: { query: 'latest LLM benchmarks', recencyFilter: 'year' },
    });
    assert.equal(out.success, true);
    assert.equal(seen[0].opts?.recencyFilter, 'year');
    assert.doesNotMatch(String(out.result), /auto-applied/, 'no auto note when the caller chose');
  });
});

describe('Track E — source_check verifies temporal claims freshness-first', () => {
  it('a temporal claim fans out date-aware variants with auto recency before citation', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-tracke-sc',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'duckduckgo',
      search: async (query, provider, opts) => {
        seen.push({ query, provider, opts });
        return [{ url: `https://${encodeURIComponent(query.slice(0, 8))}.example/p`, title: 'T', snippet: 'S', publishedAt: '2026-09-01T00:00:00.000Z' }];
      },
      fetchPage: async (url) => ({ url, title: url, text: 'passage text here' }),
    });
    const out = await surface.handler({
      name: 'source_check',
      arguments: { claim: 'latest tokamak record announced', fetchContent: false },
    });
    assert.equal(out.success, true);
    assert.ok(seen.length > 1, `date-aware variants fan out, got ${seen.length} search(es)`);
    assert.ok(seen.some((s) => /\d{4}/.test(s.query)), 'a variant anchors the year');
    for (const s of seen) {
      assert.ok(s.opts?.recencyFilter, 'every variant carries the auto recency');
    }
    assert.match(String(out.result), /2026-09-01/, 'verified passages show their dates for citation');
  });

  it('a timeless claim keeps the single-query shape (no variant drift)', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-tracke-sc-timeless',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'duckduckgo',
      search: async (query, provider, opts) => {
        seen.push({ query, opts });
        return [];
      },
      fetchPage: async (url) => ({ url, title: url, text: 't' }),
    });
    await surface.handler({ name: 'source_check', arguments: { claim: 'tokamaks use magnetic confinement' } });
    assert.equal(seen.length, 1, 'timeless claims search once, exactly as before');
    assert.equal(seen[0].opts?.recencyFilter, undefined, 'no recency rides a timeless check');
  });
});

describe('Track E — claim-level verification before citation', () => {
  it('flags temporal sentences cited only to stale or undated excerpts', async () => {
    const report = 'The latest tokamak record was set this year [1]. Magnetic confinement uses toroidal fields [2].';
    const flagged = verifyTemporalGrounding(report, [
      { index: 1, publishedAt: '2021-03-01T00:00:00.000Z' },
      { index: 2, publishedAt: undefined },
    ]);
    assert.equal(flagged.length, 1, 'only the temporal claim is questioned');
    assert.equal(flagged[0].index, 0, 'the flag names the sentence index');
    assert.deepEqual(flagged[0].citedIndices, [1]);
    assert.match(flagged[0].reason, /stale/i);
  });

  it('clears temporal sentences backed by fresh excerpts', async () => {
    const report = 'The latest tokamak record was set this year [1].';
    const flagged = verifyTemporalGrounding(report, [
      { index: 1, publishedAt: new Date(Date.now() - 5 * 86400000).toISOString() },
    ]);
    assert.deepEqual(flagged, [], 'fresh backing clears the claim');
  });
});

describe('Track E — provider-side recency reaches the mechanism', () => {
  it('searchViaExtension threads recencyFilter and echoes what it applied', async () => {
    const { searchViaExtension, resetSearchPlane } = await importEngine('searchPlane.js');
    globalThis.fetch = (async () => new Response(DDG_ONE_RESULT, { status: 200 }));
    try {
      const out = await searchViaExtension('latest tokamak benchmarks', { provider: 'duckduckgo', recencyFilter: 'week' });
      assert.equal(out.results.length, 1);
      assert.equal(out.recencyFilter, 'week', 'the outcome echoes the applied recency');
      const plain = await searchViaExtension('tokamak benchmarks', { provider: 'duckduckgo' });
      assert.equal(plain.recencyFilter, undefined, 'no recency means no scoping, exactly as before');
    } finally {
      resetSearchPlane();
    }
  });

  it('legacy retrieval paths thread recency into the plane (no second default)', async () => {
    const agentSrc = await readSrc('agent.ts');
    assert.match(agentSrc, /recencyFilter/, 'the delegated loop carries recency to the plane');
    const planeSrc = await readSrc('searchPlane.ts');
    assert.match(planeSrc, /recencyFilter/, 'the plane forwards recency to the extension');
    const searchSrc = await readSrc('search.ts');
    assert.match(searchSrc, /recencyFilter/, 'the MultiSearchProvider seam carries recency for wide mode');
    const wideSrc = await readSrc('wideAgent.ts');
    assert.match(wideSrc, /recencyFilter/, 'wide discovery threads recency through its search seam');
    const researcherSrc = await readSrc('researcherAgent.ts');
    assert.match(researcherSrc, /publishedAt/, 'researcher harvest retains provider dates (auto-recency arrives via the surface it wraps)');
  });
});
