import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * Track F — adversarial freshness tests, LIVE (SPEC #155, #161).
 *
 * Keyed legs assert what the live mechanism honestly provides: returned
 * DATES where supplied (absent means unknown — never invented), provider
 * PROVENANCE on every item (observed, never assumed), recency forwarding,
 * and domain enforcement. Provider prose is NEVER asserted (providers drift;
 * prose is not a contract) — only mechanism-emitted markers (responseId,
 * auto-recency notes) are matched.
 *
 * Human-in-the-loop by design:
 * - The whole battery SKIPS LOUDLY unless `LENS_LIVE_TESTS=1` is set —
 *   CI and keyless runs stay green deterministically. A skip is a notice,
 *   never a fake green: every live test names its missing precondition.
 * - Keyed legs additionally need `TAVILY_API_KEY` / `SERPER_API_KEY` in the
 *   environment (per-call provisioning into a temp agentDir — the operator's
 *   real config is never touched, keys never logged).
 * - Keyed validation runbook lives on ticket #161.
 *
 * Mechanism gap (documented, not worked around): the vendored Tavily/Serper
 * mappings keep only {title, url, snippet} — provider dates never reach the
 * plane. The date assertions below therefore pin the HONEST contract
 * (undefined-or-valid-ISO) until a vendor version retains dates, at which
 * point the same assertions tighten without modification.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const { searchViaExtension, resetSearchPlane } = await importEngine('searchPlane.js');
const { parsePublishedAt } = await importEngine('freshness.js');

const LIVE = process.env.LENS_LIVE_TESTS === '1';
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;

const liveOrSkip = (t, precondition, label) => {
  if (!LIVE) {
    t.skip(`LIVE test skipped — set LENS_LIVE_TESTS=1 to run (${label})`);
    return false;
  }
  if (!precondition) {
    t.skip(`LIVE test skipped — ${label}`);
    return false;
  }
  return true;
};

/** Temp agentDir: file provisioning stays hermetic; real config untouched. */
const tempAgentDir = () => mkdtempSync(join(tmpdir(), 'lens-trackf-'));

/** Asserts the honest date contract: absent (unknown) or valid ISO — never garbage, never invented. */
const assertHonestDates = (items, where) => {
  for (const item of items) {
    if (item.publishedAt === undefined) continue;
    assert.equal(typeof item.publishedAt, 'string', `${where}: publishedAt is a string when present`);
    assert.ok(!Number.isNaN(Date.parse(item.publishedAt)), `${where}: publishedAt parses (${item.publishedAt})`);
  }
};

/** Asserts observed (never assumed) provider provenance on every item. */
const assertProvenance = (outcome, provider, where) => {
  assert.ok(outcome.results.length > 0, `${where}: the live provider served results`);
  assert.equal(outcome.provider, provider, `${where}: outcome names the resolving provider`);
  for (const item of outcome.results) {
    assert.ok(item.title && item.url, `${where}: every item carries title + url`);
    assert.equal(item.searchProvider, outcome.provider, `${where}: every item carries observed provenance`);
  }
};

const keyedProviders = () => {
  const legs = [];
  if (TAVILY_KEY) legs.push({ provider: 'tavily', key: TAVILY_KEY, env: 'TAVILY_API_KEY' });
  if (SERPER_KEY) legs.push({ provider: 'serper', key: SERPER_KEY, env: 'SERPER_API_KEY' });
  return legs;
};

describe('Track F — live battery gate (skips loudly without opt-in)', () => {
  it('the battery announces its preconditions instead of faking green', (t) => {
    if (!LIVE) {
      t.skip('LIVE battery idle — set LENS_LIVE_TESTS=1 plus provider keys for keyed legs (see #161 runbook)');
      return;
    }
    assert.ok(true, 'live mode acknowledged by the operator');
  });
});

for (const leg of [{ provider: 'tavily', env: 'TAVILY_API_KEY' }, { provider: 'serper', env: 'SERPER_API_KEY' }]) {
  describe(`Track F — live keyed leg: ${leg.provider}`, () => {
    it('temporal model-announcement queries serve with provenance + honest dates', { timeout: 180_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      // All three labs named by the ticket; one test, two live calls.
      const agentDir = tempAgentDir();
      try {
        for (const topic of ['latest OpenAI model announcement', 'latest Gemini model announcement']) {
          const outcome = await searchViaExtension(topic, {
            provider: leg.provider,
            numResults: 5,
            recencyFilter: 'month',
            apiKeys: { [leg.provider]: key },
            agentDir,
          });
          assertProvenance(outcome, leg.provider, `model-announcement (${topic})`);
          assert.equal(outcome.recencyFilter, 'month', 'the recency forwarded is the recency echoed');
          assertHonestDates(outcome.results, `model-announcement (${topic})`);
        }
      } finally {
        resetSearchPlane();
      }
    });

    it('today-news query serves day-scoped with provenance', { timeout: 120_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      try {
        const outcome = await searchViaExtension('breaking technology news today', {
          provider: leg.provider,
          numResults: 5,
          recencyFilter: 'day',
          apiKeys: { [leg.provider]: key },
          agentDir: tempAgentDir(),
        });
        assertProvenance(outcome, leg.provider, 'today-news');
        assert.equal(outcome.recencyFilter, 'day');
        assertHonestDates(outcome.results, 'today-news');
      } finally {
        resetSearchPlane();
      }
    });

    it('historical control rides unscoped (no silent recency)', { timeout: 120_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      try {
        const outcome = await searchViaExtension('history of quantum computing', {
          provider: leg.provider,
          numResults: 5,
          apiKeys: { [leg.provider]: key },
          agentDir: tempAgentDir(),
        });
        assertProvenance(outcome, leg.provider, 'historical-control');
        assert.equal(outcome.recencyFilter, undefined, 'timeless queries ride unscoped, live');
      } finally {
        resetSearchPlane();
      }
    });

    it('official-source request enforces the domain filter', { timeout: 120_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      try {
        const outcome = await searchViaExtension('frontier AI model announcement', {
          provider: leg.provider,
          numResults: 8,
          domainFilter: ['openai.com'],
          apiKeys: { [leg.provider]: key },
          agentDir: tempAgentDir(),
        });
        assert.ok(outcome.results.length > 0, 'the official-source request served results');
        // Deliberately strict (adversarial): one off-domain URL fails the
        // leg — syndication/redirect drift is provider signal, not noise.
        for (const item of outcome.results) {
          assert.ok(
            item.url.includes('openai.com'),
            `domain filter enforced live — got ${item.url}`
          );
        }
      } finally {
        resetSearchPlane();
      }
    });

    it('stale high-rank results lose to fresh ones where dates exist (skips honestly where they do not)', { timeout: 180_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      const { selectPassagesWithMMR } = await importEngine('mmr.js');
      const agentDir = tempAgentDir();
      try {
        const outcome = await searchViaExtension('latest frontier AI model release', {
          provider: leg.provider,
          numResults: 10,
          recencyFilter: 'month',
          apiKeys: { [leg.provider]: key },
          agentDir,
        });
        assertProvenance(outcome, leg.provider, 'stale-leg');
        const dated = outcome.results.filter((r) => r.publishedAt !== undefined && !Number.isNaN(Date.parse(r.publishedAt)));
        if (dated.length < 2) {
          t.skip(`stale leg untestable live — provider supplied ${dated.length} dated item(s) (see vendored date gap on #161)`);
          return;
        }
        const now = Date.now();
        const candidates = dated.map((r, i) => ({
          id: r.url,
          score: dated.length - i,
          content: `${r.title} ${r.snippet}`,
          sourceId: r.url,
          domain: r.url,
          credibilityScore: 1.0,
          publishedAt: r.publishedAt,
        }));
        const ranked = selectPassagesWithMMR(candidates, {
          maxPassages: dated.length,
          temporalIntent: true,
          now,
          similarityFn: () => 0,
        });
        const oldest = dated.reduce((a, b) => (Date.parse(a.publishedAt) <= Date.parse(b.publishedAt) ? a : b));
        assert.notEqual(ranked.selected[0].id, oldest.url, 'the stalest live result does not rank first under temporal intent');
      } finally {
        resetSearchPlane();
      }
    });

    it('conflicting-numbers claim verifies to a multi-source artifact', { timeout: 180_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
      const { searchViaExtension: liveSearch } = await importEngine('searchPlane.js');
      const agentDir = tempAgentDir();
      const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
      const surface = createAgenticToolSurface({
        sessionId: `s-trackf-conflict-${leg.provider}`,
        state,
        maxFetches: 8,
        emit: () => {},
        searchProvider: leg.provider,
        search: async (query, provider, opts) => {
          const out = await liveSearch(query, {
            provider: provider ?? leg.provider,
            numResults: opts?.numResults ?? 5,
            ...(opts?.recencyFilter ? { recencyFilter: opts.recencyFilter } : {}),
            ...(opts?.domainFilter ? { domainFilter: opts.domainFilter } : {}),
            apiKeys: { [leg.provider]: key },
            agentDir,
          });
          return out.results.map((h) => ({
            url: h.url, title: h.title, snippet: h.snippet,
            ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
          }));
        },
        fetchPage: async () => null,
      });
      try {
        const out = await surface.handler({
          name: 'source_check',
          arguments: { claim: 'latest frontier AI model context window size', fetchContent: false },
        });
        assert.equal(out.success, true, `check served live (${out.error ?? 'ok'})`);
        assert.ok(state.sources.length >= 2, `conflicting-numbers check admits multiple sources live (got ${state.sources.length})`);
        assert.match(String(out.result), /responseId:/, 'the artifact names its stored response for citation');
      } finally {
        resetSearchPlane();
      }
    });

    it('freshness path engages live (temporal auto-recency + stored round-trip)', { timeout: 180_000 }, async (t) => {
      const key = leg.provider === 'tavily' ? TAVILY_KEY : SERPER_KEY;
      if (!liveOrSkip(t, key, `needs ${leg.env}`)) return;
      const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
      const { searchViaExtension: liveSearch } = await importEngine('searchPlane.js');
      const agentDir = tempAgentDir();
      const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
      const surface = createAgenticToolSurface({
        sessionId: `s-trackf-fresh-${leg.provider}`,
        state,
        maxFetches: 8,
        emit: () => {},
        searchProvider: leg.provider,
        search: async (query, provider, opts) => {
          const out = await liveSearch(query, {
            provider: provider ?? leg.provider,
            numResults: opts?.numResults ?? 5,
            ...(opts?.recencyFilter ? { recencyFilter: opts.recencyFilter } : {}),
            ...(opts?.domainFilter ? { domainFilter: opts.domainFilter } : {}),
            apiKeys: { [leg.provider]: key },
            agentDir: tempAgentDir(),
          });
          return out.results.map((h) => ({
            url: h.url, title: h.title, snippet: h.snippet,
            ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
          }));
        },
        fetchPage: async () => null,
      });
      try {
        const searched = await surface.handler({
          name: 'web_search',
          arguments: { query: 'latest xAI model announcement' },
        });
        assert.equal(searched.success, true);
        assert.match(String(searched.result), /auto-applied/, 'temporal auto-recency engaged live');
        const responseId = String(searched.result).match(/responseId:\s*(\S+)/)?.[1];
        assert.ok(responseId, 'a stored responseId issued live');
        const page = await surface.handler({ name: 'get_search_content', arguments: { responseId, limit: 500 } });
        assert.equal(page.success, true, 'stored content round-trips live');
      } finally {
        resetSearchPlane();
      }
    });
  });
}

describe('Track F — key hygiene (live, fake key, refusal or honest fallback)', () => {
  it('a bad key is refused loudly (redacted) or served via the keyless fallback with observed provenance — never served as keyed, never leaking', { timeout: 120_000 }, async (t) => {
    if (!liveOrSkip(t, true, 'needs network egress only')) return;
    const fakeKey = 'tvly-FAKE-KEY-FOR-HYGIENE-PROBE-0000';
    let message = '';
    let outcome = null;
    try {
      outcome = await searchViaExtension('tokamak records', {
        provider: 'tavily',
        numResults: 3,
        apiKeys: { tavily: fakeKey },
        agentDir: tempAgentDir(),
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      resetSearchPlane();
    }
    if (message) {
      // Loud refusal path: key material redacted.
      assert.doesNotMatch(message, /FAKE-KEY-FOR-HYGIENE/, 'key material never leaks into errors');
    } else {
      // Honest-fallback path (searchPlane DDG-last contract): the keyed
      // selection failed and the keyless chain served instead — the outcome
      // must SAY SO via observed provenance, never masquerade as keyed.
      assert.ok(outcome && outcome.results.length > 0, 'fallback served results');
      assert.notEqual(outcome.provider, 'tavily', 'fallback provenance observed, never assumed keyed');
      for (const item of outcome.results) {
        assert.equal(item.searchProvider, outcome.provider);
        assert.doesNotMatch(`${item.title} ${item.url} ${item.snippet}`, /FAKE-KEY-FOR-HYGIENE/);
      }
    }
  });
});

describe('Track F — mechanism date gap (pinned offline, no keys needed)', () => {
  it('parsePublishedAt accepts what providers will one day supply', async () => {
    assert.equal(parsePublishedAt('2026-09-20T00:00:00Z'), '2026-09-20T00:00:00.000Z');
    assert.equal(parsePublishedAt(undefined), undefined, 'absent stays absent — never invented');
  });

  it('keyed legs available in this environment', (t) => {
    const legs = keyedProviders();
    if (!LIVE) {
      t.skip(`key inventory skipped keyless — set LENS_LIVE_TESTS=1 to report (tavily: ${TAVILY_KEY ? 'present' : 'absent'}, serper: ${SERPER_KEY ? 'present' : 'absent'})`);
      return;
    }
    console.log(`[track-f] live legs: ${legs.map((l) => l.provider).join(', ') || 'none (keyless live)'}`);
    assert.ok(true);
  });
});
