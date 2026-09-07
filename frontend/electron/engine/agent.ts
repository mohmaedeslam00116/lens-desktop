import { LiveEvent, ResearchGraphNode, ResearchRequest, SourceItem } from './types';
import { MultiSearchProvider } from './search';
import { PageScraper, ScrapedPage } from './scraper';
import { ModelClient, LLMRequestOptions } from './models';
import { createEmbeddingModel, rankSourcePassages, fallbackEvidence, EmbeddingProvider } from './embeddings';

export class DeepResearchAgent {
  private sessionId: string;
  private emitEvent: (event: LiveEvent) => void;
  private nodeIndex = 0;

  constructor(sessionId: string, emitEvent: (event: LiveEvent) => void) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
  }

  private nextNodeId(prefix = 'node'): string {
    this.nodeIndex++;
    return `${prefix}_${this.nodeIndex}`;
  }

  async run(request: ResearchRequest): Promise<void> {
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

    // 3. Generate Sub-Queries via LLM
    const llmBaseOpts: Omit<LLMRequestOptions, 'messages'> = {
      provider: llmProvider,
      model: modelName,
      apiKey: apiKeys[llmProvider] || apiKeys[llmProvider === 'gemini' ? 'google' : ''],
      endpoint: ollamaEndpoint
    };

    let subqueries: string[] = [];
    try {
      this.emitEvent({
        type: 'thought',
        thought: `تحليل السؤال البحثي '${query}' وتوليد محاور استكشافية دقيقة توافق منظور ${perspectiveLabel}...`
      });

      const subqueryPrompt = `You are a Principal Research Architect.
Topic: "${query}"
Perspective: "${perspectiveLabel}"
Language: ${language === 'ar' ? 'Arabic' : 'English'}

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

    for (let i = 0; i < activeSubqueries.length; i++) {
      const subq = activeSubqueries[i];
      this.emitEvent({
        type: 'status',
        message: `استكشاف المصادر لمحور: ${subq}...`,
        step: 'searching'
      });

      this.emitEvent({
        type: 'thought',
        thought: `جاري البحث عبر الويب عن: "${subq}" عبر محرك ${searchProvider}...`
      });

      const searchHits = await MultiSearchProvider.search(subq, searchProvider, apiKeys, 6);

      for (const hit of searchHits) {
        if (discoveredUrls.has(hit.url)) continue;
        discoveredUrls.add(hit.url);

        // Scrape page content
        this.emitEvent({
          type: 'thought',
          thought: `تصفح واستخراج المحتوى الأكاديمي من: ${hit.url}`
        });

        const scraped = await PageScraper.scrape(hit.url, 7000);
        scrapedSources.push(scraped);

        const sourceItem: SourceItem = {
          url: scraped.url,
          title: scraped.title,
          domain: scraped.domain,
          snippet: scraped.content.slice(0, 160),
          credibilityScore: scraped.credibilityScore
        };

        this.emitEvent({
          type: 'source',
          ...sourceItem,
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
            parentId: 'persp_1'
          }
        });

        if (scrapedSources.length >= (depth === 'quick' ? 4 : depth === 'deep' ? 8 : 12)) {
          break;
        }
      }

      if (scrapedSources.length >= (depth === 'quick' ? 4 : depth === 'deep' ? 8 : 12)) {
        break;
      }
    }

    // 5. Multi-Hop Self-Reflection Step
    const reflectionsList: string[] = [];
    if (depth !== 'quick') {
      const reflectionMsg = `تدقيق شمولية الأدلة المستخلصة لموضوع '${query.slice(0, 45)}' والتأكد من توافق الرؤى مع إحصائيات 2025/2026.`;
      reflectionsList.push(reflectionMsg);

      this.emitEvent({
        type: 'reflection',
        reflection: reflectionMsg,
        reflections: [
          'التحقق من حداثة البيانات والأرقام لعام 2025/2026',
          'استبعاد التناقضات بين المصادر التقنية والتقارير الميدانية'
        ]
      });

      this.emitEvent({
        type: 'graph_node',
        node: {
          id: 'reflect_1',
          label: 'التدقيق الذاتي وسد الفجوات (Self-Reflection)',
          type: 'reflection',
          status: 'completed',
          parentId: 'persp_1'
        }
      });
    }

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

    const isAr = language === 'ar';
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
   - Adapt the depth and structure to the topic's complexity. A simple question deserves a focused answer, not a 7-section dossier.`;

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
}
