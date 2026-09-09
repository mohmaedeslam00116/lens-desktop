import { LiveEvent, ResearchGraphNode, ResearchRequest, SourceItem, WideResearchRequest, PlanMilestone } from './types';
import { MultiSearchProvider } from './search';
import { PageScraper, ScrapedPage } from './scraper';
import { ModelClient, LLMRequestOptions, ToolCallHandler } from './models';
import { createEmbeddingModel, rankSourcePassages, fallbackEvidence, EmbeddingProvider } from './embeddings';
import { auditEvidenceCoverage, generateAdaptiveHopPlan, formatAuditReflections } from './evidenceCoverage';
import { SkillActivationManager, CompactionShield } from './skills';
import { CitationGroundingContract } from './synthesis';

export class DeepResearchAgent {
  private sessionId: string;
  private emitEvent: (event: LiveEvent) => void;
  private activationManager?: SkillActivationManager;
  private nodeIndex = 0;

  constructor(
    sessionId: string,
    emitEvent: (event: LiveEvent) => void,
    activationManager?: SkillActivationManager
  ) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
    this.activationManager = activationManager;
  }

  private nextNodeId(prefix = 'node'): string {
    this.nodeIndex++;
    return `${prefix}_${this.nodeIndex}`;
  }

  private async ingestHits(
    hits: Array<{ url: string }>,
    discoveredUrls: Set<string>,
    scrapedSources: ScrapedPage[],
    parentId: string,
    maxAllowed: number,
    signal?: AbortSignal
  ): Promise<void> {
    for (const hit of hits) {
      if (signal?.aborted) return;
      if (discoveredUrls.has(hit.url)) continue;
      discoveredUrls.add(hit.url);

      this.emitEvent({
        type: 'thought',
        thought: `تصفح واستخراج المحتوى الأكاديمي من: ${hit.url}`
      });

      try {
        const scraped = await PageScraper.scrape(hit.url, 7000, signal);
        scrapedSources.push(scraped);

        this.emitEvent({
          type: 'source',
          url: scraped.url,
          title: scraped.title,
          domain: scraped.domain,
          snippet: scraped.content.slice(0, 160),
          credibility: scraped.credibilityScore
        });

        this.emitEvent({
          type: 'graph_node',
          node: {
            id: this.nextNodeId('src'),
            label: scraped.domain,
            type: 'source',
            status: 'completed',
            details: scraped.url,
            credibility: scraped.credibilityScore,
            parentId
          }
        });
      } catch (err) {
        if (signal?.aborted) return;
        console.warn(`[Agent] Failed to scrape ${hit.url}:`, err);
        continue;
      }

      if (scrapedSources.length >= maxAllowed) {
        break;
      }
    }
  }

  async run(request: ResearchRequest, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    const query = request.query.trim();
    const depth = request.report_type || 'deep';
    const perspective = request.perspective || 'balanced';
    const language = request.language || 'ar';
    const searchProvider = request.search_provider || 'duckduckgo';
    const llmProvider = request.llm_provider || 'gemini';
    const modelName = request.model_name;
    const apiKeys = request.api_keys || {};
    const ollamaEndpoint = request.ollama_endpoint;
    const embeddingEnabled = request.embedding_enabled !== false;
    const defaultEmbeddingProvider: EmbeddingProvider =
      llmProvider === 'gemini' ? 'gemini' : llmProvider === 'openai' ? 'openai' : llmProvider === 'ollama' ? 'ollama' : 'none';
    const embeddingProvider = request.embedding_provider || defaultEmbeddingProvider;
    const embeddingModelName = request.embedding_model;
    const embeddingApiKey = request.embedding_api_key || apiKeys[embeddingProvider] || (embeddingProvider === 'gemini' ? apiKeys['google'] : undefined);
    const embeddingEndpoint = request.embedding_endpoint || ollamaEndpoint;

    const toolHandler: ToolCallHandler = async (call) => {
      if (call.name === 'activate_skill' && this.activationManager) {
        return await this.activationManager.handleActivateSkillToolCall(
          call.arguments as { name: string },
          this.emitEvent,
          { language }
        );
      }
      return { success: false, error: `Unsupported tool: ${call.name}` };
    };

    const llmBaseOpts: Omit<LLMRequestOptions, 'messages'> = {
      provider: llmProvider,
      model: modelName,
      apiKey: apiKeys[llmProvider] || apiKeys[llmProvider === 'gemini' ? 'google' : ''],
      endpoint: ollamaEndpoint,
      tools:
        llmProvider !== 'ollama' && this.activationManager
          ? [this.activationManager.getToolDefinition()]
          : undefined,
      toolHandler:
        llmProvider !== 'ollama' && this.activationManager
          ? toolHandler
          : undefined
    };

    // 1. Emit Initial Root Node
    this.emitEvent({
      type: 'graph_node',
      node: {
        id: 'root_1',
        label: query,
        type: 'root',
        status: 'active'
      }
    });

    // 2. Emit Perspective Node
    const perspectiveLabels: Record<string, string> = {
      technical: 'الهندسة والمعمارية التقنية (Technical)',
      market: 'السوق والجدوى التجارية (Market)',
      critical: 'النقد والقيود والمخاطر (Critical)',
      storm: 'محاكاة التوافق متعدد الرؤى (Stanford STORM)',
      balanced: 'التحليل الشامل المتوازن (Balanced)'
    };
    const perspectiveLabel = perspectiveLabels[perspective] || 'التحليل الشامل';

    this.emitEvent({
      type: 'graph_node',
      node: {
        id: 'persp_1',
        label: perspectiveLabel,
        type: 'perspective',
        status: 'completed',
        parentId: 'root_1'
      }
    });

    this.emitEvent({
      type: 'status',
      message: `تفعيل منظور البحث: ${perspectiveLabel}...`,
      step: 'planning'
    });

    // Check if an approved research plan was provided (Tracer 4 trajectory freeze)
    const wideRequest = request as WideResearchRequest;

    // Pre-activate approved plan skills or requested skills (Tracer 6 Dual-Path Controller-Assisted Pre-activation)
    if (this.activationManager) {
      const requestedSkills = [
        ...(wideRequest.plan?.suggestedSkills || []),
        ...((wideRequest as any).approvedSkills || []),
        ...((wideRequest as any).skills || [])
      ];
      if (requestedSkills.length > 0) {
        await this.activationManager.preActivateSkills(requestedSkills, this.emitEvent, { language });
      }
    }

    let subqueries: string[] = [];

    if (wideRequest.plan?.milestones && wideRequest.plan.milestones.length > 0) {
      subqueries = wideRequest.plan.milestones.map((m: PlanMilestone) => m.query);
      this.emitEvent({
        type: 'thought',
        thought: language === 'ar'
          ? `تثبيت مسار البحث المعتمد وفق ${subqueries.length} محاور محددة في خطة البحث v${wideRequest.plan.version}...`
          : `Executing frozen authorized research trajectory across ${subqueries.length} milestones from plan v${wideRequest.plan.version}...`
      });
    } else {
      // 3. Generate Sub-Queries via LLM

      try {
        this.emitEvent({
          type: 'thought',
          thought: `تحليل السؤال البحثي '${query}' وتوليد محاور استكشافية دقيقة توافق منظور ${perspectiveLabel}...`
        });

        const activeSkillsCtx = this.activationManager?.getPromptContext() || '';
        const subqueryPrompt = `You are a Principal Research Architect.
Topic: "${query}"
Perspective: "${perspectiveLabel}"
Language: ${language === 'ar' ? 'Arabic' : 'English'}${activeSkillsCtx ? `\n\nDomain Guidance & Active Skills:\n${activeSkillsCtx}` : ''}

Generate 3 to 4 distinct, high-impact search queries to investigate this topic thoroughly.
Return ONLY a valid JSON array of strings, for example:
["query 1", "query 2", "query 3"]`;

        const subqueryResponse = await ModelClient.generate({
          ...llmBaseOpts,
          messages: [{ role: 'user', content: subqueryPrompt }],
          temperature: 0.2
        });

        const jsonMatch = subqueryResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          subqueries = JSON.parse(jsonMatch[0]);
        }
      } catch (err: any) {
        console.warn('[DeepResearchAgent] Failed to generate subqueries via LLM, using fallbacks:', err);
      }

      if (!subqueries || subqueries.length === 0) {
        subqueries = [
          `${query} technical overview and architecture`,
          `${query} latest benchmarks performance analysis 2025 2026`,
          `${query} limitations drawbacks and security`
        ];
      }
    }

    this.emitEvent({
      type: 'subqueries',
      subqueries
    });

    subqueries.forEach(q => {
      this.emitEvent({
        type: 'graph_node',
        node: {
          id: this.nextNodeId('q'),
          label: q,
          type: 'subquery',
          status: 'completed',
          parentId: 'persp_1'
        }
      });
    });

    // 4. Multi-Hop Search & Scraping Execution
    const maxSubqueries = depth === 'quick' ? 2 : depth === 'deep' ? 3 : 4;
    const activeSubqueries = subqueries.slice(0, maxSubqueries);

    const discoveredUrls = new Set<string>();
    const scrapedSources: ScrapedPage[] = [];
    const isAr = language === 'ar';
    const initialSourceCap = depth === 'quick' ? 4 : depth === 'storm' ? 12 : 8;

    for (let i = 0; i < activeSubqueries.length; i++) {
      if (signal?.aborted) return;
      const subq = activeSubqueries[i];
      this.emitEvent({
        type: 'status',
        message: isAr ? `استكشاف المصادر لمحور: ${subq}...` : `Discovering sources for: ${subq}...`,
        step: 'searching'
      });

      this.emitEvent({
        type: 'thought',
        thought: isAr
          ? `جاري البحث عبر الويب عن: "${subq}" عبر محرك ${searchProvider}...`
          : `Searching web for "${subq}" via ${searchProvider}...`
      });

      let searchHits: any[] = [];
      try {
        searchHits = await MultiSearchProvider.search(subq, searchProvider, apiKeys, 6, signal);
      } catch (err) {
        if (signal?.aborted) return;
        console.warn(`[Agent] Search failed for subquery "${subq}":`, err);
      }
      await this.ingestHits(searchHits, discoveredUrls, scrapedSources, 'persp_1', initialSourceCap, signal);

      if (scrapedSources.length >= initialSourceCap) {
        break;
      }
    }

    // 5. Evidence Coverage Audit & Adaptive Multi-Hop Retrieval
    const reflectionsList: string[] = [];
    const maxAdaptiveHops = depth === 'quick' ? 0 : depth === 'storm' ? 2 : 1;
    const maxHopSourcesCap = depth === 'quick' ? 4 : depth === 'storm' ? 16 : 12;

    for (let hop = 0; hop < maxAdaptiveHops; hop++) {
      if (signal?.aborted) return;
      const audit = auditEvidenceCoverage(query, activeSubqueries, scrapedSources, {
        language: isAr ? 'ar' : 'en'
      });

      const { reflection, reflections } = formatAuditReflections(audit, isAr ? 'ar' : 'en');
      reflectionsList.push(reflection);

      this.emitEvent({
        type: 'reflection',
        reflection,
        reflections,
        coverage: {
          overallScore: audit.overallScore,
          subqueryScore: audit.subqueryScore,
          aspectScore: audit.aspectScore,
          metricScore: audit.metricScore,
          diversityScore: audit.diversityScore,
          uncoveredSubqueries: audit.uncoveredSubqueries
        }
      });

      this.emitEvent({
        type: 'graph_node',
        node: {
          id: `reflect_${hop + 1}`,
          label: isAr
            ? `التدقيق الذاتي وسد الفجوات (${(audit.overallScore * 100).toFixed(0)}%)`
            : `Evidence Coverage Audit (${(audit.overallScore * 100).toFixed(0)}%)`,
          type: 'reflection',
          status: 'completed',
          parentId: 'persp_1'
        }
      });

      const hopPlan = generateAdaptiveHopPlan(audit, query, {
        depth,
        currentHop: hop,
        currentSourcesCount: scrapedSources.length,
        maxSources: maxHopSourcesCap,
        language: isAr ? 'ar' : 'en'
      });

      if (!hopPlan.shouldHop || hopPlan.targetQueries.length === 0) {
        break;
      }

      this.emitEvent({
        type: 'status',
        message: isAr
          ? `تفعيل قفزة استرجاع تكيفية لسد الفجوات: ${hopPlan.targetGaps.join('، ')}...`
          : `Triggering adaptive retrieval hop for: ${hopPlan.targetGaps.join(', ')}...`,
        step: 'searching'
      });

      for (const targetQ of hopPlan.targetQueries) {
        this.emitEvent({
          type: 'thought',
          thought: isAr
            ? `قفزة تكيفية مستهدفة (${hop + 1}/${maxAdaptiveHops}): استكشاف الويب عن "${targetQ}"...`
            : `Executing adaptive hop query (${hop + 1}/${maxAdaptiveHops}): "${targetQ}"...`
        });

        let hopHits: any[] = [];
        try {
          hopHits = await MultiSearchProvider.search(targetQ, searchProvider, apiKeys, 3, signal);
        } catch (err) {
          if (signal?.aborted) return;
          console.warn(`[Agent] Search failed for adaptive query "${targetQ}":`, err);
        }
        await this.ingestHits(hopHits, discoveredUrls, scrapedSources, `reflect_${hop + 1}`, maxHopSourcesCap, signal);

        if (scrapedSources.length >= maxHopSourcesCap) {
          break;
        }
      }

      if (scrapedSources.length >= maxHopSourcesCap) {
        break;
      }
    }

    if (signal?.aborted) return;

    // 6. Final Report Synthesis & Semantic Evidence Retrieval
    this.emitEvent({
      type: 'status',
      message: language === 'ar' ? 'جاري استخلاص الأدلة وصياغة التقرير النهائي...' : 'Synthesizing evidence and drafting final report...',
      step: 'synthesizing'
    });

    let evidenceText = '';
    let usedSemanticRetrieval = false;

    // Check if semantic embedding retrieval is enabled and provider is configured
    if (embeddingEnabled && embeddingProvider && embeddingProvider !== 'none' && scrapedSources.length > 0) {
      try {
        const isLocal = embeddingProvider === 'ollama';
        if (isLocal || (embeddingApiKey && embeddingApiKey.trim())) {
          const defaultModelForProvider =
            embeddingProvider === 'gemini' ? 'text-embedding-004' : embeddingProvider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text';
          const activeEmbedModel = embeddingModelName || defaultModelForProvider;

          this.emitEvent({
            type: 'thought',
            thought: language === 'ar'
              ? `تفعيل الاسترجاع الدلالي (Semantic Retrieval) عبر ${embeddingProvider} (${activeEmbedModel}): تقطيع المصادر ومطابقة المتجهات...`
              : `Executing vector semantic retrieval via ${embeddingProvider} (${activeEmbedModel}): chunking sources and ranking passages...`
          });

          const embeddingClient = createEmbeddingModel({
            provider: embeddingProvider,
            model: activeEmbedModel,
            apiKey: embeddingApiKey,
            endpoint: embeddingEndpoint,
            timeoutMs: 15000
          });

          const retrievalQueries = [query, ...activeSubqueries];
          const ranked = await rankSourcePassages(scrapedSources, retrievalQueries, embeddingClient, {
            maxTotalPassages: depth === 'quick' ? 8 : depth === 'deep' ? 14 : 20,
            maxPerSource: 2,
            maxContextChars: 12000
          });

          evidenceText = ranked.evidenceText;
          usedSemanticRetrieval = true;

          this.emitEvent({
            type: 'thought',
            thought: language === 'ar'
              ? `اكتمل الترتيب الدلالي: تم استخلاص ${ranked.selectedChunks.length} مقطعاً من ${ranked.metrics.sourcesCovered} مصادر بدقة متجهات ${ranked.metrics.vectorDimensions} بعداً (متوسط التطابق: ${(ranked.metrics.averageScore * 100).toFixed(0)}%).`
              : `Semantic ranking complete: extracted ${ranked.selectedChunks.length} passages across ${ranked.metrics.sourcesCovered} sources (${ranked.metrics.vectorDimensions} dims, avg relevance: ${(ranked.metrics.averageScore * 100).toFixed(0)}%).`
          });
        }
      } catch (err: any) {
        console.warn('[DeepResearchAgent] Semantic retrieval failed, using standard excerpt fallback:', err);
        this.emitEvent({
          type: 'thought',
          thought: language === 'ar'
            ? `تعذر التضمين الدلالي للمصادر (${err.message || 'خطأ غير متوقع'}). جاري الرجوع التلقائي لمقتطفات المصادر القياسية.`
            : `Semantic vector retrieval failed (${err.message || 'unexpected error'}). Falling back to standard source excerpts.`
        });
      }
    }

    // Fallback if semantic retrieval was not used or failed
    if (!evidenceText) {
      if (!usedSemanticRetrieval && scrapedSources.length > 0) {
        this.emitEvent({
          type: 'thought',
          thought: language === 'ar'
            ? 'توليف الأدلة المعرفية وصياغة فصول التقرير بأسلوب تحليلي موثق بأرقام المراجع [1] [2]...'
            : 'Synthesizing evidence passages with numbered source citations [1] [2]...'
        });
      }
      evidenceText = fallbackEvidence(scrapedSources);
    }

    // Tracer 6 Context Compaction Shielding:
    // If evidence context grows large during multi-hop rounds, compact while strictly exempting shielded skill blocks.
    if (evidenceText && this.activationManager && this.activationManager.getActiveSkills().length > 0) {
      const activePromptContext = this.activationManager.getPromptContext();
      if (CompactionShield.isShielded(activePromptContext) && evidenceText.length > 25000) {
        evidenceText = await this.compactContextWithShield(
          evidenceText,
          (unshielded) => unshielded.slice(0, 20000)
        );
      }
    }

    const userQueryLower = query.toLowerCase();
    const userExplicitlyWantsTables = /جدول|مقارن|table|compar|matrix|benchmark/i.test(query);
    const userExplicitlyWantsDiagrams = /مخطط|رسم|diagram|flowchart|architect|flow/i.test(query);

    const systemPrompt = `You are a World-Class Principal Research Analyst and Domain Authority.
Your mission is to produce an exhaustive, publication-grade, and impeccably formatted research dossier.

CRITICAL FORMATTING & STRUCTURE RULES:
1. Language: ${isAr ? 'Modern Standard Arabic (لغة عربية فصحى راقية، أكاديمية، ودقيقة)' : 'Professional Technical English'}.
2. STRUCTURE & SECTIONS — adapt the sections below to what genuinely fits the topic. Not every topic needs every section:

   # [Comprehensive Title / عنوان شامل واحترافي للموضوع]

   > [!NOTE]
   > **الخلاصة الاستراتيجية**: [Concise, high-impact summary of the key discovery, paradigm shifts, and bottom line]

   ## ملخص تنفيذي وأبرز المؤشرات (Executive Summary & Key Metrics)
   - Highlight the central findings and key metrics.
   - Provide a bulleted list of quantitative stats, benchmarks, or market percentages where available.

   ## التحليل المتعمق (Deep Analysis)
   - Divide into clear subsections (###) based on the topic's natural structure.
   - Detail the underlying mechanics, operational logic, and verified empirical evidence.

   ## TABLES — CONTEXTUAL, NOT MANDATORY:
   - Include a GitHub Flavored Markdown comparison table ONLY when the topic naturally involves comparing options, models, tools, products, or metrics.${userExplicitlyWantsTables ? '\n   - The user has explicitly requested tables/comparisons — include detailed tables.' : '\n   - Do NOT force a comparison table if the topic does not warrant one.'}

   ## DIAGRAMS — CONTEXTUAL, NOT MANDATORY:
   - Include a Mermaid diagram ONLY when visualizing an architecture, pipeline, decision tree, or process flow genuinely helps understanding.${userExplicitlyWantsDiagrams ? '\n   - The user has explicitly requested diagrams — include a clear Mermaid diagram.' : '\n   - Do NOT force a diagram if the topic is not about systems, workflows, or architectures.'}

   ## التحديات والمخاطر (Challenges & Risks) — if applicable:
   - Include a warning callout for critical risks:
     > [!WARNING]
     > **تنبيه**: [Key risks or constraints]

   ## التوصيات (Recommendations & Next Steps):
   - Include actionable advice:
     > [!TIP]
     > **توصية**: [Top actionable decision]
   - Concrete recommendations prioritized by feasibility.

   ## المراجع (References)
   - Numbered list of sources used with domain and contextual relevance.

3. CITATION ACCURACY:
   - For every factual claim, metric, or assertion, append the source number in brackets, e.g. [1], [2], or [1][3].
   - Strictly cite only valid source numbers from the gathered evidence.

4. TONE & CRAFT:
   - Analytical, substantive, zero fluff. Write naturally — not every report needs the same rigid template.
   - Adapt the depth and structure to the topic's complexity. A simple question deserves a focused answer, not a 7-section dossier.${this.activationManager?.getPromptContext() ? `\n\n${this.activationManager.getPromptContext()}` : ''}`;

    const userPrompt = `Topic: "${query}"
Perspective: ${perspectiveLabel}

--- GATHERED EVIDENCE ---
${evidenceText || 'No external evidence retrieved. Synthesize an exhaustive report based on verified knowledge.'}
--- END OF EVIDENCE ---

Synthesize the complete, richly formatted, authoritative research dossier now following all structural and table guidelines.`;

    let report = '';
    try {
      report = await ModelClient.generate({
        ...llmBaseOpts,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.25,
        onChunk: (chunk) => {
          this.emitEvent({
            type: 'report_chunk',
            chunk
          });
        }
      });
    } catch (err: any) {
      report = `# تقرير البحث: ${query}\n\nعذراً، حدث خطأ أثناء صياغة التقرير عبر مزود الذكاء الاصطناعي: ${err.message}\n\nالمصادر المكتشفة مسجلة في قائمة المراجع أدناه.`;
    }

    // Enforce the CitationGroundingContract on every completed research run,
    // including the non-hierarchical fallback path used when providers are offline.
    const citationContract = new CitationGroundingContract();
    citationContract.registerExcerpts(scrapedSources.map((source) => ({
      id: source.url,
      text: source.content,
      sourceUrl: source.url,
      sourceTitle: source.title,
      sourceDomain: source.domain
    })));
    report = citationContract.verifyAndSanitize(report).sanitizedText;

    // 7. Emit Finished Event
    const formattedSources: SourceItem[] = scrapedSources.map(s => ({
      url: s.url,
      title: s.title,
      domain: s.domain,
      snippet: s.content.slice(0, 160),
      credibilityScore: s.credibilityScore
    }));

    this.emitEvent({
      type: 'finished',
      report,
      sources: formattedSources,
      costs: 0.002,
      reflections: reflectionsList
    });
  }

  static async answerFollowup(
    query: string,
    reportContent: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    options: {
      provider: string;
      model?: string;
      apiKey?: string;
      endpoint?: string;
    }
  ): Promise<string> {
    const systemPrompt = `You are an AI Deep Research Specialist.
You conducted the following research report:
--- REPORT CONTEXT ---
${reportContent.slice(0, 12000)}
--- END CONTEXT ---

Answer the user's inquiry objectively, thoroughly, and strictly grounded in the research report evidence.
Cite relevant sections or sources where applicable.`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...chatHistory.slice(-6).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: query }
    ];

    try {
      return await ModelClient.generate({
        provider: options.provider as any,
        model: options.model,
        apiKey: options.apiKey,
        endpoint: options.endpoint,
        messages,
        temperature: 0.3
      });
    } catch (err: any) {
      return `تعذر توليد الإجابة عن سؤال المتابعة: ${err.message}`;
    }
  }

  /**
   * Compacts context during long multi-hop research sessions while strictly exempting
   * shielded skill blocks (`<skill_content>`) from summarization or pruning.
   */
  async compactContextWithShield(
    fullContext: string,
    compactor: (unshielded: string) => Promise<string> | string
  ): Promise<string> {
    return await CompactionShield.protectCompaction(fullContext, compactor);
  }
}
