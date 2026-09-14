import * as path from 'node:path';
import { ScrapedPage, calculateCredibilityScore } from './scraper';

/**
 * scrapePlane.ts — the primary scrape plane (ADR-0013, ticket #111).
 *
 * pi-web-access `extractContent` (the engine of `fetch_content`) serves page
 * retrieval behind the engine's scrape seam. LENS page/evidence structures
 * stay authoritative: the adapter converts vendored content into the LENS
 * `ScrapedPage` shape so evidence admission, dedupe, the budget ledger,
 * snapshot wrapping, and provenance semantics operate unchanged.
 *
 * Boundary clause (D5): every vendored fetch is admitted through a bounded
 * concurrency gate and counted in the plane ledger — no unledgered retrieval.
 * Vendored SSRF validation stays ON (hardening over the native scraper, which
 * fetched any URL unvalidated); `ExtractOptions.lookup` is injected so the
 * module resolves hostnames through plain Node DNS with no platform-specific
 * lookup ordering — and so offline tests (fixture hostnames) resolve without
 * real DNS, mirroring how the vendored module accepts a test resolver.
 *
 * Cancellation and saturation mirror the search plane: caller aborts
 * propagate as AbortError, queue saturation fails loudly.
 */

const VENDOR_ROOT = path.join(__dirname, '..', 'vendor', 'pi');

/** Concurrent vendored extractions (parity with SEARCH_QUERY_CONCURRENCY=3). */
const PLANE_CONCURRENCY = 3;
/** Bounded admission queue: saturation fails loudly (no unbounded waiter memory). */
const PLANE_MAX_QUEUE = 32;
/**
 * LENS content budget. The vendored module caps HTTP bodies at 5 MB; the
 * native scraper capped stored content at ~6,000 characters, so the LENS-side
 * cap (matching the native stored-content budget) stays here.
 */
const SCRAPE_CONTENT_BUDGET = 6000;

function abortError(): Error {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

type LookupResult = Array<{ address: string; family: number }>;

interface VendoredExtractResult {
  url: string;
  title: string;
  content: string;
  error: string | null;
  status?: number;
}

type VendoredExtractFn = (
  url: string,
  signal?: AbortSignal,
  options?: { timeoutMs?: number; lookup?: (hostname: string) => Promise<LookupResult> }
) => Promise<VendoredExtractResult>;

let cachedExtract: VendoredExtractFn | null = null;

async function loadExtractContent(): Promise<VendoredExtractFn> {
  if (cachedExtract) return cachedExtract;
  const piPackages = await import('./piPackages');
  const loader = await piPackages.getJitiLoader();
  if (!loader) throw new Error('jiti loader unavailable');
  const entryPath = path.join(VENDOR_ROOT, 'web-access', 'extract.ts');
  const mod = (await loader(entryPath)) as { extractContent?: unknown };
  const extractContent = mod?.extractContent;
  if (typeof extractContent !== 'function') {
    throw new Error('vendored extract module exposes no extractContent');
  }
  cachedExtract = extractContent as VendoredExtractFn;
  return cachedExtract;
}

/** Admission gate: mirrors the search plane's abort-aware, bounded queue. */
class ScrapeGate {
  private active = 0;
  private ledgerCount = 0;
  private waiters: Array<{
    resolve: () => void;
    reject: (e: Error) => void;
    signal?: AbortSignal;
    onAbort: () => void;
  }> = [];

  get ledgered(): number {
    return this.ledgerCount;
  }

  get activeCount(): number {
    return this.active;
  }

  get queueDepth(): number {
    return this.waiters.length;
  }

  /** Resolves when a slot is granted. Rejected on abort or saturation. */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < PLANE_CONCURRENCY) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= PLANE_MAX_QUEUE) {
      const err = new Error('[scrapePlane] admission queue saturated');
      err.name = 'ScrapePlaneQueueSaturated';
      return Promise.reject(err);
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const i = this.waiters.indexOf(waiter);
          if (i !== -1) this.waiters.splice(i, 1);
          reject(abortError());
        },
      };
      if (signal) {
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  /** Releases one slot. Waiters inherit it directly (no second increment). */
  release(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      waiter.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  countLedgered(): void {
    this.ledgerCount += 1;
  }

  /** Resets gate + ledger. Requires an idle gate so live waiters are never stranded. */
  reset(): void {
    if (this.active !== 0 || this.waiters.length !== 0) {
      throw new Error('[scrapePlane] reset() requires an idle gate (no active calls or waiters)');
    }
    this.ledgerCount = 0;
  }
}

const gate = new ScrapeGate();

/**
 * Test seam: overrides the DNS lookup handed to the vendored SSRF validator.
 * Production uses plain Node DNS; offline tests inject a resolver for fixture
 * hostnames (no real DNS), mirroring the vendored module's own `lookup` test
 * option. Reset with `setLookupOverride(null)`.
 */
let lookupOverride: ((hostname: string) => Promise<LookupResult>) | null = null;
export const __testSeams = {
  setLookupOverride(fn: ((hostname: string) => Promise<LookupResult>) | null): void {
    lookupOverride = fn;
  },
};

/** Plane ledger snapshot: proves (and surfaces) every retrieval admission. */
export function scrapePlaneLedgerSnapshot(): { active: number; ledgered: number } {
  return { active: gate.activeCount, ledgered: gate.ledgered };
}

/** Resets the vendored module cache and ledger counters (test seam). */
export function resetScrapePlane(): void {
  cachedExtract = null;
  gate.reset();
}

/** Error text marking content the LENS evidence path must treat as unavailable. */
export const CONTENT_UNAVAILABLE_PREFIX = 'Content unavailable from ';

/**
 * Converts one vendored extraction into the LENS `ScrapedPage` shape.
 * Success path only — error mapping lives in `primaryScrapePlane`.
 */
function toScrapedPage(url: string, result: VendoredExtractResult): ScrapedPage {
  let domain = url;
  try {
    domain = new URL(url).hostname.replace('www.', '');
  } catch {
    // keep the raw url as domain, as the native scraper did
  }
  const credibilityScore = calculateCredibilityScore(url);

  let content = (result.content ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (content.length > SCRAPE_CONTENT_BUDGET) {
    content = content.slice(0, SCRAPE_CONTENT_BUDGET) + '... [content trimmed]';
  }
  return {
    url,
    title: result.title || domain,
    domain,
    content: content || `Extracted summary from ${domain}`,
    credibilityScore,
  };
}

/**
 * The primary scrape plane. Signature-compatible with `PageScraper.scrape`,
 * so it slots behind the engine's scrape seam (agent loop, researchers, and
 * the bounded scraper pool's default fetcher).
 *
 * Cancellation propagates as AbortError — never a successful empty result.
 * Queue saturation fails loudly instead of degrading silently.
 */
export async function primaryScrapePlane(
  url: string,
  timeoutMs = 8000,
  signal?: AbortSignal
): Promise<ScrapedPage> {
  if (signal?.aborted) throw abortError();
  await gate.acquire(signal);
  try {
    gate.countLedgered();
    if (signal?.aborted) throw abortError();
    const extractContent = await loadExtractContent();
    const result = await extractContent(url, signal, {
      timeoutMs,
      // Plain Node DNS resolution (A/AAAA via the platform resolver); keeps
      // vendored SSRF validation ON while allowing offline fixture hostnames
      // to be intercepted in tests.
      lookup: lookupOverride ?? (async (hostname) => {
        const dns = await import('node:dns');
        const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
        return addresses.map((a) => ({ address: a.address, family: a.family }));
      }),
    });
    // Cancellation contract: a caller abort is always an AbortError, never a
    // converted error/sentinel (mirrors the search plane).
    if (signal?.aborted) throw abortError();
    if (result.error) {
      if (typeof result.status === 'number') {
        // Origin answered with an HTTP error: native unavailable-content
        // sentinel (never thrown) — the pool's rate-limit backoff keys on it.
        let domain = url;
        try { domain = new URL(url).hostname.replace('www.', ''); } catch { /* raw */ }
        return {
          url,
          title: domain,
          domain,
          content: `${CONTENT_UNAVAILABLE_PREFIX}${url} (HTTP ${result.status}).`,
          credibilityScore: calculateCredibilityScore(url),
        };
      }
      // No status: transport-level failure (native contract throws).
      if (/abort/i.test(result.error)) {
        // Vendored timeout/cancellation collapse into one error shape; the
        // caller signal is not aborted here, so this is the call's own timeout.
        throw new Error(`Failed to scrape ${url}: Request timed out`);
      }
      throw new Error(`Failed to scrape ${url}: ${result.error}`);
    }
    return toScrapedPage(url, result);
  } finally {
    gate.release();
  }
}
