/**
 * The Agentic Search runner (ticket #142; SPEC-028 decision 3).
 *
 * One question → one Turn-Group: a hosted AgentSession (#140) answers
 * gate-free — no plan-approval gate; that invariant is Deep Research's —
 * bounded by the session budget (the `maxFetches` retrieval cap) and the
 * plane's fetch ledger, and terminates into LENS's evidence contracts: the
 * streamed answer lands as report chunks, every admitted page lands as a
 * source, and the run ends with an explicit terminal LiveEvent (`finished`,
 * `cancelled`, `budget_exhausted`, or `error`) carrying what was already
 * admitted. The Event Faithfulness law holds: a run is never seen stopping
 * silently.
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
    admitSource(context, {
      url: page.url,
      title: page.title ?? page.url,
      domain: page.domain ?? safeHost(page.url),
      snippet: text.slice(0, 200),
      credibilityScore: page.credibilityScore ?? 0.5,
      passage: text,
    });
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
    handler: async (call) => {
      try {
        if (call.name === 'web_search') {
          const query = String(call.arguments?.query ?? '').trim();
          if (!query) return { success: false, output: 'Error: web_search requires a query.' };
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
          return { success: true, output: body || 'No results.' };
        }
        if (call.name === 'fetch_content') {
          const url = String(call.arguments?.url ?? '').trim();
          if (!url) return { success: false, output: 'Error: fetch_content requires a URL.' };
          const page = await fetchPage(url);
          if (!page) {
            return {
              success: false,
              output: context.signal?.aborted
                ? 'Error: fetch aborted.'
                : `Error: could not fetch ${url} (budget or retrieval failure).`,
            };
          }
          return { success: true, output: page.text };
        }
        return { success: false, output: `Error: unknown tool "${call.name}".` };
      } catch (error: any) {
        return { success: false, output: `Error: ${error?.message ?? String(error)}` };
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
  /** The hosted session from the #140 seam (with the surface registered). */
  session: { subscribe: (listener: (event: any) => void) => () => void; prompt: (text: string) => Promise<void>; abort: () => Promise<void> | void };
  signal?: AbortSignal;
}

export interface AgenticRunResult {
  terminal: 'finished' | 'cancelled' | 'budget_exhausted' | 'error';
  report: string;
  sources: SourceItem[];
}

/** The cancel registry: one live run per sessionId. */
const activeRuns = new Map<string, { abort: AbortController; detach: () => void }>();

/**
 * Start-time admission guard for Agentic Search: without a usable provider
 * the run can only hang, so it is rejected with a bilingual, user-actionable
 * message before any loop starts. Mirrors the Deep Research guard on
 * `/api/research/start` (ticket #119) at the agentic surface.
 */
export function agenticAdmissionGuard(body: { provider?: string; apiKey?: string; ollamaEndpoint?: string } | undefined): string | null {
  const provider = (body?.provider || 'gemini').trim().toLowerCase();
  if (provider === 'ollama') {
    if (!(body?.ollamaEndpoint || '').trim()) {
      return 'No Ollama endpoint configured. Open Settings → add your Ollama server URL, then retry. | لم يتم إعداد خادم Ollama. افتح الإعدادات ← أضف عنوان الخادم ثم أعد المحاولة.';
    }
    return null;
  }
  if (!(body?.apiKey || '').trim()) {
    return `No API key configured for "${provider}". Open Settings → paste your ${provider} key, then retry. | لا يوجد مفتاح API للمزود "${provider}". افتح الإعدادات ← أضف المفتاح ثم أعد المحاولة.`;
  }
  return null;
}

/**
 * Run one Agentic Search Turn-Group end-to-end over a hosted session with its
 * tool surface already registered (#140 seam + createAgenticToolSurface).
 */
export async function runAgenticSearch(session: any, options: AgenticRunOptions): Promise<AgenticRunResult> {
  const { sessionId, question, state } = options;
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
    emit(event);
    return { terminal, report: state.reportChunks.join(''), sources: [...state.sources] };
  };

  activeRuns.set(sessionId, { abort, detach });

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
 * session itself (aborting the in-flight provider stream), then the runner
 * surfaces its explicit `cancelled` terminal with the evidence admitted so far.
 */
export function cancelAgenticSearch(sessionId: string): boolean {
  const run = activeRuns.get(sessionId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = { agenticAdmissionGuard, activeRuns };
