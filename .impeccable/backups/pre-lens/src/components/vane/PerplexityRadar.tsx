import React, { useState } from 'react';
import { 
  Search, 
  Globe, 
  Sparkles, 
  Check, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  ArrowUpRight
} from 'lucide-react';
import { SourceItem, ResearchStep, Language } from '../../types';

interface PerplexityRadarProps {
  query: string;
  steps: ResearchStep[];
  sources: SourceItem[];
  loading: boolean;
  language: Language;
}

export const PerplexityRadar: React.FC<PerplexityRadarProps> = ({
  query,
  steps,
  sources,
  loading,
  language,
}) => {
  const isArabic = language === 'ar';
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAllSources, setShowAllSources] = useState(false);

  const activeStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const domains = Array.from(new Set(sources.map(s => s.domain).filter(Boolean)));

  // Classify step for icon selection
  const getStepIcon = (step: string, isCurrent: boolean) => {
    if (isCurrent) return Loader2;
    if (step.includes('استعلام') || step.includes('تفكيك') || step.includes('تحليل')) return Sparkles;
    if (step.includes('قراءة') || step.includes('تصفح') || step.includes('بحث')) return Globe;
    if (step.includes('فجوات') || step.includes('انعكاس') || step.includes('تدقيق')) return ShieldCheck;
    return Check;
  };

  return (
    <div className="w-full space-y-5 select-none">

      {/* ── Sources inline shelf ── */}
      {sources.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 overflow-x-auto pb-1 scrollbar-hide">
            {sources.slice(0, showAllSources ? sources.length : 5).map((src, i) => {
              const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(src.url)}&sz=32`;
              return (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition-colors duration-150 shrink-0 group"
                >
                  <img 
                    src={faviconUrl} 
                    alt="" 
                    className="w-3.5 h-3.5 rounded-sm shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" 
                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                  />
                  <span className="text-[11.5px] font-medium truncate max-w-[140px]">
                    {src.title || src.domain}
                  </span>
                  <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
                </a>
              );
            })}

            {sources.length > 5 && !showAllSources && (
              <button
                type="button"
                onClick={() => setShowAllSources(true)}
                className="text-[11px] text-slate-500 hover:text-[#2dd4bf] transition-colors font-medium shrink-0 px-2"
              >
                +{sources.length - 5} {isArabic ? 'المزيد' : 'more'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Research progress ── */}
      <div className="space-y-1">
        {/* Header toggle */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2.5 py-2 text-left rtl:text-right group transition-colors"
        >
          {loading ? (
            <div className="w-4 h-4 flex items-center justify-center text-[#2dd4bf]">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <div className="w-4 h-4 flex items-center justify-center text-emerald-400">
              <Check className="w-4 h-4" />
            </div>
          )}

          <span className="text-[13px] font-medium text-slate-200">
            {loading 
              ? (isArabic ? 'جاري التحري والتمحيص...' : 'Researching...') 
              : (isArabic ? 'اكتمل التحري' : 'Research complete')}
          </span>

          <span className="text-[11px] text-slate-500 font-normal">
            {steps.length} {isArabic ? 'خطوات' : 'steps'} · {sources.length} {isArabic ? 'مصادر' : 'sources'}
          </span>

          <div className="flex-1" />

          <ChevronDown 
            className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`} 
          />
        </button>

        {/* Active step preview when collapsed */}
        {!isExpanded && loading && activeStep && (
          <p className="text-[12px] text-slate-500 truncate pr-6 rtl:pr-0 rtl:pl-6 ml-6 rtl:ml-0 rtl:mr-6">
            {activeStep.step}
          </p>
        )}

        {/* Timeline steps */}
        {isExpanded && steps.length > 0 && (
          <div className="pt-1 pb-2">
            <div className={`relative space-y-0 ${isArabic ? 'pr-4' : 'pl-4'}`}>
              {/* Thin dotted vertical connector */}
              <div 
                className={`absolute top-2 bottom-2 w-px border-l border-dotted border-white/[0.08] ${
                  isArabic ? 'right-[7px]' : 'left-[7px]'
                }`} 
              />

              {steps.map((st, idx) => {
                const isCurrent = loading && idx === steps.length - 1;
                const StepIcon = getStepIcon(st.step, isCurrent);

                return (
                  <div key={idx} className="relative flex items-start gap-3 py-1.5">
                    {/* Tiny node dot */}
                    <div 
                      className={`relative z-10 mt-[3px] shrink-0 ${
                        isCurrent 
                          ? 'w-3.5 h-3.5 rounded-full bg-[#2dd4bf] flex items-center justify-center shadow-[0_0_8px_rgba(45,212,191,0.3)]' 
                          : 'w-2 h-2 rounded-full bg-white/[0.12]'
                      }`}
                    >
                      {isCurrent && <Loader2 className="w-2 h-2 text-black animate-spin" />}
                    </div>

                    {/* Step text */}
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12.5px] leading-relaxed ${
                        isCurrent 
                          ? 'text-[#2dd4bf] font-medium' 
                          : 'text-slate-400'
                      }`}>
                        {st.step}
                      </p>

                      {st.details && (
                        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                          {st.details}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Domains scanned — subtle inline */}
        {isExpanded && domains.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap pt-1 ml-4 rtl:ml-0 rtl:mr-4">
            <span className="text-[10.5px] text-slate-600">
              {isArabic ? 'النطاقات:' : 'Domains:'}
            </span>
            {domains.slice(0, 8).map((dom, i) => (
              <span 
                key={i} 
                className="text-[10.5px] text-slate-500"
              >
                {dom}{i < Math.min(domains.length, 8) - 1 ? ',' : ''}
              </span>
            ))}
            {domains.length > 8 && (
              <span className="text-[10.5px] text-slate-600">
                +{domains.length - 8}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── All sources modal ── */}
      {showAllSources && sources.length > 5 && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowAllSources(false)}
        >
          <div 
            className="w-full max-w-xl max-h-[70vh] bg-[#0d1117] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#2dd4bf]" />
                <span className="text-sm font-semibold text-slate-100">
                  {isArabic ? `المصادر (${sources.length})` : `Sources (${sources.length})`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAllSources(false)}
                className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Source list */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1">
              {sources.map((s, idx) => {
                const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(s.url)}&sz=32`;
                return (
                  <a
                    key={idx}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
                  >
                    <img 
                      src={faviconUrl} 
                      alt="" 
                      className="w-4 h-4 rounded-sm shrink-0 opacity-60 group-hover:opacity-100" 
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-slate-300 group-hover:text-slate-100 truncate transition-colors">
                        {s.title || s.url}
                      </p>
                      <p className="text-[11px] text-slate-600 truncate">
                        {s.domain}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
