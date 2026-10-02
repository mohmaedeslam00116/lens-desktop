/**
 * searchPlane.ts — LENS's primary retrieval plane (Track C, SPEC #155).
 *
 * Pi owns the search MECHANISM: engine search resolves through the upgraded
 * extension surface (`search()` in `web-access/gemini-search.ts`, loaded
 * through the package bridge's jiti loader) with explicit provider
 * selection. The extension owns routing + fallback chains, recency/domain
 * handling, and provider transports. LENS owns the policy: the bounded
 * concurrency gate + ledger (D5 — no unledgered retrieval), per-call key
 * provisioning (config-seam file-fresh read → serialized env override),
 * the DDG-last outer fallback, and attribution ({title, url, snippet} +
 * resolving provider; provider-side answer drafts are IGNORED, never
 * evidence).
 *
 * Keyed credentials resolve per call (caller key, else the LENS
 * `web-search.json` under `agentDir`), never from ambient process state.
 * The extension's own file tier is pinned to the LENS agent directory via
 * `PI_CODING_AGENT_DIR` (set at server startup) so it can never read the
 * operator's real `~/.pi` — isolation, not convenience.
 *
 * The seam contract (`primarySearchPlane(query, provider, apiKeys,
 * maxResults, signal) => SearchResultItem[]`) is preserved — the delegated
 * loop and researchers need no structural change.
 *
 * Failure semantics (Track C):
 *  - Explicit keyed selection without keys (or a keyed failure) degrades to
 *    the keyless DDG plane through the extension chain — observed fallback,
 *    never silent and never terminal, unless the fallback itself fails.
 *  - A DDG failure propagates terminally (no re-entry cycle; caller aborts
 *    propagate as AbortError, queue saturation propagates by name).
 */

import * as path from 'node:path';
import { SearchResultItem } from './types';
import { readProvisionedKey, redactKeyMaterial } from './configSeam';
import { resolveAgentDir } from './agentSessionHost';

/** Unified extension search entry (web-access/gemini-search.ts). */
type ExtensionSearchFn = (
  query: string,
  options?: {
    provider?: string;
    numResults?: number;
    recencyFilter?: 'day' | 'week' | 'month' | 'year';
    domainFilter?: string[];
    signal?: AbortSignal;
  }
) => Promise<{
  answer?: string;
  results?: Array<{ title?: string; url?: string; snippet?: string }>;
  provider?: string;
}>;

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

let cachedExtensionSearch: ExtensionSearchFn | null = null;

/** Plane ledger snapshot: proves (and surfaces) every retrieval admission. */
export function searchPlaneLedgerSnapshot(): { active: number; ledgered: number } {
  return { active: gate.active, ledgered: gate.ledgered };
}

/** Resets the adapter cache and ledger counters (test seam). */
export function resetSearchPlane(): void {
  cachedExtensionSearch = null;
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
 * Loads the unified extension search entry (`search()` in
 * `web-access/gemini-search.ts`) through the package bridge's jiti loader.
 * The vendored modules call global `fetch`, which stays late-bound — the
 * parity harness swaps `globalThis.fetch`, so fixtures cover this plane
 * without any special injection. Loud on failure: without the mechanism the
 * plane cannot serve, and callers must see why.
 */
async function loadExtensionSearch(): Promise<ExtensionSearchFn> {
  if (cachedExtensionSearch) return cachedExtensionSearch;
  const { getJitiLoader } = await import('./piPackages');
  const loader = await getJitiLoader();
  if (!loader) throw new Error('jiti loader unavailable');
  const mod = (await loader(path.join(VENDOR_ROOT, 'web-access', 'gemini-search.ts'))) as {
    search?: unknown;
  };
  if (typeof mod?.search !== 'function') {
    throw new Error('vendored web-access graph exposes no unified search()');
  }
  cachedExtensionSearch = mod.search as ExtensionSearchFn;
  return cachedExtensionSearch;
}

/**
 * Maps a LENS search-provider id onto the extension selection. CLOSED map —
 * the extension coerces unknown strings to `"auto"` (full-chain fan-out that
 * deliberately excludes DDG and can resolve via ambient keys LENS never
 * provisioned), so unknown ids must never pass through verbatim. Known plane
 * ids pass through; the legacy `google` id means the Google index (Serper —
 * the extension has no `google` id, without the alias it would silently
 * become `auto`); explicit `auto` selects the extension chain deliberately.
 * Anything else is a misconfiguration: warn once per process and serve the
 * deterministic keyless chain.
 */
const EXPLICIT_SELECTIONS = new Set(['duckduckgo', 'tavily', 'serper']);
const warnedUnknownProviders = new Set<string>();

function mapProviderSelection(provider: string): string {
  const id = (provider || '').trim().toLowerCase();
  if (id === 'google') return 'serper';
  if (id === 'auto') return 'auto';
  if (EXPLICIT_SELECTIONS.has(id)) return id;
  if (!id) return 'duckduckgo';
  if (!warnedUnknownProviders.has(id)) {
    warnedUnknownProviders.add(id);
    console.warn(`[searchPlane] unknown search provider "${id}" — serving the keyless chain instead.`);
  }
  return 'duckduckgo';
}

/** Key families LENS provisions per call (caller key, else config-seam file). */
function keyFamilyOf(selection: string): { provider: 'tavily' | 'serper'; env: string } | null {
  if (selection === 'tavily') return { provider: 'tavily', env: 'TAVILY_API_KEY' };
  if (selection === 'serper') return { provider: 'serper', env: 'SERPER_API_KEY' };
  return null;
}

/** Serializes the one-call env override: `process.env` is process-global,
 * and concurrent keyed calls (the gate admits 3) would otherwise capture
 * each other's keys as "prior values" — crossing keys between calls and
 * leaking the override after completion. A promise-chain mutex keeps the
 * set/call/restore triple atomic per provider family. */
const keyedEnvChains: Map<string, Promise<void>> = new Map();

async function withKeyedEnv<T>(envName: string, key: string, run: () => Promise<T>): Promise<T> {
  const previousChain = keyedEnvChains.get(envName) ?? Promise.resolve();
  let release!: () => void;
  const chain = new Promise<void>((r) => { release = r; });
  keyedEnvChains.set(envName, chain);
  await previousChain;
  const previous = process.env[envName];
  process.env[envName] = key;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
    if (keyedEnvChains.get(envName) === chain) keyedEnvChains.delete(envName);
    release();
  }
}

function isTerminalPlaneError(err: unknown, signal?: AbortSignal): boolean {
  // A cancelled caller must never degrade into a fallback retrieval: the
  // vendor surfaces aborts heterogeneously (DOMException AbortError from
  // fetch, plain "Aborted" errors, TimeoutError from AbortSignal.timeout),
  // so test the signal first, then the name, then the message.
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && /abort/i.test(err.name)) return true;
  if (err instanceof Error && /abort|timed out|timeout/i.test(err.message)) return true;
  if (err instanceof Error && err.name === 'SearchPlaneQueueSaturated') return true;
  return false;
}

export interface ExtensionSearchOptions {
  provider?: string;
  numResults?: number;
  recencyFilter?: 'day' | 'week' | 'month' | 'year';
  domainFilter?: string[];
  signal?: AbortSignal;
  apiKeys?: Record<string, string>;
  /**
   * Override the LENS-owned agent directory for key provisioning
   * (config-seam file read). Production callers omit it — the app-data
   * default holds. Tests pass a temp dir for isolation.
   */
  agentDir?: string;
}

export interface ExtensionSearchOutcome {
  results: SearchResultItem[];
  /** The provider that actually resolved — observed, never assumed. */
  provider: string;
}

/**
 * Runs one query through the extension search mechanism under the LENS gate.
 * Provider answers are IGNORED (provider-side drafts are never evidence);
 * results map to `{title, url, snippet}` with the resolving provider
 * attached for telemetry/provenance. Non-terminal failures on a non-DDG
 * selection degrade once to the keyless DDG chain; anything else propagates.
 */
export async function searchViaExtension(
  query: string,
  options?: ExtensionSearchOptions
): Promise<ExtensionSearchOutcome> {
  const signal = options?.signal;
  if (signal?.aborted) throw abortError();
  const cleanQuery = query.trim();
  const selection = mapProviderSelection(options?.provider ?? 'duckduckgo');
  if (!cleanQuery) return { results: [], provider: selection };

  const family = keyFamilyOf(selection);
  const callerKey = family ? options?.apiKeys?.[family.provider] : undefined;
  const key =
    callerKey ??
    (family ? readProvisionedKey(family.provider, options?.agentDir) : undefined);

  await gate.acquire(signal);
  try {
    gate.ledgered += 1;
    if (signal?.aborted) throw abortError();
    const search = await loadExtensionSearch();
    const run = (): Promise<Awaited<ReturnType<ExtensionSearchFn>>> =>
      search(cleanQuery, {
        provider: selection,
        numResults: options?.numResults ?? 8,
        ...(options?.recencyFilter ? { recencyFilter: options.recencyFilter } : {}),
        ...(options?.domainFilter ? { domainFilter: options.domainFilter } : {}),
        ...(signal ? { signal } : {}),
      });
    let out: Awaited<ReturnType<ExtensionSearchFn>>;
    try {
      out = family && key ? await withKeyedEnv(family.env, key, run) : await run();
    } catch (err) {
      if (isTerminalPlaneError(err, signal)) throw err;
      if (selection === 'duckduckgo') throw err;
      // Observed fallback (never silent, never terminal unless the fallback
      // fails too): the keyless DDG chain serves the query instead.
      console.warn(
        `[searchPlane] extension ${selection} failed — falling back to the keyless chain:`,
        redactKeyMaterial(err, key ?? '')
      );
      const fallback = await loadExtensionSearch();
      out = await fallback(cleanQuery, {
        provider: 'duckduckgo',
        numResults: options?.numResults ?? 8,
        ...(options?.recencyFilter ? { recencyFilter: options.recencyFilter } : {}),
        ...(options?.domainFilter ? { domainFilter: options.domainFilter } : {}),
        ...(signal ? { signal } : {}),
      });
    }
    const resolved = typeof out?.provider === 'string' && out.provider ? out.provider : selection;
    return {
      results: (out?.results ?? []).map((r) => ({
        title: String(r?.title ?? ''),
        url: String(r?.url ?? ''),
        snippet: String(r?.snippet ?? ''),
        searchProvider: resolved,
      })),
      provider: resolved,
    };
  } finally {
    gate.release();
  }
}

/**
 * The primary search plane. Signature-compatible with
 * `MultiSearchProvider.search`, so it slots behind the engine's search seam.
 *
 * Default-selection decision (Track C, SPEC #155): an unset provider serves
 * the explicit keyless DDG chain — deterministic, single-transport, no
 * ambient-key participation. The extension `auto` chain is available via
 * explicit selection (Track B threads the setting) but is never the
 * implicit default: auto fans out across ambient-keyed providers with
 * per-provider deadlines before reaching anything keyless.
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

  // Keyed providers (post-#112, Track C mechanism): served through the
  // extension chain with the caller's key or a config-seam-provisioned key.
  // A keyed failure degrades to the keyless chain inside searchViaExtension
  // (observed fallback); the keyless path never re-enters the keyed path
  // (terminal, no cycle). Items keep their resolving-provider attribution
  // (Track E provenance) — callers that serialize items tolerate the extra
  // optional field.
  const out = await searchViaExtension(cleanQuery, {
    provider,
    numResults: maxResults,
    signal,
    ...(apiKeys ? { apiKeys } : {}),
    agentDir: resolveAgentDir(),
  });
  return out.results;
}
