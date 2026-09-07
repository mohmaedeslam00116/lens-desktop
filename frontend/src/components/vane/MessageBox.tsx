import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  Copy, 
  Check, 
  Download, 
  FileText, 
  FileDown, 
  FileSpreadsheet, 
  BookOpen, 
  Layers, 
  Volume2, 
  VolumeX, 
  Table, 
  AlertTriangle,
  FileCode,
  Network,
  Plus,
  ArrowUpRight
} from 'lucide-react';
import { MessageSources } from './MessageSources';
import { PerplexityRadar } from './PerplexityRadar';
import { ReportRenderer } from './ReportRenderer';
import { AgentWorkspace } from './AgentWorkspace';
import { GraphView } from './GraphView';
import { SourceItem, ResearchStep, Language } from '../../types';
import { extractTables, tableToCSV } from '../../utils/markdownArtifacts';

interface MessageBoxProps {
  query: string;
  report: string;
  sources: SourceItem[];
  steps: ResearchStep[];
  loading: boolean;
  language: Language;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onFollowUp: (q: string) => void;
}

export const MessageBox: React.FC<MessageBoxProps> = ({
  query,
  report,
  sources,
  steps,
  loading,
  language,
  onExport,
  onFollowUp,
}) => {
  const isArabic = language === 'ar';
  const [viewMode, setViewMode] = useState<'report' | 'workspace' | 'graph'>('report');
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Stop speech when component unmounts or query changes
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [query]);

  const handleCopy = () => {
    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleSpeech = () => {
    if (!('speechSynthesis' in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    // Clean markdown formatting for smoother reading
    const cleanText = report
      .replace(/\[\d+\]/g, '')
      .replace(/[#*`_~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .slice(0, 3000);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = isArabic ? 'ar-SA' : 'en-US';
    utterance.rate = 1.0;

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  // Quick prompt pills for deep exploration
  const explorationPills = isArabic ? [
    { label: 'قارن بين الخيارات والحلول', query: `قم بإنشاء جدول مقارنة تفصيلي يستعرض كافة الحلول والبدائل المطروحة لـ: "${query}" مع إبراز المزايا والعيوب`, icon: Table },
    { label: 'أبرز المخاطر والقيود العملية', query: `ما هي أهم التحديات والمخاطر والقيود العملية والتقنية لـ: "${query}"؟`, icon: AlertTriangle },
    { label: 'أهم التوصيات وخارطة الطريق', query: `استخرج أهم 3 توصيات تنفيذية وخطوات عملية واضحة لصناع القرار بناءً على نتائج: "${query}"`, icon: ArrowUpRight },
  ] : [
    { label: 'Compare options in table', query: `Create a detailed comparison table of all options and trade-offs for: "${query}"`, icon: Table },
    { label: 'Analyze critical risks & limits', query: `What are the critical risks, challenges, and limitations regarding: "${query}"?`, icon: AlertTriangle },
    { label: 'Key actionable takeaways', query: `Synthesize the top actionable recommendations from this research on: "${query}"`, icon: ArrowUpRight },
  ];

  const extractedTables = useMemo(() => extractTables(report), [report]);

  const handleExportAllTablesCSV = () => {
    if (extractedTables.length === 0) return;
    extractedTables.forEach((t, i) => {
      setTimeout(() => {
        const csvContent = tableToCSV(t.headers, t.rows);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(t.title || `Table_${i + 1}`).replace(/\s+/g, '_')}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }, i * 200);
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-7 animate-fadeIn">
      {/* 1. Query Title Header */}
      <div className="space-y-2 pb-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-100 tracking-tight leading-relaxed">
          {query}
        </h1>
      </div>

      {/* 2. Perplexity-Style Research Radar & Progressive Reasoning Timeline */}
      <PerplexityRadar 
        query={query} 
        steps={steps} 
        sources={sources} 
        loading={loading} 
        language={language} 
      />

      {/* 3. Post-Research Workspace View Mode Switcher */}
      {report && (
        <div className="space-y-6 pt-2">
          {/* Top View Mode Bar & Export Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06] select-none">
            {/* View Mode Pills */}
            <div className="flex items-center gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('report')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  viewMode === 'report' 
                    ? 'bg-white/[0.08] text-accent shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{isArabic ? 'التقرير الشامل' : 'Living Report'}</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('workspace')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  viewMode === 'workspace' 
                    ? 'bg-white/[0.08] text-accent shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-muted" />
                <span>{isArabic ? 'مساحة العمل' : 'Workspace'}</span>
                {extractedTables.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-surface text-muted">
                    {extractedTables.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setViewMode('graph')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  viewMode === 'graph' 
                    ? 'bg-white/[0.08] text-accent shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Network className="w-3.5 h-3.5 text-accent" />
                <span>{isArabic ? 'خريطة المعرفة' : 'Reasoning Graph'}</span>
              </button>
            </div>

            {/* Document Export Actions */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {'speechSynthesis' in window && (
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
                    isSpeaking 
                      ? 'bg-accent/10 text-accent border-accent/30 animate-pulse' 
                      : 'bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 hover:text-white border-white/[0.06]'
                  }`}
                  title={isArabic ? "استماع صوتي" : "Listen to report"}
                >
                  {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{isSpeaking ? (isArabic ? 'إيقاف' : 'Stop') : (isArabic ? 'استماع' : 'Listen')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-300 hover:text-white text-xs font-medium transition"
                title={isArabic ? "نسخ التقرير كاملاً" : "Copy report"}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-muted" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? (isArabic ? 'تم النسخ' : 'Copied') : (isArabic ? 'نسخ' : 'Copy')}</span>
              </button>

              {extractedTables.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportAllTablesCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-hover text-ink border border-line text-xs font-medium transition"
                  title={isArabic ? "تصدير الجداول كـ CSV" : "Export tables as CSV"}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>CSV</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onExport('pdf')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-300 hover:text-white text-xs font-medium transition"
                title={isArabic ? "تصدير PDF" : "Export PDF"}
              >
                <FileDown className="w-3.5 h-3.5 text-muted" />
                <span>PDF</span>
              </button>

              <button
                type="button"
                onClick={() => onExport('docx')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-300 hover:text-white text-xs font-medium transition"
                title={isArabic ? "تصدير Word" : "Export Word"}
              >
                <FileText className="w-3.5 h-3.5 text-accent" />
                <span>Word</span>
              </button>

              <button
                type="button"
                onClick={() => onExport('markdown')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-slate-300 hover:text-white text-xs font-medium transition"
                title={isArabic ? "تصدير Markdown" : "Export Markdown"}
              >
                <Download className="w-3.5 h-3.5 text-muted" />
                <span>MD</span>
              </button>
            </div>
          </div>

          {/* Active View Content */}
          {viewMode === 'report' && (
            <ReportRenderer 
              content={report} 
              sources={sources} 
              language={language} 
            />
          )}

          {viewMode === 'workspace' && (
            <AgentWorkspace 
              report={report} 
              sources={sources} 
              steps={steps} 
              language={language} 
            />
          )}

          {viewMode === 'graph' && (
            <GraphView 
              graphNodes={[]} 
              query={query} 
              loading={loading} 
              language={language} 
            />
          )}
        </div>
      )}

      {/* 4. Deepen Exploration Action Pills */}
      {report && !loading && (
        <div className="space-y-3 pt-6 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>{isArabic ? 'تعميق ومتابعة البحث' : 'Deepen Exploration'}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {explorationPills.map((pill, idx) => {
              const Icon = pill.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onFollowUp(pill.query)}
                  className="p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.1] text-left rtl:text-right text-xs text-slate-300 hover:text-white transition-all duration-150 group flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-accent shrink-0 opacity-80" />
                    <span className="truncate font-medium">{pill.label}</span>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-accent shrink-0 transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

