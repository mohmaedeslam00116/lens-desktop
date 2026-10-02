import { LiveEvent, ResearchRequest, SourceItem } from './types';
import { SkillActivationManager } from './skills';
import { ResearcherRole, roleBrief } from './researcherRoles';

/**
 * researcherAgent.ts — the re-hosted researcher (ticket #146; ADR-0014
 * decision 7; SPEC-028 final migration).
 *
 * One research facet executes inside a HOSTED AgentSession built through the
 * #140 construction seam (research-tools-only allow-list, LENS-owned
 * discovery, in-memory session manager) on the SAME plane-backed tool
 * surface the #142 agentic runner uses: the LENS-wrapped web_search /
 * fetch_content tools whose retrieval routes through the ADR-0013 plane
 * ledger — the gate, budget, and SSRF validation hold inside the wrappers,
 * never in hooks.
 *
 * What the parent still owns (ADR-0010 contracts, unchanged): the brief
 * (immutable, role from the closed catalog), the fan-out and its caps, the
 * single session evidence budget, the auditor, and all telemetry. The
 * runtime owns only the execution loop: session state, steering, compaction,
 * auto-retry (ADR-0014 consequences).
 *
 * The `ResearcherRunResult` contract is preserved bit-for-bit: findings are
 * provenance-stamped `ScrapedPage`s; every URL surfaced by web_search is
 * FETCHED through the session ledger into the facet's findings pool (the
 * #89 ingestUrl contract, and the #150 evidence-preservation clause — a
 * snippet-only admission never suffices); `dedupeShared` still counts the
 * ledger's cross-researcher shares. The lifecycle vocabulary changed
 * deliberately: `run_started`/`run_completed` (execution) are the runtime
 * bridge's window events now — `started`/`completed` stay parent-owned, so
 * telemetry consumers never double-count.
 *
 * The native researcher loop this module carried since #89 is RETIRED
 * (expand-contract, parity green in test/researcher_migration.test.mjs) —
 * no dual maintenance. The class below is the honest dead seam: it
 * documents the retirement and rejects; callers use runRehostedResearcher
 * (the default factory does).
 */

/** Options of the re-hosted researcher — the parent's construction brief.
 * The retired native loop's knobs that moved INTO the runtime (tool rounds)
 * or OUT of it (injection seams used by the old tests) are gone. */
export interface ResearcherOptions {
  researcherId: string;
  facetIndex: number;
  facet: string;
  facetCount: number;
  /** Milestone provenance stamped on every finding. */
  milestoneId: string;
  milestoneTitle: string;
  /** Retained for surface compatibility; the allow-list IS the grant. */
  toolPackages: boolean;
  activationManager?: SkillActivationManager;
  searchProvider?: ResearchRequest['search_provider'];
  /** Compression proxy base URL leased by the PARENT for the whole fan-out
   * (ticket #92). The re-hosted run consumes it through the vendored
   * plane's own proxy standard: the env-var proxy contract (HTTP(S)_PROXY /
   * ALL_PROXY) — injected for the researcher's execution and restored after
   * (the fan-out runs concurrently, so the lease stays parent-scoped).
   * `compressionNotices` remain the parent's lease diagnostics. */
  proxyBaseUrl?: string;
  /** Honest alias for the retired loop's `proxyBaseUrl` consumer contract
   * (kept distinct so the parent passes compression state explicitly). */
  compressionProxyUrl?: string;
  /** Degradation notices collected by the parent's lease acquisition. */
  compressionNotices?: string[];
  /** Specialist role from the closed catalog (ADR-0010 decision 5). */
  role?: ResearcherRole;
  /** Override the LENS-owned agent discovery directory. Production callers
   * never pass it (the app-data default holds, per ADR-0014); offline tests
   * pass a per-researcher temp dir so concurrent constructions never contend
   * on the runtime's credential file — the host seam's own documented
   * pattern. */
  agentDir?: string;
}

export interface ResearcherRunResult {
  researcherId: string;
  facetIndex: number;
  facet: string;
  /** Findings tagged with the facet's milestone provenance. */
  findings: Array<{
    url: string;
    title: string;
    domain: string;
    content: string;
    credibilityScore: number;
    milestoneId?: string;
    milestoneTitle?: string;
  }>;
  toolCalls: number;
  /** URLs skipped because another researcher already fetched them —
   * the shared page still joined this facet's evidence pool. */
  dedupeShared: number;
}

/**
 * Run ONE facet through a hosted AgentSession (the re-hosted researcher).
 * Emits the parent's provenance-tagged `source` events while harvesting,
 * and returns the same result envelope the parent has always consumed.
 * Runtime faults are contained by the caller (the parent's fan-out
 * contains a failed researcher and leaves the facet to the delegated loop).
 *
 * `decorateSession` is the pi runtime's own scripted-transport seam (the
 * session's `agent.streamFunction` — the same DI point the #142 runner and
 * parity legs use): production callers never pass it; offline tests and
 * ops replays script the model transport without touching production code.
 * It receives the researcher's own brief as its second argument, so a
 * scripted transport can recognize the window's opening turn by the exact
 * brief text instead of coupling to how the brief embeds the facet.
 */
export async function runRehostedResearcher(
  sessionId: string,
  emitEvent: (event: LiveEvent) => void,
  options: ResearcherOptions,
  request: ResearchRequest,
  signal?: AbortSignal,
  decorateSession?: (session: any, brief: string) => void
): Promise<ResearcherRunResult> {
  const empty: ResearcherRunResult = {
    researcherId: options.researcherId,
    facetIndex: options.facetIndex,
    facet: options.facet,
    findings: [],
    toolCalls: 0,
    dedupeShared: 0,
  };
  if (signal?.aborted) return empty;

  const { createAgenticToolSurface } = await import('./agenticSearch');
  const { claimAndShare } = await import('./fetchLedger');
  const { primarySearchPlane } = await import('./searchPlane');
  const { primaryScrapePlane } = await import('./scrapePlane');
  const { createResearchSession } = await import('./agentSessionHost');
  const { runAgenticSearch } = await import('./agenticSearch');

  const language: 'ar' | 'en' = request.language === 'ar' ? 'ar' : 'en';
  const brief = [
    `You are a specialized research subagent.`,
    `Your assigned research facet (topic ${options.facetIndex + 1}/${options.facetCount}): "${options.facet}".`,
    roleBrief(options.role ?? 'primary', language),
    `Investigate ONLY this facet. Use the provided web tools to search for, fetch, and verify sources relevant to the facet.`,
    `Be concise: report the key facts you verified with their sources. Do not write a full report — the parent agent synthesizes.`,
    options.activationManager?.getPromptContext() || '',
  ].join('\n');

  const state = { sources: [] as SourceItem[], reportChunks: [], fetchesUsed: 0 };
  const findings: ResearcherRunResult['findings'] = [];
  let dedupeShared = 0;
  const seen = new Set<string>();

  // The window→backbone boundary (#146). The runtime bridge's emissions are
  // this researcher's OWN window vocabulary — session_state / status /
  // thought / report_chunk carry the researcher's session id, and the
  // runner's terminals are window terminals. Forwarded verbatim they would
  // corrupt the parent's run-level backbone: a window `finished` closes the
  // live stream early (the server's terminal-close rule) AND would steal the
  // delegated terminal from the parent's interception seam; window
  // report_chunks would pollute the delegated report stream (streamed-vs-
  // final integrity); a window `error` would close the stream on what the
  // fan-out is contracted to CONTAIN. The parent keeps the ADR-0010 story:
  // provenance-stamped `source` events flow through (live evidence),
  // started/completed telemetry stays parent-owned (no double lifecycle),
  // and a window error surfaces as a thrown fault for the caller's
  // containment (researchersFailed + delegated fallback), never as a run
  // terminal.
  let windowErrorMessage: string | null = null;
  const emitToParent = (event: LiveEvent): void => {
    if (event.type === 'error') {
      const message = (event as { message?: unknown }).message;
      if (typeof message === 'string' && windowErrorMessage === null) windowErrorMessage = message;
      return;
    }
    if (
      event.type === 'status'
      || event.type === 'session_state'
      || event.type === 'report_chunk'
      || event.type === 'thought'
      || event.type === 'finished'
      || event.type === 'cancelled'
      || event.type === 'budget_exhausted'
    ) return;
    emitEvent(event);
  };

  // Researcher-harvest contract (the #89 ingestUrl contract, fed by the
  // runtime's tool execution): every URL surfaced by the surface's
  // web_search is FETCHED through the session ledger into the facet's
  // findings pool with the facet's milestone provenance. A snippet-only
  // shared entry is never enough (the #150 evidence-preservation clause);
  // the ledger's `shared` flag still counts as `dedupeShared`.
  const harvest = async (url: string): Promise<void> => {
    if (seen.has(url) || findings.length >= 8 || signal?.aborted) return;
    seen.add(url);
    try {
      const entry = await claimAndShare(sessionId, url, async () => {
        const page = await primaryScrapePlane(url);
        if (
          !page?.content
          || page.content.startsWith('Content unavailable from ')
          || page.content.startsWith('Error retrieving ')
        ) {
          return null;
        }
        return page;
      });
      if (!entry) return;
      if (entry.shared) {
        dedupeShared += 1;
      }
      const page = entry.page;
      if (
        !page
        || typeof page.title !== 'string'
        || typeof page.domain !== 'string'
        || typeof page.content !== 'string'
        || typeof page.credibilityScore !== 'number'
      ) return;
      findings.push({
        url: page.url,
        title: page.title,
        domain: page.domain,
        content: page.content,
        credibilityScore: page.credibilityScore,
        milestoneId: options.milestoneId,
        milestoneTitle: options.milestoneTitle,
      });
      emitToParent({
        type: 'source',
        url: page.url,
        title: page.title,
        domain: page.domain,
        credibility: page.credibilityScore as number,
        snippet: page.content.slice(0, 160),
        milestoneId: options.milestoneId,
        milestoneTitle: options.milestoneTitle,
      });
    } catch (err) {
      seen.delete(url);
      console.warn(`[ResearcherAgent] scrape failed for ${url}:`, err);
    }
  };

  // The plane-backed surface (ADR-0013/0014: enforcement inside the tools),
  // wrapped with the harvest adapter on web_search results.
  const surface = createAgenticToolSurface({
    sessionId,
    state,
    maxFetches: 8,
    emit: emitToParent,
    search: async (query) => {
      const hits = await primarySearchPlane(query);
      return hits.map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.snippet }));
    },
    fetchPage: async (url) => {
      const page = await primaryScrapePlane(url);
      if (!page?.content || page.content.startsWith('Content unavailable from ')) return null;
      return { url: page.url, title: page.title, text: page.content };
    },
  });
  const surfaceHandler = surface.handler;
  surface.handler = async (call) => {
    const outcome = await surfaceHandler(call);
    if (call.name === 'web_search' && outcome.success && typeof outcome.result === 'string') {
      let urlCount = 0;
      for (const match of outcome.result.matchAll(/https?:\/\/[^\s"'<>\\)\]]+/g)) {
        if (urlCount >= 8) break;
        urlCount += 1;
        if (signal?.aborted) break;
        await harvest(match[0].replace(/[.,;]+$/, ''));
      }
    }
    return outcome;
  };

  // Construction through the #140 seam (ADR-0014): research-tools-only,
  // LENS-owned discovery, Pi file-backed auth (tracer P2 — requests carry Pi
  // ids only, never keys). The runtime session id is the RESEARCHER's unique id — the parent fans out
  // concurrently, and the runner's one-live-run-per-session contract must
  // never reject a sibling researcher. Evidence still flows through the
  // PARENT session's ledger (claimAndShare below keys on `sessionId`), so
  // cross-researcher dedupe and the parent's budget semantics are intact.
  const provider = request.llm_provider || 'google';
  // Compression lease (#92): the parent holds the lease for the whole
  // fan-out and passes its URL on the construction brief
  // (`compressionProxyUrl` / `proxyBaseUrl`, asserted by the compression
  // routing tests). Deliberately NOTHING here touches `process.env`:
  // the environment is process-global, so per-researcher set/restore around
  // a concurrent fan-out clobbers siblings (a finisher's restore deletes the
  // vars while others still run), and nothing on the retrieval or model path
  // consumes HTTP(S)_PROXY env vars anyway — compression travels per-request
  // in URL-prefix mode (piAdapter), not via the environment. Wiring the
  // re-hosted session transport into the proxy is seam work for later, not a
  // per-lane env hack.

  const hosted = await createResearchSession(
    {
      sessionId: options.researcherId,
      provider,
      ...(options.agentDir ? { agentDir: options.agentDir } : {}),
      ...(request.model_name ? { modelName: request.model_name } : {}),
    },
    surface
  );
  if (decorateSession) decorateSession(hosted.session, brief);

  const outcome = await runAgenticSearch(hosted.session, {
    sessionId: options.researcherId,
    question: brief,
    state,
    emit: emitToParent,
    ...(signal ? { signal } : {}),
  });
  // A window error is a researcher FAULT, not a run terminal: throw so the
  // caller's containment records it (researchersFailed, delegated
  // fallback) — never silence, never a stream-closing terminal.
  if (outcome.terminal === 'error') {
    throw new Error(windowErrorMessage || `researcher window for facet "${options.facet}" failed`);
  }

  return {
    researcherId: options.researcherId,
    facetIndex: options.facetIndex,
    facet: options.facet,
    findings,
    toolCalls: state.fetchesUsed,
    dedupeShared,
  };
}

/**
 * RETIRED (ticket #146): the native researcher loop (a scoped pi-core
 * `generate` tool loop over the LENS backbone) lived here from #89 until
 * the parity gate went green on the re-hosted path above. Keeping two
 * researcher implementations would be exactly the dual maintenance the
 * expand-contract migration exists to end, so the class is a deliberate
 * dead seam: constructing it throws with the migration pointer. The
 * parent's default factory uses `runRehostedResearcher`.
 */
export class ResearcherAgent {
  constructor() {
    throw new Error(
      '[ResearcherAgent] the native researcher loop is retired (ticket #146) — use runRehostedResearcher (the default parent factory does)'
    );
  }
}
