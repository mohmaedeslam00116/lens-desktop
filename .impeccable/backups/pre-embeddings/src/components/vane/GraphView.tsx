import React from 'react';
import { Network, CheckCircle2, Loader2, Circle, AlertCircle } from 'lucide-react';
import { ResearchGraphNode, Language } from '../../types';

interface GraphViewProps {
  graphNodes: ResearchGraphNode[];
  query: string;
  loading: boolean;
  language: Language;
}

export const GraphView: React.FC<GraphViewProps> = ({ graphNodes, query, loading, language }) => {
  const ar = language === 'ar';
  const types: Record<ResearchGraphNode['type'], string> = {
    root: ar ? 'السؤال الرئيسي' : 'Research question',
    perspective: ar ? 'زاوية بحث' : 'Perspective',
    subquery: ar ? 'سؤال فرعي' : 'Subquery',
    source: ar ? 'مصدر' : 'Source',
    reflection: ar ? 'مراجعة وتحليل' : 'Reflection',
    section: ar ? 'قسم التقرير' : 'Report section',
  };
  const states = {
    pending: { label: ar ? 'قيد الانتظار' : 'Pending', icon: Circle, color: 'text-muted' },
    active: { label: ar ? 'جارٍ العمل' : 'In progress', icon: Loader2, color: 'text-muted' },
    completed: { label: ar ? 'مكتمل' : 'Complete', icon: CheckCircle2, color: 'text-emerald-400' },
    failed: { label: ar ? 'تعذر الإكمال' : 'Failed', icon: AlertCircle, color: 'text-rose-400' },
  };
  return (
    <section className="w-full max-w-4xl mx-auto px-6 py-10 space-y-7">
      <div><h1 className="text-2xl font-semibold text-ink">{ar ? 'خريطة المعرفة' : 'Knowledge graph'}</h1><p className="text-sm text-muted mt-2">{ar ? 'تتبّع انتقال بحثك من السؤال إلى المصادر والنتائج.' : 'Follow your research from question to sources and findings.'}</p></div>
      {query && <p className="text-sm text-ink border-b border-line pb-5 leading-relaxed">{query}</p>}
      {graphNodes.length === 0 ? (
        <div className="library-empty">
          {loading ? <Loader2 size={30} className="animate-spin text-muted" /> : <Network size={34} strokeWidth={1.4} className="text-muted" />}
          <h2>{loading ? (ar ? 'يتشكّل مسار البحث' : 'Your research is taking shape') : (ar ? 'لكل بحث مسار' : 'Every research has a path')}</h2>
          <p>{loading ? (ar ? 'ستظهر خطوات البحث هنا فور وصولها.' : 'Research steps will appear here as they arrive.') : (ar ? 'ابدأ بحثًا من الصفحة الرئيسية لعرض الأسئلة والمصادر المرتبطة به هنا.' : 'Start a research from Home to see its questions and connected sources here.')}</p>
        </div>
      ) : <ol className="divide-y divide-line">{graphNodes.map(node => {
        const state = states[node.status] || states.pending;
        const Icon = state.icon;
        const parent = graphNodes.find(candidate => candidate.id === node.parentId);
        return <li key={node.id} className="flex items-start justify-between gap-4 py-5">
          <div className="min-w-0"><p className="text-sm text-ink leading-relaxed">{node.label}</p><p className="text-xs text-muted mt-2">{types[node.type]}{parent && <span> · {ar ? 'مرتبط بـ: ' : 'From: '}{parent.label}</span>}</p></div>
          <span className={`flex items-center gap-1.5 text-xs shrink-0 ${state.color}`}><Icon size={14} className={node.status === 'active' ? 'animate-spin' : ''} /><span>{state.label}</span></span>
        </li>;
      })}</ol>}
    </section>
  );
};
