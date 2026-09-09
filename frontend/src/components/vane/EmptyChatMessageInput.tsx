import React, { useRef } from 'react';
import { ArrowUp, Loader2, Table2, Boxes, TrendingUp, ShieldCheck, Cpu, Globe, SlidersHorizontal } from 'lucide-react';
import { Language, ApiSettings, ResearchMode } from '../../types';

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
  researchMode: ResearchMode;
  setResearchMode: (mode: ResearchMode) => void;
}

export const EmptyChatMessageInput: React.FC<EmptyChatMessageInputProps> = (props) => {
  const ar = props.language === 'ar';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templates = [
    { icon: Table2, label: ar ? 'مقارنة' : 'Compare', prefix: ar ? 'مقارنة معيارية شاملة في جداول لـ: ' : 'Comprehensive comparison matrix and data tables for: ', mode: 'quality' as const },
    { icon: Boxes, label: ar ? 'تحليل تقني' : 'Technical analysis', prefix: ar ? 'تحليل معماري وهندسي متعمق مع مخططات لـ: ' : 'In-depth technical architecture breakdown with diagrams for: ', mode: 'quality' as const, focus: 'academic' as const },
    { icon: TrendingUp, label: ar ? 'دراسة سوق' : 'Market research', prefix: ar ? 'تحليل الجدوى الاقتصادية وسلاسل القيمة وسوق: ' : 'Market dynamics, commercial feasibility, and supply chain analysis of: ', mode: 'balanced' as const },
    { icon: ShieldCheck, label: ar ? 'تحليل مخاطر' : 'Risk analysis', prefix: ar ? 'فحص أمني وتحليل الثغرات والمخاطر التشغيلية لـ: ' : 'Security audit, vulnerability vectors, and operational risks of: ', mode: 'quality' as const },
  ];
  const modelLabel = props.settings.custom_model_name || props.settings.model_name || props.settings.llm_provider;
  const submit = () => { if (props.query.trim() && !props.loading) props.onSubmit(); };
  return (
    <div className="research-composer">
      <form className="composer-box" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label htmlFor="research-query" className="sr-only">{ar ? 'سؤال البحث' : 'Research question'}</label>
        <textarea id="research-query" ref={textareaRef} value={props.query} onChange={e => props.setQuery(e.target.value)} rows={3}
          placeholder={ar ? 'ما الذي تريد فهمه بعمق؟' : 'What would you like to understand?'}
          aria-describedby="composer-hint"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }} />
        <div className="composer-toolbar">
          <div className="composer-options">
            <fieldset className="composer-select border-0 p-0 flex items-center gap-1" aria-describedby={props.researchMode === 'wide' ? 'wide-research-guidance' : undefined}>
              <legend className="sr-only">{ar ? 'وضع البحث' : 'Research mode'}</legend>
              <label className={`cursor-pointer rounded px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-line-strong focus-within:outline-none ${props.researchMode === 'standard' ? 'bg-hover text-ink' : 'text-muted'}`}>
                <input className="sr-only" type="radio" name="research-mode" value="standard" checked={props.researchMode === 'standard'} onChange={() => props.setResearchMode('standard')} />
                {ar ? 'بحث قياسي' : 'Standard Research'}
              </label>
              <label className={`cursor-pointer rounded px-2 py-1 text-xs focus-within:ring-2 focus-within:ring-line-strong focus-within:outline-none ${props.researchMode === 'wide' ? 'bg-hover text-ink' : 'text-muted'}`}>
                <input className="sr-only" type="radio" name="research-mode" value="wide" checked={props.researchMode === 'wide'} onChange={() => props.setResearchMode('wide')} />
                {ar ? 'البحث الموسع' : 'Wide Research'}
              </label>
            </fieldset>
            <label className="composer-select"><SlidersHorizontal size={15} aria-hidden="true" />
              <span className="sr-only">{ar ? 'عمق البحث' : 'Research depth'}</span>
              <select value={props.optimizationMode} onChange={e => props.setOptimizationMode(e.target.value as EmptyChatMessageInputProps['optimizationMode'])}>
                <option value="speed">{ar ? 'بحث سريع' : 'Quick research'}</option>
                <option value="balanced">{ar ? 'متوازن' : 'Balanced'}</option>
                <option value="quality">{ar ? 'بحث عميق' : 'Deep research'}</option>
              </select>
            </label>
            <label className="composer-select"><Globe size={15} aria-hidden="true" />
              <span className="sr-only">{ar ? 'نطاق المصادر' : 'Source focus'}</span>
              <select value={props.sourceFocus} onChange={e => props.setSourceFocus(e.target.value as EmptyChatMessageInputProps['sourceFocus'])}>
                <option value="web">{ar ? 'الويب' : 'Web'}</option>
                <option value="academic">{ar ? 'أكاديمي' : 'Academic'}</option>
                <option value="social">{ar ? 'المجتمعات' : 'Community'}</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={!props.query.trim() || props.loading}>
            <span>{props.loading ? (ar ? 'جارٍ البحث' : 'Researching') : (ar ? 'ابدأ البحث' : 'Research')}</span>
            {props.loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </form>
      <div className="composer-meta"><button onClick={props.onOpenSettings} className="model-control" title={ar ? 'اختيار النموذج' : 'Choose model'}><Cpu size={14} /><bdi>{modelLabel}</bdi></button><span id="composer-hint">{ar ? 'Enter للبحث · Shift + Enter لسطر جديد' : 'Enter to research · Shift + Enter for a new line'}</span></div>
      {props.researchMode === 'wide' && <p id="wide-research-guidance" className="text-xs text-muted mt-2">{ar ? 'ميزانية الاسترجاع الأولية تصل إلى 100 مصدر، وقد ترتفع تلقائيًا حتى 200 عند بقاء فجوات أدلة. يعرض المؤشر أدناه الأعداد الفعلية.' : 'The initial retrieval budget is up to 100 sources and may rise to 200 only when evidence gaps remain. The telemetry shows actual counts.'}</p>}
      <div className="workflow-templates" aria-label={ar ? 'قوالب البحث' : 'Research templates'}>
        <span>{ar ? 'ابدأ بـ' : 'Start with'}</span>
        {templates.map(({ icon: Icon, label, prefix, mode, ...template }) => (
          <button key={label} onClick={() => {
            const previous = templates.find(t => props.query.startsWith(t.prefix));
            const subject = previous ? props.query.slice(previous.prefix.length) : props.query;
            props.setQuery(prefix + subject);
            props.setOptimizationMode(mode);
            if ('focus' in template && template.focus) props.setSourceFocus(template.focus);
            textareaRef.current?.focus();
          }}><Icon size={14} aria-hidden="true" />{label}</button>
        ))}
      </div>
    </div>
  );
};
