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
 * Failure semantics (resilient plane):
 *  - Every selection runs a bounded, explicit attempt plan — requested
 *    provider, then the Pi `auto` chain, then the keyless DDG chain — with
 *    each step skipped when it duplicates the step already tried. No
 *    recursion, no cycles: DDG→Auto terminates, Auto→DDG terminates.
 *  - A DDG failure no longer terminates research by itself: control passes
 *    to the `auto` provider path, and only a joint failure is terminal.
 *  - Empty or unusable provider output (no valid title+url items) counts as
 *    an unsuccessful retrieval and runs the fallback policy — it is never a
 *    fake success.
 *  - Caller aborts and queue saturation stay terminal immediately: a
 *    cancelled caller must never degrade into a fallback retrieval.
 */

import * as path from 'node:path';
import { SearchResultItem } from './types';
import { readProvisionedKey, redactKeyMaterial } from './configSeam';
import { resolveAgentDir } from './agentSessionHost';
import { parsePublishedAt } from './freshness';

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
  results?: Array<{ title?: string; url?: string; snippet?: string; publishedAt?: string; date?: string }>;
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

/** The keyless default selection. Single source of truth for every
 * `?? 'duckduckgo'` site in the engine — import this instead of
 * hard-coding the id. Kept as the default (not `auto`) per product
 * semantics: deterministic, single-transport, no ambient-key fan-out. */
export const DEFAULT_SEARCH_PROVIDER = 'duckduckgo';

/** Authoritative default-provider resolution (one source of truth). */
export function resolveDefaultSearchProvider(): string {
  return DEFAULT_SEARCH_PROVIDER;
}

function mapProviderSelection(provider: string): string {
  const id = (provider || '').trim().toLowerCase();
  if (id === 'google') return 'serper';
  if (id === 'auto') return 'auto';
  if (EXPLICIT_SELECTIONS.has(id)) return id;
  if (!id) return DEFAULT_SEARCH_PROVIDER;
  if (!warnedUnknownProviders.has(id)) {
    warnedUnknownProviders.add(id);
    console.warn(`[searchPlane] unknown search provider "${id}" — serving the keyless chain instead.`);
  }
  return DEFAULT_SEARCH_PROVIDER;
}

/**
 * One provider attempt inside a bounded fallback run. Recorded internally
 * for diagnostics (`Attempt 1: duckduckgo → failed (timeout)` instead of a
 * bare `search failed`); the terminal error carries the full list for
 * development/debug tooling while the user-facing message stays concise.
 * No key material, no query content beyond what the caller already owns.
 */
export interface SearchAttempt {
  provider: string;
  status: 'success' | 'failed';
  /** Machine-readable failure class (see classifySearchError). Absent on success. */
  kind?: string;
  /** Redacted one-line reason. Absent on success. Never carries secrets. */
  error?: string;
  /** Usable results served by this attempt. Present on success. */
  results?: number;
}

/** Failure classes the plane distinguishes (never collapsed to `search failed`). */
export type SearchErrorKind =
  | 'cancelled'
  | 'auth-missing'
  | 'timeout'
  | 'network'
  | 'http'
  | 'parse'
  | 'empty'
  | 'invalid-result'
  | 'unavailable'
  | 'unknown';

/**
 * Classifies a search failure without collapsing it. Credential-safe: the
 * returned kind is a fixed vocabulary word, never provider text.
 */
export function classifySearchError(err: unknown, signal?: AbortSignal): SearchErrorKind {
  if (signal?.aborted) return 'cancelled';
  if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
  if (err instanceof Error && /abort/i.test(err.name)) return 'cancelled';
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (/abort|timed out|timeout/.test(lower)) {
    if (/abort/.test(lower)) return 'cancelled';
    return 'timeout';
  }
  if (err instanceof Error && err.name === 'SearchPlaneQueueSaturated') return 'unavailable';
  if (/api key|apikey|unauthorized|forbidden|401|403|auth/.test(lower)) return 'auth-missing';
  if (/no parseable|invalid json|parse/.test(lower)) return 'parse';
  if (/no usable|unusable|invalid result|empty/.test(lower)) return 'empty';
  if (/fetch failed|network|econnreset|econnrefused|enotfound|socket|dns/.test(lower)) return 'network';
  if (/http\s+\d{3}|status\s+\d{3}|server error|service unavailable/.test(lower)) return 'http';
  if (/no .*provider|unavailable/.test(lower)) return 'unavailable';
  return 'unknown';
}

/**
 * Terminal retrieval failure: every bounded attempt failed. The user-facing
 * `message` is concise (no stacks, no provider internals); `attempts`
 * carries the per-provider diagnostics for debug tooling.
 */
export class SearchPlaneTerminalError extends Error {
  attempts: SearchAttempt[];
  constructor(attempts: SearchAttempt[]) {
    const trail = attempts.map((a) => `${a.provider} → ${a.status}${a.kind ? ` (${a.kind})` : ''}`).join('; ');
    super(
      `Web search is temporarily unavailable. The selected provider failed, and no fallback provider returned usable results (${trail}).`
    );
    this.name = 'SearchPlaneTerminalError';
    this.attempts = attempts;
  }
}

/**
 * Bounded attempt plan for one query. Explicit, deterministic, cycle-free:
 * the requested selection first, then the Pi `auto` chain (unless already
 * tried), then the keyless DDG chain (unless already tried). Duplicates are
 * skipped, so DDG→Auto and Auto→DDG each terminate after at most two steps
 * and keyed selections after at most three.
 */
export function planSearchAttempts(selection: string): string[] {
  const plan: string[] = [];
  const push = (id: string): void => {
    if (!plan.includes(id)) plan.push(id);
  };
  push(selection);
  if (selection !== 'auto') push('auto');
  if (selection !== 'duckduckgo') push('duckduckgo');
  return plan;
}

/** A result item is usable only with a non-empty title and a valid http(s) URL. */
export function isUsableSearchResult(item: { title?: unknown; url?: unknown }): boolean {
  if (typeof item?.title !== 'string' || !item.title.trim()) return false;
  if (typeof item?.url !== 'string' || !item.url.trim()) return false;
  try {
    const parsed = new URL(item.url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** User-facing terminal message builder (no raw errors, no internals). */
export function toUserFacingSearchError(attempts: SearchAttempt[]): Error {
  return new SearchPlaneTerminalError(attempts);
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
  // Timeouts WITHOUT a caller abort are retriable through the fallback plan
  // (provider timeout ≠ research failure); only true cancellation and queue
  // saturation are terminal.
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && /abort/i.test(err.name) && !/timeout/i.test(err.message)) return true;
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
  /**
   * The recency forwarded provider-side on this call (Track E echo): the
   * caller sees which scoping rode the request instead of assuming it.
   * Forwarded, not observed-applied — a vendored transport may ignore a
   * filter it does not implement. Undefined when no recency rode the call.
   */
  recencyFilter?: 'day' | 'week' | 'month' | 'year';
  /**
   * Per-provider attempt trail for this query (diagnostics, never secrets).
   * Present on success (trailing failed attempts + the winner) and on the
   * terminal error's `attempts` (all failed).
   */
  attempts?: SearchAttempt[];
}

/**
 * Runs one query through the extension search mechanism under the LENS gate.
 * Provider answers are IGNORED (provider-side drafts are never evidence);
 * results map to `{title, url, snippet}` with the resolving provider
 * attached for telemetry/provenance.
 *
 * Bounded fallback (explicit, deterministic, cycle-free): the requested
 * selection runs first; on failure control passes to the Pi `auto` chain
 * (unless already tried), then to the keyless DDG chain (unless already
 * tried). A DDG failure therefore reaches `auto` instead of terminating
 * research; only joint failure is terminal, surfaced as a concise
 * user-facing error carrying the per-provider attempt trail for debug
 * tooling. Empty/unusable provider output counts as failure and runs the
 * same policy — never a fake success. Results always pass through the
 * normal normalization below (evidence admission, dedupe, ledger, and
 * citation grounding downstream are untouched).
 */
export async function searchViaExtension(
  query: string,
  options?: ExtensionSearchOptions
): Promise<ExtensionSearchOutcome> {
  const signal = options?.signal;
  if (signal?.aborted) throw abortError();
  const cleanQuery = query.trim();
  const selection = mapProviderSelection(options?.provider ?? resolveDefaultSearchProvider());
  if (!cleanQuery) return { results: [], provider: selection };

  await gate.acquire(signal);
  try {
    gate.ledgered += 1;
    if (signal?.aborted) throw abortError();
    const search = await loadExtensionSearch();
    const attempts: SearchAttempt[] = [];
    console.info(`[search] start provider=${selection}`);
    for (const attemptProvider of planSearchAttempts(selection)) {
      if (signal?.aborted) throw abortError();
      const family = keyFamilyOf(attemptProvider);
      const callerKey = family ? options?.apiKeys?.[family.provider] : undefined;
      const key =
        callerKey ??
        (family ? readProvisionedKey(family.provider, options?.agentDir) : undefined);
      const run = (): Promise<Awaited<ReturnType<ExtensionSearchFn>>> =>
        search(cleanQuery, {
          provider: attemptProvider,
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
        const kind = classifySearchError(err, signal);
        const reason = redactKeyMaterial(err, key ?? '');
        attempts.push({ provider: attemptProvider, status: 'failed', kind, error: reason });
        console.warn(`[search] provider=${attemptProvider} failed reason=${kind}`);
        if (attemptProvider !== selection) {
          console.info(`[search] fallback=${attemptProvider} failed reason=${kind}`);
        }
        continue;
      }
      const resolved = typeof out?.provider === 'string' && out.provider ? out.provider : attemptProvider;
      // Track E retention: kept where a provider supplies a date (none of the
      // current vendored providers do — normally absent, never invented).
      const toItem = (r: { title?: string; url?: string; snippet?: string; publishedAt?: unknown; date?: unknown }): SearchResultItem => {
        const publishedAt = parsePublishedAt(r?.publishedAt ?? r?.date);
        return {
          title: String(r?.title ?? ''),
          url: String(r?.url ?? ''),
          snippet: String(r?.snippet ?? ''),
          searchProvider: resolved,
          ...(publishedAt ? { publishedAt } : {}),
        };
      };
      const usable = (out?.results ?? []).map(toItem).filter(isUsableSearchResult);
      if (usable.length === 0) {
        attempts.push({ provider: attemptProvider, status: 'failed', kind: 'empty', error: 'no usable results' });
        console.warn(`[search] provider=${attemptProvider} failed reason=empty`);
        continue;
      }
      attempts.push({ provider: attemptProvider, status: 'success', results: usable.length });
      if (attemptProvider !== selection) {
        console.info(`[search] fallback=${attemptProvider} success results=${usable.length}`);
      } else {
        console.info(`[search] success provider=${attemptProvider} results=${usable.length}`);
      }
      return {
        results: usable,
        provider: resolved,
        // Track E echo: the recency forwarded provider-side (see field docs).
        ...(options?.recencyFilter ? { recencyFilter: options.recencyFilter } : {}),
        attempts,
      };
    }
    console.warn(`[search] terminal_failure attempts=${attempts.map((a) => `${a.provider}:${a.kind ?? a.status}`).join(',')}`);
    throw toUserFacingSearchError(attempts);
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
 *
 * The provider id space is OPEN (Track B): known plane ids, the legacy
 * `google` alias, and explicit `auto` are honored; anything else is caught
 * into the keyless chain by the closed map below. Typed `string` so threaded
 * request values need no cast.
 */
export async function primarySearchPlane(
  query: string,
  provider: string = DEFAULT_SEARCH_PROVIDER,
  apiKeys?: Record<string, string>,
  maxResults = 8,
  signal?: AbortSignal,
  /**
   * Override the LENS-owned agent directory for key provisioning
   * (config-seam file read). Production callers omit it — the app-data
   * default holds. Tests pass a temp dir so a real operator key file can
   * never steer the test onto the live network.
   */
  agentDir?: string,
  /**
   * Track E per-call retrieval scoping (SPEC #155): provider-side
   * recency/domain filters. Optional and trailing — existing 6-arg callers
   * behave exactly as before (no silent scoping when absent).
   */
  searchOpts?: {
    recencyFilter?: 'day' | 'week' | 'month' | 'year';
    domainFilter?: string[];
  }
): Promise<SearchResultItem[]> {
  // Cancellation propagates (caller-abort contract) — checked before the
  // empty-query short-circuit so an aborted caller never sees a fake success.
  if (signal?.aborted) throw abortError();
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // Keyed providers (post-#112, Track C mechanism): served through the
  // extension chain with the caller's key or a config-seam-provisioned key.
  // A keyed failure runs the bounded attempt plan inside searchViaExtension
  // (auto chain, then the keyless chain — observed fallback); the terminal
  // error surfaces only when every attempt fails. Items keep their
  // resolving-provider attribution (Track E provenance) — callers that
  // serialize items tolerate the extra optional field.
  const out = await searchViaExtension(cleanQuery, {
    provider,
    numResults: maxResults,
    signal,
    ...(apiKeys ? { apiKeys } : {}),
    ...(searchOpts?.recencyFilter ? { recencyFilter: searchOpts.recencyFilter } : {}),
    ...(searchOpts?.domainFilter ? { domainFilter: searchOpts.domainFilter } : {}),
    agentDir: agentDir ?? resolveAgentDir(),
  });
  return out.results;
}
