import * as crypto from 'crypto';
import {
  PlanMilestone,
  PlanScopingOptions,
  ResearchPlan
} from './types';

/**
 * Standard candidate skill catalog for LENS autonomous research agents.
 */
export const AVAILABLE_RESEARCH_SKILLS = [
  {
    id: 'academic-paper-analysis',
    name: { en: 'Academic Literature & Citation Analysis', ar: 'تحليل الأوراق الأكاديمية والمراجع' },
    description: { en: 'Extracts findings, methodologies, and formal citations from scholarly literature.', ar: 'استخلاص النتائج والمنهجيات والاستشهادات من الأدبيات العلمية.' }
  },
  {
    id: 'empirical-data-extraction',
    name: { en: 'Empirical Data & Quantitative Extraction', ar: 'استخراج البيانات الكمية والإحصائية' },
    description: { en: 'Pinpoints statistics, benchmarks, percentages, and empirical measurements.', ar: 'تحديد الإحصاءات والمقاييس والنسب المئوية والقياسات الميدانية.' }
  },
  {
    id: 'comparative-synthesis',
    name: { en: 'Comparative Synthesis & Trade-offs', ar: 'المقارنة المعيارية وتحليل المفاضلات' },
    description: { en: 'Structures side-by-side matrices comparing approaches, paradigms, or products.', ar: 'بناء جداول مقارنة منهجية بين النماذج والتقنيات المختلفة.' }
  },
  {
    id: 'bilingual-cross-lingual-bridge',
    name: { en: 'Bilingual Cross-Lingual Terminology Bridge', ar: 'جسر المصطلحات ثنائي اللغة' },
    description: { en: 'Expands Arabic technical queries into English academic equivalents and vice versa.', ar: 'توسيع المصطلحات التقنية بين العربية والإنجليزية لتعزيز دقة الاسترجاع.' }
  },
  {
    id: 'web-retrieval-curator',
    name: { en: 'High-Credibility Web Curator', ar: 'انتقاء وتوثيق مصادر الويب الموثوقة' },
    description: { en: 'Filters out low-signal domains and prioritizes primary documentation.', ar: 'استبعاد المواقع الإعلانية والتركيز على الوثائق والمصادر الأصلية.' }
  }
];

/**
 * Generates a versioned 4-element ResearchPlan (objective, milestones, suggestedSkills, estimatedScope)
 * for Phase 1 collaborative research plan scoping.
 */
export async function generateResearchPlan(
  query: string,
  options?: PlanScopingOptions,
  llmClient?: any
): Promise<ResearchPlan> {
  const trimmed = query.trim();
  const isArabic = options?.language === 'ar' || /[\u0600-\u06FF]/.test(trimmed);

  // 1. Determine suggested skills based on inquiry domain
  const suggestedSkills = suggestSkillsForQuery(trimmed, isArabic);

  // 2. Generate initial milestones
  let milestones: PlanMilestone[] = [];
  if (llmClient && typeof llmClient.complete === 'function') {
    try {
      milestones = await generateMilestonesWithLLM(trimmed, isArabic, llmClient);
    } catch {
      milestones = generateDeterministicMilestones(trimmed, isArabic);
    }
  } else {
    milestones = generateDeterministicMilestones(trimmed, isArabic);
  }

  // 3. Define estimated scope
  const isWide = options?.mode === 'wide' || options?.reportType === 'storm';
  const targetSources = options?.targetSources !== undefined
    ? options.targetSources
    : (isWide ? 100 : 30);
  const maxHops = options?.maxHops !== undefined
    ? options.maxHops
    : (isWide ? 2 : 1);

  const plan: ResearchPlan = {
    id: crypto.randomUUID(),
    version: 1,
    objective: trimmed,
    milestones,
    suggestedSkills,
    estimatedScope: {
      targetSources,
      maxHops
    },
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  return plan;
}

/**
 * Regenerates an existing ResearchPlan, incrementing version counter and refining milestones.
 */
export async function regenerateResearchPlan(
  previousPlan: ResearchPlan,
  modifier?: string,
  options?: PlanScopingOptions,
  llmClient?: any
): Promise<ResearchPlan> {
  const isArabic = options?.language === 'ar' || /[\u0600-\u06FF]/.test(previousPlan.objective);
  const modifierSuffix = modifier ? ` (${modifier})` : '';

  let refinedMilestones: PlanMilestone[] = [];
  if (modifier && modifier.trim().length > 0) {
    // Incorporate user feedback into milestone queries
    refinedMilestones = previousPlan.milestones.map((m, idx) => ({
      ...m,
      id: `m-${previousPlan.version + 1}-${idx + 1}`,
      query: `${m.query} - ${modifier.trim()}`,
      status: 'pending' as const
    }));
  } else {
    refinedMilestones = generateDeterministicMilestones(previousPlan.objective, isArabic).map((m, idx) => ({
      ...m,
      id: `m-${previousPlan.version + 1}-${idx + 1}`
    }));
  }

  const updatedSkills = options?.language === 'ar' || isArabic
    ? Array.from(new Set([...previousPlan.suggestedSkills, 'bilingual-cross-lingual-bridge']))
    : previousPlan.suggestedSkills;

  return {
    ...previousPlan,
    version: previousPlan.version + 1,
    objective: previousPlan.objective,
    milestones: refinedMilestones,
    suggestedSkills: updatedSkills,
    estimatedScope: {
      targetSources: options?.targetSources !== undefined ? options.targetSources : previousPlan.estimatedScope.targetSources,
      maxHops: options?.maxHops !== undefined ? options.maxHops : previousPlan.estimatedScope.maxHops
    },
    status: 'draft',
    updatedAt: Date.now()
  };
}

/**
 * Validates a ResearchPlan structure against required acceptance criteria.
 */
export function validateResearchPlan(plan: ResearchPlan): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plan.id || typeof plan.id !== 'string' || plan.id.trim() === '') {
    errors.push('Plan must have a non-empty string ID');
  }

  if (typeof plan.version !== 'number' || plan.version < 1) {
    errors.push('Plan version must be a positive integer >= 1');
  }

  if (!plan.objective || typeof plan.objective !== 'string' || plan.objective.trim() === '') {
    errors.push('Plan objective must be a non-empty string');
  }

  if (!Array.isArray(plan.milestones) || plan.milestones.length === 0) {
    errors.push('Plan must contain at least one milestone');
  } else {
    for (let i = 0; i < plan.milestones.length; i++) {
      const m = plan.milestones[i];
      if (!m.id || !m.query || !m.rationale) {
        errors.push(`Milestone at index ${i} is missing required fields (id, query, or rationale)`);
      }
    }
  }

  if (!Array.isArray(plan.suggestedSkills)) {
    errors.push('Plan suggestedSkills must be an array');
  }

  if (
    !plan.estimatedScope ||
    typeof plan.estimatedScope.targetSources !== 'number' ||
    plan.estimatedScope.targetSources <= 0 ||
    typeof plan.estimatedScope.maxHops !== 'number' ||
    plan.estimatedScope.maxHops < 0
  ) {
    errors.push('Plan estimatedScope must contain targetSources > 0 and maxHops >= 0');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Deterministic skill suggestion heuristic based on query content and language.
 */
export function suggestSkillsForQuery(query: string, isArabic: boolean): string[] {
  const qLower = query.toLowerCase();
  const skills = new Set<string>();

  // Always include high-credibility web curator as baseline
  skills.add('web-retrieval-curator');

  if (isArabic) {
    skills.add('bilingual-cross-lingual-bridge');
  }

  if (
    qLower.includes('benchmark') ||
    qLower.includes('vs') ||
    qLower.includes('versus') ||
    qLower.includes('compare') ||
    qLower.includes('comparison') ||
    query.includes('مقارنة') ||
    query.includes('مقارنات')
  ) {
    skills.add('comparative-synthesis');
    skills.add('empirical-data-extraction');
  }

  if (
    qLower.includes('paper') ||
    qLower.includes('academic') ||
    qLower.includes('scholar') ||
    qLower.includes('study') ||
    qLower.includes('journal') ||
    qLower.includes('algorithm') ||
    qLower.includes('scaling') ||
    qLower.includes('mechanism') ||
    query.includes('بحث') ||
    query.includes('دراسة') ||
    query.includes('أكاديمي')
  ) {
    skills.add('academic-paper-analysis');
  }

  if (
    qLower.includes('empirical') ||
    qLower.includes('data') ||
    qLower.includes('metric') ||
    qLower.includes('percent') ||
    qLower.includes('market') ||
    qLower.includes('financial') ||
    query.includes('بيانات') ||
    query.includes('إحصائيات') ||
    query.includes('أرقام')
  ) {
    skills.add('empirical-data-extraction');
  }

  return Array.from(skills);
}

/**
 * Deterministic milestone generation covering 4 core research axes.
 */
function generateDeterministicMilestones(query: string, isArabic: boolean): PlanMilestone[] {
  if (isArabic) {
    return [
      {
        id: 'm-1',
        query: `${query} - المفاهيم والأسس النظرية`,
        rationale: 'تأسيس الإطار النظري وتحديد المفاهيم والمصطلحات الجوهرية للموضوع.',
        status: 'pending'
      },
      {
        id: 'm-2',
        query: `${query} - البنية التقنية وآليات العمل الأساسية`,
        rationale: 'استقصاء المعمارية التقنية، الخوارزميات، وآليات التنفيذ العملية.',
        status: 'pending'
      },
      {
        id: 'm-3',
        query: `${query} - المقارنات المعيارية ونتائج التجارب العملية`,
        rationale: 'تحليل مقاييس الأداء والمقارنة مع البدائل والحلول المنافسة.',
        status: 'pending'
      },
      {
        id: 'm-4',
        query: `${query} - التحديات التقنية والاتجاهات المستقبلية`,
        rationale: 'رصد القيود الراهنة، الفجوات المفتوحة، وتوجهات التطوير القادمة.',
        status: 'pending'
      }
    ];
  }

  return [
    {
      id: 'm-1',
      query: `${query} foundational principles and core concepts`,
      rationale: 'Establish core terminology, foundational paradigms, and domain background.',
      status: 'pending'
    },
    {
      id: 'm-2',
      query: `${query} technical architecture and operational mechanisms`,
      rationale: 'Investigate architectural specifications, system designs, and underlying mechanisms.',
      status: 'pending'
    },
    {
      id: 'm-3',
      query: `${query} empirical benchmarks and performance trade-offs`,
      rationale: 'Synthesize quantitative benchmark results, comparative metrics, and trade-offs.',
      status: 'pending'
    },
    {
      id: 'm-4',
      query: `${query} key limitations challenges and future directions`,
      rationale: 'Examine known limitations, open research challenges, and prospective roadmaps.',
      status: 'pending'
    }
  ];
}

/**
 * LLM-based milestone generator with prompt formatting and JSON parsing.
 */
async function generateMilestonesWithLLM(
  query: string,
  isArabic: boolean,
  llmClient: any
): Promise<PlanMilestone[]> {
  const prompt = isArabic
    ? `أنت باحث أكاديمي واستقصائي رفيع المستوى. قسّم موضوع البحث التالي إلى 3 إلى 4 محاور بحثية أساسية:
الموضوع: "${query}"
أجب بصيغة JSON فقط كقائمة من الكائنات بالصيغة:
[{"id": "m-1", "query": "...", "rationale": "..."}]`
    : `You are an elite research scoping agent. Decompose the following inquiry into 3 to 4 distinct research milestones:
Query: "${query}"
Respond ONLY with a valid JSON array of objects:
[{"id": "m-1", "query": "...", "rationale": "..."}]`;

  const response = await llmClient.complete(prompt);
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON array from LLM response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.map((item: any, idx: number) => ({
    id: item.id || `m-${idx + 1}`,
    query: String(item.query || query),
    rationale: String(item.rationale || 'Targeted research milestone'),
    status: 'pending'
  }));
}
