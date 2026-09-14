export interface ScrapedPage {
  url: string;
  title: string;
  domain: string;
  content: string;
  credibilityScore: number;
  /** Research-facet provenance (ADR-0010 phase 2, ticket #89): set on pages
   * retrieved by a researcher subagent for its assigned facet. */
  milestoneId?: string;
  milestoneTitle?: string;
}

export function calculateCredibilityScore(url: string): number {
  try {
    const domain = new URL(url).hostname.toLowerCase().replace('www.', '');

    const highTrust = [
      'arxiv.org', 'nature.com', 'sciencedirect.com', 'ieee.org', 'acm.org',
      'github.com', 'mit.edu', 'stanford.edu', 'harvard.edu', 'nih.gov',
      'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'bbc.com',
      'openai.com', 'anthropic.com', 'deepmind.google', 'huggingface.co',
      'wikipedia.org', 'stackoverflow.com', 'developer.mozilla.org'
    ];

    if (highTrust.some(d => domain.includes(d))) return 95;
    if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 96;
    if (domain.endsWith('.org')) return 88;
    if (domain.endsWith('.ai') || domain.endsWith('.io')) return 84;
    return 80;
  } catch {
    return 75;
  }
}

/**
 * PageScraper — post-contract facade (ADR-0013, ticket #111).
 *
 * The native fetch/cheerio implementation retired: `scrape` is a thin
 * delegation to the primary scrape plane — pi-web-access `extractContent`
 * behind the LENS concurrency gate and plane ledger (boundary clause D5:
 * no unledgered retrieval). Signature, cancellation, and error semantics
 * are unchanged, so every existing caller and pinned test contract holds.
 *
 * Kept as a static facade (rather than deleted) because tests stub it at
 * this exact seam (`PageScraper.scrape = ...`) to inject offline fixtures —
 * the stub interception point for the whole engine. The plane is reached
 * through a dynamic import only, so `scrapePlane → scraper` stays the sole
 * static edge between the two modules (no import cycle at init time).
 */
export class PageScraper {
  static async scrape(url: string, timeoutMs = 8000, signal?: AbortSignal): Promise<ScrapedPage> {
    const { primaryScrapePlane } = await import('./scrapePlane');
    return primaryScrapePlane(url, timeoutMs, signal);
  }
}
