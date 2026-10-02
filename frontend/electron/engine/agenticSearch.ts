/**
 * The Agentic Search runner (ticket #142; SPEC-028 decision 3).
 *
 * One question → one Turn-Group: a hosted AgentSession (#140) answers
 * gate-free — no plan-approval gate; that invariant is Deep Research's —
 * bounded by the session budget (the `maxFetches` retrieval cap) and the
 * plane's fetch ledger, and terminates into LENS's evidence contracts: the
 * streamed answer lands as report chunks, every admitted page lands as a
 * source, and the run ends with an explicit terminal LiveEvent (`finished`,
 * `cancelled`, or `error`) carrying what was already admitted. A
 * `budget_exhausted` emission from inside the fetch wrapper is a mid-run
 * retrieval warning, never a terminal — the run continues into its answer.
 * The Event Faithfulness law holds: a run is never seen stopping silently.
 *
 * Enforcement stays in the tools (ADR-0014 decision 4): `createAgenticToolSurface`
 * builds the LENS-wrapped `web_search`/`fetch_content` tools whose retrieval
 * routes through `claimAndShare` — the ADR-0013 plane ledger — so admission,
 * dedupe, and the budget cap are single-sourced here, inside the wrapper.
 * The surface is handed to the #140 construction seam as the session's
 * customTools; hooks carry no policy.
 */

import type { LiveEvent, SourceItem } from './types';
import { attachAgentSessionBridge } from './agentSessionBridge';
import { claimAndShare, resetFetchLedger } from './fetchLedger';
import type { LensToolSurface } from './agentSessionHost';
import {
  captureTranscriptAtTerminal,
  buildConversationProjection,
  type TranscriptTurnGroup,
} from './agenticConversationProjection';
import type { AgenticTranscriptStore } from './agenticTranscript';
import { isAnswerModeFetchCall, ANSWER_MODE_UNSUPPORTED_MESSAGE } from './piPackages';
import {
  detectTemporalIntent,
  resolveRecencyForQuery,
  buildDateAwareVariants,
} from './freshness';

export interface AgenticSearchHit {
  url: string;
  title: string;
  snippet: string;
  /** Provider-supplied publication date (ISO, Track E retention). */
  publishedAt?: string;
}

/**
 * Per-call search scoping (Track D, SPEC #155): the model-facing `web_search`
 * contract carries these through to the plane. All optional — absent means
 * the surface/threaded defaults. Fewer-param injects stay assignable.
 */
export interface AgenticSearchCallOptions {
  numResults?: number;
  recencyFilter?: 'day' | 'week' | 'month' | 'year';
  domainFilter?: string[];
}

/** Per-call fetch mode (Track D): `readable` (default) or `raw`, threaded
 * into the vendored extraction. `answer` never appears here — the tool-layer
 * guard refuses it before dispatch. */
export interface AgenticFetchCallOptions {
  mode?: 'readable' | 'raw';
}

/** The mutable state one Turn-Group accumulates; the runner reads it at terminals. */
export interface AgenticRunState {
  sources: SourceItem[];
  reportChunks: string[];
  fetchesUsed: number;
}

/**
 * One tool-handler outcome under the #140 `LensToolSurface` contract: success
 * carries `result` (string pass-through, anything else JSON-serialised by the
 * host's `toPiTool`), refusal carries `error`. This is the exact shape the
 * construction seam reads — any other field (a bare `output`, say) is
 * silently dropped and the model sees "null" for the tool's text.
 */
export interface AgenticToolOutcome {
  success: boolean;
  result?: string;
  error?: string;
}

export interface AgenticToolContext {
  sessionId: string;
  /** Ledgered page retrieval for fetch_content (injectable for tests). */
  fetchPage: (url: string, options?: AgenticFetchCallOptions) => Promise<{ url: string; title: string; text: string } | null>;
  /** Search provider for web_search (injectable for tests; plane-backed in production).
   * The second argument carries the retrieval selection (Track B) and the
   * third the per-call scoping (Track D); fewer-param injects keep working,
   * and the handler always forwards what the call carried. */
  search: (query: string, provider?: string, options?: AgenticSearchCallOptions) => Promise<AgenticSearchHit[]>;
  /** The retrieval selection threaded from the start request (Track B,
   * SPEC #155) — forwarded into the search call, never the DDG default. */
  searchProvider?: string;
  maxFetches: number;
  emit: (event: LiveEvent) => void;
  state: AgenticRunState;
  signal?: AbortSignal;
}

/**
 * Admit one source through the single-sourced contract: dedupe by URL,
 * record into the run state, emit a LiveEvent `source`.
 */
function admitSource(context: AgenticToolContext, item: SourceItem): void {
  if (context.state.sources.some((s) => s.url === item.url)) return;
  context.state.sources.push(item);
  context.emit({
    type: 'source',
    sessionId: context.sessionId,
    url: item.url,
    title: item.title,
    domain: item.domain,
    snippet: item.snippet,
    credibility: item.credibilityScore,
    // Track E retention: the date rides the event where the provider supplied it.
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
  });
}

/**
 * Session-scoped stored tool content (Track D, SPEC #155): every `web_search`
 * and `source_check` stores its slices under a `responseId` the result text
 * names, and `get_search_content` pages it back. LENS-owned (a module map —
 * never the vendored store, never ambient files), bounded per session, reset
 * with the run. Store reads consume no budget and touch no ledger: they
 * retrieve nothing new.
 */
export interface StoredSearchHit {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  /** Provider-supplied publication date (ISO, Track E retention). */
  publishedAt?: string;
}

export interface StoredSearchSlice {
  query: string;
  hits: StoredSearchHit[];
}

interface StoredToolEntry {
  kind: 'search' | 'check';
  label: string;
  queries: string[];
  text: string;
  hits: StoredSearchHit[];
  slices: StoredSearchSlice[];
}

const storedBySession = new Map<string, { counter: number; entries: Map<string, StoredToolEntry> }>();

/** Bounds (pinned by the Track D contract suite — change with the tests). */
export const AGENTIC_TOOL_BOUNDS = {
  maxQueriesPerCall: 4,
  maxIncludePages: 5,
  maxFetchUrls: 10,
  maxCheckPages: 5,
  numResultsMin: 1,
  numResultsMax: 20,
  webSearchDefaultResults: 8,
  sourceCheckDefaultResults: 5,
  artifactExcerptChars: 600,
  toolResultCharCap: 12000,
  getContentDefaultLimit: 4000,
  getContentMaxLimit: 16000,
  findWindowChars: 200,
  maxFindWindows: 5,
  maxStoredTextChars: 65536,
  /** Per-hit stored page text (Track D review: entry.text was capped but
   * hits[].content was not — unbounded vendored pages times 20 entries
   * could reach hundreds of MB per session). Kept under the max retrievable
   * page (getContentMaxLimit) so the marker is reachable, never hidden. */
  maxStoredHitChars: 12000,
  maxStoredPerSession: 20,
} as const;

function storedScope(sessionId: string): { counter: number; entries: Map<string, StoredToolEntry> } {
  let scope = storedBySession.get(sessionId);
  if (!scope) {
    scope = { counter: 0, entries: new Map() };
    storedBySession.set(sessionId, scope);
  }
  return scope;
}

function storeToolContent(
  sessionId: string,
  kind: 'search' | 'check',
  label: string,
  queries: string[],
  text: string,
  hits: StoredSearchHit[],
  slices: StoredSearchSlice[]
): string {
  const scope = storedScope(sessionId);
  scope.counter += 1;
  const id = `${kind === 'check' ? 'sc' : 'ws'}-${scope.counter}`;
  const capped =
    text.length > AGENTIC_TOOL_BOUNDS.maxStoredTextChars
      ? text.slice(0, AGENTIC_TOOL_BOUNDS.maxStoredTextChars) + '\n…(stored text truncated)'
      : text;
  // Per-hit page text is capped too (Track D review): the entry-text cap
  // alone still admitted unbounded vendored pages through hits[].content.
  const cappedHits = hits.map((h) =>
    h.content && h.content.length > AGENTIC_TOOL_BOUNDS.maxStoredHitChars
      ? { ...h, content: h.content.slice(0, AGENTIC_TOOL_BOUNDS.maxStoredHitChars) + '\n…(stored page text truncated)' }
      : h
  );
  const cappedSlices = slices.map((s) => ({
    query: s.query,
    hits: s.hits.map((h) =>
      h.content && h.content.length > AGENTIC_TOOL_BOUNDS.maxStoredHitChars
        ? { ...h, content: h.content.slice(0, AGENTIC_TOOL_BOUNDS.maxStoredHitChars) + '\n…(stored page text truncated)' }
        : h
    ),
  }));
  scope.entries.set(id, { kind, label, queries, text: capped, hits: cappedHits, slices: cappedSlices });
  while (scope.entries.size > AGENTIC_TOOL_BOUNDS.maxStoredPerSession) {
    const oldest = scope.entries.keys().next();
    if (oldest.done) break;
    scope.entries.delete(oldest.value);
  }
  return id;
}

/** Drops a session's stored tool content (run start; test seam). */
export function resetAgenticStoredContent(sessionId: string): void {
  storedBySession.delete(sessionId);
}

/** Clamps a caller numResults into [1, 20], defaulting on garbage. */
function clampNumResults(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(
    AGENTIC_TOOL_BOUNDS.numResultsMax,
    Math.max(AGENTIC_TOOL_BOUNDS.numResultsMin, Math.floor(raw))
  );
}

const RECENCY_VALUES = ['day', 'week', 'month', 'year'] as const;

/** Non-empty trimmed string list from a query/queries pair. */
function normalizeQueryList(args: Record<string, any>): string[] {
  const raw: unknown[] = Array.isArray(args.queries)
    ? args.queries
    : args.query !== undefined
      ? [args.query]
      : [];
  return raw
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim())
    .filter(Boolean);
}

/** Bounds tool-result text; the store (not the model text) holds the full body. */
function capResultText(text: string): string {
  if (text.length <= AGENTIC_TOOL_BOUNDS.toolResultCharCap) return text;
  return (
    text.slice(0, AGENTIC_TOOL_BOUNDS.toolResultCharCap) +
    `\n…(result truncated at ${AGENTIC_TOOL_BOUNDS.toolResultCharCap} chars; full body retrievable via get_search_content)`
  );
}

/**
 * Shared per-call search validation (Track D): recency/domain shape checks
 * plus provider resolution, identical for `web_search` and `source_check`.
 * Unknown recency and non-string domain entries are refused — a scoped call
 * must never silently degrade into an unscoped one.
 */
function resolveSearchScoping(
  context: AgenticToolContext,
  args: Record<string, any>,
  toolName: string,
  defaultNum: number
): { error: string } | { num: number; provider?: string; scoping: AgenticSearchCallOptions } {
  if (args.recencyFilter !== undefined && !(RECENCY_VALUES as readonly string[]).includes(args.recencyFilter)) {
    return {
      error: `${toolName} recencyFilter must be one of day|week|month|year — got ${JSON.stringify(args.recencyFilter)}. Refused rather than silently serving unscoped results.`,
    };
  }
  if (args.domainFilter !== undefined) {
    if (
      !Array.isArray(args.domainFilter) ||
      args.domainFilter.some((d) => typeof d !== 'string')
    ) {
      return { error: `${toolName} domainFilter must be an array of domain strings.` };
    }
  }
  const domainFilter = Array.isArray(args.domainFilter)
    ? (args.domainFilter as string[]).map((d) => d.trim()).filter(Boolean)
    : undefined;
  return {
    num: clampNumResults(args.numResults, defaultNum),
    provider:
      typeof args.provider === 'string' && args.provider.trim()
        ? args.provider.trim()
        : context.searchProvider,
    scoping: {
      numResults: clampNumResults(args.numResults, defaultNum),
      ...(args.recencyFilter !== undefined ? { recencyFilter: args.recencyFilter } : {}),
      ...(domainFilter ? { domainFilter } : {}),
    },
  };
}

/**
 * Build the LENS-wrapped research tool surface for one Turn-Group. This is
 * the enforcement point (ADR-0014 decision 4): every retrieval inside these
 * wrappers is ledgered and budget-capped; hooks carry no policy.
 */
export function createAgenticToolSurface(context: AgenticToolContext): LensToolSurface {
  const definitions = [
    {
      name: 'web_search',
      description:
        'Search the web for evidence. Prefer `queries` (2-4 varied angles) over a single `query`. Returns titles, URLs, snippets, provider dates where supplied, and a responseId for full stored retrieval via get_search_content. Temporal queries without an explicit recencyFilter gain the intent recency automatically (reported in the result notes).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Single search query. Prefer `queries` with varied angles for research.' },
          queries: { type: 'array', items: { type: 'string' }, description: 'Multiple queries searched in one call (max 4 served; remainder noted, resubmit separately).' },
          provider: { type: 'string', description: 'Per-call retrieval selection (duckduckgo, tavily, serper, auto). Omit for the session default.' },
          numResults: { type: 'integer', minimum: 1, maximum: 20, description: 'Results per query (default 8, max 20).' },
          recencyFilter: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Filter by recency. Unknown values are refused, never ignored.' },
          domainFilter: { type: 'array', items: { type: 'string' }, description: 'Limit to domains (prefix with - to exclude).' },
          includeContent: { type: 'boolean', description: 'Fetch full page text for top hits through the ledgered, budget-capped fetcher (max 5 pages).' },
        },
        required: [],
      },
    },
    {
      name: 'fetch_content',
      description: "Fetch pages' full text by URL (ledgered, budget-capped). readable (default) serves cleaned article text, raw serves unprocessed source. answer mode is refused — synthesis belongs to the research agent.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Single URL to fetch.' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Multiple URLs, served in order (max 10 per call; remainder noted).' },
          mode: { type: 'string', enum: ['readable', 'raw'], description: "Fetch mode. 'answer' is refused (see error guidance)." },
          prompt: { type: 'string', description: 'UNSUPPORTED in LENS — any call carrying it is refused (no video-analysis mechanism).' },
          timestamp: { type: 'string', description: 'UNSUPPORTED in LENS — any call carrying it is refused (no video-frame mechanism).' },
        },
        required: [],
      },
    },
    {
      name: 'source_check',
      description: 'Gather web sources for a claim and return a bounded machine-readable artifact with exact passage citations for manual review. Temporal claims verify freshness-first (date-aware variants + auto recency) before anything cites them. No verdict is ever inferred — the artifact is evidence, not a judgment.',
      parameters: {
        type: 'object',
        properties: {
          claim: { type: 'string', description: 'The assertion to gather web sources for (required).' },
          queries: { type: 'array', items: { type: 'string' }, description: 'Search queries (default: the claim; max 4 served).' },
          numResults: { type: 'integer', minimum: 1, maximum: 20, description: 'Results per query (default 5, max 20).' },
          fetchContent: { type: 'boolean', description: 'Fetch up to 5 result pages for exact passage extraction (default false; fetches ride the run budget).' },
          recencyFilter: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Filter by recency. Unknown values are refused, never ignored.' },
          domainFilter: { type: 'array', items: { type: 'string' }, description: 'Limit to domains (prefix with - to exclude).' },
          provider: { type: 'string', description: 'Per-call retrieval selection. Omit for the session default.' },
        },
        required: ['claim'],
      },
    },
    {
      name: 'get_search_content',
      description: 'Retrieve bounded pages of stored web_search/source_check results by responseId, or find passages within them. Store reads consume no budget and touch no ledger — they retrieve nothing new.',
      parameters: {
        type: 'object',
        properties: {
          responseId: { type: 'string', description: 'The responseId from a web_search or source_check call in this session (required).' },
          queryIndex: { type: 'integer', minimum: 0, description: 'Select the stored slice for the query at this index.' },
          url: { type: 'string', description: "Return the stored content for this URL (must belong to the entry)." },
          urlIndex: { type: 'integer', minimum: 0, description: 'Select the stored hit at this index.' },
          offset: { type: 'integer', minimum: 0, description: 'Character offset into the stored text (default 0). Ignored with findText.' },
          limit: { type: 'integer', minimum: 1, maximum: 16000, description: 'Max stored characters to return (default 4000). Ignored with findText.' },
          findText: { type: 'string', description: 'Locate passages containing this text (up to 5 windows).' },
          findMode: { type: 'string', enum: ['exact', 'case-insensitive'], description: 'Matching mode for findText (default case-insensitive). Requires findText; fuzzy is unsupported.' },
        },
        required: ['responseId'],
      },
    },
  ];

  return {
    definitions,
    handler: async (call): Promise<AgenticToolOutcome> => {
      try {
        // Primary-plane boundary (ADR-0013, D3) holds UNCHANGED on the agentic
        // path (#143): answer-mode fetch_content is refused before any
        // vendored execution, retrieval, or budget — graceful guidance, no
        // model injection; synthesis ownership never splits.
        if (call.name === 'fetch_content' && isAnswerModeFetchCall(call.arguments ?? {})) {
          return { success: false, error: ANSWER_MODE_UNSUPPORTED_MESSAGE };
        }
        if (call.name === 'web_search') {
          return await handleWebSearch(context, call.arguments ?? {});
        }
        if (call.name === 'fetch_content') {
          return await handleFetchContent(context, call.arguments ?? {});
        }
        if (call.name === 'source_check') {
          return await handleSourceCheck(context, call.arguments ?? {});
        }
        if (call.name === 'get_search_content') {
          return handleGetSearchContent(context, call.arguments ?? {});
        }
        return { success: false, error: `unknown tool "${call.name}".` };
      } catch (error: any) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  };
}

/**
 * `web_search` (Track D): full-contract retrieval. Queries fan out through
 * the threaded selection with per-call scoping; hits merge (dedupe by URL),
 * admit as sources, and store under a responseId for `get_search_content`.
 * `includeContent` fetches top pages through the ledgered, budget-capped
 * fetcher — shortfalls are reported, never silent.
 */
async function handleWebSearch(
  context: AgenticToolContext,
  args: Record<string, any>
): Promise<AgenticToolOutcome> {
  const queryList = normalizeQueryList(args);
  if (queryList.length === 0) {
    return { success: false, error: 'web_search requires a query or queries.' };
  }
  const scoping = resolveSearchScoping(context, args, 'web_search', AGENTIC_TOOL_BOUNDS.webSearchDefaultResults);
  if ('error' in scoping) return { success: false, error: scoping.error };
  const { provider, scoping: callOpts } = scoping;
  const served = queryList.slice(0, AGENTIC_TOOL_BOUNDS.maxQueriesPerCall);
  const notes: string[] = [];
  // Track E auto-recency (SPEC #155): a temporal query without an explicit
  // recencyFilter gains the intent's suggestion provider-side — reported,
  // never silent; an explicit selection always wins (resolved above).
  if (args.recencyFilter === undefined) {
    const auto = resolveRecencyForQuery(served.join(' '));
    if (auto) {
      callOpts.recencyFilter = auto;
      const markers = served
        .map((q) => detectTemporalIntent(q).matchedTerms)
        .reduce((all, terms) => all.concat(terms), [])
        .filter((t, i, arr) => arr.indexOf(t) === i);
      notes.push(
        `recencyFilter '${auto}' auto-applied provider-side (temporal intent: ${markers.join(', ') || 'freshness-seeking query'}) — pass an explicit recencyFilter to override.`
      );
    }
  }
  if (queryList.length > served.length) {
    notes.push(
      `${served.length} of ${queryList.length} queries served (cap ${AGENTIC_TOOL_BOUNDS.maxQueriesPerCall}); resubmit the remainder separately.`
    );
  }
  const includeContent = args.includeContent === true;

  const slices: StoredSearchSlice[] = [];
  for (const q of served) {
    // callOpts carries numResults plus only the scoping the call defined.
    const hits = await context.search(q, provider, callOpts);
    slices.push({
      query: q,
      // Track E retention: provider dates flow into the store and admission.
      hits: hits.map((h) => ({
        url: h.url,
        title: h.title,
        snippet: h.snippet,
        ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
      })),
    });
  }

  const merged = new Map<string, StoredSearchHit>();
  for (const slice of slices) {
    for (const hit of slice.hits) {
      if (!merged.has(hit.url)) merged.set(hit.url, { ...hit });
    }
  }
  for (const hit of merged.values()) {
    admitSource(context, {
      url: hit.url,
      title: hit.title,
      domain: safeHost(hit.url),
      snippet: hit.snippet,
      credibilityScore: 0.5,
      // Track E retention: admitted sources carry dates where supplied.
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
    });
  }

  if (includeContent) {
    const targets = [...merged.values()].slice(0, AGENTIC_TOOL_BOUNDS.maxIncludePages);
    let servedPages = 0;
    for (const hit of targets) {
      const page = await fetchPageForSurface(context, hit.url, {});
      if (page) {
        servedPages += 1;
        hit.content = page.text;
      }
    }
    if (servedPages < targets.length) {
      notes.push(
        `content fetched for ${servedPages} of ${targets.length} pages (budget cap ${context.maxFetches}); excerpts below cover only fetched pages.`
      );
    }
    // Propagate fetched content back into the per-query slices (same
    // dead-slice rule as source_check): `queryIndex` pages real content.
    const byUrl = new Map([...merged.values()].map((h) => [h.url, h]));
    for (const slice of slices) {
      for (const h of slice.hits) {
        const full = byUrl.get(h.url);
        if (full?.content) h.content = full.content;
      }
    }
  }

  const lines: string[] = [];
  slices.forEach((slice, qi) => {
    lines.push(`Query ${qi + 1}/${slices.length}: ${slice.query}`);
    slice.hits.forEach((h, i) => {
      // Track E: the date shows where the provider supplied it — the model
      // cites fresh evidence for freshness-seeking queries, never assumes.
      const dateSuffix = h.publishedAt ? ` (published ${h.publishedAt.slice(0, 10)})` : '';
      lines.push(`[${qi + 1}.${i + 1}] ${h.title} — ${h.url}${dateSuffix}\n${h.snippet}`);
      if (h.content) lines.push(`Full text (excerpt): ${h.content.slice(0, 300)}`);
    });
  });
  if (merged.size === 0) lines.push('No results.');
  const body = lines.join('\n\n');
  const storedText = [body, ...notes.map((n) => `Note: ${n}`)].join('\n\n');
  const responseId = storeToolContent(context.sessionId, 'search', served.join(' | '), served, storedText, [...merged.values()], slices);
  // Notes and the responseId ride AFTER the cap (Track D review nit): on a
  // long body the cap must never eat the honesty lines; the store holds all.
  const tail = [...notes.map((n) => `Note: ${n}`), `responseId: ${responseId} (retrieve full stored content via get_search_content)`];
  return { success: true, result: `${capResultText(body)}\n\n${tail.join('\n\n')}` };
}

/**
 * Shared ledgered fetch for the surface internals (Track D): budget gate,
 * `budget_exhausted` emission, `claimAndShare` admission, and passage
 * back-fill live here once — `fetch_content`, `includeContent`, and
 * `source_check` all ride it, so admission, dedupe, and the cap stay
 * single-sourced (ADR-0014 decision 4).
 */
const fetchPageForSurface = async (
  context: AgenticToolContext,
  url: string,
  options: AgenticFetchCallOptions
): Promise<{ url: string; title: string; text: string } | null> => {
  if (context.signal?.aborted) return null;
  if (context.state.fetchesUsed >= context.maxFetches) {
    context.emit({
      type: 'budget_exhausted',
      sessionId: context.sessionId,
      state: 'budget_exhausted',
      message: `Retrieval budget exhausted (cap ${context.maxFetches}). | استُنفدت ميزانية الاسترجاع (الحد ${context.maxFetches}).`,
    });
    return null;
  }
  context.state.fetchesUsed += 1;
  const mode = options.mode;
  const entry = await claimAndShare(context.sessionId, url, async () => {
    const page = await context.fetchPage(url, mode ? { mode } : undefined);
    // Normalize to the ledger's ScrapedPageLike shape (content, not text).
    return page ? { url: page.url, title: page.title, content: page.text } : null;
  });
  if (!entry) return null;
  const page = entry.page;
  const text = typeof page.content === 'string' ? page.content : '';
  const item: SourceItem = {
    url: page.url,
    title: page.title ?? page.url,
    domain: page.domain ?? safeHost(page.url),
    snippet: text.slice(0, 200),
    credibilityScore: page.credibilityScore ?? 0.5,
    passage: text,
  };
  const existing = context.state.sources.find((s) => s.url === item.url);
  if (existing) {
    // Evidence preservation (ADR-0013 boundary clause): a URL first
    // admitted as a search snippet GAINS the full fetched passage when the
    // same URL is later fetched — the content is never silently dropped by
    // the admission dedupe.
    if (!existing.passage && item.passage) existing.passage = item.passage;
    if (!existing.domain && item.domain) existing.domain = item.domain;
  } else {
    admitSource(context, item);
  }
  return { url: page.url, title: page.title ?? page.url, text };
};

const VIDEO_AND_ADVANCED_FETCH_FIELDS = ['prompt', 'timestamp', 'frames', 'model', 'auth', 'proxy', 'answerModel', 'forceClone'] as const;

/**
 * `fetch_content` (Track D): url/urls with readable/raw modes. Unsupported
 * mechanism fields (video analysis, proxy/auth profiles, model overrides)
 * are refused loudly — the headless engine has no browser, no ffmpeg, no
 * remote-hosted providers. Multi-URL calls serve in order within the run
 * budget; per-URL failures report inline, and total failure is an explicit
 * failure (never an empty success).
 */
async function handleFetchContent(
  context: AgenticToolContext,
  args: Record<string, any>
): Promise<AgenticToolOutcome> {
  const mode = args.mode ?? 'readable';
  if (mode !== 'readable' && mode !== 'raw') {
    return {
      success: false,
      error: `fetch_content mode must be 'readable' or 'raw' — got ${JSON.stringify(mode)}. (answer mode is refused: ${ANSWER_MODE_UNSUPPORTED_MESSAGE})`,
    };
  }
  const unsupported = VIDEO_AND_ADVANCED_FETCH_FIELDS.filter((f) => args[f] !== undefined);
  if (unsupported.length > 0) {
    return {
      success: false,
      error: `fetch_content option(s) unsupported in LENS: ${unsupported.join(', ')} — LENS serves readable/raw extraction only (no video analysis, no proxy/auth profiles, no model overrides).`,
    };
  }
  const rawList: unknown[] = Array.isArray(args.urls) ? args.urls : args.url !== undefined ? [args.url] : [];
  const urlList = rawList.filter((u): u is string => typeof u === 'string').map((u) => u.trim()).filter(Boolean);
  if (urlList.length === 0) {
    return { success: false, error: 'fetch_content requires a url or urls.' };
  }
  const served = urlList.slice(0, AGENTIC_TOOL_BOUNDS.maxFetchUrls);
  const notes: string[] = [];
  if (urlList.length > served.length) {
    notes.push(`${served.length} of ${urlList.length} URLs served (cap ${AGENTIC_TOOL_BOUNDS.maxFetchUrls}); resubmit the remainder separately.`);
  }
  const sections: string[] = [];
  let servedCount = 0;
  for (const url of served) {
    const page = await fetchPageForSurface(context, url, { mode });
    if (page) {
      servedCount += 1;
      sections.push(`## ${page.url}\n${page.title}\n\n${page.text}`);
    } else {
      sections.push(
        `## ${url}\ncould not fetch ${url} (${context.signal?.aborted ? 'aborted' : 'budget or retrieval failure'}).`
      );
    }
  }
  for (const note of notes) sections.push(`Note: ${note}`);
  if (servedCount === 0) {
    return { success: false, error: sections.join('\n\n') };
  }
  return { success: true, result: capResultText(sections.join('\n\n')) };
}

/**
 * `source_check` (Track D): claim-evidence artifact WITHOUT semantic
 * inference. Searches the claim (or the given queries), optionally fetches
 * top pages for exact passages, admits everything as evidence, and stores
 * the artifact for `get_search_content`. The MODEL judges support — the tool
 * never emits supported/contradicted/verdict labels.
 */
async function handleSourceCheck(
  context: AgenticToolContext,
  args: Record<string, any>
): Promise<AgenticToolOutcome> {
  const claim = typeof args.claim === 'string' ? args.claim.trim() : '';
  if (!claim) {
    return { success: false, error: 'source_check requires a claim.' };
  }
  const requested = normalizeQueryList({ queries: args.queries });
  const scoping = resolveSearchScoping(context, args, 'source_check', AGENTIC_TOOL_BOUNDS.sourceCheckDefaultResults);
  if ('error' in scoping) return { success: false, error: scoping.error };
  const { provider, scoping: callOpts } = scoping;
  const wantContent = args.fetchContent === true;
  const notes: string[] = [];

  // Track E freshness-first verification (SPEC #155): a temporal claim
  // without explicit queries fans out date-aware variants (claim + year
  // anchor + latest tail) and auto-applies the intent recency — the check
  // verifies against FRESH evidence before anything cites it. Explicit
  // queries or an explicit recency stay exactly as the caller scoped them.
  let queryList = (requested.length > 0 ? requested : [claim]).slice(0, AGENTIC_TOOL_BOUNDS.maxQueriesPerCall);
  if (requested.length === 0 && args.recencyFilter === undefined) {
    const intent = detectTemporalIntent(claim);
    if (intent.isTemporal) {
      queryList = buildDateAwareVariants(claim).slice(0, AGENTIC_TOOL_BOUNDS.maxQueriesPerCall);
      if (intent.suggestedRecency) {
        callOpts.recencyFilter = intent.suggestedRecency;
        notes.push(
          `temporal claim — date-aware variants (${queryList.length}) with recencyFilter '${intent.suggestedRecency}' auto-applied (markers: ${intent.matchedTerms.join(', ')}); pass explicit queries/recencyFilter to override.`
        );
      }
    }
  } else if (args.recencyFilter === undefined) {
    const auto = resolveRecencyForQuery(queryList.join(' '));
    if (auto) {
      callOpts.recencyFilter = auto;
      notes.push(`recencyFilter '${auto}' auto-applied provider-side (temporal intent) — pass an explicit recencyFilter to override.`);
    }
  }

  // Per-query slices are retained (Track D review): `queryIndex` on a check
  // id pages the slice it names — never a dead empty success.
  const slices: StoredSearchSlice[] = [];
  for (const q of queryList) {
    const hits = await context.search(q, provider, callOpts);
    slices.push({
      query: q,
      // Track E retention: provider dates flow into the store and admission.
      hits: hits.map((h) => ({
        url: h.url,
        title: h.title,
        snippet: h.snippet,
        ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
      })),
    });
  }
  const merged = new Map<string, StoredSearchHit>();
  for (const slice of slices) {
    for (const h of slice.hits) {
      if (!merged.has(h.url)) merged.set(h.url, { ...h });
    }
  }
  for (const hit of merged.values()) {
    admitSource(context, {
      url: hit.url,
      title: hit.title,
      domain: safeHost(hit.url),
      snippet: hit.snippet,
      credibilityScore: 0.5,
      // Track E retention: admitted sources carry dates where supplied.
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
    });
  }

  const targets = wantContent ? [...merged.values()].slice(0, AGENTIC_TOOL_BOUNDS.maxCheckPages) : [];
  let fetchedPages = 0;
  for (const hit of targets) {
    const page = await fetchPageForSurface(context, hit.url, {});
    if (page) {
      fetchedPages += 1;
      hit.content = page.text;
    }
  }
  if (wantContent && fetchedPages < targets.length) {
    notes.push(
      `passages extracted for ${fetchedPages} of ${targets.length} pages (budget cap ${context.maxFetches}).`
    );
  }
  if (!wantContent && merged.size > 0) {
    notes.push('passages not extracted (fetchContent false); re-run with fetchContent true for exact citations.');
  }

  const lines: string[] = [
    `Claim: ${claim}`,
    `Queries (${queryList.length}): ${queryList.join(' | ')}`,
    `Sources (${merged.size}):`,
  ];
  let rank = 0;
  for (const hit of merged.values()) {
    rank += 1;
    // Track E: dates show where supplied — the model cites verified fresh
    // passages, never assumes recency.
    const dateSuffix = hit.publishedAt ? ` (published ${hit.publishedAt.slice(0, 10)})` : '';
    lines.push(`[${rank}] ${hit.title} — ${hit.url}${dateSuffix}\nSnippet: ${hit.snippet}`);
    lines.push(hit.content ? `Passage: ${hit.content.slice(0, AGENTIC_TOOL_BOUNDS.artifactExcerptChars)}` : 'Passage: (not extracted)');
  }
  if (merged.size === 0) lines.push('(no sources found)');
  const body = lines.join('\n\n');
  // Fetched passages live on the merged hits — propagate them back into the
  // per-query slices so `queryIndex` pages real content, never dead empties.
  const byUrl = new Map([...merged.values()].map((h) => [h.url, h]));
  for (const slice of slices) {
    for (const h of slice.hits) {
      const full = byUrl.get(h.url);
      if (full?.content) h.content = full.content;
    }
  }
  const storedText = [body, ...notes.map((n) => `Note: ${n}`)].join('\n\n');
  const responseId = storeToolContent(context.sessionId, 'check', claim, queryList, storedText, [...merged.values()], slices);
  // Notes and the responseId ride AFTER the cap (Track D review nit): on a
  // long body the cap must never eat the honesty lines; the store holds all.
  const tail = [...notes.map((n) => `Note: ${n}`), `responseId: ${responseId} (retrieve full stored content via get_search_content)`];
  return { success: true, result: `${capResultText(body)}\n\n${tail.join('\n\n')}` };
}

/**
 * `get_search_content` (Track D): bounded paging over the session's stored
 * tool content. Unknown ids, dangling findMode, out-of-range selectors, and
 * fuzzy matching are refusals — a store read must never invent content.
 * Reads consume no budget and touch no ledger.
 */
function handleGetSearchContent(
  context: AgenticToolContext,
  args: Record<string, any>
): AgenticToolOutcome {
  const responseId = typeof args.responseId === 'string' ? args.responseId : '';
  if (!responseId) {
    return { success: false, error: 'get_search_content requires a responseId.' };
  }
  // Shape errors precede the store lookup: a malformed call is refused for
  // its shape regardless of whether the id exists.
  if (args.findMode !== undefined && args.findText === undefined) {
    return { success: false, error: 'get_search_content findMode requires findText; provide findText or omit findMode.' };
  }
  if (args.findMode !== undefined && !['exact', 'case-insensitive'].includes(args.findMode)) {
    return {
      success: false,
      error: `get_search_content findMode must be 'exact' or 'case-insensitive' — fuzzy matching is unsupported in LENS.`,
    };
  }
  const entry = storedBySession.get(context.sessionId)?.entries.get(responseId);
  if (!entry) {
    return {
      success: false,
      error: `get_search_content: unknown responseId ${JSON.stringify(responseId)} for this session. Use a responseId returned by web_search or source_check in the same run.`,
    };
  }

  let target: { label: string; text: string };
  if (args.url !== undefined || args.urlIndex !== undefined) {
    let hit: StoredSearchHit | undefined;
    if (args.url !== undefined) {
      if (typeof args.url !== 'string') {
        return { success: false, error: 'get_search_content url must be a string.' };
      }
      hit = entry.hits.find((h) => h.url === args.url);
      if (!hit) {
        return { success: false, error: `get_search_content: url ${JSON.stringify(args.url)} is not part of responseId ${JSON.stringify(responseId)}.` };
      }
    } else {
      const i = args.urlIndex;
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= entry.hits.length) {
        return { success: false, error: `get_search_content: urlIndex out of range (0-${entry.hits.length - 1}) for responseId ${JSON.stringify(responseId)}.` };
      }
      hit = entry.hits[i];
    }
    target = { label: hit.url, text: hit.content ?? hit.snippet };
  } else if (args.queryIndex !== undefined) {
    const i = args.queryIndex;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= entry.slices.length) {
      return { success: false, error: `get_search_content: queryIndex out of range (0-${entry.slices.length - 1}) for responseId ${JSON.stringify(responseId)}.` };
    }
    const slice = entry.slices[i];
    target = {
      label: `query ${i}: ${slice.query}`,
      text: slice.hits.map((h, hi) => `[${hi}] ${h.title} — ${h.url}\n${h.content ?? h.snippet}`).join('\n\n') || '(no hits)',
    };
  } else {
    target = { label: responseId, text: entry.text };
  }

  if (args.findText !== undefined) {
    if (typeof args.findText !== 'string' || !args.findText) {
      return { success: false, error: 'get_search_content findText must be a non-empty string.' };
    }
    const needle = args.findMode === 'exact' ? args.findText : args.findText.toLowerCase();
    const haystack = args.findMode === 'exact' ? target.text : target.text.toLowerCase();
    const windows: string[] = [];
    let from = 0;
    while (windows.length < AGENTIC_TOOL_BOUNDS.maxFindWindows) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      const start = Math.max(0, at - AGENTIC_TOOL_BOUNDS.findWindowChars);
      const end = Math.min(target.text.length, at + needle.length + AGENTIC_TOOL_BOUNDS.findWindowChars);
      windows.push(`…${target.text.slice(start, end)}…`);
      from = at + needle.length;
    }
    if (windows.length === 0) {
      return { success: true, result: `No matches for ${JSON.stringify(args.findText)} in ${target.label} (${target.text.length} chars searched).` };
    }
    return { success: true, result: windows.join('\n\n---\n\n') };
  }

  const offset = args.offset ?? 0;
  const limit = args.limit ?? AGENTIC_TOOL_BOUNDS.getContentDefaultLimit;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return { success: false, error: 'get_search_content offset must be a non-negative integer.' };
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0 || limit > AGENTIC_TOOL_BOUNDS.getContentMaxLimit) {
    return { success: false, error: `get_search_content limit must be an integer 1-${AGENTIC_TOOL_BOUNDS.getContentMaxLimit}.` };
  }
  if (offset > target.text.length) {
    return { success: false, error: `get_search_content offset ${offset} exceeds the stored text length (${target.text.length}) for ${target.label}.` };
  }
  const slice = target.text.slice(offset, offset + limit);
  const suffix = offset + limit < target.text.length
    ? `\n…(${target.text.length - offset - limit} more chars; re-run with offset ${offset + limit})`
    : '';
  return { success: true, result: slice + suffix };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface AgenticRunOptions {
  sessionId: string;
  question: string;
  emit: (event: LiveEvent) => void;
  /** The accumulated state from the tool surface built for this run. */
  state: AgenticRunState;
  signal?: AbortSignal;
  /**
   * Transcript persistence (#144): when provided, the turn-group transcript
   * is captured into this LENS-side store at terminal time. Absent → no
   * capture (callers without persistence); a failing store never breaks the
   * run — the explicit terminal outranks storage.
   */
  transcript?: { store: Pick<AgenticTranscriptStore, 'write' | 'read'> };
}

export interface AgenticRunResult {
  /** The runner's explicit run terminals. `budget_exhausted` is emitted by
   * the tool surface mid-run and is NOT a run terminal — it never appears
   * here. */
  terminal: 'finished' | 'cancelled' | 'error';
  report: string;
  sources: SourceItem[];
  /** The persisted conversation projection on `finished` (#144); null otherwise. */
  conversationProjection?: ReturnType<typeof buildConversationProjection>;
}

/** The cancel registry: one live run per sessionId. */
const activeRuns = new Map<
  string,
  { abort: AbortController; detach: () => void; session?: { abort: () => Promise<void> | void } }
>();

/**
 * Start-time admission guard for Agentic Search (tracer P4: deleted).
 *
 * RETIRED: the sync request-key inspection (`apiKey`/`ollamaEndpoint` off the
 * body) was a parallel auth path. Admission now reads Pi truth through the
 * async server guards (`providerAdmissionGuardForAgent` → `auth.json` /
 * `models.json`), which reject bilingually with 422. Kept as a documented
 * stub so legacy call-sites fail loudly instead of silently.
 */
export function agenticAdmissionGuard(
  _body: { provider?: string; apiKey?: string; ollamaEndpoint?: string } | undefined
): string | null {
  void _body;
  throw new Error(
    '[agenticSearch] agenticAdmissionGuard retired (tracer P4): admission reads Pi truth via providerAdmissionGuardForAgent.'
  );
}

/**
 * Run one Agentic Search Turn-Group end-to-end over a hosted session with its
 * tool surface already registered (#140 seam + createAgenticToolSurface).
 */
export async function runAgenticSearch(session: any, options: AgenticRunOptions): Promise<AgenticRunResult> {
  const { sessionId, question, state } = options;

  // One live run per session: a second start while one is live is rejected
  // explicitly — never a silent registry takeover that orphans the live run
  // and makes cancel unreachable for it. The rejection is a visible error
  // terminal (Event Faithfulness), bilingually actionable.
  if (activeRuns.has(sessionId)) {
    const message = 'An agentic run is already live for this session. Cancel it or wait for it to finish. | هناك تشغيل أجنتي حي لهذه الجلسة. ألغه أو انتظر انتهائه.';
    options.emit({ type: 'error', sessionId, state: 'failed', message } as LiveEvent);
    return { terminal: 'error', report: '', sources: [] };
  }

  const abort = new AbortController();
  let terminal: AgenticRunResult['terminal'] = 'error';
  resetFetchLedger(sessionId);
  // Track D: a run starts from an empty stored-content registry — a
  // responseId from a previous run must never resolve in this one.
  resetAgenticStoredContent(sessionId);

  // Bridge first: runtime events are visible from the very first instant.
  // Every emission also mirrors report chunks into the draft, so the
  // terminal payload carries exactly what streamed — one source of truth.
  const emit = (event: LiveEvent) => {
    if (event.type === 'report_chunk' && typeof event.chunk === 'string') {
      state.reportChunks.push(event.chunk);
    }
    options.emit(event);
  };
  const detach = attachAgentSessionBridge(session, { sessionId, emit });

  const emitTerminal = (next: AgenticRunResult['terminal'], event: LiveEvent): AgenticRunResult => {
    terminal = next;
    // Terminal-time transcript capture (#144; SPEC-028 Decision 2): the
    // turn-group transcript is the session's own `state.messages` — plain
    // JSON — captured exactly once, when the run ends, into the LENS-side
    // store. The capture lands BEFORE the terminal event is emitted, so the
    // projection riding the `finished` event is built from the SAME bytes
    // this run just wrote — never one turn-group behind, never the live
    // runtime. Persistence failure never breaks the terminal.
    const turn: TranscriptTurnGroup = {
      question,
      terminal: next,
      capturedAt: Date.now(),
      messages: (session?.state?.messages ?? []) as Array<Record<string, unknown>>,
    };
    captureTranscriptAtTerminal(options.transcript?.store, sessionId, turn);
    const projection =
      next === 'finished'
        ? buildConversationProjection(options.transcript?.store.read(sessionId))
        : undefined;
    if (projection !== undefined) {
      (event as { conversationProjection?: ReturnType<typeof buildConversationProjection> }).conversationProjection =
        projection;
    }
    emit(event);
    return { terminal, report: state.reportChunks.join(''), sources: [...state.sources], conversationProjection: projection };
  };

  activeRuns.set(sessionId, { abort, detach, session });

  try {
    const promptOutcome = await session
      .prompt(question)
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );

    if (abort.signal.aborted || options.signal?.aborted) {
      return emitTerminal('cancelled', {
        type: 'cancelled',
        sessionId,
        state: 'cancelled',
        message: 'Cancelled by user. | أُلغيت بواسطة المستخدم.',
        sources: [...state.sources],
      } as LiveEvent);
    }
    if (!promptOutcome.ok) {
      throw promptOutcome.error;
    }
    return emitTerminal('finished', {
      type: 'finished',
      sessionId,
      state: 'completed',
      report: state.reportChunks.join(''),
      sources: [...state.sources],
      costs: 0,
    } as LiveEvent);
  } catch (error: any) {
    if (abort.signal.aborted || options.signal?.aborted) {
      return emitTerminal('cancelled', {
        type: 'cancelled',
        sessionId,
        state: 'cancelled',
        message: 'Cancelled by user. | أُلغيت بواسطة المستخدم.',
        sources: [...state.sources],
      } as LiveEvent);
    }
    return emitTerminal('error', {
      type: 'error',
      sessionId,
      state: 'failed',
      message: `Agentic run failed: ${error?.message ?? String(error)}`,
    } as LiveEvent);
  } finally {
    detach();
    activeRuns.delete(sessionId);
  }
}

/**
 * Cancel the live run for a session: aborts the runner's signal AND the
 * session itself (aborting the in-flight provider stream — a runner signal
 * alone is only observed at loop boundaries and would leave the stream
 * running), then the runner surfaces its explicit `cancelled` terminal with
 * the evidence admitted so far.
 */
export function cancelAgenticSearch(sessionId: string): boolean {
  const run = activeRuns.get(sessionId);
  if (!run) return false;
  run.abort.abort();
  try {
    void run.session?.abort();
  } catch {
    // Session abort is best-effort; the terminal path surfaces real failures.
  }
  return true;
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = { agenticAdmissionGuard, activeRuns };
