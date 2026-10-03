/**
 * LENS Deep Research Engine — Hierarchical Synthesis & Citation Grounding Contract
 * Tracer 7 (Issue #34): Implements milestone-by-milestone analytical section generation,
 * meta-synthesis pass for executive overview and comparison matrices, deterministic
 * pre-allocated citation brackets [1], [2]..., automated post-synthesis regex verification
 * guaranteeing zero hallucinated citations, and empirical contradiction callouts.
 */

import {
  PlanMilestone,
  ResearchPlan,
  SearchPerspective,
  SearchDepth,
  SourceItem
} from './types';
import { LLMRequestOptions } from './models';
import { generate } from './modelGateway';
import { AdmittedChunk, CandidateChunk } from './admission';
import { verifyTemporalGrounding as verifyTemporalClaimGrounding, type TemporalGroundingFlag } from './freshness';
import { buildAbstentionReport, buildUncertainSectionNotice } from './abstention';
import { CompactionShield } from './skills';

/**
 * A grounded evidence excerpt with an immutable, deterministic citation bracket.
 */
export interface GroundedExcerpt {
  index: number;              // 1-based integer (1, 2, 3...)
  bracket: string;            // Pre-allocated bracket string: "[1]", "[2]"
  chunkId: string;            // Unique chunk identifier
  milestoneId: string;        // Associated milestone ID (or 'default'/'residual')
  text: string;               // Verbatim evidence passage text
  sourceUrl: string;          // Source URL
  sourceTitle?: string;       // Page or document title
  sourceDomain: string;       // Domain name e.g. "nature.com"
  score?: number;             // Hybrid relevance score
  /** Provider-supplied publication date (ISO, Track E retention). */
  publishedAt?: string;
  admittedReason?: 'quota' | 'residual';
  metadata?: Record<string, any>;
}

/**
 * Input format for candidate chunks or sources to be registered in the contract.
 */
export interface GroundedExcerptInput {
  id?: string;
  chunkId?: string;
  milestoneId?: string;
  text?: string;
  content?: string;
  snippet?: string;
  sourceUrl?: string;
  url?: string;
  sourceTitle?: string;
  title?: string;
  sourceDomain?: string;
  domain?: string;
  score?: number;
  /** Provider-supplied publication date (ISO, Track E retention). */
  publishedAt?: string;
  admittedReason?: 'quota' | 'residual';
  metadata?: Record<string, any>;
}

/**
 * Post-synthesis verification statistics and audit record.
 */
export interface GroundingVerificationResult {
  sanitizedText: string;
  originalText: string;
  totalFound: number;
  validCount: number;
  hallucinatedCount: number;
  remappedCount: number;
  hallucinatedIndices: number[];
  validIndices: number[];
  citedIndices: number[];
  deterministicVerification: boolean;
  zeroHallucinationGuaranteed?: boolean;
}

/**
 * Contradiction detection & callouts live in the leaf `contradictions.ts`
 * seam (Track G): re-exported here so existing importers keep working while
 * lightweight consumers (evidence auditor) import the leaf directly and
 * never drag the synthesis graph into their program.
 */
import {
  formatContradictionCallout,
  extractContradictionCallouts,
  detectMetricContradictions,
  type ContradictionClaim,
  type ContradictionCalloutOptions,
  type ExtractedContradiction,
  type DetectedContradiction,
  type ContradictionExcerpt,
} from './contradictions';
export {
  formatContradictionCallout,
  extractContradictionCallouts,
  detectMetricContradictions,
} from './contradictions';
export type {
  ContradictionClaim,
  ContradictionCalloutOptions,
  ExtractedContradiction,
  DetectedContradiction,
  ContradictionExcerpt,
} from './contradictions';

export interface GroundedReference {
  index: number;
  bracket: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  /** Provider-supplied publication date (ISO, Track E retention). */
  publishedAt?: string;
  milestoneId?: string;
  score?: number;
  cited: boolean;
}

export interface MilestoneSectionResult {
  milestoneId: string;
  milestoneQuery: string;
  rationale?: string;
  rawContent: string;
  sanitizedContent: string;
  citedIndices: number[];
  contradictions: ExtractedContradiction[];
  verification: GroundingVerificationResult;
}

export interface MetaSynthesisResult {
  rawContent: string;
  sanitizedContent: string;
  executiveSummary: string;
  comparisonMatrix?: string;
  citedIndices: number[];
  contradictions: ExtractedContradiction[];
  verification: GroundingVerificationResult;
}

export interface HierarchicalSynthesisResult {
  report: string;
  objective: string;
  language: 'ar' | 'en';
  metaSynthesis: MetaSynthesisResult;
  milestoneSections: MilestoneSectionResult[];
  contract: CitationGroundingContract;
  totalAdmittedSources: number;
  totalCitedSources: number;
  groundingVerification: {
    totalFoundInReport: number;
    validCitations: number;
    hallucinatedStripped: number;
    remappedCount: number;
    deterministicVerification: boolean;
    zeroHallucinationGuaranteed?: boolean;
    citedIndices: number[];
  };
  references: GroundedReference[];
  contradictions: ExtractedContradiction[];
}

export type LLMGenerator = (
  prompt: { system: string; user: string },
  context: {
    stage: 'milestone' | 'meta';
    milestone?: PlanMilestone;
    milestoneIndex?: number;
    totalMilestones?: number;
  }
) => Promise<string>;

export interface HierarchicalSynthesisOptions {
  plan: ResearchPlan | { id?: string; objective?: string; milestones: PlanMilestone[] };
  evidence: Array<AdmittedChunk | CandidateChunk | GroundedExcerptInput | SourceItem>;
  query?: string;
  language?: 'ar' | 'en';
  perspective?: SearchPerspective;
  depth?: SearchDepth;
  generator?: LLMGenerator;
  llmOptions?: LLMRequestOptions;
  activeSkillsContext?: string;
  enableComparisonMatrix?: boolean;
  enableContradictionCallouts?: boolean;
  remapStrategy?: 'strip';
  remapMap?: Map<number, number> | Record<number, number>;
  onlyCitedInReferences?: boolean;
  onProgress?: (event: {
    stage: 'milestone' | 'meta' | 'verification';
    milestoneId?: string;
    milestoneQuery?: string;
    sectionIndex?: number;
    totalSections?: number;
    progressPercent?: number;
  }) => void;
  onChunk?: (chunk: string) => void;
}

/**
 * CitationGroundingContract pre-allocates deterministic citation indices ([1], [2]...)
 * to candidate passages and strictly sanitizes LLM output to guarantee zero hallucinated citations.
 */
export class CitationGroundingContract {
  private excerpts: GroundedExcerpt[] = [];
  private indexMap: Map<number, GroundedExcerpt> = new Map();
  private chunkIdMap: Map<string, GroundedExcerpt> = new Map();
  private milestoneMap: Map<string, GroundedExcerpt[]> = new Map();
  private remapDictionary: Map<number, number> = new Map();

  constructor(options: {
    remapStrategy?: 'strip';
    remapMap?: Map<number, number> | Record<number, number>;
  } = {}) {
    if (options.remapMap) {
      if (options.remapMap instanceof Map) {
        this.remapDictionary = new Map(options.remapMap);
      } else if (typeof options.remapMap === 'object') {
        for (const [k, v] of Object.entries(options.remapMap)) {
          this.remapDictionary.set(Number(k), Number(v));
        }
      }
    }
  }

  /**
   * Pre-allocates deterministic sequential citation indices [1], [2]...
   * for candidate excerpts.
   */
  public registerExcerpts(
    inputs: Array<AdmittedChunk | CandidateChunk | GroundedExcerptInput | SourceItem>
  ): GroundedExcerpt[] {
    for (const input of inputs) {
      this.registerExcerpt(input);
    }
    return this.getAllExcerpts();
  }

  public registerExcerpt(
    input: AdmittedChunk | CandidateChunk | GroundedExcerptInput | SourceItem
  ): GroundedExcerpt {
    const rawId = (input as any).id || (input as any).chunkId || `chunk_${this.excerpts.length + 1}`;

    // Check if chunkId already registered
    const existing = this.chunkIdMap.get(rawId);
    if (existing) {
      return existing;
    }

    const nextIndex = this.excerpts.length + 1;
    const bracket = `[${nextIndex}]`;
    const milestoneId = (input as any).milestoneId || 'default';
    const text = (input as any).text || (input as any).content || (input as any).snippet || '';
    const sourceUrl = (input as any).sourceUrl || (input as any).url || '';
    const sourceTitle = (input as any).sourceTitle || (input as any).title || '';
    const sourceDomain = (input as any).sourceDomain || (input as any).domain || this.extractDomain(sourceUrl);
    const score = typeof (input as any).score === 'number' ? (input as any).score : undefined;
    const admittedReason = (input as any).admittedReason || 'quota';
    const metadata = (input as any).metadata;
    // Track E retention: the date rides the excerpt where supplied.
    const publishedAt = typeof (input as any).publishedAt === 'string' ? (input as any).publishedAt : undefined;

    const excerpt: GroundedExcerpt = {
      index: nextIndex,
      bracket,
      chunkId: rawId,
      milestoneId,
      text,
      sourceUrl,
      sourceTitle,
      sourceDomain,
      score,
      ...(publishedAt ? { publishedAt } : {}),
      admittedReason,
      metadata
    };

    this.excerpts.push(excerpt);
    this.indexMap.set(nextIndex, excerpt);
    this.chunkIdMap.set(rawId, excerpt);

    if (!this.milestoneMap.has(milestoneId)) {
      this.milestoneMap.set(milestoneId, []);
    }
    this.milestoneMap.get(milestoneId)!.push(excerpt);

    return excerpt;
  }

  public hasIndex(index: number): boolean {
    return this.indexMap.has(index);
  }

  public getExcerpt(index: number): GroundedExcerpt | undefined {
    return this.indexMap.get(index);
  }

  public getAllExcerpts(): GroundedExcerpt[] {
    return [...this.excerpts];
  }

  public getExcerptsForMilestone(milestoneId: string): GroundedExcerpt[] {
    return this.milestoneMap.get(milestoneId) || [];
  }

  public getTotalCount(): number {
    return this.excerpts.length;
  }

  /**
   * Track E claim-level temporal verification (SPEC #155): every
   * freshness-seeking sentence in the report must cite at least one fresh
   * registered excerpt. Sentences backed only by stale/undated excerpts (or
   * by nothing) are flagged for `source_check` verification BEFORE citation
   * — advisory (like the evidence auditor): it annotates, never strips.
   */
  public verifyTemporalGrounding(report: string, nowMs: number = Date.now()): TemporalGroundingFlag[] {
    return verifyTemporalClaimGrounding(
      report,
      this.excerpts.map((ex) => ({
        index: ex.index,
        ...(ex.publishedAt ? { publishedAt: ex.publishedAt } : {}),
      })),
      nowMs
    );
  }

  public setRemapRule(hallucinatedIndex: number, targetIndex: number): void {
    this.remapDictionary.set(hallucinatedIndex, targetIndex);
  }

  private extractDomain(urlStr: string): string {
    if (!urlStr) return 'source';
    try {
      return new URL(urlStr).hostname.replace(/^www\./, '');
    } catch {
      return urlStr.split('/')[0] || 'source';
    }
  }

  /**
   * Formats evidence passages with explicit [x] citation brackets for LLM prompt injection.
   */
  public formatEvidenceForPrompt(
    excerptsOrMilestoneId?: GroundedExcerpt[] | string,
    options: { maxChars?: number } = {}
  ): string {
    let list: GroundedExcerpt[];
    if (typeof excerptsOrMilestoneId === 'string') {
      list = this.getExcerptsForMilestone(excerptsOrMilestoneId);
      if (list.length === 0) {
        list = this.getAllExcerpts();
      }
    } else if (Array.isArray(excerptsOrMilestoneId)) {
      list = excerptsOrMilestoneId;
    } else {
      list = this.getAllExcerpts();
    }

    if (list.length === 0) {
      return 'No external evidence passages admitted.';
    }

    const maxChars = options.maxChars || 40000;
    const blocks: string[] = [];
    let currentLength = 0;

    for (const ex of list) {
      const header = `${ex.bracket} Source: "${ex.sourceTitle || ex.sourceDomain}" (${ex.sourceUrl}) [Domain: ${ex.sourceDomain}]`;
      const content = `Content: ${ex.text}`;
      const block = `${header}\n${content}\n`;

      if (currentLength + block.length > maxChars && blocks.length > 0) {
        break;
      }
      blocks.push(block);
      currentLength += block.length;
    }

    return blocks.join('\n');
  }

  /**
   * Post-synthesis regex verifier scanning the generated text.
   * Strips or remaps any unmapped/hallucinated citation brackets,
   * guaranteeing zero hallucinated citations.
   */
  public verifyAndSanitize(
    rawText: string,
    options: {
      remapStrategy?: 'strip';
      remapMap?: Map<number, number> | Record<number, number>;
    } = {}
  ): GroundingVerificationResult {
    if (!rawText) {
      return {
        sanitizedText: '',
        originalText: '',
        totalFound: 0,
        validCount: 0,
        hallucinatedCount: 0,
        remappedCount: 0,
        hallucinatedIndices: [],
        validIndices: [],
        citedIndices: [],
        deterministicVerification: true,
        zeroHallucinationGuaranteed: true
      };
    }

    const localRemapMap = new Map<number, number>(this.remapDictionary);
    if (options.remapMap) {
      if (options.remapMap instanceof Map) {
        for (const [k, v] of options.remapMap) localRemapMap.set(k, v);
      } else {
        for (const [k, v] of Object.entries(options.remapMap)) localRemapMap.set(Number(k), Number(v));
      }
    }

    // 1. Protect code blocks, inline code, and shielded XML tags from citation modification
    const protectedBlocks: string[] = [];
    const tokenPrefix = '\x00__LENS_PROTECTED_BLOCK_';
    const tokenSuffix = '__\x00';

    let text = rawText;

    // Fenced code blocks
    text = text.replace(/```[\s\S]*?```/g, (match) => {
      const id = protectedBlocks.length;
      protectedBlocks.push(match);
      return `${tokenPrefix}${id}${tokenSuffix}`;
    });

    // Inline code
    text = text.replace(/`[^`\n]+`/g, (match) => {
      const id = protectedBlocks.length;
      protectedBlocks.push(match);
      return `${tokenPrefix}${id}${tokenSuffix}`;
    });

    // <skill_content> tags
    text = text.replace(/<skill_content[^>]*>[\s\S]*?<\/skill_content>/gi, (match) => {
      const id = protectedBlocks.length;
      protectedBlocks.push(match);
      return `${tokenPrefix}${id}${tokenSuffix}`;
    });

    // Markdown task list checkboxes e.g. - [ ] or - [x]
    text = text.replace(/^(\s*[-*+]\s+\[[ xX]\])/gm, (match) => {
      const id = protectedBlocks.length;
      protectedBlocks.push(match);
      return `${tokenPrefix}${id}${tokenSuffix}`;
    });

    // Valid Markdown links e.g. [1](url), [12](url), [text](url)
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)\n]+|[^\s)\n]+(?:\s+["'][^"'\n]*["'])?)\)/g, (match) => {
      const id = protectedBlocks.length;
      protectedBlocks.push(match);
      return `${tokenPrefix}${id}${tokenSuffix}`;
    });

    // 2. Track audit metrics
    const hallucinatedIndices: number[] = [];
    const validIndices: number[] = [];
    const citedIndicesSet = new Set<number>();
    let validCount = 0;
    let hallucinatedCount = 0;
    let remappedCount = 0;

    const parseInnerNumbers = (inner: string): number[] => {
      // 1. Normalize Arabic-Indic and Persian digits to standard ASCII digits
      const normalized = inner
        .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
        .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48));

      // 2. Match ranges (e.g. 1-3, 1 - 3) or individual digits regardless of delimiter (comma, semicolon, Arabic comma, whitespace)
      const tokens = normalized.match(/(\d+\s*[-–—−\u2013\u2014\u2212]\s*\d+|\d+)/g) || [];
      const nums: number[] = [];

      for (const token of tokens) {
        const rangeMatch = token.match(/^(\d+)\s*[-–—−\u2013\u2014\u2212]\s*(\d+)$/);
        if (rangeMatch) {
          let start = parseInt(rangeMatch[1], 10);
          let end = parseInt(rangeMatch[2], 10);
          if (start > end) {
            const tmp = start;
            start = end;
            end = tmp;
          }
          // Cap range expansion to upper limit of available excerpts + 5 to prevent memory blowup,
          // but expand all intermediate values so every single index is verified
          const maxExcerpt = this.excerpts.length;
          const cappedEnd = Math.min(end, maxExcerpt + 5);
          for (let i = start; i <= cappedEnd; i++) {
            nums.push(i);
          }
          if (end > cappedEnd) {
            nums.push(end);
          }
        } else if (/^\d+$/.test(token)) {
          nums.push(parseInt(token, 10));
        }
      }
      return nums;
    };

    // Helper to resolve an individual index
    const resolveIndex = (idx: number): { action: 'valid' | 'remapped' | 'stripped'; resolvedIndex?: number } => {
      if (this.hasIndex(idx)) {
        return { action: 'valid', resolvedIndex: idx };
      }

      // Check explicit remap map
      if (localRemapMap.has(idx)) {
        const mapped = localRemapMap.get(idx)!;
        if (this.hasIndex(mapped)) {
          return { action: 'remapped', resolvedIndex: mapped };
        }
      }

      return { action: 'stripped' };
    };

    // Shared number processor eliminating code duplication across regex passes
    const processNumberList = (numbers: number[]) => {
      const kept: number[] = [];
      for (const n of numbers) {
        const res = resolveIndex(n);
        if (res.action === 'valid') {
          validCount++;
          validIndices.push(n);
          citedIndicesSet.add(n);
          kept.push(n);
        } else if (res.action === 'remapped') {
          hallucinatedCount++;
          remappedCount++;
          hallucinatedIndices.push(n);
          validIndices.push(res.resolvedIndex!);
          citedIndicesSet.add(res.resolvedIndex!);
          kept.push(res.resolvedIndex!);
        } else {
          hallucinatedCount++;
          hallucinatedIndices.push(n);
        }
      }
      return kept;
    };

    // Shared cleaner for punctuation and artifact whitespace
    const cleanPunctuationAndWhitespace = (input: string): string => {
      let t = input;
      // Remove empty brackets e.g. []
      t = t.replace(/\[\s*\]/g, '');
      // Collapse duplicate / consecutive delimiters (commas, semicolons, Arabic commas)
      t = t.replace(/([,;،\u060C])\s*([,;،\u060C])/g, '$1');
      t = t.replace(/([,;،\u060C])\s*([,;،\u060C])/g, '$1');
      // Remove delimiter immediately preceding closing sentence punctuation
      t = t.replace(/[,;،\u060C]\s*([.!?])/g, '$1');
      // Remove spaces before punctuation marks
      t = t.replace(/[ \t]+([.,;:!?،\u060C])/g, '$1');
      // Multiple spaces on the same line collapsed to a single space
      t = t.replace(/([^\n \t])[ \t]{2,}([^\n \t])/g, '$1 $2');
      // Clean up trailing spaces before newlines
      t = t.replace(/[ \t]+$/gm, '');
      return t;
    };

    // Regex supporting comma, semicolon, Arabic comma, dash, AND whitespace delimiters
    const bracketContentPattern = `[\\d\\u0660-\\u0669\\u06F0-\\u06F9]+(?:\\s*(?:[,;،\\u060C\\s]|[-–—−\\u2013\\u2014\\u2212])\\s*[\\d\\u0660-\\u0669\\u06F0-\\u06F9]+)*`;

    // 3. Process standard unlinked citation brackets e.g. [1], [1, 99], [99 100]
    const standardBracketRegex = new RegExp(`\\[\\s*(${bracketContentPattern})\\s*\\]`, 'g');
    text = text.replace(standardBracketRegex, (_match, inner) => {
      const numbers = parseInnerNumbers(inner);
      const kept = processNumberList(numbers);
      if (kept.length === 0) return '';
      const uniqueKept = Array.from(new Set(kept));
      return `[${uniqueKept.join(', ')}]`;
    });

    // 4. Clean up artifact whitespace and punctuation left behind by stripped brackets
    text = cleanPunctuationAndWhitespace(text);

    // 5. Mandatory Second-Pass Verification Sweep (Guarantees zero hallucinated citations)
    let remainingHallucinations = 0;
    const secondPassRegex = new RegExp(`\\[\\s*(${bracketContentPattern})\\s*\\]`, 'g');
    let checkMatch: RegExpExecArray | null;

    while ((checkMatch = secondPassRegex.exec(text)) !== null) {
      const nums = parseInnerNumbers(checkMatch[1]);
      for (const n of nums) {
        if (!this.hasIndex(n)) {
          remainingHallucinations++;
          hallucinatedCount++;
          hallucinatedIndices.push(n);
        }
      }
    }

    // If any hallucinated brackets slipped past, forcibly strip them
    if (remainingHallucinations > 0) {
      secondPassRegex.lastIndex = 0;
      text = text.replace(secondPassRegex, (_match, inner) => {
        const nums = parseInnerNumbers(inner);
        const validOnly = nums.filter(n => this.hasIndex(n));
        if (validOnly.length === 0) return '';
        return `[${Array.from(new Set(validOnly)).join(', ')}]`;
      });
      text = cleanPunctuationAndWhitespace(text);
    }

    // 7. Restore protected blocks
    // Iterate in reverse: a later block may embed a placeholder from an earlier pass.
    for (let i = protectedBlocks.length - 1; i >= 0; i--) {
      const placeholder = `${tokenPrefix}${i}${tokenSuffix}`;
      text = text.replace(placeholder, () => protectedBlocks[i]);
    }

    const citedIndices = Array.from(citedIndicesSet).sort((a, b) => a - b);

    return {
      sanitizedText: text,
      originalText: rawText,
      totalFound: validCount + hallucinatedCount,
      validCount,
      hallucinatedCount,
      remappedCount,
      hallucinatedIndices,
      validIndices,
      citedIndices,
      deterministicVerification: true,
      zeroHallucinationGuaranteed: true
    };
  }

  /**
   * Formats a publication-grade References section listing grounded evidence sources.
   */
  public formatReferences(options: {
    onlyCited?: boolean;
    language?: 'ar' | 'en';
    citedIndices?: number[];
  } = {}): string {
    const isAr = options.language === 'ar';
    const citedSet = new Set<number>(options.citedIndices || []);

    const targetExcerpts = options.onlyCited && citedSet.size > 0
      ? this.excerpts.filter(e => citedSet.has(e.index))
      : this.excerpts;

    if (targetExcerpts.length === 0) {
      return isAr ? '## المراجع\n\nلا توجد مراجع معتمدة.' : '## References\n\nNo references cited.';
    }

    const header = isAr ? '## المراجع الموثقة (Grounded References)' : '## References & Evidence Provenance';
    const lines: string[] = [header, ''];

    for (const ex of targetExcerpts) {
      const isCited = citedSet.size > 0 ? citedSet.has(ex.index) : true;
      const statusBadge = isCited ? '' : isAr ? ' *(مرجع استكشافي)*' : ' *(admitted background)*';
      const title = ex.sourceTitle || ex.sourceDomain || `Source ${ex.index}`;
      const domain = ex.sourceDomain;
      const url = ex.sourceUrl;
      const snippet = ex.text.length > 200 ? `${ex.text.slice(0, 197)}...` : ex.text;

      lines.push(`${ex.bracket} **${title}** — \`${domain}\`${statusBadge}`);
      if (url && url !== domain) {
        lines.push(`    ${url}`);
      }
      if (snippet) {
        // Sanitize any bracketed numbers within verbatim snippets to prevent leaking fake citations in references
        const cleanSnippet = snippet.replace(/\[(\d+)\]/g, '($1)');
        lines.push(`    > "${cleanSnippet.replace(/\n/g, ' ')}"`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}

/** Contradiction detection and callout implementations live in the leaf
 * contradictions.ts seam (Track G) and are re-exported at the top of
 * this module - see the re-export block above. */


/**
 * HierarchicalSynthesis orchestrates multi-phase research dossier generation:
 * 1. Milestone-by-milestone analytical section synthesis from admitted evidence
 * 2. Meta-synthesis pass generating executive overview, comparison matrices, and trade-offs
 * 3. Citation Grounding Contract enforcement guaranteeing zero hallucinated citations
 */
export class HierarchicalSynthesis {
  private options: HierarchicalSynthesisOptions;
  private contract: CitationGroundingContract;

  constructor(options: HierarchicalSynthesisOptions) {
    this.options = options;
    this.contract = new CitationGroundingContract({
      remapStrategy: options.remapStrategy || 'strip',
      remapMap: options.remapMap
    });
    this.contract.registerExcerpts(options.evidence);
  }

  public getContract(): CitationGroundingContract {
    return this.contract;
  }

  /**
   * Executes the complete hierarchical synthesis pipeline.
   *
   * Track G honesty (SPEC #155): zero admitted excerpts abstain outright —
   * no sections, no meta pass, no dossier. A report without evidence is an
   * abstention, never an authoritative document.
   */
  public async synthesize(): Promise<HierarchicalSynthesisResult> {
    const language = this.options.language || 'en';
    const isAr = language === 'ar';
    const perspective = this.options.perspective || 'balanced';
    const query = this.options.query || (this.options.plan as any).objective || 'Research Report';

    if (this.contract.getTotalCount() === 0) {
      return this.synthesizeAbstention(query, language);
    }

    // Normalize milestones
    const planMilestones: PlanMilestone[] = [];
    if (this.options.plan?.milestones && Array.isArray(this.options.plan.milestones)) {
      for (const m of this.options.plan.milestones) {
        planMilestones.push({
          id: m.id || `m_${planMilestones.length + 1}`,
          query: m.query || 'Research Facet',
          rationale: m.rationale || ''
        });
      }
    }

    if (planMilestones.length === 0) {
      planMilestones.push({
        id: 'm_1',
        query,
        rationale: 'Primary research topic'
      });
    }

    // Detect empirical contradictions across all admitted excerpts
    const potentialContradictions = detectMetricContradictions(this.contract.getAllExcerpts());

    // Phase 1: Synthesize analytical sections for each approved plan milestone
    const milestoneSections: MilestoneSectionResult[] = [];
    const totalMilestones = planMilestones.length;

    for (let i = 0; i < totalMilestones; i++) {
      const milestone = planMilestones[i];

      if (this.options.onProgress) {
        this.options.onProgress({
          stage: 'milestone',
          milestoneId: milestone.id,
          milestoneQuery: milestone.query,
          sectionIndex: i + 1,
          totalSections: totalMilestones + 1,
          progressPercent: Math.round(((i + 1) / (totalMilestones + 2)) * 70)
        });
      }

      const sectionResult = await this.synthesizeMilestoneSection(
        milestone,
        i,
        totalMilestones,
        query,
        language,
        perspective,
        potentialContradictions
      );

      milestoneSections.push(sectionResult);
    }

    // Phase 2: Meta-Synthesis Pass (Executive Overview, Comparison Matrix, Trade-offs)
    if (this.options.onProgress) {
      this.options.onProgress({
        stage: 'meta',
        sectionIndex: totalMilestones + 1,
        totalSections: totalMilestones + 1,
        progressPercent: 85
      });
    }

    const metaResult = await this.synthesizeMetaPass(
      milestoneSections,
      query,
      language,
      perspective,
      potentialContradictions
    );

    // Phase 3: Assemble Full Dossier and Enforce Global Grounding Verification
    if (this.options.onProgress) {
      this.options.onProgress({
        stage: 'verification',
        sectionIndex: totalMilestones + 1,
        totalSections: totalMilestones + 1,
        progressPercent: 95
      });
    }

    const assembledReport = this.assembleDocument(
      query,
      metaResult,
      milestoneSections,
      potentialContradictions,
      language
    );

    // Final global verification pass guaranteeing zero hallucinated citations
    const finalVerification = this.contract.verifyAndSanitize(assembledReport);

    const onlyCited = this.options.onlyCitedInReferences !== undefined
      ? this.options.onlyCitedInReferences
      : true;

    // Build Grounded References section
    const referencesText = this.contract.formatReferences({
      language,
      onlyCited,
      citedIndices: finalVerification.citedIndices
    });

    const fullReportWithReferences = `${finalVerification.sanitizedText.trim()}\n\n${referencesText}`;

    // Collect all unique contradictions
    const allContradictions: ExtractedContradiction[] = [
      ...metaResult.contradictions,
      ...milestoneSections.flatMap(s => s.contradictions)
    ];

    // Build references objects for telemetry
    const referencesList: GroundedReference[] = this.contract.getAllExcerpts().map(ex => ({
      index: ex.index,
      bracket: ex.bracket,
      title: ex.sourceTitle || ex.sourceDomain,
      url: ex.sourceUrl,
      domain: ex.sourceDomain,
      snippet: ex.text.slice(0, 160),
      // Track E retention: references carry dates where supplied.
      ...(ex.publishedAt ? { publishedAt: ex.publishedAt } : {}),
      milestoneId: ex.milestoneId,
      score: ex.score,
      cited: finalVerification.citedIndices.includes(ex.index)
    }));

    if (this.options.onProgress) {
      this.options.onProgress({
        stage: 'verification',
        progressPercent: 100
      });
    }

    const totalHallucinatedStripped =
      finalVerification.hallucinatedCount +
      metaResult.verification.hallucinatedCount +
      milestoneSections.reduce((sum, s) => sum + s.verification.hallucinatedCount, 0);

    const totalRemappedCount =
      finalVerification.remappedCount +
      metaResult.verification.remappedCount +
      milestoneSections.reduce((sum, s) => sum + s.verification.remappedCount, 0);

    const validCitations = finalVerification.validCount;
    const totalFoundInReport = validCitations + totalHallucinatedStripped;

    return {
      report: fullReportWithReferences,
      objective: query,
      language,
      metaSynthesis: metaResult,
      milestoneSections,
      contract: this.contract,
      totalAdmittedSources: this.contract.getTotalCount(),
      totalCitedSources: finalVerification.citedIndices.length,
      groundingVerification: {
        totalFoundInReport,
        validCitations,
        hallucinatedStripped: totalHallucinatedStripped,
        remappedCount: totalRemappedCount,
        deterministicVerification: true,
        zeroHallucinationGuaranteed: true,
        citedIndices: finalVerification.citedIndices
      },
      references: referencesList,
      contradictions: allContradictions
    };
  }

  /**
   * Track G abstention (SPEC #155): zero admitted excerpts produce an
   * abstention report, never a dossier. The result shape is complete (all
   * consumers keep working) but carries no sections, no references, and no
   * citation brackets anywhere.
   */
  private synthesizeAbstention(query: string, language: 'ar' | 'en'): HierarchicalSynthesisResult {
    const report = buildAbstentionReport({ query, language, reason: 'no-evidence' });
    if (this.options.onProgress) {
      this.options.onProgress({ stage: 'verification', progressPercent: 100 });
    }
    const verification: GroundingVerificationResult = {
      sanitizedText: report,
      originalText: report,
      totalFound: 0,
      validCount: 0,
      hallucinatedCount: 0,
      remappedCount: 0,
      hallucinatedIndices: [],
      validIndices: [],
      citedIndices: [],
      deterministicVerification: true,
      zeroHallucinationGuaranteed: true,
    };
    const metaResult: MetaSynthesisResult = {
      rawContent: report,
      sanitizedContent: report,
      executiveSummary: '',
      comparisonMatrix: undefined,
      citedIndices: [],
      contradictions: [],
      verification,
    };
    return {
      report,
      objective: query,
      language,
      metaSynthesis: metaResult,
      milestoneSections: [],
      contract: this.contract,
      totalAdmittedSources: 0,
      totalCitedSources: 0,
      groundingVerification: {
        totalFoundInReport: 0,
        validCitations: 0,
        hallucinatedStripped: 0,
        remappedCount: 0,
        deterministicVerification: true,
        zeroHallucinationGuaranteed: true,
        citedIndices: [],
      },
      references: [],
      contradictions: [],
    };
  }

  /**
   * Synthesizes an analytical section for an individual milestone from its admitted evidence.
   */
  private async synthesizeMilestoneSection(
    milestone: PlanMilestone,
    index: number,
    total: number,
    query: string,
    language: 'ar' | 'en',
    perspective: SearchPerspective,
    contradictions: DetectedContradiction[]
  ): Promise<MilestoneSectionResult> {
    const isAr = language === 'ar';
    const milestoneEvidence = this.contract.getExcerptsForMilestone(milestone.id);
    const evidenceContext = this.contract.formatEvidenceForPrompt(
      milestoneEvidence.length > 0 ? milestoneEvidence : this.contract.getAllExcerpts()
    );

    // Filter relevant contradictions for this milestone
    const relevantContradictions = contradictions.filter(c =>
      milestoneEvidence.some(e => e.index === c.sourceA.index || e.index === c.sourceB.index)
    );

    const contradictionInstructions = this.buildContradictionPrompt(relevantContradictions, language);
    const skillsContext = this.options.activeSkillsContext ? `\n\n${this.options.activeSkillsContext}` : '';

    const systemPrompt = isAr
      ? `أنت باحث تحليلي متخصص في هذا المجال.
مهمتك صياغة قسم تحليلي متعمق ومحكم للمحور البحثي المعتمد: "${milestone.query}".

قواعد التوثيق الصارمة (Citation Grounding Contract):
1. يجب توثيق كل معلومة أو رقم أو استنتاج باستخدام أقواس المراجع المخصصة مسبقاً [1]، [2] من الأدلة المرفقة حصراً.
2. يُحظر تماماً إدراج أي رقم مرجع غير موجود في قائمة الأدلة المرفقة.
3. التزم باللغة العربية الفصحى وأسلوب تحليلي موضوعي مباشر.
${contradictionInstructions}${skillsContext}`
      : `You are an expert research analyst and domain specialist.
Your mission is to produce a rigorous, publication-grade analytical section for the approved research milestone: "${milestone.query}".

STRICT CITATION GROUNDING CONTRACT:
1. Every factual assertion, benchmark, or metric MUST cite the pre-allocated bracketed numbers [1], [2] from the admitted evidence below.
2. ZERO UNGROUNDED CITATIONS: Strictly never cite any bracketed number not present in the provided evidence.
3. Tone: Rigorous, analytical, direct, and objective.
${contradictionInstructions}${skillsContext}`;

    const userPrompt = isAr
      ? `الموضوع الأساسي: "${query}"
المحور التحليلي (${index + 1}/${total}): "${milestone.query}"
الهدف والأسباب: ${milestone.rationale || 'تحليل معماري وعلمي متكامل'}
منظور البحث: ${perspective}

--- الأدلة المعتمدة الموثقة مسبقاً لهذا المحور ---
${evidenceContext}
--- نهاية الأدلة ---

قم بصياغة القسم التحليلي المتعمق الآن مع بدء العنوان بـ "### ${milestone.query}".`
      : `Research Objective: "${query}"
Analytical Milestone (${index + 1}/${total}): "${milestone.query}"
Rationale: ${milestone.rationale || 'Comprehensive technical and architectural investigation'}
Perspective: ${perspective}

--- ADMITTED GROUNDED EVIDENCE FOR THIS MILESTONE ---
${evidenceContext}
--- END OF EVIDENCE ---

Synthesize the detailed analytical section now, starting with heading "### ${milestone.query}".`;

    let rawContent = '';

    if (this.options.generator) {
      try {
        rawContent = await this.options.generator(
          { system: systemPrompt, user: userPrompt },
          { stage: 'milestone', milestone, milestoneIndex: index, totalMilestones: total }
        );
      } catch (err: any) {
        rawContent = this.buildUncertainMilestoneSection(milestone, milestoneEvidence, relevantContradictions, isAr);
      }
    } else if (this.options.llmOptions) {
      try {
        rawContent = await generate({
          ...this.options.llmOptions,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.25,
          onChunk: this.options.onChunk
        });
      } catch (err: any) {
        rawContent = this.buildUncertainMilestoneSection(milestone, milestoneEvidence, relevantContradictions, isAr);
      }
    } else {
      rawContent = this.buildUncertainMilestoneSection(milestone, milestoneEvidence, relevantContradictions, isAr);
    }

    // Run Citation Grounding verification on this section
    const verification = this.contract.verifyAndSanitize(rawContent);
    const extractedContradictions = extractContradictionCallouts(verification.sanitizedText);

    return {
      milestoneId: milestone.id,
      milestoneQuery: milestone.query,
      rationale: milestone.rationale,
      rawContent,
      sanitizedContent: verification.sanitizedText,
      citedIndices: verification.citedIndices,
      contradictions: extractedContradictions,
      verification
    };
  }

  /**
   * Synthesizes the meta-synthesis pass (executive summary, comparison matrices, strategic recommendations).
   */
  private async synthesizeMetaPass(
    sections: MilestoneSectionResult[],
    query: string,
    language: 'ar' | 'en',
    perspective: SearchPerspective,
    contradictions: DetectedContradiction[]
  ): Promise<MetaSynthesisResult> {
    const isAr = language === 'ar';
    const allEvidenceContext = this.contract.formatEvidenceForPrompt(undefined, { maxChars: 20000 });
    const sectionSummaries = sections.map((s, idx) =>
      `Milestone ${idx + 1} ("${s.milestoneQuery}"):\n${s.sanitizedContent.slice(0, 500)}...`
    ).join('\n\n');

    const contradictionPrompt = this.buildContradictionPrompt(contradictions, language);

    const systemPrompt = isAr
      ? `أنت باحث تحليلي استراتيجي متخصص.
مهمتك إجراء التوليف الكلي الشامل (Meta-Synthesis Pass) لتقرير البحث: "${query}".

المخرجات المطلوبة بدقة:
1. > [!NOTE] الخلاصة الاستراتيجية المركزة (Strategic Takeaway).
2. ## ملخص تنفيذي وأبرز المؤشرات (Executive Summary & Key Metrics) مع قائمة نقطية بالمؤشرات الكمية.
3. ## جدول المقارنة المعيارية وتحليل المفاضلات (Comparative Matrix & Trade-offs) كجدول Markdown يقارن المحاور والحلول والقيود ومراجع الأدلة.
4. ## التوصيات الاستراتيجية والآفاق المستقبلية (Strategic Recommendations).

قواعد التوثيق:
- وثق كل مؤشر ومقارنة باستخدام أرقام المراجع المعتمدة مسبقاً [1]، [2]... حصراً.
- يُحظر تماماً إدراج أي رقم مرجع خارجي غير موجود في الأدلة.
${contradictionPrompt}`
      : `You are an expert research analyst conducting high-level synthesis.
Your mission is to produce the overarching Meta-Synthesis Pass for the research report: "${query}".

REQUIRED STRUCTURAL DELIVERABLES:
1. > [!NOTE] Strategic Takeaway callout.
2. ## Executive Summary & Key Metrics with a bulleted list of quantitative findings.
3. ## Comparative Analysis & Trade-offs Matrix formatted as a rich Markdown comparison table contrasting milestones, approaches, and trade-offs.
4. ## Strategic Recommendations & Future Outlook.

CITATION GROUNDING CONTRACT:
- Ground all assertions and comparison points in the pre-allocated reference numbers [1], [2]...
- Strictly never cite any bracketed reference numbers not present in the admitted evidence.
${contradictionPrompt}`;

    const userPrompt = isAr
      ? `الموضوع: "${query}"
منظور البحث: ${perspective}

--- ملخصات الأقسام التحليلية المنجزة لكل محور ---
${sectionSummaries}

--- قائمة الأدلة المعتمدة المتاحة ---
${allEvidenceContext}

قم بصياغة التوليف الاستراتيجي الشامل وجدول المقارنة المعيارية والتوصيات الآن.`
      : `Topic: "${query}"
Perspective: ${perspective}

--- SUMMARIES OF COMPLETED MILESTONE ANALYSES ---
${sectionSummaries}

--- CATALOG OF ADMITTED GROUNDED EVIDENCE ---
${allEvidenceContext}

Synthesize the overarching Executive Summary, Comparative Matrix, and Strategic Recommendations now.`;

    let rawContent = '';

    if (this.options.generator) {
      try {
        rawContent = await this.options.generator(
          { system: systemPrompt, user: userPrompt },
          { stage: 'meta' }
        );
      } catch (err: any) {
        rawContent = this.buildUncertainMetaPass(query, sections, contradictions, isAr);
      }
    } else if (this.options.llmOptions) {
      try {
        rawContent = await generate({
          ...this.options.llmOptions,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.25,
          onChunk: this.options.onChunk
        });
      } catch (err: any) {
        rawContent = this.buildUncertainMetaPass(query, sections, contradictions, isAr);
      }
    } else {
      rawContent = this.buildUncertainMetaPass(query, sections, contradictions, isAr);
    }

    const verification = this.contract.verifyAndSanitize(rawContent);
    const extractedContradictions = extractContradictionCallouts(verification.sanitizedText);

    // Extract executive summary and comparison table slices
    const executiveSummary = this.extractSectionByHeading(verification.sanitizedText, /Executive Summary|ملخص تنفيذي/i);
    const comparisonMatrix = this.extractTable(verification.sanitizedText);

    return {
      rawContent,
      sanitizedContent: verification.sanitizedText,
      executiveSummary,
      comparisonMatrix,
      citedIndices: verification.citedIndices,
      contradictions: extractedContradictions,
      verification
    };
  }

  /**
   * Assembles the final publication-grade research dossier from meta-synthesis and milestone sections.
   */
  private assembleDocument(
    query: string,
    meta: MetaSynthesisResult,
    milestoneSections: MilestoneSectionResult[],
    contradictions: DetectedContradiction[],
    language: 'ar' | 'en'
  ): string {
    const isAr = language === 'ar';
    const lines: string[] = [];

    // Title
    lines.push(`# ${query}`);
    lines.push('');

    // Meta synthesis pass (Strategic Takeaway, Executive Summary, Comparison Matrix)
    lines.push(meta.sanitizedContent.trim());
    lines.push('');

    // Milestone Detailed Analysis Heading
    const detailedHeading = isAr
      ? '## التحليل الفني والأكاديمي المتعمق للمحاور (Deep Milestone Analysis)'
      : '## Detailed Milestone & Thematic Analysis';
    lines.push(detailedHeading);
    lines.push('');

    // Milestone analytical sections
    for (const s of milestoneSections) {
      lines.push(s.sanitizedContent.trim());
      lines.push('');
    }

    // Comparison Matrix fallback if meta synthesis didn't render one
    if (this.options.enableComparisonMatrix !== false && !meta.comparisonMatrix) {
      const matrixHeading = isAr ? '## جدول المقارنة المعيارية وتحليل المفاضلات' : '## Comparative Matrix & Trade-offs';
      lines.push(matrixHeading);
      lines.push('');
      lines.push(this.generateDefaultComparisonTable(milestoneSections, isAr));
      lines.push('');
    }

    // Explicit Contradictions Section if any empirical conflicts were detected and not already called out
    if (contradictions.length > 0 && meta.contradictions.length === 0 && milestoneSections.every(s => s.contradictions.length === 0)) {
      const conflictHeading = isAr ? '## تعارض البيانات والمفاضلات القياسية' : '## Empirical Discrepancies & Contradiction Analysis';
      lines.push(conflictHeading);
      lines.push('');
      for (const c of contradictions) {
        lines.push(formatContradictionCallout({
          topicOrMetric: c.topicOrMetric,
          claims: [
            { sourceIndex: c.sourceA.index, valueOrAssertion: c.sourceA.value, domain: c.sourceA.domain },
            { sourceIndex: c.sourceB.index, valueOrAssertion: c.sourceB.value, domain: c.sourceB.domain }
          ],
          explanation: c.suggestedExplanation,
          language
        }));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private buildContradictionPrompt(contradictions: DetectedContradiction[], language: 'ar' | 'en'): string {
    const isAr = language === 'ar';
    if (contradictions.length === 0) {
      return isAr
        ? `تعليمات رصد التعارضات: في حال وجود أي تضارب بين المصادر في أرقام القياسات أو التواريخ أو النتائج، لا تقم بدمج الأرقام أو التغاضي عنها؛ بل أدرج تنبيهاً صريحاً بتنسيق:
> [!WARNING]
> **تعارض في البيانات**: المصدر [X] يذكر القيمة A بينما المصدر [Y] يذكر القيمة B مع تحليل السبب.`
        : `CONTRADICTION CALLOUT INSTRUCTIONS:
When sources report conflicting benchmarks, numerical measurements, or factual claims:
Do NOT blend or average the numbers. You MUST format an explicit Contradiction Callout as:
> [!WARNING]
> **Contradiction Callout: <Topic>**
> - Source [X] (<domain>): <Claim A>
> - Source [Y] (<domain>): <Claim B>
> *Discrepancy Analysis*: <Reason for variance>`;
    }

    const hints = contradictions.map(c =>
      `- Empirical discrepancy detected between Source [${c.sourceA.index}] (${c.sourceA.value}) and Source [${c.sourceB.index}] (${c.sourceB.value}).`
    ).join('\n');

    return isAr
      ? `تنبيه تعارضات مرصودة مسبقاً في الأدلة:\n${hints}\nيجب تضمين تعارض في البيانات بصيغة > [!WARNING] لتوضيح هذا التباين وأسبابه.`
      : `DETECTED EVIDENCE CONTRADICTIONS:\n${hints}\nYou MUST include a formatted > [!WARNING] Contradiction Callout explaining this discrepancy.`;
  }

  private extractSectionByHeading(text: string, regex: RegExp): string {
    const lines = text.split('\n');
    let capturing = false;
    const captured: string[] = [];

    for (const line of lines) {
      if (regex.test(line)) {
        capturing = true;
        continue;
      }
      if (capturing) {
        if (/^##\s+/.test(line)) break;
        captured.push(line);
      }
    }

    return captured.join('\n').trim();
  }

  private extractTable(text: string): string | undefined {
    const tableRegex = /\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+/;
    const m = text.match(tableRegex);
    return m ? m[0] : undefined;
  }

  /**
   * Track G honest comparison table (SPEC #155): every cell derives from
   * admitted evidence — the milestone query, a verbatim excerpt slice, and
   * its real citations. No invented architectures, metrics, or trade-offs;
   * sections without citations say so explicitly instead of borrowing [1].
   */
  private generateDefaultComparisonTable(sections: MilestoneSectionResult[], isAr: boolean): string {
    const rows = sections.map(s => {
      const citations = s.citedIndices.length > 0
        ? s.citedIndices.map(i => `[${i}]`).join('')
        : (isAr ? '(لا أدلة مستشهد بها)' : '(no cited evidence)');
      const excerpt = s.citedIndices.length > 0
        ? (this.contract.getExcerpt(s.citedIndices[0])?.text.slice(0, 120) ?? '')
        : '';
      const evidenceCell = excerpt ? `${excerpt} ${s.citedIndices.map(i => `[${i}]`).join('')}` : citations;
      return `| ${s.milestoneQuery} | ${evidenceCell} | ${citations} |`;
    });

    if (isAr) {
      return [
        '| المحور التحليلي | الأدلة المعتمدة (حرفياً) | مراجع الأدلة |',
        '|---|---|---|',
        ...rows
      ].join('\n');
    }

    return [
      '| Milestone / Facet | Admitted evidence (verbatim) | Evidence Citations |',
      '|---|---|---|',
      ...rows
    ].join('\n');
  }

  /**
   * Track G uncertain section (SPEC #155): synthesis transport failed but
   * admitted evidence exists. The section keeps its structural heading and
   * reproduces excerpts VERBATIM with their real brackets — no generated
   * claims, no invented metrics, no confidence language. It replaces the
   * deleted fabricating fallback, which wrote authoritative-sounding prose
   * over the same evidence slots.
   */
  private buildUncertainMilestoneSection(
    milestone: PlanMilestone,
    excerpts: GroundedExcerpt[],
    contradictions: DetectedContradiction[],
    isAr: boolean
  ): string {
    const list = excerpts.length > 0 ? excerpts : this.contract.getAllExcerpts().slice(0, 4);

    const lines: string[] = [];
    lines.push(`### ${milestone.query}`);
    lines.push('');
    lines.push(buildUncertainSectionNotice(isAr ? 'ar' : 'en', 'milestone'));
    lines.push('');
    for (const ex of list.slice(0, 4)) {
      const label = isAr ? 'مقتطف موثق حرفياً' : 'Verbatim admitted excerpt';
      lines.push(`- **${label}**: ${ex.text.slice(0, 300)} ${ex.bracket}`);
    }
    lines.push('');

    if (contradictions.length > 0) {
      const c = contradictions[0];
      lines.push(formatContradictionCallout({
        topicOrMetric: c.topicOrMetric,
        claims: [
          { sourceIndex: c.sourceA.index, valueOrAssertion: c.sourceA.value, domain: c.sourceA.domain },
          { sourceIndex: c.sourceB.index, valueOrAssertion: c.sourceB.value, domain: c.sourceB.domain }
        ],
        explanation: c.suggestedExplanation,
        language: isAr ? 'ar' : 'en'
      }));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Track G uncertain meta pass (SPEC #155): same contract as the milestone
   * builder — structural headings preserved (downstream shape contracts),
   * zero generated takeaways. It replaces the deleted fabricating fallback,
   * which asserted invented alignment and confidence over these slots.
   */
  private buildUncertainMetaPass(
    query: string,
    sections: MilestoneSectionResult[],
    contradictions: DetectedContradiction[],
    isAr: boolean
  ): string {
    const lines: string[] = [];

    lines.push(buildUncertainSectionNotice(isAr ? 'ar' : 'en', 'meta'));
    lines.push('');
    if (isAr) {
      lines.push('## ملخص تنفيذي وأبرز المؤشرات (Executive Summary & Key Metrics)');
      lines.push(`- تعذر التوليف الآلي لموضوع "${query}" — المقاييس أدناه هي جرد للأدلة المعتمدة، لا استنتاجات.`);
      lines.push(`- عدد الأقسام التحليلية: ${sections.length} (راجع كل قسم ومقتطفاته الموثقة).`);
    } else {
      lines.push('## Executive Summary & Key Metrics');
      lines.push(`- Automated synthesis of "${query}" is unavailable — the inventory below counts admitted evidence, never findings.`);
      lines.push(`- Analytical sections: ${sections.length} (see each section and its cited excerpts).`);
    }
    lines.push('');
    lines.push('## Comparative Matrix & Trade-offs');
    lines.push('');
    lines.push(this.generateDefaultComparisonTable(sections, isAr));
    lines.push('');
    if (isAr) {
      lines.push('## التوصيات الاستراتيجية والآفاق المستقبلية');
      lines.push('> [!TIP]');
      lines.push('> **توصية إجرائية**: لا توجد توصية مولّدة — راجع المقتطفات الموثقة في كل قسم قبل أي قرار.');
    } else {
      lines.push('## Strategic Recommendations & Outlook');
      lines.push('> [!TIP]');
      lines.push('> **Procedural recommendation**: no generated recommendation exists — review the cited excerpts in each section before any decision.');
    }

    return lines.join('\n');
  }
}

/**
 * Standalone convenience function to execute hierarchical synthesis.
 */
export async function synthesizeHierarchical(
  options: HierarchicalSynthesisOptions
): Promise<HierarchicalSynthesisResult> {
  const synthesis = new HierarchicalSynthesis(options);
  return await synthesis.synthesize();
}
