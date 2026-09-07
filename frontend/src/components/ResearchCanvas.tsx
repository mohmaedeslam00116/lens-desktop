import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Sparkles, 
  Search, 
  Zap, 
  BookOpen, 
  Languages, 
  Download, 
  FileText, 
  FileDown, 
  Copy, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Clock, 
  List, 
  Share2,
  ExternalLink,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { Language, ResearchDepth, ReportData, ApiSettings, TocHeading } from '../types';
import { translations } from '../i18n/translations';

interface ResearchCanvasProps {
  language: Language;
  report: ReportData | null;
  isSearching: boolean;
  onStartResearch: (query: string, depth: ResearchDepth, reportLang: string) => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  settings: ApiSettings;
  onSelectSourceInInspector?: (url: string) => void;
}

export const ResearchCanvas: React.FC<ResearchCanvasProps> = ({
  language,
  report,
  isSearching,
  onStartResearch,
  onExport,
  settings,
  onSelectSourceInInspector
}) => {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('deep');
  const [reportLang, setReportLang] = useState('auto');
  const [copied, setCopied] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');

  const t = translations[language];

  // Extract Table of Contents (TOC) from report content
  const tocHeadings: TocHeading[] = useMemo(() => {
    if (!report?.content) return [];
    const headings: TocHeading[] = [];
    const lines = report.content.split('\n');

    lines.forEach((line) => {
      const matchH1 = line.match(/^#\s+(.+)$/);
      const matchH2 = line.match(/^##\s+(.+)$/);

      if (matchH1) {
        const text = matchH1[1].trim();
        const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u0621-\u064A-]/g, '');
        headings.push({ id, text, level: 1 });
      } else if (matchH2) {
        const text = matchH2[1].trim();
        const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u0621-\u064A-]/g, '');
        headings.push({ id, text, level: 2 });
      }
    });

    return headings;
  }, [report?.content]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    onStartResearch(query.trim(), depth, reportLang);
  };

  const handleCopy = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const samplePrompts = [
    {
      title_ar: "مقارنة معمارية أطر عمل وكلاء الذكاء الاصطناعي (LangGraph vs AutoGen vs CrewAI)",
      title_en: "Architectural comparison of AI Agent Frameworks (LangGraph vs AutoGen vs CrewAI)",
    },
    {
      title_ar: "دراسة شاملة لأحدث تقنيات البحث العميق ونماذج الاستدلال (Deep Research & Reasoning Models)",
      title_en: "Comprehensive survey of Deep Web Research and Long-Horizon Reasoning LLMs",
    },
    {
      title_ar: "تحليل استثماري وتقني لسوق الحوسبة الكمومية والتطبيقات التجارية لعام 2026",
      title_en: "Investment and technical analysis of Quantum Computing commercial breakthroughs in 2026",
    }
  ];

  return (
    <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-obsidian-base relative">
      {/* If no report is loaded, show the Command Center Search Workspace */}
      {!report && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-3xl mx-auto w-full">
          <div className="text-center space-y-3 mb-8 animate-fadeIn">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Autonomous Deep Research Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
              {t.app_title}
            </h1>
            <p className="text-sm text-slate-400 max-w-lg mx-auto leading-relaxed">
              {t.app_subtitle}
            </p>
          </div>

          {/* Search Box Card */}
          <form onSubmit={handleSubmit} className="w-full">
            <div className="bg-obsidian-panel border border-obsidian-border hover:border-slate-700 focus-within:border-blue-500/80 rounded-2xl p-4 shadow-2xl transition shadow-glow-blue/5">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                rows={3}
                disabled={isSearching}
                placeholder={t.search_placeholder}
                className="w-full bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none resize-none text-sm leading-relaxed"
              />

              {/* Bottom bar inside search box */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-2 border-t border-obsidian-borderSubtle text-xs">
                <div className="flex items-center gap-2">
                  {/* Depth Toggle */}
                  <div className="flex items-center bg-obsidian-surface rounded-lg p-0.5 border border-obsidian-border">
                    <button
                      type="button"
                      onClick={() => setDepth('quick')}
                      className={`px-2.5 py-1 rounded-md transition font-medium text-[11px] flex items-center gap-1.5 ${
                        depth === 'quick' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      <span>{t.depth_quick}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepth('deep')}
                      className={`px-2.5 py-1 rounded-md transition font-medium text-[11px] flex items-center gap-1.5 ${
                        depth === 'deep' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>{t.depth_deep}</span>
                    </button>
                  </div>

                  {/* Language Selector */}
                  <div className="flex items-center gap-1 bg-obsidian-surface px-2 py-1 rounded-lg border border-obsidian-border text-[11px] text-slate-400">
                    <Languages className="w-3 h-3 text-slate-400" />
                    <select
                      value={reportLang}
                      onChange={(e) => setReportLang(e.target.value)}
                      className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="auto" className="bg-slate-900">{t.lang_auto}</option>
                      <option value="ar" className="bg-slate-900">{t.lang_ar}</option>
                      <option value="en" className="bg-slate-900">{t.lang_en}</option>
                    </select>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={!query.trim() || isSearching}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow transition active:scale-95 disabled:opacity-40"
                >
                  {isSearching ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{t.btn_searching}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{t.btn_start_research}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Sample Prompts / Inspiration */}
          <div className="w-full mt-8 space-y-2">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
              نماذج لأبحاث مقترحة:
            </div>
            <div className="grid grid-cols-1 gap-2">
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setQuery(language === 'ar' ? p.title_ar : p.title_en)}
                  className="text-left p-2.5 rounded-xl bg-obsidian-panel/60 border border-obsidian-border hover:border-blue-500/40 hover:bg-obsidian-panel transition text-xs text-slate-300 flex items-center justify-between group"
                >
                  <span className="line-clamp-1">{language === 'ar' ? p.title_ar : p.title_en}</span>
                  {language === 'ar' ? (
                    <ArrowLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 transition" />
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 transition" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* If a report is loaded, show the living Document Canvas */}
      {report && (
        <div className="flex-1 flex flex-col">
          {/* Top Document Action Bar */}
          <div className="sticky top-0 z-10 bg-obsidian-base/80 backdrop-blur-md border-b border-obsidian-border px-6 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                {report.depth === 'deep' ? t.depth_deep : t.depth_quick}
              </span>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>{report.wordCount || report.content.trim().split(/\s+/).length} كلمة</span>
                <span>•</span>
                <span>{report.sources.length} مصادر</span>
              </div>
            </div>

            {/* Quick Export & Actions Toolbar */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-obsidian-surface hover:bg-obsidian-subtle border border-obsidian-border text-slate-300 text-xs transition"
                title={t.copy_markdown}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? t.copied : t.copy_markdown}</span>
              </button>

              <div className="flex items-center bg-obsidian-surface rounded-lg border border-obsidian-border p-0.5">
                <button
                  onClick={() => onExport('pdf')}
                  className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-obsidian-subtle rounded transition flex items-center gap-1"
                  title={t.export_pdf}
                >
                  <FileDown className="w-3 h-3 text-red-400" />
                  <span>PDF</span>
                </button>
                <button
                  onClick={() => onExport('docx')}
                  className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-obsidian-subtle rounded transition flex items-center gap-1"
                  title={t.export_docx}
                >
                  <FileText className="w-3 h-3 text-blue-400" />
                  <span>DOCX</span>
                </button>
                <button
                  onClick={() => onExport('markdown')}
                  className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-obsidian-subtle rounded transition flex items-center gap-1"
                  title={t.export_md}
                >
                  <Download className="w-3 h-3 text-emerald-400" />
                  <span>MD</span>
                </button>
              </div>
            </div>
          </div>

          {/* Document Content with Optional Side Table of Contents */}
          <div className="flex-1 flex justify-center px-6 py-8">
            <div className="w-full max-w-4xl flex gap-8">
              {/* Document Prose Column */}
              <div className="flex-1 min-w-0 document-prose">
                <div className="mb-6 pb-4 border-b border-obsidian-borderSubtle">
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 mb-2 leading-tight">
                    {report.title || report.query}
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>تم التوليد في: {new Date(report.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Markdown Output */}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => {
                      const text = String(children);
                      const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u0621-\u064A-]/g, '');
                      return <h1 id={id}>{children}</h1>;
                    },
                    h2: ({ children }) => {
                      const text = String(children);
                      const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u0621-\u064A-]/g, '');
                      return <h2 id={id}>{children}</h2>;
                    },
                  }}
                >
                  {report.content}
                </ReactMarkdown>

                {/* Sources References Grid at bottom of document */}
                {report.sources && report.sources.length > 0 && (
                  <div className="mt-12 pt-8 border-t border-obsidian-border">
                    <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                      <span>المصادر والمراجع الموثقة ({report.sources.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {report.sources.map((src, i) => (
                        <a
                          key={i}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-2.5 rounded-lg bg-obsidian-panel border border-obsidian-border hover:border-slate-700 transition group text-xs text-slate-300"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="w-4 h-4 rounded bg-slate-800 text-blue-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                              {i + 1}
                            </span>
                            <span className="truncate group-hover:text-blue-400 transition">
                              {src.title || src.url}
                            </span>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 flex-shrink-0 ml-1.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Table of Contents (TOC) */}
              {tocHeadings.length > 1 && (
                <div className="hidden xl:block w-56 flex-shrink-0 sticky top-16 h-fit max-h-[80vh] overflow-y-auto pl-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <List className="w-3.5 h-3.5 text-slate-400" />
                    <span>فهرس التقرير</span>
                  </div>
                  <nav className="space-y-1 text-xs">
                    {tocHeadings.map((h, index) => (
                      <a
                        key={index}
                        href={`#${h.id}`}
                        className={`block py-1 px-2 rounded-md transition text-[11px] line-clamp-1 ${
                          h.level === 1
                            ? 'font-semibold text-slate-300 hover:text-white hover:bg-obsidian-panel'
                            : 'pl-4 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {h.text}
                      </a>
                    ))}
                  </nav>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
