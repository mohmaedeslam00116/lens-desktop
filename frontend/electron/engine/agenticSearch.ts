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

/** Result of one web_search call. */
export interface AgenticSearchHit {
  url: string;
  title: string;
  snippet: string;
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
  fetchPage: (url: string) => Promise<{ url: string; title: string; text: string } | null>;
  /** Search provider for web_search (injectable for tests; plane-backed in production). */
  search: (query: string) => Promise<AgenticSearchHit[]>;
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
  });
}

/**
 * Build the LENS-wrapped research tool surface for one Turn-Group. This is
 * the enforcement point (ADR-0014 decision 4): every retrieval inside these
 * wrappers is ledgered and budget-capped; hooks carry no policy.
 */
export function createAgenticToolSurface(context: AgenticToolContext): LensToolSurface {
  const fetchPage = async (url: string): Promise<{ url: string; title: string; text: string } | null> => {
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
    const entry = await claimAndShare(context.sessionId, url, async () => {
      const page = await context.fetchPage(url);
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

  const definitions = [
    {
      name: 'web_search',
      description: 'Search the web for evidence on a query. Returns titles, URLs, and snippets.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: 'fetch_content',
      description: "Fetch one page's full readable text by URL (ledgered, budget-capped).",
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
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
          const query = String(call.arguments?.query ?? '').trim();
          if (!query) return { success: false, error: 'web_search requires a query.' };
          const hits = await context.search(query);
          for (const hit of hits) {
            admitSource(context, {
              url: hit.url,
              title: hit.title,
              domain: safeHost(hit.url),
              snippet: hit.snippet,
              credibilityScore: 0.5,
            });
          }
          const body = hits
            .map((h, i) => `[${i + 1}] ${h.title} — ${h.url}\n${h.snippet}`)
            .join('\n\n');
          return { success: true, result: body || 'No results.' };
        }
        if (call.name === 'fetch_content') {
          const url = String(call.arguments?.url ?? '').trim();
          if (!url) return { success: false, error: 'fetch_content requires a URL.' };
          const page = await fetchPage(url);
          if (!page) {
            return {
              success: false,
              error: context.signal?.aborted
                ? 'fetch aborted.'
                : `could not fetch ${url} (budget or retrieval failure).`,
            };
          }
          return { success: true, result: page.text };
        }
        return { success: false, error: `unknown tool "${call.name}".` };
      } catch (error: any) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  };
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
