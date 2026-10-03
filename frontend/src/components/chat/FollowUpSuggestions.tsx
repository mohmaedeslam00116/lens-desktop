import React from 'react';
import { Plus } from 'lucide-react';
import type { Language } from '../../types';

interface FollowUpSuggestionsProps {
  language: Language;
  query: string;
  onFollowUp: (q: string) => void;
}

/**
 * FollowUpSuggestions — compact contextual continuations rendered from the
 * real query (never decorative): compare, risks, takeaways, sources, depth.
 */
export const FollowUpSuggestions: React.FC<FollowUpSuggestionsProps> = ({ language, query, onFollowUp }) => {
  const ar = language === 'ar';
  const short = query.length > 90 ? `${query.slice(0, 90)}…` : query;
  const suggestions = ar
    ? [
        { label: 'قارن الخيارات في جدول', q: `قم بإنشاء جدول مقارنة تفصيلي للخيارات المطروحة في: "${short}"` },
        { label: 'أبرز المخاطر والقيود', q: `ما أهم المخاطر والقيود العملية لـ: "${short}"؟` },
        { label: 'اعرض المصادر', q: `اعرض أهم المصادر والأدلة لـ: "${short}"` },
        { label: 'تعمّق أكثر', q: `تعمّق أكثر في الجوانب التقنية لـ: "${short}"` },
      ]
    : [
        { label: 'Compare options', q: `Create a comparison table of the options in: "${short}"` },
        { label: 'Show the sources', q: `Show the key sources and evidence for: "${short}"` },
        { label: 'Go deeper', q: `Go deeper into the technical aspects of: "${short}"` },
        { label: 'Opposing evidence', q: `Find opposing evidence or limitations for: "${short}"` },
      ];
  return (
    <div className="chat-followups" aria-label={ar ? 'اقتراحات المتابعة' : 'Follow-up suggestions'}>
      {suggestions.map((s) => (
        <button key={s.label} type="button" className="chat-followup-pill" onClick={() => onFollowUp(s.q)}>
          <Plus size={12} aria-hidden="true" />
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
};
