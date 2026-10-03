import { SearchResultItem } from './types';
import { DEFAULT_SEARCH_PROVIDER } from './searchPlane';

/**
 * MultiSearchProvider — post-#112 contract (ADR-0013 D2).
 *
 * Thin compatibility facade over the primary plane (no independent
 * provider/fallback policy here): every call delegates to
 * `primarySearchPlane`, which owns the bounded attempt plan.
 *
 * The keyed provider implementations (Tavily / Serper HTTP clients) retired:
 * keyed search now serves through the primary plane's vendored providers
 * (`searchWithTavily` / `searchWithSerper` via jiti), which read credentials
 * from `web-search.json` / environment variables provisioned by the LENS
 * settings → config seam (`engine/configSeam.ts`). Key material is passed as
 * an explicit override for one call only — never logged, never persisted
 * outside the config seam's own file.
 *
 * `search()` remains the canonical keyed-provider entry for wide mode and
 * the plane's legacy signature: it delegates verbatim to the primary plane,
 * which owns the bounded attempt plan (requested → auto → keyless DDG).
 */
export class MultiSearchProvider {
  static async search(
    query: string,
    provider: string = DEFAULT_SEARCH_PROVIDER,
    apiKeys?: Record<string, string>,
    maxResults = 8,
    signal?: AbortSignal,
    /**
     * Track E per-call retrieval scoping (SPEC #155): provider-side
     * recency/domain filters. Optional and trailing — existing 5-arg callers
     * behave exactly as before.
     */
    searchOpts?: {
      recencyFilter?: 'day' | 'week' | 'month' | 'year';
      domainFilter?: string[];
    }
  ): Promise<SearchResultItem[]> {
    const { primarySearchPlane } = await import('./searchPlane');
    // Compatibility facade: the plane owns provider mapping, the bounded
    // attempt plan, and all retrieval policy — nothing is duplicated here.
    return primarySearchPlane(query, provider, apiKeys, maxResults, signal, undefined, searchOpts);
  }
}
