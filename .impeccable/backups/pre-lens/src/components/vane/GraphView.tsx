import React from 'react';
import { Network, Sparkles, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { ResearchGraphNode, Language } from '../../types';

interface GraphViewProps {
  graphNodes: ResearchGraphNode[];
  query: string;
  loading: boolean;
  language: Language;
}

export const GraphView: React.FC<GraphViewProps> = ({
  graphNodes,
  query,
  loading,
  language,
}) => {
  const isArabic = language === 'ar';

  const defaultNodes: ResearchGraphNode[] = graphNodes.length > 0 ? graphNodes : [
    { id: 'root', label: query || (isArabic ? 'الهدف البحثي الرئيسي' : 'Main Research Objective'), type: 'goal', status: loading ? 'running' : 'done' },
    { id: 'p1', label: isArabic ? 'المنظور المعماري والتقني' : 'Technical & Architectural Perspective', type: 'perspective', status: 'done', parentId: 'root' },
    { id: 'p2', label: isArabic ? 'ديناميكيات السوق والجدوى' : 'Market & Economic Dynamics', type: 'perspective', status: 'done', parentId: 'root' },
    { id: 'q1', label: isArabic ? 'تفكيك الاستعلامات وتحليل الفجوات' : 'Query Decomposition & Gap Analysis', type: 'query', status: loading ? 'running' : 'done', parentId: 'p1' },
    { id: 's1', label: isArabic ? 'توليف المعرفة والتأصيل' : 'Grounded Synthesis & Living Report', type: 'synthesis', status: loading ? 'running' : 'done', parentId: 'q1' },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="border-b border-[#21262d] pb-5 space-y-1">
        <div className="flex items-center gap-2 text-sky-400 text-xs font-mono">
          <Network className="w-4 h-4" />
          <span>{isArabic ? 'مخطط الاستدلال البصري (STORM DAG)' : 'Visual Reasoning Graph'}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-100">
          {isArabic ? 'خريطة مسار البحث المتعدد الرؤى' : 'Multi-Perspective Research Graph'}
        </h1>
        <p className="text-xs text-slate-400">
          {isArabic ? 'رسم بياني لعقد التفكير واستخراج الفجوات المعرفية المستقلة' : 'Directed acyclic graph tracking autonomous multi-hop reasoning nodes'}
        </p>
      </div>

      <div className="p-6 rounded-2xl bg-[#161b22] border border-[#21262d] shadow-xl space-y-4">
        <div className="space-y-3">
          {defaultNodes.map((node, i) => (
            <div
              key={node.id}
              className="p-3.5 rounded-xl bg-[#0d1117] border border-[#21262d] flex items-center justify-between gap-4 transition group hover:border-[#30363d]"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#21262d] text-sky-400 flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                  {i + 1}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200 group-hover:text-sky-300 transition">
                    {node.label}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-0.5">
                    Node Type: {node.type}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {node.status === 'running' ? (
                  <span className="flex items-center gap-1.5 text-xs text-sky-400 font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {isArabic ? 'نشط' : 'Active'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {isArabic ? 'مكتمل' : 'Resolved'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
