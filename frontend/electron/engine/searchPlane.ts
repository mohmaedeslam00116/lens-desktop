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
 * Failure semantics (post-contract, ticket #110):
 *  - Keyed providers (Tavily/Serper keys present) keep the native path — no
 *    regression for keyed users until the config seam ticket (#112) lands.
 *  - The vendored DDG module unavailable (jiti failure, vendored entry
 *    missing) or the vendored provider errors → the caller's keyed provider
 *    if keys are present, else the error propagates (no plane↔native
 *    re-entry cycle; caller aborts propagate).
 */

import * as path from 'node:path';
import { MultiSearchProvider } from './search';
import { SearchResultItem } from './types';
import { hasProvisionedKey, readProvisionedKey, redactKeyMaterial } from './configSeam';

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
   * removed and rejected, and a granted-but-aborted caller hands its slot
   * back rather than using it. A granted caller *inherits* the released slot
   * (no second increment), so active never exceeds PLANE_CONCURRENCY. */
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
    // Granted: the slot was transferred by release() (active unchanged).
    // Re-check cancellation — the grant may have raced an abort between
    // resolution and resume; hand the inherited slot back if so.
    if (signal?.aborted) {
      this.release();
      throw abortError();
    }
  }

  /** Releases one held slot: transferred to the next queued waiter if one
   * exists (active unchanged — the waiter inherits it), decremented otherwise. */
  release(): void {
    const next = this.waiters.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    if (next.onAbort && next.signal) {
      next.signal.removeEventListener('abort', next.onAbort);
    }
    next.resolve();
  }

  /** Resets the ledger counters (test seam). Requires an idle gate: resetting
   * a live gate would strand queued waiters and corrupt slot accounting. */
  reset(): void {
    if (this.active !== 0 || this.waiters.length !== 0) {
      throw new Error('[searchPlane] cannot reset an active gate');
    }
    this.ledgered = 0;
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
  cachedKeyed = null;
  keyedOverride = null;
  gate.reset();
}

/**
 * Test seams for the retired native-DDG contract (ticket #110): the wide-mode
 * abort contract previously pinned on `MultiSearchProvider.searchDuckDuckGo`
 * (endpoint override, prompt AbortError on stalled bodies) now holds against
 * the vendored plane's execution. `fetchImpl` overrides the transport for the
 * duration of one call only; the process-wide fetch stays untouched.
 */
export const __testSeams = {
  /** Overrides the vendored keyed search modules (offline keyed-path tests). */
  setKeyedOverride(override: { tavily?: KeyedSearchFn; serper?: KeyedSearchFn } | null): void {
    keyedOverride = override;
  },
  async searchWithDuckDuckGo(
    query: string,
    options?: {
      numResults?: number;
      signal?: AbortSignal;
      fetchImpl?: typeof fetch;
    }
  ): Promise<{ results: Array<{ title: string; url: string; snippet: string }> }> {
    const loader = await (await import('./piPackages')).getJitiLoader();
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
    if (!options?.fetchImpl) {
      const direct = await search(query, { numResults: options?.numResults, signal: options?.signal });
      return { results: direct.results ?? [] };
    }
    const previousFetch = globalThis.fetch;
    globalThis.fetch = options.fetchImpl as typeof fetch;
    try {
      const r = await search(query, { numResults: options.numResults, signal: options.signal });
      return { results: r.results ?? [] };
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
};

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

/** Serves one query through the vendored plane under the concurrency gate.
 * Cancellation propagates as AbortError — never a successful empty result. */
async function serveThroughPlane(
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  if (signal?.aborted) throw abortError();
  await gate.acquire(signal);
  try {
    gate.ledgered += 1;
    if (signal?.aborted) throw abortError();
    const resolver = await loadPlaneResolver();
    return await resolver(query, maxResults, signal);
  } finally {
    gate.release();
  }
}

/** Vendored keyed-provider module cache (config is read once per module). */
interface KeyedSearchResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
  organic?: Array<{ title?: string; link?: string; snippet?: string }>;
}
type KeyedSearchFn = (
  query: string,
  options?: { numResults?: number; signal?: AbortSignal }
) => Promise<KeyedSearchResponse>;
let cachedKeyed: { tavily?: KeyedSearchFn; serper?: KeyedSearchFn } | null = null;

/**
 * Test seam: overrides the vendored keyed search modules (offline keyed-path
 * tests). Pass `null` to clear. Reset alongside `resetSearchPlane`.
 */
let keyedOverride: { tavily?: KeyedSearchFn; serper?: KeyedSearchFn } | null = null;

async function loadKeyedSearch(): Promise<{ tavily?: KeyedSearchFn; serper?: KeyedSearchFn }> {
  if (keyedOverride) return keyedOverride;
  if (cachedKeyed) return cachedKeyed;
  const piPackages = await import('./piPackages');
  const loader = await piPackages.getJitiLoader();
  if (!loader) throw new Error('jiti loader unavailable');
  const tavilyMod = (await loader(path.join(VENDOR_ROOT, 'web-access', 'tavily.ts'))) as {
    searchWithTavily?: unknown;
  };
  const serperMod = (await loader(path.join(VENDOR_ROOT, 'web-access', 'serper.ts'))) as {
    searchWithSerper?: unknown;
  };
  const keyed: { tavily?: KeyedSearchFn; serper?: KeyedSearchFn } = {};
  if (typeof tavilyMod?.searchWithTavily === 'function') {
    keyed.tavily = tavilyMod.searchWithTavily as KeyedSearchFn;
  }
  if (typeof serperMod?.searchWithSerper === 'function') {
    keyed.serper = serperMod.searchWithSerper as KeyedSearchFn;
  }
  if (!keyed.tavily && !keyed.serper) {
    throw new Error('vendored keyed search modules expose no search functions');
  }
  cachedKeyed = keyed;
  return keyed;
}

/** Serves one query through the vendored KEYED providers under the same gate
 * and ledger as the keyless plane (D5: no unledgered retrieval). The caller's
 * key is exported to the matching env var for the duration of the call —
 * the vendored credential resolver reads env per call; the key is restored
 * in `finally` and never logged. */
async function serveThroughKeyedPlane(
  provider: 'tavily' | 'serper',
  key: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchResultItem[]> {
  if (signal?.aborted) throw abortError();
  const keyed = await loadKeyedSearch();
  const run: KeyedSearchFn | undefined = provider === 'tavily' ? keyed.tavily : keyed.serper;
  if (typeof run !== 'function') throw new Error(`vendored ${provider} search unavailable`);
  const envName = provider === 'tavily' ? 'TAVILY_API_KEY' : 'SERPER_API_KEY';
  const previous = process.env[envName];
  await gate.acquire(signal);
  try {
    gate.ledgered += 1;
    if (signal?.aborted) throw abortError();
    process.env[envName] = key;
    const response = await run(query, { numResults: maxResults, signal });
    if (provider === 'tavily') {
      return (response.results ?? []).map((r) => ({
        title: r.title || r.url || '',
        url: r.url || '',
        snippet: r.content || '',
      })).filter((r) => r.url);
    }
    return (response.organic ?? []).map((r) => ({
      title: r.title || r.link || '',
      url: r.link || '',
      snippet: r.snippet || '',
    })).filter((r) => r.url);
  } finally {
    // Restore the prior env value (or delete it) — the override lives for
    // exactly one call and never appears in logs or telemetry.
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
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
  // Cancellation propagates (caller-abort contract) — checked before the
  // empty-query short-circuit so an aborted caller never sees a fake success.
  if (signal?.aborted) throw abortError();
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const keys = apiKeys || {};

  // Keyed providers (post-#112): served through the vendored keyed providers
  // (D2 contract complete). The caller's key rides as a one-call env override;
  // absent a caller key, a config-seam-provisioned key is used. A keyed
  // failure degrades to the keyless plane (native semantic); the keyless path
  // never re-enters the keyed path (terminal, no cycle).
  if (provider === 'tavily' && (keys.tavily || hasProvisionedKey('tavily'))) {
    const key = keys.tavily || readProvisionedKey('tavily');
    if (key) {
      try {
        return await serveThroughKeyedPlane('tavily', key, cleanQuery, maxResults, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof Error && err.name === 'SearchPlaneQueueSaturated') throw err;
        // Redacted warn (no-leak clause): never echoes key material.
        console.warn('[searchPlane] vendored tavily failed — falling back to the keyless plane:', redactKeyMaterial(err, key));
      }
    }
  }
  if ((provider === 'serper' || provider === 'google') && (keys.serper || hasProvisionedKey('serper'))) {
    const key = keys.serper || readProvisionedKey('serper');
    if (key) {
      try {
        return await serveThroughKeyedPlane('serper', key, cleanQuery, maxResults, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof Error && err.name === 'SearchPlaneQueueSaturated') throw err;
        console.warn('[searchPlane] vendored serper failed — falling back to the keyless plane:', redactKeyMaterial(err, key));
      }
    }
  }

  // DDG keyless (or keyed-failure fallback): the vendored keyless plane.
  // Terminal in both directions — a keyless failure with no other key
  // propagates; it NEVER re-enters the keyed or native path (no cycle).
  return serveThroughPlane(cleanQuery, maxResults, signal);
}
