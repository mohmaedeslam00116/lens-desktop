import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowRight, 
  Zap, 
  Sliders, 
  Sparkles, 
  Globe, 
  GraduationCap, 
  MessageSquare, 
  Cpu, 
  ChevronDown,
  Loader2,
  Table,
  ShieldCheck,
  TrendingUp,
  Boxes
} from 'lucide-react';
import { Language, ApiSettings } from '../../types';

interface EmptyChatMessageInputProps {
  query: string;
  setQuery: (q: string) => void;
  onSubmit: () => void;
  loading: boolean;
  language: Language;
  settings: ApiSettings;
  onOpenSettings: () => void;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  setOptimizationMode: (m: 'speed' | 'balanced' | 'quality') => void;
  sourceFocus: 'web' | 'academic' | 'social';
  setSourceFocus: (f: 'web' | 'academic' | 'social') => void;
}

export const EmptyChatMessageInput: React.FC<EmptyChatMessageInputProps> = ({
  query,
  setQuery,
  onSubmit,
  loading,
  language,
  settings,
  onOpenSettings,
  optimizationMode,
  setOptimizationMode,
  sourceFocus,
  setSourceFocus,
}) => {
  const isArabic = language === 'ar';
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showOptMenu, setShowOptMenu] = useState(false);
  const [showFocusMenu, setShowFocusMenu] = useState(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (query.trim() && !loading) {
        onSubmit();
      }
    }
  };

  const workflowChips = isArabic ? [
    {
      icon: Table,
      label: 'مقارنة معيارية وجداول',
      action: () => {
        setOptimizationMode('quality');
        if (!query.includes('مقارنة')) {
          setQuery(query ? `مقارنة معيارية شاملة في جداول لـ: ${query}` : 'مقارنة معيارية شاملة وجداول تحليلية لـ ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: Boxes,
      label: 'تحليل معماري وهندسي',
      action: () => {
        setOptimizationMode('quality');
        setSourceFocus('academic');
        if (!query.includes('تحليل')) {
          setQuery(query ? `تحليل معماري وهندسي متعمق مع مخططات تدفق لـ: ${query}` : 'تحليل معماري وهندسي مفصل مع مخططات لـ ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: TrendingUp,
      label: 'دراسة سوق وجدوى',
      action: () => {
        setOptimizationMode('balanced');
        if (!query.includes('سوق')) {
          setQuery(query ? `تحليل الجدوى الاقتصادية وسلاسل القيمة وسوق: ${query}` : 'تحليل سوق وجدوى تجارية لـ ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: ShieldCheck,
      label: 'تدقيق أمني ومخاطر',
      action: () => {
        setOptimizationMode('quality');
        if (!query.includes('مخاطر')) {
          setQuery(query ? `فحص أمني وتحليل الثغرات والمخاطر التشغيلية لـ: ${query}` : 'فحص أمني وتحليل مخاطر لـ ');
        }
        textareaRef.current?.focus();
      }
    },
  ] : [
    {
      icon: Table,
      label: 'Comparison Matrix & Tables',
      action: () => {
        setOptimizationMode('quality');
        if (!query.includes('comparison')) {
          setQuery(query ? `Comprehensive comparison matrix and data tables for: ${query}` : 'Comprehensive comparison matrix and data tables for ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: Boxes,
      label: 'Technical Deep Dive',
      action: () => {
        setOptimizationMode('quality');
        setSourceFocus('academic');
        if (!query.includes('architecture')) {
          setQuery(query ? `In-depth technical architecture breakdown for: ${query}` : 'In-depth technical architecture for ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: TrendingUp,
      label: 'Market & Feasibility',
      action: () => {
        setOptimizationMode('balanced');
        if (!query.includes('market')) {
          setQuery(query ? `Market dynamics, commercial feasibility, and supply chain analysis of: ${query}` : 'Market dynamics and feasibility of ');
        }
        textareaRef.current?.focus();
      }
    },
    {
      icon: ShieldCheck,
      label: 'Security & Risk Audit',
      action: () => {
        setOptimizationMode('quality');
        if (!query.includes('security')) {
          setQuery(query ? `Security audit, vulnerability vectors, and operational risks of: ${query}` : 'Security and risk audit of ');
        }
        textareaRef.current?.focus();
      }
    },
  ];

  const optModes = [
    {
      id: 'speed' as const,
      title: isArabic ? 'فائق السرعة (Speed)' : 'Speed Mode',
      desc: isArabic ? 'استجابة فورية وتوليف موجز بأقل زمن' : 'Quickest possible answer',
      icon: Zap,
      color: 'text-amber-400',
    },
    {
      id: 'balanced' as const,
      title: isArabic ? 'متوازن (Balanced)' : 'Balanced Mode',
      desc: isArabic ? 'توازن مثالي بين السرعة وتغطية المصادر' : 'Balanced speed and depth',
      icon: Sliders,
      color: 'text-emerald-400',
    },
    {
      id: 'quality' as const,
      title: isArabic ? 'بحث عميق (STORM Quality)' : 'STORM Deep Mode',
      desc: isArabic ? 'تعدد رؤى، تفكيك استعلامات، وتوليد جداول عند الحاجة' : 'Multi-perspective deep research',
      icon: Sparkles,
      color: 'text-[#2dd4bf]',
    },
  ];

  const focusModes = [
    {
      id: 'web' as const,
      title: isArabic ? 'بحث الويب الشامل' : 'All Web Index',
      icon: Globe,
    },
    {
      id: 'academic' as const,
      title: isArabic ? 'أكاديمي وأوراق بحثية' : 'Academic & Papers',
      icon: GraduationCap,
    },
    {
      id: 'social' as const,
      title: isArabic ? 'نقاشات ومجتمعات تقنية' : 'Community Discussions',
      icon: MessageSquare,
    },
  ];

  const currentOpt = optModes.find(m => m.id === optimizationMode) || optModes[2];
  const currentFocus = focusModes.find(f => f.id === sourceFocus) || focusModes[0];
  const OptIcon = currentOpt.icon;
  const FocusIcon = currentFocus.icon;

  const modelLabel = settings.custom_model_name || settings.model_name || settings.llm_provider;

  return (
    <div className="w-full space-y-4 select-none">
      {/* 1. Quick Workflow Template Chips */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {workflowChips.map((chip, idx) => {
          const ChipIcon = chip.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={chip.action}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors active:scale-95"
            >
              <ChipIcon className="w-3.5 h-3.5 text-[#2dd4bf] opacity-80" />
              <span>{chip.label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Main Search Command Card */}
      <div className="flex flex-col bg-[#111620] px-4 pt-4 pb-3 rounded-2xl w-full border border-white/[0.08] hover:border-white/[0.14] focus-within:border-[#2dd4bf]/40 focus-within:ring-2 focus-within:ring-[#2dd4bf]/10 shadow-xl shadow-black/30 transition-all duration-200">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder={isArabic ? 'ما الذي ترغب في استكشافه وتفكيكه والبحث عنه بعمق اليوم؟' : 'Ask anything to begin autonomous deep research...'}
          className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-sm leading-relaxed resize-none focus:outline-none"
        />

        {/* Action Controls Toolbar */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.05]">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Optimization Selector Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowOptMenu(!showOptMenu);
                  setShowFocusMenu(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 text-xs font-medium transition hover:text-white border border-white/[0.06]"
                title="عمق وسرعة البحث"
              >
                <OptIcon className={`w-3.5 h-3.5 ${currentOpt.color}`} />
                <span>{currentOpt.title.split(' ')[0]}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              {showOptMenu && (
                <div className="absolute left-0 rtl:left-auto rtl:right-0 bottom-full mb-2 w-64 p-1.5 bg-[#111620] border border-white/[0.1] rounded-xl shadow-2xl z-40 space-y-1 backdrop-blur-md">
                  {optModes.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setOptimizationMode(opt.id);
                          setShowOptMenu(false);
                        }}
                        className={`w-full p-2 rounded-lg text-left rtl:text-right flex items-start gap-2.5 transition ${
                          optimizationMode === opt.id ? 'bg-white/[0.08] text-white font-medium' : 'hover:bg-white/[0.04] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${opt.color}`} />
                        <div>
                          <p className="text-xs font-medium leading-none mb-1 text-slate-200">{opt.title}</p>
                          <p className="text-[11px] text-slate-500 leading-tight">{opt.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sources Focus Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowFocusMenu(!showFocusMenu);
                  setShowOptMenu(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 text-xs font-medium transition hover:text-white border border-white/[0.06]"
                title="نطاق المصادر المستهدفة"
              >
                <FocusIcon className="w-3.5 h-3.5 text-[#2dd4bf]" />
                <span>{currentFocus.title}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              {showFocusMenu && (
                <div className="absolute left-0 rtl:left-auto rtl:right-0 bottom-full mb-2 w-56 p-1.5 bg-[#111620] border border-white/[0.1] rounded-xl shadow-2xl z-40 space-y-1 backdrop-blur-md">
                  {focusModes.map((f) => {
                    const Icon = f.icon;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setSourceFocus(f.id);
                          setShowFocusMenu(false);
                        }}
                        className={`w-full p-2 rounded-lg text-left rtl:text-right flex items-center gap-2.5 transition ${
                          sourceFocus === f.id ? 'bg-white/[0.08] text-white font-medium' : 'hover:bg-white/[0.04] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4 text-[#2dd4bf] shrink-0" />
                        <span className="text-xs font-medium">{f.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Model Pill */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 text-xs transition border border-white/[0.06]"
              title="تغيير أو تخصيص النموذج"
            >
              <Cpu className="w-3.5 h-3.5 text-[#2dd4bf]" />
              <span className="truncate max-w-[130px] font-mono text-[11px]">{modelLabel}</span>
            </button>
          </div>

          {/* Submit Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!query.trim() || loading}
              onClick={onSubmit}
              className="w-8 h-8 rounded-full bg-[#2dd4bf] hover:bg-[#2dd4bf]/90 text-slate-950 disabled:opacity-30 disabled:hover:bg-[#2dd4bf] flex items-center justify-center transition shadow-md shadow-[#2dd4bf]/20 active:scale-95 shrink-0"
              title={isArabic ? 'بدء البحث العميق (Enter)' : 'Start Research (Enter)'}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
