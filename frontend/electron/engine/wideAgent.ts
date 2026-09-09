import {
  LiveEvent,
  PlanMilestone,
  SourceItem,
  WideResearchRequest,
  WideResearchTelemetry,
} from './types';
import { MultiSearchProvider } from './search';
import { BoundedScraperPool } from './scraperPool';
import { ScrapedPage } from './scraper';
import { CandidateChunk, admitStratifiedEvidence } from './admission';
import { chunkStructuredDocument } from './chunker';
import { createEmbeddingModel, rankSourcePassages } from './embeddings';
import { HierarchicalSynthesis } from './synthesis';
import { SkillActivationManager } from './skills';

const INITIAL_SOURCE_BUDGET = 100;
const MAXIMUM_SOURCE_BUDGET = 200;
const EXPANSION_INCREMENT = 25;
const COVERAGE_THRESHOLD = 0.8;

type Pool = Pick<BoundedScraperPool, 'scrapeAll' | 'getDeduplicationStats'>;

interface AdmissionResult {
  admittedChunks: CandidateChunk[];
  coverageAudit: {
    overallScore: number;
    subqueryScore: number;
    aspectScore: number;
    metricScore: number;
    diversityScore: number;
    uncoveredSubqueries: string[];
  };
}

interface SynthesisResult {
  report: string;
  references: Array<{
    index: number;
    title?: string;
    url: string;
    domain?: string;
    snippet?: string;
    cited?: boolean;
  }>;
  groundingVerification: {
    totalFoundInReport: number;
    validCitations: number;
    hallucinatedStripped: number;
    deterministicVerification: boolean;
    citedIndices: number[];
  };
}

export interface WideResearchRunResult {
  report: string;
  sources: SourceItem[];
  telemetry: WideResearchTelemetry;
}

export interface WideResearchAgentDependencies {
  search?: (
    query: string,
    provider: 'duckduckgo' | 'tavily' | 'serper',
    apiKeys: Record<string, string>,
    maxResults: number,
    signal?: AbortSignal,
  ) => Promise<Array<{ url: string; title: string; snippet: string }>>;
  createPool?: () => Pool;
  rankPassages?: (sources: ScrapedPage[], milestones: PlanMilestone[]) => Promise<CandidateChunk[]>;
  admitEvidence?: (
    candidates: CandidateChunk[],
    milestones: PlanMilestone[],
    query: string,
    options: Parameters<typeof admitStratifiedEvidence>[3],
  ) => AdmissionResult;
  synthesize?: (input: {
    request: WideResearchRequest;
    plan: NonNullable<WideResearchRequest['plan']>;
    evidence: CandidateChunk[];
  }) => Promise<SynthesisResult>;
}

function isArabic(value: string | undefined): boolean {
  return value === 'ar';
}

function sanitizeCitationIndices(text: string, maxCitation: number): string {
  return text.replace(/\[(\d+)\]/g, (match, value) => {
    const citation = Number(value);
    return Number.isInteger(citation) && citation > 0 && citation <= maxCitation ? match : '';
  });
}

function lexicalCandidates(
  sources: ScrapedPage[],
  milestones: PlanMilestone[],
  sourceMilestones: Map<string, string>,
): CandidateChunk[] {
  return sources.flatMap((source, sourceIndex) => {
    const milestoneId = sourceMilestones.get(source.url) || milestones[sourceIndex % milestones.length]?.id || 'general';
    const chunks = chunkStructuredDocument(source.content, {
      defaultTitle: source.title,
      sourceIndex,
      citationId: sourceIndex + 1,
    });
    return chunks.map((chunk, chunkIndex) => ({
      id: `wide-${sourceIndex + 1}-${chunkIndex + 1}`,
      milestoneId,
      text: chunk.content,
      sourceUrl: source.url,
      sourceDomain: source.domain,
      score: Math.max(0.01, (source.credibilityScore || 50) / 100 - chunkIndex * 0.001),
      metadata: { title: source.title },
    }));
  });
}

export class WideResearchAgent {
  private readonly sessionId: string;
  private readonly emitEvent: (event: LiveEvent) => void;
  private readonly dependencies: WideResearchAgentDependencies;
  private readonly activationManager?: SkillActivationManager;

  constructor(
    sessionId: string,
    emitEvent: (event: LiveEvent) => void,
    dependencies: WideResearchAgentDependencies = {},
    activationManager?: SkillActivationManager,
  ) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
    this.dependencies = dependencies;
    this.activationManager = activationManager;
  }

  public async run(request: WideResearchRequest, signal?: AbortSignal): Promise<WideResearchRunResult | undefined> {
    const plan = request.plan;
    if (request.mode !== 'wide' || !plan || plan.status !== 'approved') {
      throw new Error('Wide Research requires an approved plan before retrieval can begin.');
    }
    if (signal?.aborted) return undefined;

    const language = request.language || 'en';
    const ar = isArabic(language);
    const provider = request.search_provider || 'duckduckgo';
    const apiKeys = request.api_keys || {};
    const milestones = plan.milestones.filter(milestone => milestone.query.trim());
    if (milestones.length === 0) {
      throw new Error('Wide Research requires at least one approved plan milestone.');
    }

    if (this.activationManager && plan.suggestedSkills.length > 0) {
      await this.activationManager.preActivateSkills(plan.suggestedSkills, this.emitEvent, { language });
    }

    const search = this.dependencies.search || ((query, searchProvider, keys, maxResults, sig) =>
      MultiSearchProvider.search(query, searchProvider, keys, maxResults, sig));
    const pool = this.dependencies.createPool?.() || new BoundedScraperPool();
    const discovered = new Map<string, { milestoneId: string; title: string }>();
    const pagesByUrl = new Map<string, ScrapedPage>();
    let searchedMilestones = 0;
    let requestedUrlCount = 0;
    let activeBudget = INITIAL_SOURCE_BUDGET;
    let hop = 0;
    let latestAdmission: AdmissionResult | undefined;

    this.emitEvent({
      type: 'status',
      step: 'wide_retrieval',
      message: ar
        ? 'تم اعتماد الخطة. يبدأ البحث الواسع بحد 100 مصدر.'
        : 'Plan approved. Wide Research starts with a 100-source budget.',
    });

    while (!signal?.aborted) {
      await this.discoverUntilBudget({
        target: activeBudget,
        milestones,
        discovered,
        search,
        provider,
        apiKeys,
        signal,
        onSearch: () => { searchedMilestones++; },
      });
      if (signal?.aborted) return undefined;

      const urls = Array.from(discovered.keys()).slice(requestedUrlCount, activeBudget);
      if (urls.length === 0) break;
      requestedUrlCount += urls.length;

      const scraped = await pool.scrapeAll(urls, {
        signal,
        onProgress: (_completed, _total, page) => {
          if (!page || signal?.aborted) return;
          pagesByUrl.set(page.url, page);
          this.emitEvent({
            type: 'source',
            url: page.url,
            title: page.title,
            domain: page.domain,
            snippet: page.content.slice(0, 160),
            credibility: page.credibilityScore,
          });
        },
      });
      if (signal?.aborted) return undefined;

      for (const page of scraped) pagesByUrl.set(page.url, page);
      const sources = Array.from(pagesByUrl.values());
      const candidates = await this.buildCandidates(request, sources, milestones, new Map(
        Array.from(discovered.entries()).map(([url, data]) => [url, data.milestoneId]),
      ));
      if (signal?.aborted) return undefined;

      latestAdmission = (this.dependencies.admitEvidence || ((allCandidates, planMilestones, query, options) =>
        admitStratifiedEvidence(allCandidates, planMilestones, query, options)))(
        candidates,
        milestones,
        request.query,
        {
          currentHop: hop,
          maxHops: plan.estimatedScope.maxHops,
          currentSourcesCount: sources.length,
          maxSourcesBudget: activeBudget,
          depth: 'storm',
          language: ar ? 'ar' : 'en',
          maxTotalChunks: 120,
        },
      );

      const stats = pool.getDeduplicationStats();
      const telemetry = this.createTelemetry({
        activeBudget,
        discovered: discovered.size,
        fetched: sources.length,
        unique: typeof stats.admitted === 'number' ? stats.admitted : sources.length,
        admitted: latestAdmission.admittedChunks.length,
        cited: 0,
        hop,
        coverageScore: latestAdmission.coverageAudit.overallScore,
      });
      this.emitEvent({ type: 'wide_telemetry', wideTelemetry: telemetry });

      const coverageGap = latestAdmission.coverageAudit.overallScore < COVERAGE_THRESHOLD;
      if (!coverageGap || activeBudget >= MAXIMUM_SOURCE_BUDGET) break;

      const nextBudget = Math.min(MAXIMUM_SOURCE_BUDGET, activeBudget + EXPANSION_INCREMENT);
      const expansionReason = ar
        ? `تغطية الأدلة ${(latestAdmission.coverageAudit.overallScore * 100).toFixed(0)}% أقل من عتبة ${(COVERAGE_THRESHOLD * 100).toFixed(0)}%.`
        : `Evidence coverage ${(latestAdmission.coverageAudit.overallScore * 100).toFixed(0)}% is below the ${(COVERAGE_THRESHOLD * 100).toFixed(0)}% threshold.`;
      this.emitEvent({
        type: 'wide_telemetry',
        wideTelemetry: this.createTelemetry({
          activeBudget: nextBudget,
          discovered: discovered.size,
          fetched: sources.length,
          unique: typeof stats.admitted === 'number' ? stats.admitted : sources.length,
          admitted: latestAdmission.admittedChunks.length,
          cited: 0,
          hop: hop + 1,
          coverageScore: latestAdmission.coverageAudit.overallScore,
          expansion: {
            from: activeBudget,
            to: nextBudget,
            reason: expansionReason,
            uncoveredMilestones: milestones
              .filter(milestone => latestAdmission?.coverageAudit.uncoveredSubqueries.includes(milestone.query))
              .map(milestone => milestone.id),
            uncoveredSubqueries: latestAdmission.coverageAudit.uncoveredSubqueries,
          },
        }),
      });
      activeBudget = nextBudget;
      hop++;
    }

    if (signal?.aborted) return undefined;
    const evidence = latestAdmission?.admittedChunks || [];
    const synthesis = await (this.dependencies.synthesize || ((input) => this.defaultSynthesize(input)))({
      request,
      plan,
      evidence,
    });
    if (signal?.aborted) return undefined;

    const sourceItems: SourceItem[] = synthesis.references.map(reference => ({
      url: reference.url,
      title: reference.title || reference.domain || reference.url,
      domain: reference.domain || '',
      snippet: reference.snippet,
      credibilityScore: 0,
      citationIndex: reference.index,
      isCited: reference.cited,
    }));
    const finalTelemetry = this.createTelemetry({
      activeBudget,
      discovered: discovered.size,
      fetched: pagesByUrl.size,
      unique: pagesByUrl.size,
      admitted: evidence.length,
      cited: synthesis.groundingVerification.citedIndices.length,
      hop,
      coverageScore: latestAdmission?.coverageAudit.overallScore,
    });
    const report = sanitizeCitationIndices(synthesis.report, synthesis.references.length);
    this.emitEvent({ type: 'wide_telemetry', wideTelemetry: finalTelemetry });
    this.emitEvent({
      type: 'finished',
      report,
      sources: sourceItems,
      costs: 0,
      wideTelemetry: finalTelemetry,
      coverage: latestAdmission ? {
        overallScore: latestAdmission.coverageAudit.overallScore,
        subqueryScore: latestAdmission.coverageAudit.subqueryScore,
        aspectScore: latestAdmission.coverageAudit.aspectScore,
        metricScore: latestAdmission.coverageAudit.metricScore,
        diversityScore: latestAdmission.coverageAudit.diversityScore,
        uncoveredSubqueries: latestAdmission.coverageAudit.uncoveredSubqueries,
      } : undefined,
    });
    return { report, sources: sourceItems, telemetry: finalTelemetry };
  }

  private async discoverUntilBudget(input: {
    target: number;
    milestones: PlanMilestone[];
    discovered: Map<string, { milestoneId: string; title: string }>;
    search: NonNullable<WideResearchAgentDependencies['search']>;
    provider: 'duckduckgo' | 'tavily' | 'serper';
    apiKeys: Record<string, string>;
    signal?: AbortSignal;
    onSearch: () => void;
  }): Promise<void> {
    const maxSearches = Math.max(input.milestones.length * 8, 16);
    let searchIndex = 0;
    while (input.discovered.size < input.target && searchIndex < maxSearches) {
      if (input.signal?.aborted) return;
      const milestone = input.milestones[searchIndex % input.milestones.length];
      const suffix = Math.floor(searchIndex / input.milestones.length);
      const query = suffix === 0 ? milestone.query : `${milestone.query} evidence ${suffix + 1}`;
      try {
        const hits = await input.search(query, input.provider, input.apiKeys, 25, input.signal);
        if (input.signal?.aborted) return;
        input.onSearch();
        for (const hit of hits) {
          if (hit.url && !input.discovered.has(hit.url)) {
            input.discovered.set(hit.url, { milestoneId: milestone.id, title: hit.title });
          }
        }
        searchIndex++;
        if (hits.length === 0 && searchIndex >= input.milestones.length) break;
      } catch (err) {
        if (input.signal?.aborted) return;
        throw err;
      }
    }
  }

  private async buildCandidates(
    request: WideResearchRequest,
    sources: ScrapedPage[],
    milestones: PlanMilestone[],
    sourceMilestones: Map<string, string>,
  ): Promise<CandidateChunk[]> {
    if (this.dependencies.rankPassages) return this.dependencies.rankPassages(sources, milestones);
    const embeddingProvider = request.embedding_provider;
    const apiKey = request.embedding_api_key || request.api_keys?.[embeddingProvider || ''];
    if (request.embedding_enabled !== false && embeddingProvider && embeddingProvider !== 'none' && apiKey) {
      try {
        const ranked = await rankSourcePassages(
          sources,
          [request.query, ...milestones.map(milestone => milestone.query)],
          createEmbeddingModel({
            provider: embeddingProvider,
            model: request.embedding_model || (embeddingProvider === 'gemini'
              ? 'text-embedding-004'
              : embeddingProvider === 'openai'
                ? 'text-embedding-3-small'
                : 'nomic-embed-text'),
            apiKey,
            endpoint: request.embedding_endpoint || request.ollama_endpoint,
          }),
          { maxTotalPassages: 32, maxPerSource: 2, maxContextChars: 20000 },
        );
        return ranked.selectedChunks.map((chunk, index) => ({
          id: chunk.id,
          milestoneId: sourceMilestones.get(chunk.url) || milestones[index % milestones.length].id,
          text: chunk.content,
          sourceUrl: chunk.url,
          sourceDomain: chunk.domain,
          score: chunk.score || 0,
          metadata: { title: chunk.title },
        }));
      } catch (error) {
        console.warn('[WideResearchAgent] Hybrid ranking failed; using lexical fallback.', error);
      }
    }
    return lexicalCandidates(sources, milestones, sourceMilestones);
  }

  private async defaultSynthesize(input: {
    request: WideResearchRequest;
    plan: NonNullable<WideResearchRequest['plan']>;
    evidence: CandidateChunk[];
  }): Promise<SynthesisResult> {
    const result = await new HierarchicalSynthesis({
      plan: input.plan,
      evidence: input.evidence,
      query: input.request.query,
      language: input.request.language === 'ar' ? 'ar' : 'en',
      perspective: input.request.perspective,
      depth: 'storm',
      llmOptions: {
        messages: [],
        provider: input.request.llm_provider || 'gemini',
        model: input.request.model_name,
        apiKey: input.request.api_keys?.[input.request.llm_provider || 'gemini'],
        endpoint: input.request.ollama_endpoint,
      },
      activeSkillsContext: this.activationManager?.getPromptContext(),
    }).synthesize();
    return result;
  }

  private createTelemetry(input: Omit<WideResearchTelemetry, 'initialBudget' | 'maximumBudget'>): WideResearchTelemetry {
    return {
      initialBudget: INITIAL_SOURCE_BUDGET,
      maximumBudget: MAXIMUM_SOURCE_BUDGET,
      ...input,
    };
  }
}
