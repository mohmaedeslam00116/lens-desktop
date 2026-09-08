/**
 * LENS Deep Research Engine — Evidence Shelf & Inspection Module
 * Tracer 8 (Issue #35): Facet-grouped source shelf organization, multi-dimensional
 * filtering (milestone facet, domain, relevance tier, citation status), and
 * evidence inspection passage extraction with bilingual fidelity support.
 */

import { SourceItem, PlanMilestone, ResearchPlan } from './types';

export interface EvidenceShelfContext {
  sources: SourceItem[];
  plan?: ResearchPlan | null;
  reportContent?: string;
  language: 'ar' | 'en';
}

export interface EnrichedSourceItem extends SourceItem {
  index: number;                        // 1-based position in collection
  citationIndex?: number;              // Pre-allocated or mapped 1-based citation index
  citationIndices: number[];           // All citation occurrences in report
  isCited: boolean;                    // Whether cited in report body
  passage: string;                     // Verbatim admitted passage or excerpt
  originalSnippet?: string;            // Original language excerpt for bilingual verification
  score: number;                       // Normalized relevance score (0..1)
  relevanceTier: 'high' | 'medium' | 'low';
  milestoneId: string;                 // Assigned plan milestone ID (or 'general')
  milestoneTitle: string;              // Assigned milestone query/label
}

export interface MilestoneFacetGroup {
  milestoneId: string;
  milestoneQuery: string;
  milestoneRationale?: string;
  sources: EnrichedSourceItem[];
  totalCount: number;
  citedCount: number;
}

export interface SourceShelfFilters {
  milestoneId?: string;                // 'all' or specific milestoneId
  citationStatus?: 'all' | 'cited' | 'background';
  relevanceTier?: 'all' | 'high' | 'medium' | 'low';
  domain?: string;                     // 'all' or specific domain
  searchQuery?: string;
}

export interface SourceShelfStats {
  totalAdmitted: number;
  totalCited: number;
  totalBackground: number;
  uniqueDomainsCount: number;
  topDomains: Array<{ domain: string; count: number }>;
  tierCounts: {
    high: number;
    medium: number;
    low: number;
  };
  milestoneBreakdown: Array<{
    milestoneId: string;
    milestoneQuery: string;
    total: number;
    cited: number;
  }>;
}

export interface CitationInspectionDetail {
  citationIndex: number;
  source: EnrichedSourceItem | null;
  exactPassage: string;
  surroundingClaim?: string;
  isBilingual: boolean;
  originalSnippet?: string;
  relevanceScore: number;
  relevanceTier: 'high' | 'medium' | 'low';
  sourceDomain: string;
  sourceTitle: string;
  sourceUrl: string;
  milestoneId: string;
  milestoneTitle: string;
  credibilityScore: number;
}

/**
 * Normalizes Eastern Arabic (Arabic-Indic) and Persian digits to Western ASCII digits.
 */
export function normalizeEasternNumerals(text: string): string {
  if (!text) return '';
  const easternDigits: Record<string, string> = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
  };
  return text.replace(/[٠-٩۰-۹]/g, (digit) => easternDigits[digit] || digit);
}

/**
 * Robustly extracts all 1-based citation indices cited within the report markdown.
 * Strictly ignores code blocks, inline code, markdown links, GFM callouts, and task checkboxes.
 */
export function extractCitedIndices(reportText: string): Set<number> {
  const cited = new Set<number>();
  if (!reportText || typeof reportText !== 'string') return cited;

  // Mask protected elements to avoid false citation parsing
  let sanitized = reportText;

  // 1. Fenced code blocks ```...```
  sanitized = sanitized.replace(/```[\s\S]*?```/g, (match) => ' '.repeat(match.length));

  // 2. Inline code `...`
  sanitized = sanitized.replace(/`[^`\n]+`/g, (match) => ' '.repeat(match.length));

  // 3. Markdown links [text](url) - protect brackets
  sanitized = sanitized.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match) => ' '.repeat(match.length));

  // 4. GFM alert callouts [!NOTE], [!WARNING], [!TIP]
  sanitized = sanitized.replace(/\[!(?:NOTE|WARNING|TIP|IMPORTANT|CAUTION)\]/gi, (match) => ' '.repeat(match.length));

  // 5. Task list checkboxes [ ], [x], [X]
  sanitized = sanitized.replace(/\[[ xX]\]/g, (match) => ' '.repeat(match.length));

  // Normalize numerals
  sanitized = normalizeEasternNumerals(sanitized);

  // Scan citation brackets e.g. [1], [1, 2], [1; 3], [1، 4], [1-3], [1–3], [1—3]
  const bracketRegex = /\[([\d\s,;،\-\u2013\u2014]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(sanitized)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;

    // Split by commas, semicolons, Arabic commas
    const parts = inner.split(/[,;،]/);
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (!part) continue;

      // Check range e.g. 1-3, 1–3, 1—3
      const rangeMatch = part.match(/^(\d+)\s*[\-\u2013\u2014]\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (start <= end && end - start <= 200) {
          for (let k = start; k <= end; k++) {
            if (k > 0) cited.add(k);
          }
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num > 0) {
          cited.add(num);
        }
      }
    }
  }

  return cited;
}

/**
 * Normalizes score to 0..1 range and determines relevance tier.
 */
export function categorizeRelevanceTier(score?: number): 'high' | 'medium' | 'low' {
  if (typeof score !== 'number' || isNaN(score)) return 'medium';
  let norm = score;
  if (norm > 1 && norm <= 100) {
    norm = norm / 100;
  }
  if (norm >= 0.80) return 'high';
  if (norm >= 0.60) return 'medium';
  return 'low';
}

/**
 * Extracts clean domain hostname from URL.
 */
export function extractDomain(url?: string, defaultDomain?: string): string {
  if (defaultDomain && defaultDomain.trim()) return defaultDomain.trim();
  if (!url) return 'web';
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

/**
 * Enriches raw SourceItems with full provenance, facet milestone assignment,
 * normalized relevance score, relevance tier, and citation status.
 */
export interface ExcerptLike {
  sourceUrl?: string;
  index?: number;
  text?: string;
  score?: number;
  milestoneId?: string;
  metadata?: Record<string, any>;
}

export function enrichSources(
  sources: SourceItem[],
  plan?: ResearchPlan | null,
  reportText: string = '',
  excerpts: ExcerptLike[] = []
): EnrichedSourceItem[] {
  if (!Array.isArray(sources)) return [];

  const citedSet = extractCitedIndices(reportText);
  const excerptMapByUrl = new Map<string, ExcerptLike>();
  const excerptMapByIndex = new Map<number, ExcerptLike>();

  for (const exc of excerpts) {
    if (exc.sourceUrl) {
      excerptMapByUrl.set(exc.sourceUrl, exc);
    }
    if (exc.index) {
      excerptMapByIndex.set(exc.index, exc);
    }
  }

  const milestones = plan?.milestones || [];
  const milestoneMap = new Map<string, PlanMilestone>();
  milestones.forEach((m) => milestoneMap.set(m.id, m));

  return sources.map((source, idx) => {
    const index = idx + 1; // 1-based sequential index
    const citationIndex = source.citationIndex || index;
    const isCited = citedSet.has(citationIndex) || (source.isCited === true);

    const matchedExcerpt = excerptMapByIndex.get(citationIndex) || (source.url ? excerptMapByUrl.get(source.url) : undefined);

    // Determine passage
    let passage = source.passage || source.snippet || matchedExcerpt?.text || '';
    if (!passage && source.title) {
      passage = source.title;
    }

    // Determine score
    let score = source.score;
    if (typeof score !== 'number' || isNaN(score)) {
      if (typeof source.credibilityScore === 'number') {
        score = source.credibilityScore > 1 ? source.credibilityScore / 100 : source.credibilityScore;
      } else if (matchedExcerpt?.score) {
        score = matchedExcerpt.score;
      } else {
        score = isCited ? 0.88 : 0.65;
      }
    }
    if (score > 1 && score <= 100) {
      score = score / 100;
    }

    const relevanceTier = categorizeRelevanceTier(score);

    // Determine milestone assignment: check explicit milestone, then content match, else fallback to 'general'
    let milestoneId = source.milestoneId || matchedExcerpt?.milestoneId || '';
    let milestoneTitle = source.milestoneTitle || '';

    if (!milestoneId && milestones.length > 0) {
      const lower = `${source.title || ''} ${passage || ''}`.toLowerCase();
      for (const m of milestones) {
        const words = `${m.query || ''} ${m.rationale || ''}`.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        if (words.some((w: string) => lower.includes(w))) {
          milestoneId = m.id;
          milestoneTitle = m.query;
          break;
        }
      }
    }

    if (milestoneId && milestoneMap.has(milestoneId)) {
      milestoneTitle = milestoneMap.get(milestoneId)!.query;
    } else if (!milestoneId || milestoneId === 'general') {
      milestoneId = 'general';
      milestoneTitle = 'General Background Evidence';
    } else if (!milestoneTitle) {
      milestoneTitle = `Milestone: ${milestoneId}`;
    }

    const domain = extractDomain(source.url, source.domain);
    const credibilityScore = typeof source.credibilityScore === 'number'
      ? (source.credibilityScore > 1 ? source.credibilityScore : Math.round(source.credibilityScore * 100))
      : 85;

    return {
      ...source,
      index,
      citationIndex,
      citationIndices: isCited ? [citationIndex] : [],
      isCited,
      passage,
      originalSnippet: source.originalSnippet || (matchedExcerpt?.metadata?.originalSnippet as string) || undefined,
      score: Math.min(1, Math.max(0, score)),
      relevanceTier,
      milestoneId,
      milestoneTitle,
      domain,
      credibilityScore
    };
  });
}

/**
 * Multi-dimensional filtering for source shelf exploration.
 */
export function filterSources(
  sources: EnrichedSourceItem[],
  filters: SourceShelfFilters = {}
): EnrichedSourceItem[] {
  if (!Array.isArray(sources)) return [];

  const {
    milestoneId = 'all',
    citationStatus = 'all',
    relevanceTier = 'all',
    domain = 'all',
    searchQuery = ''
  } = filters;

  const normalizedQuery = searchQuery.trim().toLowerCase();

  return sources.filter((src) => {
    // 1. Milestone Facet filter
    if (milestoneId !== 'all' && src.milestoneId !== milestoneId) {
      return false;
    }

    // 2. Citation Status filter
    if (citationStatus === 'cited' && !src.isCited) {
      return false;
    }
    if (citationStatus === 'background' && src.isCited) {
      return false;
    }

    // 3. Relevance Tier filter
    if (relevanceTier !== 'all' && src.relevanceTier !== relevanceTier) {
      return false;
    }

    // 4. Domain filter
    if (domain !== 'all' && src.domain.toLowerCase() !== domain.toLowerCase()) {
      return false;
    }

    // 5. Keyword search filter across title, domain, URL, passage, and milestone title
    if (normalizedQuery) {
      const matchQuery = normalizeEasternNumerals(normalizedQuery);
      const indexStr = String(src.citationIndex || src.index);
      const matchIndex = indexStr === matchQuery || `[${indexStr}]` === matchQuery || `#${indexStr}` === matchQuery;
      const matchTitle = (src.title || '').toLowerCase().includes(matchQuery);
      const matchDomain = (src.domain || '').toLowerCase().includes(matchQuery);
      const matchUrl = (src.url || '').toLowerCase().includes(matchQuery);
      const matchPassage = (src.passage || '').toLowerCase().includes(matchQuery);
      const matchMilestone = (src.milestoneTitle || '').toLowerCase().includes(matchQuery);

      if (!matchIndex && !matchTitle && !matchDomain && !matchUrl && !matchPassage && !matchMilestone) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Groups enriched sources by approved plan milestones.
 * Preserves milestone ordering from ResearchPlan and handles unassigned residual sources.
 */
export function groupSourcesByMilestone(
  sources: EnrichedSourceItem[],
  plan?: ResearchPlan | null
): MilestoneFacetGroup[] {
  const groups: MilestoneFacetGroup[] = [];
  const groupsById = new Map<string, MilestoneFacetGroup>();

  // 1. Seed groups from approved plan milestones if provided
  if (plan?.milestones && Array.isArray(plan.milestones)) {
    for (const m of plan.milestones) {
      const grp: MilestoneFacetGroup = {
        milestoneId: m.id,
        milestoneQuery: m.query,
        milestoneRationale: m.rationale,
        sources: [],
        totalCount: 0,
        citedCount: 0
      };
      groups.push(grp);
      groupsById.set(m.id, grp);
    }
  }

  // 2. Assign sources to corresponding milestone groups
  const unassignedSources: EnrichedSourceItem[] = [];

  for (const src of sources) {
    const grp = groupsById.get(src.milestoneId);
    if (grp) {
      grp.sources.push(src);
      grp.totalCount += 1;
      if (src.isCited) grp.citedCount += 1;
    } else {
      unassignedSources.push(src);
    }
  }

  // 3. If there are unassigned sources, group them under their respective milestoneId or general
  if (unassignedSources.length > 0) {
    const residualMap = new Map<string, EnrichedSourceItem[]>();
    for (const src of unassignedSources) {
      const key = src.milestoneId || 'general';
      if (!residualMap.has(key)) residualMap.set(key, []);
      residualMap.get(key)!.push(src);
    }

    for (const [mid, sList] of residualMap.entries()) {
      const first = sList[0];
      const title = first.milestoneTitle || (mid === 'general' ? 'General Evidence' : `Milestone: ${mid}`);
      const cited = sList.filter((s) => s.isCited).length;
      groups.push({
        milestoneId: mid,
        milestoneQuery: title,
        sources: sList,
        totalCount: sList.length,
        citedCount: cited
      });
    }
  }

  return groups;
}

/**
 * Computes comprehensive statistical overview for the source shelf.
 */
export function computeShelfStats(
  sources: EnrichedSourceItem[],
  plan?: ResearchPlan | null
): SourceShelfStats {
  const totalAdmitted = sources.length;
  let totalCited = 0;
  const domainCounts = new Map<string, number>();
  const tierCounts = { high: 0, medium: 0, low: 0 };

  for (const src of sources) {
    if (src.isCited) totalCited += 1;
    const dom = src.domain || 'web';
    domainCounts.set(dom, (domainCounts.get(dom) || 0) + 1);
    tierCounts[src.relevanceTier] += 1;
  }

  const topDomains = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  const groups = groupSourcesByMilestone(sources, plan);
  const milestoneBreakdown = groups.map((g) => ({
    milestoneId: g.milestoneId,
    milestoneQuery: g.milestoneQuery,
    total: g.totalCount,
    cited: g.citedCount
  }));

  return {
    totalAdmitted,
    totalCited,
    totalBackground: totalAdmitted - totalCited,
    uniqueDomainsCount: domainCounts.size,
    topDomains,
    tierCounts,
    milestoneBreakdown
  };
}

/**
 * Extracts surrounding report sentence or paragraph citing a given citation index.
 */
export function extractSurroundingClaim(reportText: string, citationIndex: number): string | undefined {
  if (!reportText || typeof reportText !== 'string' || !citationIndex) return undefined;

  // Split report into paragraphs and find paragraph citing this index
  const paragraphs = reportText.split(/\n\s*\n/);
  for (const p of paragraphs) {
    if (extractCitedIndices(p).has(citationIndex)) {
      // Find sentence or return trimmed paragraph
      const clean = p.trim().replace(/^>\s*/gm, ''); // strip blockquote markers
      return clean;
    }
  }

  return undefined;
}

/**
 * Detects if a claim or passage is bilingual (e.g. Arabic claim with English/Latin passage).
 */
export function detectBilingualMismatch(textA: string, textB: string): boolean {
  if (!textA || !textB) return false;

  const countArabic = (t: string) => (t.match(/[\u0600-\u06FF]/g) || []).length;
  const countLatin = (t: string) => (t.match(/[a-zA-Z]/g) || []).length;

  const arabicCountA = countArabic(textA);
  const latinCountA = countLatin(textA);
  const arabicCountB = countArabic(textB);
  const latinCountB = countLatin(textB);

  // Predominant script check: must have meaningful length and dominate over other script
  const isArabicA = arabicCountA >= 5 && arabicCountA > latinCountA;
  const isLatinA = latinCountA >= 5 && latinCountA > arabicCountA;

  const isArabicB = arabicCountB >= 5 && arabicCountB > latinCountB;
  const isLatinB = latinCountB >= 5 && latinCountB > arabicCountB;

  return (isArabicA && isLatinB) || (isLatinA && isArabicB);
}

/**
 * Extracts complete inspection detail for an Evidence Inspection Drawer.
 */
export function extractCitationInspection(
  citationIndex: number,
  sources: EnrichedSourceItem[],
  reportText: string = '',
  language: 'ar' | 'en' = 'en'
): CitationInspectionDetail {
  // Find source matching citationIndex or index
  let source = sources.find((s) => s.citationIndex === citationIndex || s.index === citationIndex) || null;
  if (!source && citationIndex > 0 && citationIndex <= sources.length) {
    source = sources[citationIndex - 1];
  }

  const surroundingClaim = extractSurroundingClaim(reportText, citationIndex);
  const exactPassage = source?.passage || source?.snippet || (language === 'ar' ? 'لا يتوفر مقطع أصلي لهذا المصدر.' : 'No excerpt passage available for this source.');

  const isBilingual = Boolean(
    (source?.originalSnippet && surroundingClaim) ||
    (surroundingClaim && detectBilingualMismatch(surroundingClaim, exactPassage)) ||
    (language === 'ar' && /[a-zA-Z]{4,}/.test(exactPassage))
  );

  return {
    citationIndex,
    source,
    exactPassage,
    surroundingClaim,
    isBilingual,
    originalSnippet: source?.originalSnippet || (isBilingual ? exactPassage : undefined),
    relevanceScore: source?.score ?? 0.85,
    relevanceTier: source?.relevanceTier ?? 'high',
    sourceDomain: source?.domain || 'web',
    sourceTitle: source?.title || (source?.url || `Source [${citationIndex}]`),
    sourceUrl: source?.url || '',
    milestoneId: source?.milestoneId || 'general',
    milestoneTitle: source?.milestoneTitle || (language === 'ar' ? 'محور عام' : 'General Facet'),
    credibilityScore: source?.credibilityScore ?? 85
  };
}
