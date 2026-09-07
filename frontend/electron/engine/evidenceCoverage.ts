/**
 * LENS Deep Research Engine — Evidence Coverage & Adaptive Multi-Hop Retrieval
 * Pure TypeScript heuristic auditing gathered evidence across subqueries,
 * empirical metrics, perspective breadth, and domain diversity before final synthesis.
 * Determines when to trigger targeted follow-up retrieval hops without latency blowup.
 */

import { SearchDepth } from './types';
import { tokenizeBilingual } from './bm25';
import { stemAndNormalizeArabicPhrase } from './queryExpansion';

export interface CoverageAuditOptions {
  subqueryWeight?: number;       // Weight for subquery coverage (default: 0.45)
  aspectWeight?: number;         // Weight for analytical aspects (default: 0.25)
  metricWeight?: number;         // Weight for quantitative metrics (default: 0.15)
  diversityWeight?: number;      // Weight for source domain diversity (default: 0.15)
  expectedMetricsCount?: number; // Target number of quantitative data markers (default: 8)
  targetDomainCount?: number;    // Target unique domains for corroboration (default: 4)
  subqueryCoverageThreshold?: number; // Minimum term overlap to consider covered (default: 0.40)
  language?: 'ar' | 'en';
}

export interface FacetCoverage {
  subquery: string;
  coverage: number;              // 0.0 to 1.0
  matchingTerms: string[];
  missingTerms: string[];
  isCovered: boolean;
}

export interface AspectStatus {
  architecture: boolean;
  benchmarks: boolean;
  risks: boolean;
}

export interface CoverageAuditResult {
  overallScore: number;          // 0.0 to 1.0
  subqueryScore: number;
  aspectScore: number;
  metricScore: number;
  diversityScore: number;
  subqueryFacets: FacetCoverage[];
  uncoveredSubqueries: string[];
  metricMatchesCount: number;
  uniqueDomains: string[];
  aspectsDetected: AspectStatus;
  missingAspects: string[];
  recommendation: string;
}

export interface HopPlanOptions {
  depth?: SearchDepth | string;
  currentHop?: number;
  maxSources?: number;
  currentSourcesCount?: number;
  threshold?: number;
  language?: 'ar' | 'en';
}

export interface AdaptiveHopPlan {
  shouldHop: boolean;
  reason: string;
  targetQueries: string[];
  targetGaps: string[];
}

// ---------------------------------------------------------------------------
// 1. Empirical Quantitative & Analytical Aspect Matchers
// ---------------------------------------------------------------------------

// Quantitative metrics: percentages, financial figures, benchmark units (excluding standalone years)
const METRIC_PATTERNS = [
  /\b\d+(?:\.\d+)?%/g,
  /(?:[\$€£¥]|USD|EUR)\s*\d+(?:,\d+)*(?:\.\d+)?/gi,
  /\b\d+(?:\.\d+)?\s*(?:ms|seconds|minutes|hours|GHz|MHz|TFLOPS|PFLOPS|parameters|tokens\/sec|accuracy|latency|F1|qubits|dB|Gbps|Mbps)\b/gi,
  /\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:مليار|مليون|دولار|بالمائة|ثانية|ميلي ثانية)\b/g
];

// Core analytical aspects required for comprehensive research
const ARCHITECTURE_PATTERNS = [
  /\b(architecture|mechanics|implementation|framework|pipeline|protocol|algorithm)\b/i,
  /(?:معمارية|خوارزمية|آلية عمل|هندسة|بنية|طريقة عمل|بروتوكول)/
];

const BENCHMARK_PATTERNS = [
  /\b(benchmark|evaluation|performance|throughput|accuracy|comparison|score|metrics)\b/i,
  /(?:مقارنة|أداء|تقييم|معايير|نتائج قياسية|كفاءة)/
];

const RISK_PATTERNS = [
  /\b(limitation|challenge|risk|drawback|bottleneck|vulnerability|flaw|trade-off)\b/i,
  /(?:تحديات|مخاطر|قيود|سلبيات|ثغرات|مفاضلة|معوقات)/
];

// ---------------------------------------------------------------------------
// 2. Evidence Coverage Audit Engine
// ---------------------------------------------------------------------------

/**
 * Audits a collection of gathered sources against user research queries,
 * quantifying subquery coverage, empirical metric density, aspect breadth, and domain diversity.
 */
export function auditEvidenceCoverage(
  query: string,
  subqueries: string[],
  sources: Array<{ content: string; domain?: string }>,
  options: CoverageAuditOptions = {}
): CoverageAuditResult {
  const subqWeight = typeof options.subqueryWeight === 'number' ? options.subqueryWeight : 0.45;
  const aspectWeight = typeof options.aspectWeight === 'number' ? options.aspectWeight : 0.25;
  const metricWeight = typeof options.metricWeight === 'number' ? options.metricWeight : 0.15;
  const diversityWeight = typeof options.diversityWeight === 'number' ? options.diversityWeight : 0.15;
  const expectedMetrics = options.expectedMetricsCount || 8;
  const targetDomains = options.targetDomainCount || 4;
  const subqThreshold = typeof options.subqueryCoverageThreshold === 'number' ? options.subqueryCoverageThreshold : 0.40;
  const isAr = options.language === 'ar' || (!options.language && /[\u0600-\u06FF]/.test(query));

  if (!sources || sources.length === 0) {
    const emptyRecommendation = isAr
      ? 'لم يتم جمع أي أدلة بعد. يلزم إجراء قفزة استرجاع تكيفية.'
      : 'No evidence gathered. Multi-hop retrieval required.';

    return {
      overallScore: 0,
      subqueryScore: 0,
      aspectScore: 0,
      metricScore: 0,
      diversityScore: 0,
      subqueryFacets: subqueries.map(q => ({
        subquery: q,
        coverage: 0,
        matchingTerms: [],
        missingTerms: tokenizeBilingual(q),
        isCovered: false
      })),
      uncoveredSubqueries: [...subqueries],
      metricMatchesCount: 0,
      uniqueDomains: [],
      aspectsDetected: { architecture: false, benchmarks: false, risks: false },
      missingAspects: ['architecture', 'benchmarks', 'risks'],
      recommendation: emptyRecommendation
    };
  }

  // Combine source text and compute document token vocabulary
  const fullText = sources.map(s => s.content).join('\n\n');
  const docTokens = new Set(tokenizeBilingual(fullText));
  const stemmedDocText = stemAndNormalizeArabicPhrase(fullText);
  const stemmedDocTokens = new Set(stemmedDocText.split(/\s+/).filter(Boolean));

  // --- Facet 1: Subquery Topic Coverage ---
  const subqueryFacets: FacetCoverage[] = [];
  const uncoveredSubqueries: string[] = [];

  const effectiveSubqueries = subqueries.length > 0 ? subqueries : [query];

  for (const subq of effectiveSubqueries) {
    const rawTokens = tokenizeBilingual(subq);
    if (rawTokens.length === 0) {
      subqueryFacets.push({
        subquery: subq,
        coverage: 1.0,
        matchingTerms: [],
        missingTerms: [],
        isCovered: true
      });
      continue;
    }

    const matchingTerms: string[] = [];
    const missingTerms: string[] = [];

    for (const tok of rawTokens) {
      const isArabic = /[\u0600-\u06FF]/.test(tok);
      if (isArabic) {
        const stemmed = stemAndNormalizeArabicPhrase(tok);
        if (stemmedDocTokens.has(stemmed) || docTokens.has(tok)) {
          matchingTerms.push(tok);
        } else {
          missingTerms.push(tok);
        }
      } else {
        if (docTokens.has(tok.toLowerCase())) {
          matchingTerms.push(tok);
        } else {
          missingTerms.push(tok);
        }
      }
    }

    const coverage = matchingTerms.length / rawTokens.length;
    const isCovered = coverage >= subqThreshold;

    subqueryFacets.push({
      subquery: subq,
      coverage: Number(coverage.toFixed(3)),
      matchingTerms,
      missingTerms,
      isCovered
    });

    if (!isCovered) {
      uncoveredSubqueries.push(subq);
    }
  }

  const subqueryScore = subqueryFacets.length > 0
    ? subqueryFacets.reduce((sum, f) => sum + f.coverage, 0) / subqueryFacets.length
    : 0;

  // --- Facet 2: Empirical & Quantitative Metrics Density ---
  let metricMatchesCount = 0;
  for (const regex of METRIC_PATTERNS) {
    const matches = fullText.match(regex);
    if (matches) {
      metricMatchesCount += matches.length;
    }
  }
  const metricScore = Math.min(1.0, metricMatchesCount / expectedMetrics);

  // --- Facet 3: Analytical Aspects Breadth ---
  const hasArchitecture = ARCHITECTURE_PATTERNS.some(p => p.test(fullText));
  const hasBenchmarks = BENCHMARK_PATTERNS.some(p => p.test(fullText));
  const hasRisks = RISK_PATTERNS.some(p => p.test(fullText));

  const aspectsDetected: AspectStatus = {
    architecture: hasArchitecture,
    benchmarks: hasBenchmarks,
    risks: hasRisks
  };

  const missingAspects: string[] = [];
  if (!hasArchitecture) missingAspects.push('architecture');
  if (!hasBenchmarks) missingAspects.push('benchmarks');
  if (!hasRisks) missingAspects.push('risks');

  const aspectScore = (3 - missingAspects.length) / 3.0;

  // --- Facet 4: Domain Diversity ---
  const domainSet = new Set<string>();
  for (const s of sources) {
    if (s.domain) {
      const cleanDomain = s.domain.toLowerCase().replace(/^www\./, '');
      domainSet.add(cleanDomain);
    }
  }
  const uniqueDomains = Array.from(domainSet);
  const diversityScore = Math.min(1.0, uniqueDomains.length / targetDomains);

  // --- Composite Evidence Coverage Score ---
  const overallScore = Number((
    subqWeight * subqueryScore +
    aspectWeight * aspectScore +
    metricWeight * metricScore +
    diversityWeight * diversityScore
  ).toFixed(3));

  // Construct localized diagnosis recommendation
  let recommendation = isAr
    ? 'تغطية الأدلة مكتملة ومطابقة لمعايير الجودة المطلوبة.'
    : 'Evidence coverage meets target quality threshold.';

  if (overallScore < 0.70) {
    if (isAr) {
      const gaps: string[] = [];
      if (uncoveredSubqueries.length > 0) gaps.push(`${uncoveredSubqueries.length} محاور غير مغطاة`);
      if (missingAspects.length > 0) gaps.push(`جوانب ناقصة: ${missingAspects.join('، ')}`);
      if (metricScore < 0.40) gaps.push('شح في المؤشرات الرقمية');
      if (diversityScore < 0.50) gaps.push('تنوع مصادر محدود');
      recommendation = `تغطية الأدلة دون المستوى المستهدف (${(overallScore * 100).toFixed(0)}%). الفجوات المرصودة: ${gaps.join('؛ ')}.`;
    } else {
      const gaps: string[] = [];
      if (uncoveredSubqueries.length > 0) gaps.push(`${uncoveredSubqueries.length} uncovered subqueries`);
      if (missingAspects.length > 0) gaps.push(`missing aspects: ${missingAspects.join(', ')}`);
      if (metricScore < 0.40) gaps.push('sparse quantitative data');
      if (diversityScore < 0.50) gaps.push('low source diversity');
      recommendation = `Evidence coverage sub-optimal (${(overallScore * 100).toFixed(0)}%). Gaps identified: ${gaps.join('; ')}.`;
    }
  }

  return {
    overallScore,
    subqueryScore: Number(subqueryScore.toFixed(3)),
    aspectScore: Number(aspectScore.toFixed(3)),
    metricScore: Number(metricScore.toFixed(3)),
    diversityScore: Number(diversityScore.toFixed(3)),
    subqueryFacets,
    uncoveredSubqueries,
    metricMatchesCount,
    uniqueDomains,
    aspectsDetected,
    missingAspects,
    recommendation
  };
}

/**
 * Formats user-facing localized reflection strings from an audit result.
 */
export function formatAuditReflections(
  audit: CoverageAuditResult,
  language: 'ar' | 'en' = 'ar'
): { reflection: string; reflections: string[] } {
  const isAr = language === 'ar';

  const reflection = isAr
    ? `تدقيق شمولية الأدلة: نسبة التغطية ${(audit.overallScore * 100).toFixed(0)}% عبر ${audit.uniqueDomains.length} نطاقات. ${audit.recommendation}`
    : `Auditing evidence coverage: ${(audit.overallScore * 100).toFixed(0)}% across ${audit.uniqueDomains.length} domains. ${audit.recommendation}`;

  const reflections: string[] = [
    isAr
      ? `تغطية المحاور: ${(audit.subqueryScore * 100).toFixed(0)}% (الفجوات: ${audit.uncoveredSubqueries.length})`
      : `Subquery coverage: ${(audit.subqueryScore * 100).toFixed(0)}% (${audit.uncoveredSubqueries.length} uncovered)`,
    isAr
      ? `كثافة المؤشرات الرقمية: ${audit.metricMatchesCount} معياراً وإحصائية مسجلة`
      : `Empirical metric density: ${audit.metricMatchesCount} quantitative markers`,
    isAr
      ? `تنوع المصادر: ${audit.uniqueDomains.length} نطاقات فريدة تم فحصها`
      : `Domain diversity: ${audit.uniqueDomains.length} unique sources corroborated`
  ];

  return { reflection, reflections };
}

// ---------------------------------------------------------------------------
// 3. Adaptive Multi-Hop Decision & Query Synthesizer
// ---------------------------------------------------------------------------

/**
 * Determines whether an adaptive retrieval hop should be triggered,
 * and synthesizes 1 to 2 strictly targeted follow-up queries based on identified gaps.
 */
export function generateAdaptiveHopPlan(
  audit: CoverageAuditResult,
  primaryQuery: string,
  options: HopPlanOptions = {}
): AdaptiveHopPlan {
  const depth = options.depth || 'deep';
  const currentHop = options.currentHop || 0;
  const currentSourcesCount = options.currentSourcesCount || 0;
  const isAr = options.language === 'ar' || /[\u0600-\u06FF]/.test(primaryQuery);

  // Canonical depth tier limits: quick: 0 hops, deep: 1 hop, storm: 2 hops
  const maxHops = depth === 'quick' ? 0 : depth === 'storm' ? 2 : 1;
  // Expanding budgets: initial pass is (4, 8, 12), hop capacity expands to (4, 12, 16)
  const maxSourcesAllowed = options.maxSources || (depth === 'quick' ? 4 : depth === 'storm' ? 16 : 12);

  // Threshold calibration: 'deep' requires 0.70, 'storm' requires 0.75
  const defaultThreshold = depth === 'storm' ? 0.75 : 0.70;
  const threshold = typeof options.threshold === 'number' ? options.threshold : defaultThreshold;

  // Guard 1: Quick mode enforces single-pass
  if (depth === 'quick') {
    return {
      shouldHop: false,
      reason: isAr ? 'نمط البحث السريع يقتصر على جولة استرجاع واحدة.' : 'Quick mode enforces single-pass retrieval.',
      targetQueries: [],
      targetGaps: []
    };
  }

  // Guard 2: Maximum hop count reached
  if (currentHop >= maxHops) {
    return {
      shouldHop: false,
      reason: isAr ? 'تم الوصول إلى الحد الأقصى لقفزات الاسترجاع التكيفية.' : 'Maximum adaptive hop count reached.',
      targetQueries: [],
      targetGaps: []
    };
  }

  // Guard 3: Source collection budget already filled
  if (currentSourcesCount >= maxSourcesAllowed) {
    return {
      shouldHop: false,
      reason: isAr ? 'تم استيفاء الحد الأقصى المخصص لحجم المصادر المستخلصة.' : 'Source collection budget already filled.',
      targetQueries: [],
      targetGaps: []
    };
  }

  // Guard 4: Evidence coverage satisfies quality threshold (Early Exit)
  if (audit.overallScore >= threshold) {
    return {
      shouldHop: false,
      reason: isAr
        ? `نسبة التغطية (${(audit.overallScore * 100).toFixed(0)}%) تستوفي الحد المطلوب (${(threshold * 100).toFixed(0)}%). الانتقال المباشر للصياغة.`
        : `Evidence coverage (${(audit.overallScore * 100).toFixed(0)}%) satisfies threshold (${(threshold * 100).toFixed(0)}%). Early exit to synthesis.`,
      targetQueries: [],
      targetGaps: []
    };
  }

  // --- Synthesize Targeted Gap Queries ---
  const targetQueries: string[] = [];
  const targetGaps: string[] = [];

  // Gap 1: Uncovered Subqueries (Highest Priority)
  if (audit.uncoveredSubqueries.length > 0) {
    const topUncovered = audit.uncoveredSubqueries[0];
    const gapDesc = isAr
      ? `محور غير مغطى: "${topUncovered.slice(0, 30)}..."`
      : `Uncovered subquery: "${topUncovered.slice(0, 30)}..."`;
    targetGaps.push(gapDesc);

    if (isAr) {
      targetQueries.push(`${topUncovered} تفاصيل ومعمارية وإحصائيات`);
    } else {
      targetQueries.push(`${topUncovered} detailed architecture and analysis`);
    }
  }

  // Gap 2: Missing Quantitative Metrics
  if (audit.metricScore < 0.40 && targetQueries.length < 2) {
    targetGaps.push(isAr ? 'فجوة في المؤشرات والنتائج الرقمية' : 'Quantitative benchmarks & empirical metrics gap');
    if (isAr) {
      targetQueries.push(`${primaryQuery} إحصائيات وأرقام ومقارنة الأداء 2025 2026`);
    } else {
      targetQueries.push(`${primaryQuery} benchmark performance metrics numbers 2025 2026`);
    }
  }

  // Gap 3: Missing Benchmarks Aspect
  if (audit.missingAspects.includes('benchmarks') && targetQueries.length < 2) {
    targetGaps.push(isAr ? 'فجوة تقييم الأداء والنتائج القياسية' : 'Performance evaluation & benchmark gap');
    if (isAr) {
      targetQueries.push(`${primaryQuery} نتائج قياسية ومعايير الأداء`);
    } else {
      targetQueries.push(`${primaryQuery} benchmark evaluation performance results`);
    }
  }

  // Gap 4: Missing Architecture Aspect
  if (audit.missingAspects.includes('architecture') && targetQueries.length < 2) {
    targetGaps.push(isAr ? 'فجوة المعمارية والآلية التقنية' : 'Technical architecture & mechanisms gap');
    if (isAr) {
      targetQueries.push(`${primaryQuery} معمارية وهندسة وطريقة عمل المنظومة`);
    } else {
      targetQueries.push(`${primaryQuery} system architecture engineering mechanics`);
    }
  }

  // Gap 5: Missing Critical Risks & Limitations
  if (audit.missingAspects.includes('risks') && targetQueries.length < 2) {
    targetGaps.push(isAr ? 'فجوة التحديات والمخاطر والقيود' : 'Risks, limitations & security challenges gap');
    if (isAr) {
      targetQueries.push(`${primaryQuery} التحديات والمخاطر والقيود`);
    } else {
      targetQueries.push(`${primaryQuery} limitations challenges risks drawbacks`);
    }
  }

  // If no concrete gaps could be synthesized, do not hop (prevent unanchored hallucinated branching)
  if (targetQueries.length === 0) {
    return {
      shouldHop: false,
      reason: isAr ? 'لم ترصد أي فجوات هيكلية تستدعي قفزة إضافية.' : 'No concrete structural gaps identified to query.',
      targetQueries: [],
      targetGaps: []
    };
  }

  const hopReason = isAr
    ? `نسبة التغطية ${(audit.overallScore * 100).toFixed(0)}% دون الحد المستهدف ${(threshold * 100).toFixed(0)}%. تفعيل قفزة لسد: ${targetGaps.join('، ')}.`
    : `Coverage score ${(audit.overallScore * 100).toFixed(0)}% below target ${(threshold * 100).toFixed(0)}%. Triggering adaptive hop for: ${targetGaps.join(', ')}.`;

  return {
    shouldHop: true,
    reason: hopReason,
    targetQueries: targetQueries.slice(0, 2),
    targetGaps
  };
}
