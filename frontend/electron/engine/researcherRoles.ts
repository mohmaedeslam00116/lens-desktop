import { ResearchPlan } from './types';

/**
 * researcherRoles.ts — closed 5-role Researcher Role Catalog with
 * deterministic selection and budget-bounded deficit re-specialization
 * (ADR-0010 decision 5, ticket #93).
 *
 * The catalog is CLOSED (the map's five roles; LLM-invented roles are
 * rejected in the ADR — they break prompt/telemetry/parity tractability).
 * The parent selects exactly one role per facet deterministically from the
 * plan text alone: the same plan always yields the same role per facet
 * (no clock, no randomness, no model call).
 *
 * When the coverage audit reports gaps, the parent may spawn additional
 * role-tagged researchers — bounded by the remaining session budget and a
 * hard re-specialization cap so it can never loop (ADR-0010 decision 5).
 */

/** The closed catalog. Order is telemetry-stable. */
export const RESEARCHER_ROLES = [
  'primary',
  'technical',
  'opposing',
  'recent_news',
  'source_verifier',
] as const;

export type ResearcherRole = (typeof RESEARCHER_ROLES)[number];

/** Human-readable role descriptors (bilingual prompt/telemetry surface). */
export const ROLE_LABELS: Record<ResearcherRole, { en: string; ar: string }> = {
  primary: {
    en: 'Generalist web researcher: broad, balanced coverage of the facet',
    ar: 'باحث ويب عام: تغطية واسعة ومتوازنة للجوانب المحورية',
  },
  technical: {
    en: 'Technical deep-dive specialist: mechanisms, benchmarks, specifications, and quantitative detail',
    ar: 'متخصص في التعمق التقني: الآليات والمعايير والمواصفات والتفاصيل الكمية',
  },
  opposing: {
    en: 'Independent/opposing-view researcher: counterarguments, criticism, limitations, and dissenting evidence',
    ar: 'باحث الآراء المستقلة والمضادة: الحجج المضادة والنقد والقيود والأدلة المخالفة',
  },
  recent_news: {
    en: 'Recent-news researcher: latest developments, announcements, and time-stamped updates',
    ar: 'باحث المستجدات: أحدث التطورات والإعلانات والتحديثات المؤرخة',
  },
  source_verifier: {
    en: 'Source verifier: cross-checking claims across independent sources and validating evidence quality',
    ar: 'مدقق المصادر: التحقق المتقاطع من الادعاءات عبر مصادر مستقلة وتقييم جودة الأدلة',
  },
};

/** Keyword tables for deterministic role selection. English + Arabic stems
 * share the tables; matching is over the bilingual tokenizer's stems, so an
 * Arabic facet gets the same role as its English equivalent. */
const ROLE_KEYWORDS: Record<Exclude<ResearcherRole, 'primary'>, string[]> = {
  technical: [
    'benchmark', 'architecture', 'specification', 'mechanism', 'algorithm',
    'performance', 'latency', 'throughput', 'api', 'protocol', 'implement',
    'معمار', 'معيار', 'خوارزم', 'أداء', 'تقني', 'مواصف',
  ],
  opposing: [
    'criticism', 'limitation', 'risk', 'controversy', 'debate', 'opposing',
    'drawback', 'failure', 'security', 'concern', 'skeptic',
    'نقد', 'قيود', 'مخاطر', 'جدل', 'سلبيات', 'تحديات',
  ],
  recent_news: [
    'latest', 'recent', 'news', 'update', 'announcement', 'release', 'launch',
    'trend', '2025', '2026', 'current',
    'أحدث', 'جديد', 'مستجد', 'تطور', 'إعلان',
  ],
  source_verifier: [
    'verify', 'validate', 'credib', 'reliab', 'fact-check', 'accuracy',
    'misinformation', 'authentic', 'cross-check',
    'تحقق', 'مصداق', 'دقة', 'موثوق',
  ],
};

/** Scores each non-primary role by keyword-stem matches over the facet text.
 * Ties resolve by catalog order (deterministic); `primary` wins when no
 * role scores (the balanced default). */
export function selectRoleForFacet(facet: string, tokenize: (text: string) => string[]): ResearcherRole {
  const stems = new Set(tokenize(facet));
  let bestRole: ResearcherRole = 'primary';
  let bestScore = 0;
  // Iterate the catalog in order so ties keep the earlier role — the
  // selection is a pure function of (facet text, catalog order).
  for (const role of RESEARCHER_ROLES) {
    if (role === 'primary') continue;
    const keywords = ROLE_KEYWORDS[role];
    let score = 0;
    for (const kw of keywords) {
      // Keyword tables hold stems/prefixes; a facet stem matches when it
      // starts with the keyword stem (bilingual tokenizer output).
      for (const stem of stems) {
        if (stem.startsWith(kw) || kw.startsWith(stem)) {
          score += 1;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }
  return bestRole;
}

/** Deterministic role per facet for a whole plan (facet order = plan order). */
export function assignRoles(plan: ResearchPlan, tokenize: (text: string) => string[]): ResearcherRole[] {
  return plan.milestones.map((m) => selectRoleForFacet(m.query, tokenize));
}

/** Bilingual per-role prompt paragraph (researcher brief parameterization). */
export function roleBrief(role: ResearcherRole, language: 'ar' | 'en'): string {
  const label = ROLE_LABELS[role][language];
  if (language === 'ar') {
    return `دورك المخصص: ${label}. اضبط بحثك وفق هذا الدور.`;
  }
  return `Your assigned specialist role: ${label}. Tailor your investigation to this role.`;
}

/** Bounded re-specialization planning (ADR-0010 decision 5): given per-facet
 * coverage scores from the fan-out, proposes additional role-tagged
 * researchers for deficit facets — mapped from the deficit KIND, capped by
 * the remaining budget, and bounded by `maxRespecializations` so it can
 * never loop.
 *
 * Deterministic: deficit facets are visited in plan order; one extra
 * researcher per deficit facet per pass. */
export function planRespecialization(input: {
  coverageByFacet: Record<string, number>;
  facetRoles: Array<{ facetIndex: number; facet: string; role: ResearcherRole }>;
  existingRoleCounts: Record<ResearcherRole, number>;
  coverageThreshold?: number;
  maxRespecializations?: number;
}): Array<{ facetIndex: number; facet: string; role: ResearcherRole; reason: string }> {
  const threshold = input.coverageThreshold ?? 0.5;
  const max = input.maxRespecializations ?? 4;
  const proposals: Array<{ facetIndex: number; facet: string; role: ResearcherRole; reason: string }> = [];

  for (const { facetIndex, facet, role } of input.facetRoles) {
    if (proposals.length >= max) break;
    // Unmeasured coverage (the facet produced no evidence at all) counts as
    // a full deficit — it must trigger re-specialization, not be skipped.
    const coverage = input.coverageByFacet[facet] ?? 0;
    // Only deficit facets (no evidence, or below threshold).
    if (coverage >= threshold) continue;

    // Deficit-kind → follow-up role mapping (deterministic):
    //  - zero coverage: broaden or deepen — a non-primary role retries as
    //    primary (broader brief); a primary that found nothing escalates to
    //    a technical deep-dive;
    //  - partial coverage from a technical/verifier pass → source_verifier
    //    (quality-check what was found);
    //  - other partial coverage → technical deep-dive (fill the gap).
    let followUp: ResearcherRole;
    if (coverage === 0) {
      followUp = role === 'primary' ? 'technical' : 'primary';
    } else if (role === 'technical' || role === 'source_verifier') {
      followUp = 'source_verifier';
    } else {
      followUp = 'technical';
    }
    proposals.push({
      facetIndex,
      facet,
      role: followUp,
      reason: `coverage deficit (${Math.round(coverage * 100)}% < ${Math.round(threshold * 100)}%)`,
    });
  }
  return proposals;
}
