import { SearchResultItem } from './types';

/**
 * MultiSearchProvider — post-#112 contract (ADR-0013 D2).
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
 * the plane's legacy signature: a vendored keyed failure degrades to the
 * keyless DDG plane (native semantic); the keyless path never re-enters
 * `search()` (terminal-fallback contract, #110).
 */
export class MultiSearchProvider {
  static async search(
    query: string,
    provider: 'duckduckgo' | 'tavily' | 'serper' | 'google' = 'duckduckgo',
    apiKeys?: Record<string, string>,
    maxResults = 8,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const { primarySearchPlane } = await import('./searchPlane');
    return primarySearchPlane(query, provider, apiKeys, maxResults, signal);
  }
}
