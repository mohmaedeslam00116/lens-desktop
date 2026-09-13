/**
 * searchPlane.ts — LENS's primary retrieval plane (ADR-0010 phase 5, #109).
 *
 * The primary-plane boundary decision (recorded in ADR-0013) locks
 * pi-web-access as the primary search plane: engine search resolves through
 * this adapter, which drives the vendored DuckDuckGo provider behind the
 * engine's existing `searchFn` seam. The seam contract
 * (`(query, provider, apiKeys, maxResults, signal) => SearchResultItem[]`)
 * is preserved — the delegated loop and researchers need no structural change.
 *
 * Boundary clause (non-negotiable, D5): every vendored-plane retrieval is
 * **ledgered** — admitted through the plane's bounded concurrency gate and
 * counted in the plane ledger (exposed for tests and telemetry) — so no
 * pi-web-access retrieval bypasses LENS's controls.
 *
 * Failure semantics (D2/D6, pinned by tests):
 *  - Keyed providers (Tavily/Serper keys present) keep the native path — no
 *    regression for keyed users until the config seam ticket (#112) lands.
 *  - The vendored DDG module unavailable (jiti failure, vendored entry
 *    missing) → native fallback.
 *  - The vendored provider errors → native fallback (caller aborts propagate).
 */

import * as path from 'node:path';
import { MultiSearchProvider } from './search';
import { SearchResultItem } from './types';

/** Resolver shape the vendored DDG module is adapted to. */
type PlaneResolver = (
  query: string,
  maxResults: number,
  signal?: AbortSignal
) => Promise<SearchResultItem[]>;

/** Vendored copy root — mirrors piPackages' VENDOR_ROOT layout. */
const VENDOR_ROOT = path.join(__dirname, '..', 'vendor', 'pi');

/** Bounded concurrency gate for vendored-plane executions (matches the
 * vendored search stack's own query fan-out cap). */
const PLANE_CONCURRENCY = 3;

/** Bounded admission queue: callers beyond this cap fail loudly instead of
 * queueing without limit (memory boundedness) or degrading silently. */
const PLANE_MAX_QUEUE = 32;

interface PlaneWaiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortError(): Error {
  return new DOMException('This operation was aborted', 'AbortError');
}

class PlaneGate {
  active = 0;
  ledgered = 0;
  private waiters: PlaneWaiter[] = [];

  /** Admits one caller. Abort-aware: a caller that aborts while queued is
   * removed and rejected, and a slot granted to an already-aborted caller is
   * handed on rather than used. */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    if (this.active < PLANE_CONCURRENCY) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= PLANE_MAX_QUEUE) {
      const err = new Error('[searchPlane] admission queue saturated');
      err.name = 'SearchPlaneQueueSaturated';
      throw err;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: PlaneWaiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
    // Granted: take ownership of the slot, then re-check cancellation — the
    // grant may have raced an abort between resolution and resume.
    this.active += 1;
    if (signal?.aborted) {
      this.release();
      throw abortError();
    }
  }

  /** Releases one held slot and grants the next queued waiter (if any). */
  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (!next) return;
    if (next.onAbort && next.signal) {
      next.signal.removeEventListener('abort', next.onAbort);
    }
    next.resolve();
  }

  reset(): void {
    this.active = 0;
    this.ledgered = 0;
    this.waiters = [];
  }
}

const gate = new PlaneGate();

let cachedResolver: PlaneResolver | null = null;

/** Plane ledger snapshot: proves (and surfaces) every retrieval admission. */
export function searchPlaneLedgerSnapshot(): { active: number; ledgered: number } {
  return { active: gate.active, ledgered: gate.ledgered };
}

/** Resets the adapter cache and ledger counters (test seam). */
export function resetSearchPlane(): void {
  cachedResolver = null;
  gate.reset();
}

/**
 * Loads the vendored DuckDuckGo module through the package bridge's jiti
 * loader. The vendored module calls global `fetch`, which stays late-bound —
 * the parity harness swaps `globalThis.fetch`, so fixtures cover this plane
 * without any special injection.
 */
async function loadPlaneResolver(): Promise<PlaneResolver> {
  if (cachedResolver) return cachedResolver;
  const { getJitiLoader } = await import('./piPackages');
  const loader = await getJitiLoader();
  if (!loader) throw new Error('jiti loader unavailable');
  const entryPath = path.join(VENDOR_ROOT, 'web-access', 'duckduckgo.ts');
  const mod = (await loader(entryPath)) as {
    searchWithDuckDuckGo?: (
      query: string,
      options?: { numResults?: number; signal?: AbortSignal }
    ) => Promise<{ results?: Array<{ title: string; url: string; snippet: string }> }>;
  };
  const search = mod?.searchWithDuckDuckGo;
  if (typeof search !== 'function') {
    throw new Error('vendored DDG module exposes no searchWithDuckDuckGo');
  }
  cachedResolver = async (query, maxResults, signal) => {
    const response = await search(query, { numResults: maxResults, signal });
    const results = response.results ?? [];
    return results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
  };
  return cachedResolver;
}

/** Serves one query through the vendored plane under the concurrency gate. */
async function serveThroughPlane(
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  if (signal?.aborted) return [];
  await gate.acquire(signal);
  try {
    gate.ledgered += 1;
    if (signal?.aborted) return [];
    const resolver = await loadPlaneResolver();
    return await resolver(query, maxResults, signal);
  } finally {
    gate.release();
  }
}

/**
 * The primary search plane. Signature-compatible with
 * `MultiSearchProvider.search`, so it slots behind the engine's search seam.
 */
export async function primarySearchPlane(
  query: string,
  provider: 'duckduckgo' | 'tavily' | 'serper' | 'google' = 'duckduckgo',
  apiKeys?: Record<string, string>,
  maxResults = 8,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  if (signal?.aborted) return [];

  const keys = apiKeys || {};

  // Keyed providers keep the native path (fallback guard, D2/D6): the
  // config seam (#112) will later provision these through web-search.json.
  if (provider === 'tavily' && keys.tavily) {
    return MultiSearchProvider.search(query, provider, apiKeys, maxResults, signal);
  }
  if ((provider === 'serper' || provider === 'google') && keys.serper) {
    return MultiSearchProvider.search(query, provider, apiKeys, maxResults, signal);
  }

  // DDG keyless (or unknown provider) → the vendored plane, with native
  // fallback on any plane failure. The fallback goes through the canonical
  // native seam entry (`MultiSearchProvider.search`), so module-level stubs
  // of the native seam intercept it — one interception point for the plane.
  // Caller aborts propagate (native semantic); queue saturation fails
  // loudly instead of degrading silently.
  try {
    return await serveThroughPlane(cleanQuery, maxResults, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof Error && err.name === 'SearchPlaneQueueSaturated') throw err;
    console.warn(
      '[searchPlane] vendored plane failed — falling back to native DDG:',
      String(err).slice(0, 300)
    );
    return MultiSearchProvider.search(cleanQuery, 'duckduckgo', apiKeys, maxResults, signal);
  }
}
