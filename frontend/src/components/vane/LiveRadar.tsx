import React, { useState } from 'react';
import { 
  Compass, 
  Search, 
  BookOpen, 
  CheckCircle2, 
  Loader2, 
  Layers, 
  ShieldCheck, 
  Terminal, 
  ChevronDown, 
  ChevronUp,
  Globe,
  Sparkles,
  Cpu
} from 'lucide-react';
import { SourceItem, Language, ResearchStep } from '../../types';

interface LiveRadarProps {
  query: string;
  steps: ResearchStep[];
  sources: SourceItem[];
  loading: boolean;
  language: Language;
}

export const LiveRadar: React.FC<LiveRadarProps> = ({
  query,
  steps,
  sources,
  loading,
  language,
}) => {
  const isArabic = language === 'ar';
  const [showTerminal, setShowTerminal] = useState(true);

  // Compute active stage based on steps length & status
  const currentStepText = steps.length > 0 ? steps[steps.length - 1].step : '';
  
  let currentStageIndex = 0;
  if (steps.some(s => s.step.includes('صياغة') || s.step.includes('توليف') || s.step.includes('تقرير'))) {
    currentStageIndex = 4;
  } else if (steps.some(s => s.step.includes('فجوات') || s.step.includes('انعكاس') || s.step.includes('تدقيق'))) {
    currentStageIndex = 3;
  } else if (sources.length > 0) {
    currentStageIndex = 2;
  } else if (steps.some(s => s.step.includes('استعلام') || s.step.includes('تفكيك'))) {
    currentStageIndex = 1;
  }

  const pipelineStages = [
    { label: isArabic ? 'تفكيك المحاور' : 'Query Decomp', icon: Sparkles },
    { label: isArabic ? 'تمشيط الويب' : 'Web Retrieval', icon: Search },
    { label: isArabic ? 'قراءة المصادر' : 'Deep Reading', icon: Globe },
    { label: isArabic ? 'تدقيق الفجوات' : 'Self-Reflection', icon: ShieldCheck },
    { label: isArabic ? 'توليف التقرير' : 'Dossier Synthesis', icon: BookOpen },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface  p-5 space-y-5 select-none animate-fadeIn">
      {/* 1. Header & Live Indicator */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <span>{isArabic ? 'رادار التحري والاستكشاف الذاتي' : 'Autonomous Research Radar'}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                loading ? 'bg-accent/20 text-accent border border-accent/30 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'
              }`}>
                {loading ? (isArabic ? 'نشط ومستمر' : 'LIVE RUNNING') : (isArabic ? 'مكتمل' : 'RESOLVED')}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">
              {currentStepText || query}
            </p>
          </div>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-right rtl:text-left">
            <span className="block text-[10px] text-slate-400 font-mono">{isArabic ? 'المصادر المستخرجة' : 'Sources'}</span>
            <span className="text-xs font-bold text-accent font-mono">{sources.length}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-canvas border border-line text-right rtl:text-left">
            <span className="block text-[10px] text-slate-400 font-mono">{isArabic ? 'خطوات التفكير' : 'Steps'}</span>
            <span className="text-xs font-bold text-accent font-mono">{steps.length}</span>
          </div>
        </div>
      </div>

      {/* 2. Visual 5-Stage Pipeline */}
      <div className="space-y-2">
        <div className="grid grid-cols-5 gap-2">
          {pipelineStages.map((stg, idx) => {
            const Icon = stg.icon;
            const isCompleted = !loading || idx < currentStageIndex;
            const isCurrent = loading && idx === currentStageIndex;
            return (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border text-center space-y-1 transition ${
                  isCurrent 
                    ? 'bg-accent/10 border-accent/50 shadow-[0_0_12px_rgba(56,189,248,0.15)] ring-1 ring-accent/30' 
                    : isCompleted 
                    ? 'bg-panel border-white/5 text-slate-300' 
                    : 'bg-canvas/40 border-white/5 text-slate-600 opacity-60'
                }`}
              >
                <div className="w-5 h-5 rounded-full mx-auto flex items-center justify-center">
                  {isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  ) : isCompleted ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 text-slate-600" />
                  )}
                </div>
                <p className={`text-[10px] font-semibold truncate ${
                  isCurrent ? 'text-accent' : isCompleted ? 'text-slate-300' : 'text-slate-500'
                }`}>
                  {stg.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Live Thought Stream Terminal */}
      <div className="rounded-xl border border-line bg-canvas overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTerminal(!showTerminal)}
          className="w-full px-4 py-2 bg-panel flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-accent" />
            <span className="font-semibold text-slate-300">
              {isArabic ? 'سجل تفكير واستدلال الوكيل المباشر' : 'Live Agent Thought Stream'}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          {showTerminal ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showTerminal && (
          <div className="p-3 max-h-48 overflow-y-auto space-y-2 font-mono text-[11px] custom-scrollbar bg-canvas/90 text-slate-300">
            {steps.length === 0 ? (
              <p className="text-slate-600 italic">{isArabic ? 'بانتظار انطلاق أول خطوة...' : 'Waiting for first execution step...'}</p>
            ) : (
              steps.map((st, i) => (
                <div key={i} className="flex items-start gap-2 leading-relaxed border-b border-white/[0.02] pb-1">
                  <span className="text-accent font-bold shrink-0">›</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-slate-200">{st.step}</span>
                    {st.details && (
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5 leading-normal">
                        {st.details}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
