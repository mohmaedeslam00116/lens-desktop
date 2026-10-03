import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Live retrieval smoke — the real production chain, unmocked:
 *
 *   Packaged Electron runtime → jiti → vendored Pi Web Access
 *   → unified search() → provider → real internet
 *
 * then one real source fetch through the scrape plane. Opt-in via
 * `LENS_LIVE_TESTS=1` so CI never depends on external availability.
 * Stable by construction: non-empty results, valid URLs, non-empty
 * titles, successful non-empty fetch — never exact titles, rankings,
 * URLs, or counts (search engines drift).
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const LIVE = process.env.LENS_LIVE_TESTS === '1';

const liveOrSkip = (t, label) => {
  if (!LIVE) {
    t.skip(`LIVE smoke skipped — set LENS_LIVE_TESTS=1 to run (${label})`);
    return false;
  }
  return true;
};

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

describe('Live retrieval smoke (real runtime path, opt-in)', () => {
  it('real search serves usable results and a real fetch serves content', { timeout: 180_000 }, async (t) => {
    if (!liveOrSkip(t, 'needs network egress to a search provider')) return;
    const { searchViaExtension, resetSearchPlane } = await importEngine('searchPlane.js');
    const { primaryScrapePlane, resetScrapePlane } = await importEngine('scrapePlane.js');
    try {
      const out = await searchViaExtension('tokamak fusion energy benchmark', {
        provider: 'duckduckgo',
        numResults: 5,
      });
      assert.ok(out.results.length >= 1, 'the real provider served at least one result');
      for (const item of out.results) {
        assert.ok(item.title && item.title.trim(), 'every result carries a non-empty title');
        assert.ok(isValidHttpUrl(item.url), `every result URL is valid — got ${item.url}`);
      }
      const first = out.results[0];
      const page = await primaryScrapePlane(first.url, 15000);
      assert.ok(page.content && page.content.length > 0, 'the real fetch served non-empty content');
    } finally {
      resetSearchPlane();
      resetScrapePlane();
    }
  });
});
