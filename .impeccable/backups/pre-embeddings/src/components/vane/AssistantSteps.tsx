import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, Search, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { ResearchStep, Language } from '../../types';

interface AssistantStepsProps {
  steps: ResearchStep[];
  loading: boolean;
  language: Language;
}

export const AssistantSteps: React.FC<AssistantStepsProps> = ({ steps, loading, language }) => {
  const isArabic = language === 'ar';
  const [isExpanded, setIsExpanded] = useState(true);

  if (!steps || steps.length === 0) {
    if (!loading) return null;
    return (
      <div className="flex items-center gap-2.5 p-3 rounded-xl bg-panel border border-line text-xs text-slate-400">
        <Loader2 className="w-4 h-4 text-accent animate-spin" />
        <span>{isArabic ? 'جاري بدء استكشاف الموضوع وتوليد الاستعلامات...' : 'Initiating research and query decomposition...'}</span>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl bg-panel border border-line overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-center justify-between text-left rtl:text-right hover:bg-line/50 transition"
      >
        <div className="flex items-center gap-2.5">
          <Brain className="w-4 h-4 text-accent" />
          <span className="text-xs font-semibold text-slate-200">
            {isArabic ? `مسار التفكير والاستدلال (${steps.length} خطوات)` : `Research Progress (${steps.length} steps)`}
          </span>
          {loading && (
            <span className="flex items-center gap-1 text-[11px] text-accent font-mono">
              <Loader2 className="w-3 h-3 animate-spin" />
              {isArabic ? 'جاري التنفيذ...' : 'Live'}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t border-line/60 space-y-2">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const isThinkingStep = step.step.toLowerCase().includes('reflect') || step.step.toLowerCase().includes('فجوة') || step.step.toLowerCase().includes('تأمل');
            
            return (
              <div key={idx} className="flex items-start gap-2.5 text-xs">
                {isLast && loading ? (
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0 mt-0.5" />
                ) : isThinkingStep ? (
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className={`leading-relaxed ${isLast && loading ? 'text-accent font-medium' : isThinkingStep ? 'text-amber-200/90' : 'text-slate-300'}`}>
                    {step.step}
                  </p>
                  {step.details && (
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5 leading-normal">
                      {step.details}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
