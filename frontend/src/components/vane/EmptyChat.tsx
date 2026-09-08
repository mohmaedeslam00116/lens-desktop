import React from 'react';
import { ArrowUpRight, ArrowRight, KeyRound } from 'lucide-react';
import { EmptyChatMessageInput } from './EmptyChatMessageInput';
import { Language, ApiSettings, ResearchMode } from '../../types';
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
  researchMode: ResearchMode;
  setResearchMode: (mode: ResearchMode) => void;
}

export const EmptyChat: React.FC<EmptyChatProps> = (props) => {
  const ar = props.language === 'ar';
  const configured = props.settings.llm_provider === 'ollama' || Boolean(props.settings.keys[props.settings.llm_provider as keyof ApiSettings['keys']]?.trim());
  const topics = ar ? [
    { category: 'الذكاء الاصطناعي', title: 'كيف تتطور نماذج التفكير؟', query: 'أحدث التطورات المعمارية في نماذج التفكير الاستدلالي (Reasoning Models) لعام 2026' },
    { category: 'مقارنة تقنية', title: 'DeepSeek R1 مقابل OpenAI o3', query: 'مقارنة هندسية تفصيلية بين DeepSeek-R1 و OpenAI o3-mini من حيث التكلفة والأداء' },
    { category: 'الطاقة والأسواق', title: 'بطاريات الحالة الصلبة: من المختبر إلى السوق', query: 'تحليل الجدوى وسلاسل الإمداد لبطاريات الحالة الصلبة Solid-State Batteries' },
    { category: 'الأمن الرقمي', title: 'التشفير في عصر الحوسبة الكمومية', query: 'تأثير الحوسبة الكمومية على خوارزميات التشفير ومعايير NIST ما بعد الكم' },
  ] : [
    { category: 'Artificial intelligence', title: 'How are reasoning models evolving?', query: 'Latest architectural developments in AI reasoning models in 2026' },
    { category: 'Technical comparison', title: 'DeepSeek R1 versus OpenAI o3', query: 'Comprehensive architectural and cost comparison between DeepSeek R1 and OpenAI o3-mini' },
    { category: 'Energy & markets', title: 'Solid-state batteries: from lab to market', query: 'Commercial feasibility and supply chain analysis of solid-state batteries' },
    { category: 'Digital security', title: 'Encryption in the quantum era', query: 'Impact of quantum computing on modern encryption and NIST post-quantum standards' },
  ];

  return (
    <div className="research-home">
      <section className="home-intro" aria-labelledby="home-title">
        <BrandLogo size="lg" />
        <h1 id="home-title">{ar ? 'كل سؤال يستحق نظرة أعمق.' : 'Every question deserves a closer look.'}</h1>
        <p>{ar ? 'استكشف المصادر، قارن الأفكار، وابنِ فهمًا أوضح بتقرير موثّق.' : 'Explore sources, connect ideas, and build a clearer picture with cited research.'}</p>
      </section>
      <EmptyChatMessageInput {...props} />
      {!configured && (
        <button className="setup-prompt" onClick={props.onOpenSettings}>
          <KeyRound size={15} aria-hidden="true" />
          <span>{ar ? 'قبل بحثك الأول، اربط نموذج الذكاء الاصطناعي.' : 'Before your first research, connect an AI model.'}</span>
          <span className="setup-link">{ar ? 'إعداد النموذج' : 'Set up model'}<ArrowRight size={14} className="direction-arrow" /></span>
        </button>
      )}
      <section className="topic-section" aria-labelledby="topics-title">
        <div className="section-heading"><h2 id="topics-title">{ar ? 'مساحة للفضول' : 'Room for curiosity'}</h2><span>{ar ? 'اختر فكرة وعدّلها بطريقتك' : 'A starting point. Make it yours.'}</span></div>
        <div className="topic-grid">
          {topics.map(topic => (
            <button key={topic.query} className="topic-row" onClick={() => {
              props.setQuery(topic.query);
              document.getElementById('research-query')?.focus();
            }}>
              <span><span className="topic-category">{topic.category}</span><span className="topic-title">{topic.title}</span></span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      <p className="home-footnote">{ar ? 'من السؤال إلى المصادر، ومن المصادر إلى فهم أعمق.' : 'From question to sources. From sources to understanding.'}</p>
    </div>
  );
};
