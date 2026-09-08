import React, { useState, useMemo } from 'react';
import { 
  Table, 
  GitGraph, 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  Search, 
  Layers, 
  ShieldCheck, 
  Activity, 
  FileSpreadsheet,
  ExternalLink,
  ChevronDown,
  TrendingUp,
  Filter
} from 'lucide-react';
import { MermaidDiagram } from './MermaidDiagram';
import { FacetGroupedShelf } from '../research/FacetGroupedShelf';
import { SourceItem, Language, ResearchStep, ResearchPlan } from '../../types';
import { extractTables, extractMermaidDiagrams, extractKeyMetrics, tableToCSV } from '../../utils/markdownArtifacts';

interface AgentWorkspaceProps {
  report: string;
  sources: SourceItem[];
  steps: ResearchStep[];
  language: Language;
  plan?: ResearchPlan | null;
  onInspectEvidence?: (citationIndex: number) => void;
}

export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  report,
  sources,
  steps,
  language,
  plan,
  onInspectEvidence,
}) => {
  const isArabic = language === 'ar';
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'tables' | 'diagrams' | 'metrics' | 'sources'>('tables');
  const [tableSearch, setTableSearch] = useState('');
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null);

  // Extract structured artifacts dynamically
  const tables = useMemo(() => extractTables(report), [report]);
  const diagrams = useMemo(() => extractMermaidDiagrams(report), [report]);
  const metrics = useMemo(() => extractKeyMetrics(report), [report]);

  const handleCopyMarkdownTable = (rawMarkdown: string, id: string) => {
    navigator.clipboard.writeText(rawMarkdown);
    setCopiedTableId(id);
    setTimeout(() => setCopiedTableId(null), 2000);
  };

  const handleDownloadCSV = (headers: string[], rows: string[][], filename: string) => {
    const csvContent = tableToCSV(headers, rows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter tables if search is active
  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tables;
    const q = tableSearch.toLowerCase().trim();
    return tables.filter(t => 
      t.title.toLowerCase().includes(q) || 
      t.headers.some(h => h.toLowerCase().includes(q)) ||
      t.rows.some(row => row.some(cell => cell.toLowerCase().includes(q)))
    );
  }, [tables, tableSearch]);

  const workspaceTabs = [
    { 
      id: 'tables' as const, 
      label: isArabic ? 'جداول المقارنة والبيانات' : 'Data & Comparison Tables', 
      icon: Table,
      count: tables.length,
      badgeColor: 'bg-emerald-500/20 text-emerald-400' 
    },
    { 
      id: 'diagrams' as const, 
      label: isArabic ? 'المخططات المعمارية' : 'Visual Diagrams', 
      icon: GitGraph,
      count: diagrams.length,
      badgeColor: 'bg-accent/20 text-accent' 
    },
    { 
      id: 'metrics' as const, 
      label: isArabic ? 'المؤشرات والإحصائيات' : 'Key Metrics', 
      icon: TrendingUp,
      count: metrics.length,
      badgeColor: 'bg-amber-500/20 text-amber-400' 
    },
    { 
      id: 'sources' as const, 
      label: isArabic ? 'فهرس المصادر والتحقق' : 'Verified Sources', 
      icon: ShieldCheck,
      count: sources.length,
      badgeColor: 'bg-accent/20 text-accent' 
    },
  ];

  return (
    <div className="space-y-6 select-text animate-fadeIn">
      {/* Workspace Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-surface to-panel border border-line flex items-center justify-between gap-4 select-none">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center  shadow-accent/10">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>{isArabic ? 'مساحة عمل الوكيل الذكي (Agent Workspace Studio)' : 'Agent Workspace Studio'}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-accent/20 text-accent border border-accent/30">
                Autonomous Assets
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isArabic 
                ? 'استوديو استخراج وتصدير الجداول والمخططات والمؤشرات الرقمية المستخلصة من البحث' 
                : 'Structured artifacts extracted by the agent: tables, CSVs, Mermaid architectures, and metrics'}
            </p>
          </div>
        </div>

        {/* Global CSV Export All Tables */}
        {tables.length > 0 && (
          <button
            type="button"
            onClick={() => {
              tables.forEach((t, i) => {
                setTimeout(() => {
                  handleDownloadCSV(t.headers, t.rows, t.title || `Table_${i + 1}`);
                }, i * 200);
              });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition shadow-sm"
            title="تصدير كافة الجداول دفعة واحدة كملفات CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isArabic ? 'تحميل كل الجداول (CSV)' : 'Export All Tables'}</span>
          </button>
        )}
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-line pb-2 overflow-x-auto select-none">
        {workspaceTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeWorkspaceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveWorkspaceTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                isActive 
                  ? 'bg-accent/10 text-accent border border-accent/40 shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-panel'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${tab.badgeColor}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: DATA & COMPARISON TABLES */}
      {activeWorkspaceTab === 'tables' && (
        <div className="space-y-4">
          {/* Table Search */}
          {tables.length > 1 && (
            <div className="relative max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder={isArabic ? 'تصفية وبحث داخل الجداول...' : 'Search inside tables...'}
                className="w-full bg-surface border border-line rounded-xl pl-8 pr-3 rtl:pl-3 rtl:pr-8 py-2 text-slate-200 text-xs focus:outline-none focus:border-accent/50"
              />
            </div>
          )}

          {filteredTables.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-line bg-surface/40 space-y-2">
              <Table className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                {tables.length === 0 
                  ? (isArabic ? 'لم يتم توليد أي جداول بعد في هذا البحث.' : 'No tables generated in this research yet.')
                  : (isArabic ? 'لا توجد جداول مطابقة للبحث.' : 'No tables match search query.')}
              </p>
            </div>
          ) : (
            filteredTables.map((tbl, idx) => (
              <div 
                key={tbl.id}
                className="rounded-2xl border border-line bg-surface  overflow-hidden space-y-0 transition hover:border-line-strong"
              >
                {/* Table Header Bar */}
                <div className="p-4 bg-panel border-b border-line flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{tbl.title}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {tbl.rows.length} {isArabic ? 'صفوف' : 'rows'} • {tbl.headers.length} {isArabic ? 'أعمدة' : 'columns'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Copy Markdown */}
                    <button
                      type="button"
                      onClick={() => handleCopyMarkdownTable(tbl.rawMarkdown, tbl.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition text-xs border border-white/5"
                      title="نسخ جدول Markdown"
                    >
                      {copiedTableId === tbl.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedTableId === tbl.id ? (isArabic ? 'تم النسخ' : 'Copied') : (isArabic ? 'نسخ Markdown' : 'Copy MD')}</span>
                    </button>

                    {/* Download CSV */}
                    <button
                      type="button"
                      onClick={() => handleDownloadCSV(tbl.headers, tbl.rows, tbl.title)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition text-xs font-medium border border-emerald-500/30"
                      title="تحميل كملف CSV"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>{isArabic ? 'تصدير CSV' : 'Export CSV'}</span>
                    </button>
                  </div>
                </div>

                {/* Table Data View */}
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left rtl:text-right border-collapse text-xs">
                    <thead>
                      <tr className="bg-panel/80 border-b border-line">
                        {tbl.headers.map((h, i) => (
                          <th key={i} className="px-4 py-3 font-semibold text-slate-200 tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {tbl.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-white/[0.02] transition">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-4 py-3 text-slate-300 align-top">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 2: VISUAL MERMAID DIAGRAMS */}
      {activeWorkspaceTab === 'diagrams' && (
        <div className="space-y-4">
          {diagrams.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-line bg-surface/40 space-y-2">
              <GitGraph className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                {isArabic ? 'لا توجد مخططات معمارية مستخرجة في هذا التقرير.' : 'No visual architecture diagrams in this report.'}
              </p>
            </div>
          ) : (
            diagrams.map((d) => (
              <MermaidDiagram key={d.id} code={d.code} title={d.title} />
            ))
          )}
        </div>
      )}

      {/* TAB 3: KEY METRICS & INSIGHTS */}
      {activeWorkspaceTab === 'metrics' && (
        <div className="space-y-4">
          {metrics.length === 0 ? (
            <div className="py-12 text-center rounded-2xl border border-dashed border-line bg-surface/40 space-y-2">
              <TrendingUp className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                {isArabic ? 'لا توجد مؤشرات رقمية مفردة مستخرجة.' : 'No standalone quantitative metrics detected.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {metrics.map((m, idx) => (
                <div 
                  key={idx}
                  className="p-4 rounded-xl bg-surface border border-line hover:border-accent/40 transition space-y-1.5 shadow-sm"
                >
                  <p className="text-[11px] font-semibold text-slate-400 truncate">{m.label}</p>
                  <p className="text-sm font-bold text-accent font-mono leading-snug">{m.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: VERIFIED SOURCES HUB / FACET-GROUPED SHELF */}
      {activeWorkspaceTab === 'sources' && (
        <FacetGroupedShelf
          sources={sources}
          plan={plan}
          reportContent={report}
          language={language}
          onInspectEvidence={(idx) => {
            if (onInspectEvidence) onInspectEvidence(idx);
          }}
        />
      )}
    </div>
  );
};
