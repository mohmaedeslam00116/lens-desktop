import { LiveEvent, ResearchRequest } from './types';
import { generate } from './modelGateway';
import { MultiSearchProvider } from './search';
import { primarySearchPlane } from './searchPlane';
import { PageScraper, ScrapedPage } from './scraper';
import { LLMToolDefinition, ToolCallHandler } from './models';
import { SkillActivationManager } from './skills';
import { buildResearchPackageTools } from './piResearchTools';
import { claimAndShare } from './fetchLedger';
import { ResearcherRole, roleBrief } from './researcherRoles';

/**
 * researcherAgent.ts — single in-process researcher subagent (ADR-0010 phase 2,
 * ticket #89).
 *
 * One research facet executes inside a scoped pi-core agent run: the
 * deterministic retrieval backbone (LENS MultiSearchProvider + PageScraper,
 * budget-bounded) gathers evidence for the facet, and — when the package
 * bridge is enabled — the model drives the four pi-web-access tools
 * (web_search / source_check / fetch_content / get_search_content) through the
 * adapter's depth-capped tool loop to steer additional retrieval and
 * verification. Every finding is tagged with the facet's milestone id/title so
 * downstream evidence admission carries per-facet provenance (ADR-0010
 * decision 3: LENS contracts stay authoritative; the toolset is the
 * supplementary plane on the expand–contract path toward Pi-native tools).
 *
 * The seams here (researcherId, brief-style options, activity telemetry,
 * result envelope) are the pi-subagents-shaped surface the parent already
 * speaks; a later host-based adoption is a swap behind them.
 *
 * Cross-researcher URL dedupe (ticket #90): every scrape goes through the
 * session-scoped fetch ledger — a URL fetched by one researcher is never
 * re-fetched by another; the already-admitted page is shared instead and
 * counted in this researcher's `dedupeShared` telemetry.
 */

/** URL extraction from tool result text (web_search results carry URLs). */
const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]]+/g;
const MAX_TOOL_URLS = 8;
const MAX_FINDINGS = 8;
/** Hard ceiling for model-driven tool rounds, regardless of the requested
 * option (boundedness: no Infinity/arbitrary-cost loops). */
const MAX_TOOL_ROUNDS = 8;

export interface ResearcherOptions {
  researcherId: string;
  facetIndex: number;
  facet: string;
  facetCount: number;
  /** Milestone provenance stamped on every finding. */
  milestoneId: string;
  milestoneTitle: string;
  /** Attach the vendored pi-web-access toolset for model-driven retrieval. */
  toolPackages: boolean;
  activationManager?: SkillActivationManager;
  searchProvider?: ResearchRequest['search_provider'];
  /** Bounded tool rounds the researcher may spend (memory/time boundedness). */
  maxToolRounds?: number;
  /** Injection seams for offline tests (default to the LENS providers). */
  searchFn?: typeof MultiSearchProvider.search;
  scrapeFn?: (url: string, timeoutMs?: number, signal?: AbortSignal) => Promise<ScrapedPage | null>;
  /** Injection seam for the vendored package toolset (default: the real
   * bridge). Tests supply a faux toolset to exercise the model-driven
   * retrieval path offline. */
  packageToolsFactory?: typeof import('./piResearchTools').buildResearchPackageTools;
  /** Compression proxy base URL leased by the PARENT for the whole fan-out
   * (ADR-0010, ticket #92); absent = uncompressed. The researcher never
   * starts or stops the supervised proxy itself — researchers run
   * concurrently against a process-wide supervisor, so the lease is owned at
   * parent/session scope and released after the run. */
  proxyBaseUrl?: string;
  /** Degradation notices collected by the parent's lease acquisition. */
  compressionNotices?: string[];
  /** Specialist role from the closed catalog (ADR-0010 decision 5, ticket
   * #93). Defaults to 'primary' (the v1 pass-through role). */
  role?: ResearcherRole;
}

export interface ResearcherRunResult {
  researcherId: string;
  facetIndex: number;
  facet: string;
  /** Findings tagged with the facet's milestone provenance. */
  findings: ScrapedPage[];
  toolCalls: number;
  /** URLs skipped because another researcher already fetched them —
   * the shared page still joined this facet's evidence pool. */
  dedupeShared: number;
}

export class ResearcherAgent {
  private sessionId: string;
  private emitEvent: (event: LiveEvent) => void;
  private options: ResearcherOptions;
  private dedupeShared = 0;

  constructor(sessionId: string, emitEvent: (event: LiveEvent) => void, options: ResearcherOptions) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
    this.options = options;
  }

  private telemetry(
    phase: 'run_started' | 'run_completed' | 'retrieval' | 'tool_activity',
    counts: { sourcesRetrieved?: number; toolCalls?: number; dedupeShared?: number } = {}
  ): void {
    this.emitEvent({
      type: 'researcher_telemetry',
      researcherTelemetry: {
        researcherId: this.options.researcherId,
        // Closed-catalog role (ticket #93); 'primary' is the v1 default.
        role: this.options.role ?? 'primary',
        facet: this.options.facet,
        phase,
        counts: {
          facetIndex: this.options.facetIndex,
          facetCount: this.options.facetCount,
          ...counts,
        },
      },
    });
  }

  /** Scrapes one URL into a provenance-tagged finding through the session
   * fetch ledger: cross-researcher dedupe (a URL is fetched once per session;
   * concurrent researchers share the admitted page) with retry semantics for
   * failed fetches. The finding lands in this facet's pool even when shared,
   * so coverage reflects every facet the evidence serves. */
  private async ingestUrl(
    url: string,
    seen: Set<string>,
    findings: ScrapedPage[],
    signal?: AbortSignal
  ): Promise<void> {
    if (seen.has(url) || findings.length >= MAX_FINDINGS || signal?.aborted) return;
    seen.add(url);
    try {
      const scrape = this.options.scrapeFn ?? PageScraper.scrape;
      const entry = await claimAndShare(this.sessionId, url, async (): Promise<ScrapedPage | null> => {
        const page = await scrape(url, 7000, signal);
        if (
          !page?.content
          || page.content.startsWith('Content unavailable from ')
          || page.content.startsWith('Error retrieving ')
        ) {
          // Normalize failed fetches to null so the ledger releases the claim
          // and a later researcher can retry the URL.
          return null;
        }
        return page;
      });
      if (!entry) return; // failed fetch (own or shared); claim already released
      // Stamp THIS facet's provenance on the (possibly shared) page copy so
      // per-facet evidence — and per-facet coverage aggregation — attributes
      // the finding to this facet.
      const page: ScrapedPage = {
        ...(entry.page as ScrapedPage),
        milestoneId: this.options.milestoneId,
        milestoneTitle: this.options.milestoneTitle,
      };
      if (entry.shared) {
        this.dedupeShared += 1;
        this.telemetry('retrieval', { dedupeShared: this.dedupeShared });
      }
      findings.push(page);
      this.emitEvent({
        type: 'source',
        url: page.url,
        title: page.title,
        domain: page.domain,
        credibility: page.credibilityScore,
        snippet: page.content.slice(0, 160),
        milestoneId: this.options.milestoneId,
        milestoneTitle: this.options.milestoneTitle,
      });
      if (!entry.shared) {
        this.telemetry('retrieval', { sourcesRetrieved: findings.length });
      }
    } catch (err) {
      seen.delete(url);
      if (signal?.aborted) return;
      console.warn(`[ResearcherAgent] scrape failed for ${url}:`, err);
    }
  }

  async run(request: ResearchRequest, signal?: AbortSignal): Promise<ResearcherRunResult> {
    const findings: ScrapedPage[] = [];
    const seen = new Set<string>();
    let toolCalls = 0;
    this.dedupeShared = 0;
    if (signal?.aborted) {
      return { researcherId: this.options.researcherId, facetIndex: this.options.facetIndex, facet: this.options.facet, findings, toolCalls, dedupeShared: 0 };
    }

    // Execution-level lifecycle uses distinct phase names from the parent's
    // assignment lifecycle (`started`/`completed`): one component owns each
    // pair, so telemetry consumers never double-count researchers.
    this.telemetry('run_started');

    // Phase A — deterministic retrieval backbone (budget-bounded). Default
    // plane: the vendored pi-web-access DDG adapter (ADR-0013 primary plane,
    // #109) — the seam contract is unchanged, only what sits behind it.
    // Bind: MultiSearchProvider.search is called statically in the engine;
    // detaching it as a free function would lose its `this`.
    const searchFn = this.options.searchFn
      ? this.options.searchFn
      : primarySearchPlane;
    let hits: Array<{ url: string }> = [];
    try {
      hits = await searchFn(
        this.options.facet,
        this.options.searchProvider || request.search_provider || 'duckduckgo',
        request.api_keys || {},
        6,
        signal
      );
    } catch (err) {
      if (!signal?.aborted) {
        console.warn(`[ResearcherAgent] search failed for facet "${this.options.facet}":`, err);
      }
      // No early return on abort: flow reaches the common completion logic so
      // run_completed is always emitted (no stale active researcher in telemetry).
    }
    for (const hit of hits) {
      if (signal?.aborted) break;
      if (typeof hit?.url !== 'string' || !/^https?:\/\//i.test(hit.url)) continue;
      await this.ingestUrl(hit.url, seen, findings, signal);
    }

    // Phase B — model-driven retrieval through the pi-web-access toolset
    // (supplementary plane; the adapter runs its own depth-capped tool loop).
    if (this.options.toolPackages && !signal?.aborted) {
      // Compression routing (ticket #92): the proxy lease is acquired by the
      // parent for the whole fan-out; the researcher only consumes its URL.
      const proxyBaseUrl = this.options.proxyBaseUrl;
      try {
        const buildTools = this.options.packageToolsFactory
          ?? (await import('./piResearchTools')).buildResearchPackageTools;
        const built = await buildTools(
          {
            sessionId: this.sessionId,
            cwd: process.cwd(),
            language: (request.language === 'ar' ? 'ar' : 'en'),
            timeoutMs: 5 * 60 * 1000,
          },
          signal
        );
        const tools: LLMToolDefinition[] = built.tools;

        // Wrapped handler: counts tool activity, and harvests URLs surfaced by
        // web_search results so tool-directed retrieval enters the facet's
        // evidence pool with the same provenance tagging.
        const inner = built.handler;
        const wrappedHandler: ToolCallHandler = async (call) => {
          toolCalls += 1;
          this.telemetry('tool_activity', { toolCalls });
          const result = await inner(call);
          if (call.name === 'web_search' && typeof result.result === 'string') {
            // Lazy iteration with an early stop: a huge tool response must not
            // allocate an unbounded match array just to read the first few URLs.
            let urlCount = 0;
            for (const match of result.result.matchAll(URL_PATTERN)) {
              if (urlCount >= MAX_TOOL_URLS) break;
              urlCount += 1;
              if (signal?.aborted) break;
              await this.ingestUrl(match[0].replace(/[.,;]+$/, ''), seen, findings, signal);
            }
          }
          return result;
        };

        const provider = request.llm_provider || 'gemini';
        const apiKeys = request.api_keys || {};
        const requestedToolRounds = this.options.maxToolRounds ?? 2;
        const maxToolRounds = Number.isFinite(requestedToolRounds)
          ? Math.min(MAX_TOOL_ROUNDS, Math.max(0, Math.floor(requestedToolRounds)))
          : 2;
        const language: 'ar' | 'en' = request.language === 'ar' ? 'ar' : 'en';
        const role = this.options.role ?? 'primary';
        const systemPrompt = [
          `You are a specialized research subagent.`,
          `Your assigned research facet (topic ${this.options.facetIndex + 1}/${this.options.facetCount}): "${this.options.facet}".`,
          roleBrief(role, language),
          `Investigate ONLY this facet. Use the provided web tools to search for, fetch, and verify sources relevant to the facet.`,
          `Be concise: report the key facts you verified with their sources. Do not write a full report — the parent agent synthesizes.`,
          this.options.activationManager?.getPromptContext() || '',
        ].join('\n');

        for (let round = 0; round < maxToolRounds; round++) {
          if (signal?.aborted) break;
          await generate(
            {
              provider,
              model: request.model_name,
              apiKey: apiKeys[provider] || apiKeys[provider === 'gemini' ? 'google' : ''],
              endpoint: request.ollama_endpoint,
              tools,
              toolHandler: wrappedHandler,
              messages: [
                { role: 'system', content: systemPrompt },
                {
                  role: 'user',
                  content: `Facet: "${this.options.facet}"\nRetrieved so far: ${findings.length} source(s). Continue investigating this facet with the tools, or state DONE if the facet is sufficiently covered.`,
                },
              ],
              temperature: 0.2,
            },
            { signal, ...(proxyBaseUrl ? { proxyBaseUrl } : {}) }
          );
        }
      } catch (err) {
        if (!signal?.aborted) {
          console.warn('[ResearcherAgent] tool loop failed (continuing with backbone findings):', err);
        }
      }
    }

    this.telemetry('run_completed', { sourcesRetrieved: findings.length, toolCalls, dedupeShared: this.dedupeShared });
    return {
      researcherId: this.options.researcherId,
      facetIndex: this.options.facetIndex,
      facet: this.options.facet,
      findings,
      toolCalls,
      dedupeShared: this.dedupeShared,
    };
  }
}
