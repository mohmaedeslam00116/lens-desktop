import React from 'react';
import { Compass, ArrowUpRight } from 'lucide-react';
import { EmptyChatMessageInput } from './EmptyChatMessageInput';
import { Language, ApiSettings } from '../../types';
import { BrandLogo } from '../brand/BrandLogo';

interface EmptyChatProps {
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

export const EmptyChat: React.FC<EmptyChatProps> = (props) => {
  const isArabic = props.language === 'ar';

  const suggestionPills = isArabic ? [
    { title: 'معمارية الذكاء الاصطناعي ونماذج التفكير 2026', query: 'أحدث التطورات المعمارية في نماذج التفكير الاستدلالي (Reasoning Models) لعام 2026' },
    { title: 'مقارنة هندسية: DeepSeek R1 مقابل OpenAI o3', query: 'مقارنة هندسية تفصيلية بين DeepSeek-R1 و OpenAI o3-mini من حيث التكلفة والأداء' },
    { title: 'تحليل سوق وسلاسل إمداد بطاريات الحالة الصلبة', query: 'تحليل الجدوى وسلاسل الإمداد لبطاريات الحالة الصلبة Solid-State Batteries' },
    { title: 'مستقبل الحوسبة الكمومية والتشفير ما بعد الكم', query: 'تأثير الحوسبة الكمومية على خوارزميات التشفير ومعايير NIST ما بعد الكم' },
  ] : [
    { title: 'AI Reasoning Architectures 2026', query: 'Latest architectural developments in AI reasoning models in 2026' },
    { title: 'DeepSeek R1 vs OpenAI o3 Comparison', query: 'Comprehensive architectural and cost comparison between DeepSeek R1 and OpenAI o3-mini' },
    { title: 'Solid-State Battery Market & Supply Chain', query: 'Commercial feasibility and supply chain analysis of solid-state batteries' },
    { title: 'Post-Quantum Cryptography & Security', query: 'Impact of quantum computing on modern encryption and NIST post-quantum standards' },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] max-w-2xl mx-auto px-4 py-12 select-none">
      {/* Brand Hero Header */}
      <div className="flex flex-col items-center text-center mb-9 space-y-3">
        <BrandLogo size="lg" withText={true} isArabic={isArabic} className="mb-2" />

        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-100 tracking-tight">
          {isArabic ? 'أين تبدأ المعرفة والتحري العميق' : 'Where knowledge begins'}
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-md leading-relaxed">
          {isArabic 
            ? 'وكيل بحث مستقل فائق الدقة يمشط مصادر الويب، يحلل الفجوات، ويبني تقارير موثقة بالأدلة.'
            : 'Autonomous deep research engine that synthesizes verified evidence, analytical reports, and domain insights.'}
        </p>
      </div>

      {/* Hero Input Box */}
      <div className="w-full mb-9">
        <EmptyChatMessageInput {...props} />
      </div>

      {/* Suggested Topics */}
      <div className="w-full flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <Compass className="w-3.5 h-3.5 text-[#2dd4bf] opacity-80" />
          <span>{isArabic ? 'مقترحات استكشافية متعمقة' : 'Explore research topics'}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full">
          {suggestionPills.map((pill, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                props.setQuery(pill.query);
              }}
              className="p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.1] text-left rtl:text-right text-xs text-slate-300 hover:text-slate-100 transition-all duration-150 group flex items-center justify-between"
            >
              <span className="truncate pr-2 rtl:pr-0 rtl:pl-2">{pill.title}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-[#2dd4bf] transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
