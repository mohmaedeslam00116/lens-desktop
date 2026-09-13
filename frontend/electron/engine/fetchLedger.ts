import { normalizeCanonicalUrl } from './dedup';

/**
 * fetchLedger.ts — session-scoped cross-researcher fetch ledger (ADR-0010
 * decision 8, ticket #90): a URL fetched by one researcher is never re-fetched
 * by another; instead the already-admitted evidence is shared. The ledger
 * anchors on the LENS DeduplicationEngine's canonical-URL normalization so
 * dedupe semantics stay consistent with the engine's own Level-1 dedupe.
 *
 * Correctness contract: the first researcher to need a URL owns its single
 * fetch; concurrent researchers needing the same URL attach to the same
 * in-flight promise and receive the SAME admitted page (no re-fetch, no
 * drift), flagged `shared: true`. On fetch failure the memoized null is
 * dropped so a later researcher may retry. Canonical-keyed maps hold at most
 * one entry per fetched URL and are evicted on session teardown, so the
 * ledger is memory-bounded.
 */

/** One admitted finding flowing through the ledger. */
export interface LedgerEntry {
  page: ScrapedPageLike;
  /** Milestone provenance of the researcher that first fetched it. */
  milestoneId: string;
  milestoneTitle: string;
  /** True when THIS caller received evidence fetched by another researcher
   * (the ledger's cross-researcher dedupe in action). */
  shared: boolean;
}

/** Minimal structural page type (avoids an import cycle with scraper.ts).
 * Extra fields (e.g. milestone provenance) are read via narrowing casts. */
interface ScrapedPageLike {
  url: string;
  title?: string;
  domain?: string;
  content?: string;
  credibilityScore?: number;
}

interface Ledger {
  /** In-flight or completed fetches, keyed by canonical URL. */
  entries: Map<string, Promise<LedgerEntry | null>>;
}

const ledgers = new Map<string, Ledger>();

function ledgerFor(sessionId: string): Ledger {
  let ledger = ledgers.get(sessionId);
  if (!ledger) {
    ledger = { entries: new Map() };
    ledgers.set(sessionId, ledger);
  }
  return ledger;
}

/**
 * Claims a URL for a single session-wide fetch and shares the result.
 *
 * - First caller: owns the fetch; `shared` is false on its entry.
 * - Concurrent/later callers: attach to the same in-flight fetch and receive
 *   the identical admitted page with `shared` set to true — the URL is never
 *   re-fetched for them.
 * - A failed fetch (`null`) is not memoized: the next caller becomes the new
 *   owner and may retry.
 */
export async function claimAndShare(
  sessionId: string,
  url: string,
  fetchPage: () => Promise<ScrapedPageLike | null>
): Promise<LedgerEntry | null> {
  const ledger = ledgerFor(sessionId);
  const canonical = normalizeCanonicalUrl(url);
  const existing = ledger.entries.get(canonical);
  if (existing) {
    const shared = await existing;
    if (!shared) {
      // The earlier fetch failed: drop the memoized null so the next caller
      // becomes the new owner and may retry the fetch.
      ledger.entries.delete(canonical);
      return null;
    }
    return { ...shared, shared: true };
  }
  const p = (async (): Promise<LedgerEntry | null> => {
    try {
      const page = await fetchPage();
      if (!page) return null;
      return {
        page,
        milestoneId: (page as { milestoneId?: string }).milestoneId || '',
        milestoneTitle: (page as { milestoneTitle?: string }).milestoneTitle || '',
        shared: false,
      };
    } catch {
      // Fetch faults (network, abort) resolve to null — never reject through
      // the shared promise, or every attacher would throw.
      return null;
    }
  })();
  // Registered synchronously in the same tick as the get() above, so no
  // interleaving caller can miss the claim.
  ledger.entries.set(canonical, p);
  const own = await p;
  if (!own) {
    // Own fetch failed: release the claim so a later caller can retry.
    ledger.entries.delete(canonical);
  }
  return own;
}

/** Clears one session's ledger — call on session teardown. */
export function resetFetchLedger(sessionId: string): void {
  ledgers.delete(sessionId);
}
