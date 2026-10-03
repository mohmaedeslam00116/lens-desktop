/**
 * Pi-owned search-provider catalog — Track A of the Pi-owned retrieval
 * migration (SPEC #155, ticket #156).
 *
 * The eligible search providers are engine truth served from this seam, not
 * a renderer allowlist: `GET /api/pi/search-providers` serves exactly what
 * `getSearchProviderCatalog()` returns, and the Settings Search tab renders
 * that response verbatim. Zero key material — entries name the settings key
 * field (`keyField`), never a secret.
 *
 * Scope note: this is the LENS-supported set (providers with complete
 * end-to-end support: UX, credentials, tests, evidence pipeline) — NOT the
 * full Pi Web Access provider set. Pi supports many more providers; exposing
 * them here is follow-up work, not a bug fix.
 *
 * Backend v1 serves the plane providers (keyless DuckDuckGo default, keyed
 * Tavily/Serper). Track C swaps this backend to the upgraded extension
 * surface (`web-search.json` routing truth) without touching the route or
 * the renderer — that is the point of the seam.
 */

export interface SearchProviderEntry {
  id: string;
  name: string;
  /** Card badge: the keyless default, automatic Pi selection, or bring-your-own-key. */
  badge: 'Default' | 'Auto' | 'BYOK';
  descEn: string;
  descAr: string;
  /**
   * Settings key field holding this provider's credential
   * (`ApiSettings.keys[keyField]`), or absent when keyless. A field name,
   * never a secret.
   */
  keyField?: string;
}

/**
 * The eligible search providers, in display order. Sorted deterministically;
 * the route serves this list verbatim so renderer and engine cannot drift.
 */
export function getSearchProviderCatalog(): SearchProviderEntry[] {
  return [
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      badge: 'Default',
      descEn: 'Free & built-in, zero setup required',
      descAr: 'مجاني ومدمج 100% بدون أي إعداد أو مفاتيح',
    },
    {
      id: 'auto',
      name: 'Auto',
      badge: 'Auto',
      descEn: 'Pi selects the provider per query, keyless DDG as final fallback',
      descAr: 'يختار Pi المزود لكل استعلام تلقائياً، مع DuckDuckGo المجاني كملاذ أخير',
    },
    {
      id: 'tavily',
      name: 'Tavily Search',
      badge: 'BYOK',
      descEn: 'Autonomous AI agent search API',
      descAr: 'محرك بحث متقدم مصمم لوكلاء الذكاء الاصطناعي',
      keyField: 'tavily',
    },
    {
      id: 'serper',
      name: 'Google (Serper)',
      badge: 'BYOK',
      descEn: 'Full Google organic index',
      descAr: 'فهرس نتائج Google الكامل',
      keyField: 'serper',
    },
  ];
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = {
  getSearchProviderCatalog,
};
