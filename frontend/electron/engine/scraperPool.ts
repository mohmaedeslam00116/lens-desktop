import { PageScraper, ScrapedPage } from './scraper';
import { DeduplicationEngine, DeduplicationStats, normalizeCanonicalUrl } from './dedup';

export interface BoundedScraperPoolOptions {
  globalConcurrency?: number;
  hostConcurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  maxCharsPerPage?: number;
  customFetcher?: (url: string, timeoutMs: number, signal?: AbortSignal) => Promise<ScrapedPage>;
  deduplicator?: DeduplicationEngine;
}

interface QueuedScrapeTask {
  url: string;
  canonicalUrl: string;
  hostname: string;
  retries: number;
  runAfter?: number;
  signal?: AbortSignal;
  resolve: (page: ScrapedPage | null) => void;
}

/**
 * Helper to extract and normalize hostname from URL.
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'invalid';
  }
}

/**
 * High-throughput Asynchronous Scraper Pool
 *
 * Scrapes 100–200+ sources concurrently with global (C_global = 10) and per-host (C_host = 2)
 * concurrency limits, 10s request timeouts, non-blocking exponential backoff on HTTP 429/503,
 * and automated 3-level deduplication to maintain sub-10 MB RAM footprints.
 */
export class BoundedScraperPool {
  private readonly globalConcurrency: number;
  private readonly hostConcurrency: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly maxCharsPerPage: number;
  private readonly fetcher: (url: string, timeoutMs: number, signal?: AbortSignal) => Promise<ScrapedPage>;
  private readonly deduplicator: DeduplicationEngine;

  private activeGlobal = 0;
  private activePerHost = new Map<string, number>();
  private hostBackoffUntil = new Map<string, number>();
  private queue: QueuedScrapeTask[] = [];

  constructor(options: BoundedScraperPoolOptions = {}) {
    this.globalConcurrency = Math.max(1, options.globalConcurrency ?? 10);
    this.hostConcurrency = Math.max(1, options.hostConcurrency ?? 2);
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 10000);
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffBaseMs = options.backoffBaseMs ?? 100;
    this.maxCharsPerPage = options.maxCharsPerPage ?? 6000;
    this.fetcher = options.customFetcher ?? ((url, timeout, sig) => PageScraper.scrape(url, timeout, sig));
    this.deduplicator = options.deduplicator ?? new DeduplicationEngine();
  }

  /**
   * Scrapes a single URL through the pool respecting concurrency caps and deduplication.
   * Returns ScrapedPage if successfully scraped and admitted, or null if duplicate/failed.
   */
  public async scrape(url: string, options: { signal?: AbortSignal } = {}): Promise<ScrapedPage | null> {
    if (options.signal?.aborted) {
      return null;
    }

    // Level 1: Atomically check & claim canonical URL upfront
    const claim = this.deduplicator.claimUrl(url);
    if (!claim.claimed) {
      return null;
    }

    const hostname = extractHostname(url);

    return new Promise<ScrapedPage | null>((resolve) => {
      this.queue.push({
        url,
        canonicalUrl: claim.canonicalUrl,
        hostname,
        retries: 0,
        signal: options.signal,
        resolve
      });

      this.processQueue();
    });
  }

  /**
   * Scrapes a list of URLs concurrently through the pool.
   * Emits progress updates and returns all unique, admitted ScrapedPage instances.
   */
  public async scrapeAll(
    urls: string[],
    options: {
      signal?: AbortSignal;
      onProgress?: (completed: number, total: number, page: ScrapedPage | null) => void;
    } = {}
  ): Promise<ScrapedPage[]> {
    if (urls.length === 0) {
      return [];
    }

    let completed = 0;
    const total = urls.length;
    const results: ScrapedPage[] = [];

    const tasks = urls.map(async (url) => {
      if (options.signal?.aborted) {
        return null;
      }

      try {
        const page = await this.scrape(url, { signal: options.signal });
        completed++;
        if (page) {
          results.push(page);
        }
        if (options.onProgress) {
          options.onProgress(completed, total, page);
        }
        return page;
      } catch (err) {
        completed++;
        if (options.onProgress) {
          options.onProgress(completed, total, null);
        }
        return null;
      }
    });

    await Promise.all(tasks);
    return results;
  }

  /**
   * Returns active deduplication statistics.
   */
  public getDeduplicationStats(): DeduplicationStats {
    return this.deduplicator.getStats();
  }

  /**
   * Aborts a task and releases its claimed canonical URL.
   */
  private abortTask(task: QueuedScrapeTask): void {
    this.deduplicator.releaseUrl(task.canonicalUrl);
    task.resolve(null);
  }

  /**
   * Enforces request timeout internally via racing AbortController.
   */
  private async fetchWithTimeout(url: string, signal?: AbortSignal): Promise<ScrapedPage> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const onCallerAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      return await this.fetcher(url, this.timeoutMs, controller.signal);
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Internal scheduler processing queued tasks within global, per-host, and backoff bounds.
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    let earliestFutureRun: number | null = null;

    while (this.activeGlobal < this.globalConcurrency) {
      // Find next task whose host concurrency is below cap and whose host/task backoff has elapsed
      const taskIndex = this.queue.findIndex(task => {
        if (task.signal?.aborted) return true;

        const hostBackoff = this.hostBackoffUntil.get(task.hostname) || 0;
        const taskBackoff = task.runAfter || 0;
        const effectiveBackoff = Math.max(hostBackoff, taskBackoff);

        if (effectiveBackoff > now) {
          if (earliestFutureRun === null || effectiveBackoff < earliestFutureRun) {
            earliestFutureRun = effectiveBackoff;
          }
          return false;
        }

        const currentHostActive = this.activePerHost.get(task.hostname) || 0;
        return currentHostActive < this.hostConcurrency;
      });

      if (taskIndex === -1) {
        break;
      }

      const [task] = this.queue.splice(taskIndex, 1);

      if (task.signal?.aborted) {
        this.abortTask(task);
        continue;
      }

      const hostActive = (this.activePerHost.get(task.hostname) || 0) + 1;
      this.activePerHost.set(task.hostname, hostActive);
      this.activeGlobal++;

      // Execute task in background, freeing concurrency slots immediately on completion
      this.executeScrapeTask(task).finally(() => {
        this.activeGlobal--;
        const current = this.activePerHost.get(task.hostname) || 1;
        if (current <= 1) {
          this.activePerHost.delete(task.hostname);
        } else {
          this.activePerHost.set(task.hostname, current - 1);
        }
        this.processQueue();
      });
    }

    if (earliestFutureRun !== null) {
      const waitMs = Math.max(10, earliestFutureRun - Date.now());
      setTimeout(() => this.processQueue(), waitMs);
    }
  }

  /**
   * Executes an individual scrape task with timeout, exponential backoff, and content deduplication.
   */
  private async executeScrapeTask(task: QueuedScrapeTask): Promise<void> {
    if (task.signal?.aborted) {
      this.abortTask(task);
      return;
    }

    try {
      // Ingest using normalized canonical URL and enforce timeout internally
      const page = await this.fetchWithTimeout(task.canonicalUrl, task.signal);

      if (task.signal?.aborted) {
        this.abortTask(task);
        return;
      }

      // Check if page indicates rate limit response (e.g. from PageScraper fallback text)
      const isRateLimitedPage = page?.content &&
        (page.content.includes('(HTTP 429)') ||
         page.content.includes('(HTTP 503)') ||
         /rate limit|too many requests/i.test(page.content));

      if (isRateLimitedPage) {
        throw { status: 429, message: page.content };
      }

      if (!page || !page.content || page.content.startsWith('Error retrieving ')) {
        this.abortTask(task);
        return;
      }

      // Enforce memory bounds: cap content length per page
      let cleanContent = page.content;
      if (cleanContent.length > this.maxCharsPerPage) {
        cleanContent = cleanContent.slice(0, this.maxCharsPerPage) + '... [trimmed]';
      }

      // Level 2 & 3: Content deduplication admission check
      const admission = this.deduplicator.admitContent(task.canonicalUrl, cleanContent);
      if (!admission.admitted) {
        task.resolve(null);
        return;
      }

      const boundedPage: ScrapedPage = {
        ...page,
        url: task.canonicalUrl,
        content: cleanContent
      };

      task.resolve(boundedPage);
    } catch (err: any) {
      if (task.signal?.aborted) {
        this.abortTask(task);
        return;
      }

      // Check for HTTP 429 / 503 rate limiting and schedule non-blocking retry with exponential backoff
      const isRateLimited = err?.status === 429 ||
        err?.status === 503 ||
        /429|503|too many requests|rate limit/i.test(err?.message || '');

      if (isRateLimited && task.retries < this.maxRetries) {
        const backoffMs = this.backoffBaseMs * Math.pow(2, task.retries);
        task.retries++;
        const resumeTime = Date.now() + backoffMs;
        task.runAfter = resumeTime;
        this.hostBackoffUntil.set(task.hostname, resumeTime);

        // Re-insert task into queue with future timestamp
        this.queue.unshift(task);
        return;
      }

      // Fallback on unrecoverable error or exhausted retries
      this.abortTask(task);
    }
  }
}
