/**
 * abstention.ts — LENS evidence-honesty seam (Track G, SPEC #155).
 *
 * Zero-evidence and unresolved-conflict runs surface unsupported/uncertain
 * instead of dossiers. This module is pure (no I/O, no imports): the
 * standard loop, HierarchicalSynthesis, and wide mode all build the same
 * abstention report from it, so the honesty contract cannot drift per path.
 *
 * The machine-readable marker (`ABSTAIN_MARKER`) rides an HTML comment:
 * invisible in render, trivial to assert, and — critically — it contains
 * no citation brackets, so a marker-presence + no-brackets assertion proves
 * a run emitted honesty instead of a dossier.
 */

export const ABSTAIN_MARKER = '<!-- lens:abstain=no-evidence -->';

export type AbstainReason = 'no-evidence';

export interface AbstentionInput {
  query: string;
  language?: 'ar' | 'en' | string;
  reason?: AbstainReason;
  /** How many retrieval attempts ran (searches + hops); 0 when unknown. */
  attempts?: number;
}

/**
 * Builds the no-evidence abstention report. Bilingual, bounded, and
 * bracket-free by construction: no citation indices are ever emitted, so
 * there is nothing for the grounding contract to verify and nothing a
 * reader can mistake for a sourced claim.
 */
export function buildAbstentionReport(input: AbstentionInput): string {
  const query = typeof input?.query === 'string' && input.query.trim() ? input.query.trim() : 'untitled query';
  const isAr = input?.language === 'ar' || /[\u0600-\u06FF]/.test(query);
  const attempts = typeof input?.attempts === 'number' && input.attempts > 0 ? input.attempts : 0;

  if (isAr) {
    const lines = [
      `# تعذر إعداد تقرير موثق: ${query}`,
      '',
      '> [!WARNING]',
      '> **غير مدعوم بأدلة — Unsupported**: لم يعثر البحث على أي مصدر قابل للتوثيق لهذا الموضوع، لذا لا يوجد تقرير استقصائي. هذا الإشعار الصريح يحل محل أي dossier — عدم وجود أدلة لا يُترجم إلى استنتاجات.',
      '',
      attempts > 0
        ? `نُفذت ${attempts} من محاولات الاسترجاع دون قبول أي مصدر (فشل النقل، أو حظر الوصول، أو غياب نتائج قابلة للتحليل).`
        : 'لم تُقبل أي مصادر من مراحل الاسترجاع (فشل النقل، أو حظر الوصول، أو غياب نتائج قابلة للتحليل).',
      '',
      '## الخطوات التالية المقترحة',
      '',
      '- أعد صياغة السؤال بتفصيل أكبر أو نطاق أضيق ثم أعد تشغيل البحث.',
      '- تحقق من توفر المصادر حول الموضوع عبر بحث ويب مباشر.',
      '- وسّع ميزانية الاسترجاع (المصادر والقفزات) ثم أعد المحاولة.',
      '',
      ABSTAIN_MARKER,
    ];
    return lines.join('\n');
  }

  const lines = [
    `# Unsupported — no verifiable report: ${query}`,
    '',
    '> [!WARNING]',
    '> **Unsupported / Uncertain**: retrieval admitted zero documentable sources for this topic, so there is no research dossier. This explicit notice replaces any report — absence of evidence is not translated into findings.',
    '',
    attempts > 0
      ? `${attempts} retrieval attempt(s) ran with zero admitted sources (transport failure, access blocks, or no parseable results).`
      : 'No sources were admitted at any retrieval stage (transport failure, access blocks, or no parseable results).',
    '',
    '## Suggested next steps',
    '',
    '- Restate the question with more detail or a narrower scope, then re-run research.',
    '- Check source availability on the topic with a direct web search.',
    '- Extend the retrieval budget (sources and hops) and retry.',
    '',
    ABSTAIN_MARKER,
  ];
  return lines.join('\n');
}

/**
 * Builds the uncertain-section notice used when synthesis itself fails
 * (dead generator/LLM) but admitted evidence exists: the section lists
 * verbatim excerpts with their real brackets and makes no claim of its
 * own. Verbatim + cited is honest; synthesized-sounding is not.
 */
export function buildUncertainSectionNotice(language: 'ar' | 'en', kind: 'milestone' | 'meta'): string {
  const scope = kind === 'milestone' ? 'section' : 'overview';
  const scopeAr = kind === 'milestone' ? 'القسم' : 'التوليف العام';
  if (language === 'ar') {
    return [
      '> [!WARNING]',
      `> **غير مؤكد — synthesis unavailable**: تعذر توليد ${scopeAr} التحليلي آلياً، لذا تُعرض الأدلة المعتمدة حرفياً دون استنتاجات مولّدة. أي سطر خارج الاقتباسات الموثقة هو وصف إجرائي، لا ادعاء بحثي.`,
      `> **Uncertain ${scope}**: synthesis transport failed; admitted evidence is reproduced verbatim with no generated conclusions.`,
    ].join('\n');
  }
  return [
    '> [!WARNING]',
    `> **Uncertain ${scope} — synthesis unavailable**: the analytical ${scope} could not be generated, so admitted evidence is reproduced verbatim with no generated conclusions. Prose outside the cited excerpts is procedural, never a research claim.`,
  ].join('\n');
}

/** True when a finished report is an abstention rather than a dossier. */
export function isAbstentionReport(report: unknown): boolean {
  return typeof report === 'string' && report.includes(ABSTAIN_MARKER);
}
