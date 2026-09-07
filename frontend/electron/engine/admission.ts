/**
 * LENS Deep Research Engine — Stratified Evidence Admission & Multi-Hop Coverage Audit
 * Allocates quota-guaranteed passages per approved milestone (K_min = 8),
 * distributes residual capacity by global hybrid relevance, connects with evidence
 * coverage auditing for smart early exit (>= 80%), and emits honest budget exhaustion
 * telemetry with interactive [Extend Research] action payloads.
 */

import {
  PlanMilestone,
  LiveEvent,
  ResearchExtensionPayload,
  SearchDepth
} from './types';
import {
  auditEvidenceCoverage,
  generateAdaptiveHopPlan,
  CoverageAuditResult,
  AdaptiveHopPlan
} from './evidenceCoverage';

export interface CandidateChunk {
  id: string;
  milestoneId: string;
  text: string;
  sourceUrl: string;
  sourceDomain?: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface AdmittedChunk extends CandidateChunk {
  admittedReason: 'quota' | 'residual';
  admissionRank: number;
}

export interface MilestoneAdmissionStats {
  milestoneId: string;
  milestoneQuery?: string;
  candidateCount: number;
  admittedQuotaCount: number;
  admittedResidualCount: number;
  totalAdmittedCount: number;
  quotaSatisfied: boolean;
  underQuotaShortfall: number;
}

export interface StratifiedAdmissionOptions {
  minQuotaPerMilestone?: number; // K_min (default: 8)
  maxTotalChunks?: number;       // M_max (default: 60)
  coverageThreshold?: number;    // Early exit threshold (default: 0.80)
  currentHop?: number;           // Current retrieval hop (0-based)
  maxHops?: number;              // Maximum allowed hops (default: 2)
  currentSourcesCount?: number;  // Current total ingested sources
  maxSourcesBudget?: number;     // Maximum sources budget (default: 100)
  depth?: SearchDepth | string;  // Research depth tier (default: 'storm')
  language?: 'ar' | 'en';
}

export interface StratifiedAdmissionResult {
  admittedChunks: AdmittedChunk[];
  totalAdmitted: number;
  milestoneStats: Map<string, MilestoneAdmissionStats>;
  coverageAudit: CoverageAuditResult;
  earlyExit: boolean;
  shouldHop: boolean;
  budgetExhausted: boolean;
  hopPlan?: AdaptiveHopPlan;
  extensionPayload?: ResearchExtensionPayload;
  event?: LiveEvent;
}

export class StratifiedEvidenceAdmission {
  private options: Required<StratifiedAdmissionOptions>;

  constructor(options: StratifiedAdmissionOptions = {}) {
    this.options = {
      minQuotaPerMilestone: typeof options.minQuotaPerMilestone === 'number' ? options.minQuotaPerMilestone : 8,
      maxTotalChunks: typeof options.maxTotalChunks === 'number' ? options.maxTotalChunks : 60,
      coverageThreshold: typeof options.coverageThreshold === 'number' ? options.coverageThreshold : 0.80,
      currentHop: typeof options.currentHop === 'number' ? options.currentHop : 0,
      maxHops: typeof options.maxHops === 'number' ? options.maxHops : 2,
      currentSourcesCount: typeof options.currentSourcesCount === 'number' ? options.currentSourcesCount : 0,
      maxSourcesBudget: typeof options.maxSourcesBudget === 'number' ? options.maxSourcesBudget : 100,
      depth: options.depth || 'storm',
      language: options.language || 'en'
    };
  }

  /**
   * Performs stratified facet-aware admission across milestones and residual pool,
   * audits mathematical coverage, and generates early-exit or multi-hop decisions.
   */
  public admit(
    candidates: CandidateChunk[],
    milestonesInput?: PlanMilestone[] | string[] | Array<{ id: string; query?: string }>,
    primaryQuery?: string
  ): StratifiedAdmissionResult {
    const isAr = this.options.language === 'ar' || (primaryQuery && /[\u0600-\u06FF]/.test(primaryQuery));
    const effectiveLang: 'ar' | 'en' = isAr ? 'ar' : 'en';

    // 1. Normalize milestones
    const normalizedMilestones: Array<{ id: string; query: string }> = [];
    if (Array.isArray(milestonesInput) && milestonesInput.length > 0) {
      for (const item of milestonesInput) {
        if (typeof item === 'string') {
          normalizedMilestones.push({ id: item, query: item });
        } else if (item && typeof item === 'object') {
          normalizedMilestones.push({
            id: item.id || (item as any).query || 'default',
            query: item.query || item.id || 'Milestone'
          });
        }
      }
    } else {
      // Derive milestones from unique candidate milestoneIds
      const uniqueMilestoneIds = Array.from(new Set(candidates.map(c => c.milestoneId).filter(Boolean)));
      if (uniqueMilestoneIds.length > 0) {
        for (const mid of uniqueMilestoneIds) {
          normalizedMilestones.push({ id: mid, query: mid });
        }
      } else {
        normalizedMilestones.push({
          id: 'default',
          query: primaryQuery || 'General Research Milestone'
        });
      }
    }

    // 2. Determine effective per-milestone quota with fairness bounding
    // If milestones * minQuota exceeds maxTotalChunks, bound quota proportionally
    // so every milestone gets a fair guaranteed share without exceeding M_max
    const requestedQuota = this.options.minQuotaPerMilestone;
    const maxTotal = this.options.maxTotalChunks;
    const effectiveQuota = (normalizedMilestones.length * requestedQuota > maxTotal)
      ? Math.max(1, Math.floor(maxTotal / normalizedMilestones.length))
      : requestedQuota;

    const admittedChunks: AdmittedChunk[] = [];
    const admittedIds = new Set<string>();
    const milestoneStats = new Map<string, MilestoneAdmissionStats>();

    // Initialize stats map
    for (const m of normalizedMilestones) {
      milestoneStats.set(m.id, {
        milestoneId: m.id,
        milestoneQuery: m.query,
        candidateCount: 0,
        admittedQuotaCount: 0,
        admittedResidualCount: 0,
        totalAdmittedCount: 0,
        quotaSatisfied: false,
        underQuotaShortfall: 0
      });
    }

    let rankCounter = 1;

    // Shared chunk admission helper (eliminates duplicated insertion and rank logic)
    const admitCandidate = (candidate: CandidateChunk, reason: 'quota' | 'residual'): boolean => {
      if (admittedIds.has(candidate.id)) return false;
      admittedIds.add(candidate.id);
      admittedChunks.push({
        ...candidate,
        admittedReason: reason,
        admissionRank: rankCounter++
      });

      const stats = milestoneStats.get(candidate.milestoneId || 'default');
      if (stats) {
        if (reason === 'quota') {
          stats.admittedQuotaCount++;
        } else {
          stats.admittedResidualCount++;
        }
        stats.totalAdmittedCount++;
      }
      return true;
    };

    // 3. Phase 1: Stratified Milestone Quota Allocation (K_min)
    for (const m of normalizedMilestones) {
      const stats = milestoneStats.get(m.id)!;
      // Get all candidates for this milestone
      const milestoneCandidates = candidates.filter(c => (c.milestoneId || 'default') === m.id);
      stats.candidateCount = milestoneCandidates.length;

      // Sort candidate chunks descending by hybrid relevance score
      const sortedCandidates = [...milestoneCandidates].sort((a, b) => b.score - a.score);

      // Admit up to effectiveQuota
      const quotaToAdmit = Math.min(effectiveQuota, sortedCandidates.length);
      for (let i = 0; i < quotaToAdmit; i++) {
        admitCandidate(sortedCandidates[i], 'quota');
      }

      stats.underQuotaShortfall = Math.max(0, effectiveQuota - stats.candidateCount);
      // Quota is satisfied if we admitted effectiveQuota OR admitted all available candidates
      stats.quotaSatisfied = stats.admittedQuotaCount >= effectiveQuota || stats.candidateCount <= effectiveQuota;
    }

    // 4. Phase 2: Residual Capacity Allocation by Global Hybrid Score
    const residualCapacity = Math.max(0, maxTotal - admittedChunks.length);
    if (residualCapacity > 0) {
      // Find all remaining unadmitted candidates across all milestones
      const residualCandidates = candidates
        .filter(c => !admittedIds.has(c.id))
        .sort((a, b) => b.score - a.score);

      const toAdmitFromResidual = Math.min(residualCapacity, residualCandidates.length);
      for (let i = 0; i < toAdmitFromResidual; i++) {
        admitCandidate(residualCandidates[i], 'residual');
      }
    }

    // 5. Phase 3: Evidence Coverage Audit
    const sourcePassages = admittedChunks.map(c => ({
      content: c.text,
      domain: c.sourceDomain
    }));

    const subqueries = normalizedMilestones.map(m => m.query);
    const effectiveQuery = primaryQuery || (subqueries.length > 0 ? subqueries[0] : '');

    const coverageAudit = auditEvidenceCoverage(effectiveQuery, subqueries, sourcePassages, {
      language: effectiveLang
    });

    // 6. Phase 4: Early Exit vs Multi-Hop vs Budget Exhaustion Decision
    let earlyExit = false;
    let shouldHop = false;
    let budgetExhausted = false;
    let hopPlan: AdaptiveHopPlan | undefined = undefined;
    let extensionPayload: ResearchExtensionPayload | undefined = undefined;

    const threshold = this.options.coverageThreshold;
    const isCoverageSatisfied = coverageAudit.overallScore >= threshold;

    if (isCoverageSatisfied) {
      // Smart Early Exit: Evidence satisfies quality threshold
      earlyExit = true;
      shouldHop = false;
      budgetExhausted = false;
    } else {
      // Coverage is below threshold; check budget limits
      const isHopExhausted = this.options.currentHop >= this.options.maxHops;
      const isSourcesExhausted = this.options.currentSourcesCount >= this.options.maxSourcesBudget;

      if (isHopExhausted || isSourcesExhausted) {
        // Honest Budget Exhaustion
        budgetExhausted = true;
        shouldHop = false;
        earlyExit = false;

        const uncoveredMilestones = Array.from(milestoneStats.values())
          .filter(s => s.underQuotaShortfall > 0 || coverageAudit.uncoveredSubqueries.includes(s.milestoneQuery || ''))
          .map(s => s.milestoneId);

        const reason = effectiveLang === 'ar'
          ? `تم استنفاد ميزانية الاسترجاع (القفزات: ${this.options.currentHop}/${this.options.maxHops}، المصادر: ${this.options.currentSourcesCount}/${this.options.maxSourcesBudget}) مع بقاء فجوات في التغطية (${(coverageAudit.overallScore * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%).`
          : `Retrieval budget exhausted (hops: ${this.options.currentHop}/${this.options.maxHops}, sources: ${this.options.currentSourcesCount}/${this.options.maxSourcesBudget}) with remaining coverage gaps (${(coverageAudit.overallScore * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%).`;

        extensionPayload = {
          budgetExhausted: true,
          reason,
          suggestedAdditionalSources: 20,
          suggestedAdditionalHops: 1,
          uncoveredMilestones,
          uncoveredSubqueries: coverageAudit.uncoveredSubqueries,
          missingAspects: coverageAudit.missingAspects,
          actionText: {
            ar: 'توسيع نطاق البحث',
            en: 'Extend Research'
          }
        };
      } else {
        // Budget remains: generate adaptive hop plan
        hopPlan = generateAdaptiveHopPlan(coverageAudit, effectiveQuery, {
          depth: this.options.depth,
          currentHop: this.options.currentHop,
          maxSources: this.options.maxSourcesBudget,
          currentSourcesCount: this.options.currentSourcesCount,
          threshold,
          language: effectiveLang
        });

        shouldHop = hopPlan.shouldHop;
        earlyExit = false;
        budgetExhausted = false;
      }
    }

    const result: StratifiedAdmissionResult = {
      admittedChunks,
      totalAdmitted: admittedChunks.length,
      milestoneStats,
      coverageAudit,
      earlyExit,
      shouldHop,
      budgetExhausted,
      hopPlan,
      extensionPayload
    };

    if (budgetExhausted) {
      result.event = createBudgetExhaustedEvent(result);
    }

    return result;
  }
}

/**
 * Convenience standalone function for stratified evidence admission.
 */
export function admitStratifiedEvidence(
  candidates: CandidateChunk[],
  milestones?: PlanMilestone[] | string[] | Array<{ id: string; query?: string }>,
  primaryQuery?: string,
  options?: StratifiedAdmissionOptions
): StratifiedAdmissionResult {
  const admission = new StratifiedEvidenceAdmission(options);
  return admission.admit(candidates, milestones, primaryQuery);
}

/**
 * Creates a standard LiveEvent representing a budget_exhausted state.
 */
export function createBudgetExhaustedEvent(
  result: StratifiedAdmissionResult,
  sessionId?: string
): LiveEvent {
  return {
    type: 'session_state',
    state: 'budget_exhausted',
    sessionId,
    message: result.extensionPayload?.reason || 'Research budget exhausted with remaining gaps.',
    extensionPayload: result.extensionPayload,
    coverage: {
      overallScore: result.coverageAudit.overallScore,
      subqueryScore: result.coverageAudit.subqueryScore,
      aspectScore: result.coverageAudit.aspectScore,
      metricScore: result.coverageAudit.metricScore,
      diversityScore: result.coverageAudit.diversityScore,
      uncoveredSubqueries: result.coverageAudit.uncoveredSubqueries
    }
  };
}
