import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  FileText, 
  Code, 
  Terminal, 
  Copy, 
  Check, 
  FileDown, 
  Download, 
  Sparkles, 
  Zap, 
  BookOpen, 
  Languages, 
  List, 
  Clock, 
  ExternalLink, 
  ChevronRight, 
  Network,
  ShieldCheck,
  Globe,
  Layers,
  Search,
  Scale,
  Cpu,
  TrendingUp,
  ArrowLeft,
  ArrowRight
} from 'lucide-react';
import { 
  ReportData, 
  Language, 
  ResearchDepth, 
  ResearchPerspective, 
  ResearchGraphNode, 
  ApiSettings, 
  TocHeading, 
  SourceItem 
} from '../../types';
import { translations } from '../../i18n/translations';

interface EditorCanvasProps {
  language: Language;
  report: ReportData | null;
  isSearching: boolean;
  onStartResearch: (query: string, depth: ResearchDepth, reportLang: string, perspective: ResearchPerspective) => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  settings: ApiSettings;
  telemetryLogs?: string[];
  sources?: SourceItem[];
  graphNodes?: ResearchGraphNode[];
  onOpenCommandPalette: () => void;
}

type EditorTab = 'report' | 'graph' | 'sources' | 'telemetry';

export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  language,
  report,
  isSearching,
  onStartResearch,
  onExport,
  settings,
  telemetryLogs = [],
  sources = [],
  graphNodes = [],
  onOpenCommandPalette
}) => {
  const [activeTab, setActiveTab] = useState<EditorTab>('report');
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<ResearchDepth>('deep');
  const [perspective, setPerspective] = useState<ResearchPerspective>('balanced');
  const [reportLang, setReportLang] = useState('auto');
  const [copied, setCopied] = useState(false);
  const [selectedSourceForPreview, setSelectedSourceForPreview] = useState<SourceItem | null>(null);

  const t = translations[language];

  // Extract Table of Contents (TOC) from markdown
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
    onStartResearch(query.trim(), depth, reportLang, perspective);
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
      rec_perspective: "technical" as ResearchPerspective
    },
    {
      title_ar: "تحليل اقتصادي وتقني لسوق الحوسبة الكمومية والتطبيقات التجارية لعام 2026",
      title_en: "Economic and technical analysis of Quantum Computing commercial market 2026",
      rec_perspective: "market" as ResearchPerspective
    },
    {
      title_ar: "تقييم نقدي لمخاطر وأمان نماذج الاستدلال والتفكير العميق (Reasoning Models Vulnerabilities)",
      title_en: "Critical evaluation of AI reasoning model security vulnerabilities & trade-offs",
      rec_perspective: "critical" as ResearchPerspective
    }
  ];

  const filename = report 
    ? `${report.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 26).trim()}.md`
    : 'untitled-research.md';

  const activeSources = report?.sources || sources;

  return (
    <main className="flex-1 flex flex-col h-full bg-vscode-editor overflow-hidden text-xs relative select-text">
      {/* 1. VS Code / Cursor Tab Bar */}
      <div className="h-[35px] bg-[#141414] border-b border-vscode-border flex items-center justify-between select-none overflow-x-auto flex-shrink-0">
        <div className="flex items-center h-full">
          {/* Tab 1: report.md */}
          <button
            onClick={() => setActiveTab('report')}
            className={`h-full px-3.5 flex items-center gap-2 border-r border-vscode-border text-xs transition relative ${
              activeTab === 'report'
                ? 'bg-vscode-editor text-vscode-textActive font-medium'
                : 'bg-[#141414] text-vscode-textMuted hover:bg-[#1f1f1f] hover:text-vscode-textNormal'
            }`}
          >
            {activeTab === 'report' && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-vscode-accent" />
            )}
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            <span className="truncate max-w-[160px]">{filename}</span>
          </button>

          {/* Tab 2: graph.view (Visual Multi-Hop Graph) */}
          <button
            onClick={() => setActiveTab('graph')}
            className={`h-full px-3.5 flex items-center gap-2 border-r border-vscode-border text-xs transition relative ${
              activeTab === 'graph'
                ? 'bg-vscode-editor text-vscode-textActive font-medium'
                : 'bg-[#141414] text-vscode-textMuted hover:bg-[#1f1f1f] hover:text-vscode-textNormal'
            }`}
          >
            {activeTab === 'graph' && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-vscode-accent" />
            )}
            <Network className="w-3.5 h-3.5 text-purple-400" />
            <span>graph.view</span>
          </button>

          {/* Tab 3: sources.json */}
          {activeSources.length > 0 && (
            <button
              onClick={() => setActiveTab('sources')}
              className={`h-full px-3.5 flex items-center gap-2 border-r border-vscode-border text-xs transition relative ${
                activeTab === 'sources'
                  ? 'bg-vscode-editor text-vscode-textActive font-medium'
                  : 'bg-[#141414] text-vscode-textMuted hover:bg-[#1f1f1f] hover:text-vscode-textNormal'
              }`}
            >
              {activeTab === 'sources' && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-vscode-accent" />
              )}
              <Code className="w-3.5 h-3.5 text-amber-400" />
              <span>sources.json</span>
              <span className="text-[10px] text-vscode-textMuted">({activeSources.length})</span>
            </button>
          )}

          {/* Tab 4: telemetry.log */}
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`h-full px-3.5 flex items-center gap-2 border-r border-vscode-border text-xs transition relative ${
              activeTab === 'telemetry'
                ? 'bg-vscode-editor text-vscode-textActive font-medium'
                : 'bg-[#141414] text-vscode-textMuted hover:bg-[#1f1f1f] hover:text-vscode-textNormal'
            }`}
          >
            {activeTab === 'telemetry' && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-vscode-accent" />
            )}
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>telemetry.log</span>
          </button>
        </div>

        {/* Tab Right Actions */}
        {report && (
          <div className="flex items-center gap-1.5 px-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-vscode-hover text-vscode-textMuted hover:text-vscode-textActive transition text-[11px]"
              title={t.copy_markdown}
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? t.copied : 'نسخ'}</span>
            </button>

            <div className="h-3.5 w-px bg-vscode-border" />

            <button
              onClick={() => onExport('pdf')}
              className="p-1 rounded hover:bg-vscode-hover text-vscode-textMuted hover:text-red-400 transition"
              title="تصدير PDF"
            >
              <FileDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onExport('docx')}
              className="p-1 rounded hover:bg-vscode-hover text-vscode-textMuted hover:text-blue-400 transition"
              title="تصدير Word (.docx)"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onExport('markdown')}
              className="p-1 rounded hover:bg-vscode-hover text-vscode-textMuted hover:text-emerald-400 transition"
              title="تصدير Markdown (.md)"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 2. Breadcrumbs Bar */}
      <div className="h-[24px] bg-vscode-editor border-b border-vscode-border/60 flex items-center px-4 text-[11px] text-vscode-textMuted select-none gap-1.5 flex-shrink-0">
        <span>workspace</span>
        <ChevronRight className="w-3 h-3 text-vscode-textMuted" />
        <span>deep-research</span>
        <ChevronRight className="w-3 h-3 text-vscode-textMuted" />
        <span className="text-vscode-textNormal font-medium">{filename}</span>
        {report?.depth && (
          <span className="ml-auto px-1.5 py-0.2 rounded bg-vscode-input text-blue-400 font-mono text-[10px] border border-vscode-border">
            {report.depth.toUpperCase()}
          </span>
        )}
      </div>

      {/* 3. Editor Viewport */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {/* Tab 1: Report Document or Welcome Canvas */}
        {activeTab === 'report' && (
          <>
            {!report ? (
              /* Welcome Prompt Screen (Cursor IDE Style) with Stanford STORM & Open Deep Research Controls */
              <div className="max-w-2xl mx-auto py-12 px-6 flex flex-col items-center justify-center">
                <div className="w-full space-y-6 animate-fadeIn">
                  {/* Header Title */}
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-vscode-input border border-vscode-border text-blue-400 font-mono text-[11px]">
                      <Sparkles className="w-3 h-3" />
                      <span>Autonomous Deep Research Engine 2.0</span>
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-vscode-textActive tracking-tight">
                      {language === 'ar' ? 'ما الذي تريد البحث عنه بعمق اليوم؟' : 'What would you like to deeply research today?'}
                    </h1>
                    <p className="text-xs text-vscode-textMuted max-w-md mx-auto leading-relaxed">
                      {t.app_subtitle}
                    </p>
                  </div>

                  {/* Cursor-style docked input container */}
                  <form onSubmit={handleSubmit} className="w-full">
                    <div className="bg-vscode-input border border-vscode-border hover:border-slate-600 focus-within:border-vscode-accent rounded-lg p-3 transition shadow-lg space-y-3">
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
                        className="w-full bg-transparent text-vscode-textActive placeholder:text-vscode-textMuted focus:outline-none resize-none text-xs leading-relaxed"
                      />

                      {/* Depth & Perspective Multi-Select Bar */}
                      <div className="space-y-2 pt-2 border-t border-vscode-border">
                        {/* Row A: Depth Selection */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="text-vscode-textMuted font-mono text-[10px]">
                            {language === 'ar' ? 'عمق التحقيق:' : 'RESEARCH DEPTH:'}
                          </span>
                          <div className="flex items-center bg-[#181818] rounded p-0.5 border border-vscode-border">
                            <button
                              type="button"
                              onClick={() => setDepth('quick')}
                              className={`px-2 py-0.5 rounded transition text-[10.5px] flex items-center gap-1 ${
                                depth === 'quick' ? 'bg-vscode-selection text-white font-medium' : 'text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                              title="بحث سريع (3-5 مصادر)"
                            >
                              <Zap className="w-3 h-3 text-amber-400" />
                              <span>سريع</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDepth('deep')}
                              className={`px-2 py-0.5 rounded transition text-[10.5px] flex items-center gap-1 ${
                                depth === 'deep' ? 'bg-vscode-selection text-white font-medium' : 'text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                              title="بحث متعمق مع تدقيق الفجوات (10-15 مصدر)"
                            >
                              <BookOpen className="w-3 h-3 text-blue-400" />
                              <span>عميق</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDepth('storm')}
                              className={`px-2 py-0.5 rounded transition text-[10.5px] flex items-center gap-1 ${
                                depth === 'storm' ? 'bg-vscode-selection text-white font-medium' : 'text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                              title="محاكاة Stanford STORM لتوافق الآراء المتعددة (20+ مصدر)"
                            >
                              <Layers className="w-3 h-3 text-purple-400" />
                              <span>STORM</span>
                            </button>
                          </div>
                        </div>

                        {/* Row B: Stanford STORM Perspective Selector */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="text-vscode-textMuted font-mono text-[10px]">
                            {language === 'ar' ? 'منظور التحليل:' : 'PERSPECTIVE:'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPerspective('balanced')}
                              className={`px-2 py-0.5 rounded border text-[10.5px] transition ${
                                perspective === 'balanced'
                                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
                                  : 'bg-[#181818] border-vscode-border text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                            >
                              شامل ومتوازن
                            </button>
                            <button
                              type="button"
                              onClick={() => setPerspective('technical')}
                              className={`px-2 py-0.5 rounded border text-[10.5px] transition flex items-center gap-1 ${
                                perspective === 'technical'
                                  ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-400'
                                  : 'bg-[#181818] border-vscode-border text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                            >
                              <Cpu className="w-3 h-3" />
                              <span>معماري وتقني</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPerspective('market')}
                              className={`px-2 py-0.5 rounded border text-[10.5px] transition flex items-center gap-1 ${
                                perspective === 'market'
                                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                                  : 'bg-[#181818] border-vscode-border text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                            >
                              <TrendingUp className="w-3 h-3" />
                              <span>سوق وجدوى</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPerspective('critical')}
                              className={`px-2 py-0.5 rounded border text-[10.5px] transition flex items-center gap-1 ${
                                perspective === 'critical'
                                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                                  : 'bg-[#181818] border-vscode-border text-vscode-textMuted hover:text-vscode-textNormal'
                              }`}
                            >
                              <Scale className="w-3 h-3" />
                              <span>نقد ومخاطر</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Controls inside input (Language & Submit) */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-vscode-border text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 bg-[#181818] px-2 py-0.5 rounded border border-vscode-border text-[10.5px] text-vscode-textMuted">
                            <Languages className="w-3 h-3 text-vscode-textMuted" />
                            <select
                              value={reportLang}
                              onChange={(e) => setReportLang(e.target.value)}
                              className="bg-transparent text-vscode-textNormal focus:outline-none cursor-pointer text-[10.5px]"
                            >
                              <option value="auto" className="bg-[#181818]">{t.lang_auto}</option>
                              <option value="ar" className="bg-[#181818]">{t.lang_ar}</option>
                              <option value="en" className="bg-[#181818]">{t.lang_en}</option>
                            </select>
                          </div>
                        </div>

                        {/* Execute Button */}
                        <button
                          type="submit"
                          disabled={!query.trim() || isSearching}
                          className="flex items-center gap-1.5 px-3 py-1 rounded bg-vscode-accent hover:bg-vscode-accentHover text-white font-medium text-xs transition disabled:opacity-40"
                        >
                          {isSearching ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              <span>جاري الاستكشاف...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3" />
                              <span>بدء البحث المستقل (Enter)</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Sample suggestions */}
                  <div className="space-y-1.5 pt-2">
                    <span className="text-[10px] font-semibold text-vscode-textMuted uppercase tracking-wider">
                      {language === 'ar' ? 'أبحاث مقترحة متعددة الرؤى:' : 'Suggested Researches:'}
                    </span>
                    <div className="grid grid-cols-1 gap-1.5">
                      {samplePrompts.map((p, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setQuery(language === 'ar' ? p.title_ar : p.title_en);
                            setPerspective(p.rec_perspective);
                          }}
                          className="w-full text-left p-2 rounded bg-[#181818] border border-vscode-border hover:border-slate-600 hover:bg-[#202020] transition text-[11px] text-vscode-textNormal flex items-center justify-between group"
                        >
                          <span className="truncate">{language === 'ar' ? p.title_ar : p.title_en}</span>
                          {language === 'ar' ? (
                            <ArrowLeft className="w-3 h-3 text-vscode-textMuted group-hover:text-blue-400 flex-shrink-0" />
                          ) : (
                            <ArrowRight className="w-3 h-3 text-vscode-textMuted group-hover:text-blue-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard Shortcuts Cheat Sheet */}
                  <div className="border-t border-vscode-border pt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] text-vscode-textMuted">
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-1 py-0.5 rounded bg-vscode-input border border-vscode-border font-mono">Ctrl+K</kbd>
                      <span>الأوامر</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-1 py-0.5 rounded bg-vscode-input border border-vscode-border font-mono">Ctrl+N</kbd>
                      <span>بحث جديد</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-1 py-0.5 rounded bg-vscode-input border border-vscode-border font-mono">Ctrl+I</kbd>
                      <span>الوكيل</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <kbd className="px-1 py-0.5 rounded bg-vscode-input border border-vscode-border font-mono">Ctrl+B</kbd>
                      <span>المستكشف</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Living Markdown Report View with Side Outline & Rich Citations */
              <div className="flex justify-center px-8 py-6">
                <div className="w-full max-w-4xl flex gap-8">
                  {/* Prose Document Column */}
                  <div className="flex-1 min-w-0 document-prose">
                    <div className="mb-6 pb-3 border-b border-vscode-border">
                      <h1 className="text-xl sm:text-2xl font-bold text-vscode-textActive mb-2">
                        {report.title || report.query}
                      </h1>
                      <div className="flex items-center gap-3 text-[11px] text-vscode-textMuted">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(report.createdAt).toLocaleString()}</span>
                        </span>
                        <span>•</span>
                        <span>{report.wordCount || report.content.trim().split(/\s+/).length} كلمة</span>
                        <span>•</span>
                        <span>{report.sources.length} مصادر موثقة</span>
                      </div>
                    </div>

                    {/* Markdown Renderer with custom citation badge handler */}
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

                    {/* Report Sources Grid with Credibility Badges */}
                    {report.sources && report.sources.length > 0 && (
                      <div className="mt-12 pt-6 border-t border-vscode-border">
                        <h3 className="text-xs font-bold text-vscode-textActive mb-3 flex items-center justify-between">
                          <span>المصادر والمراجع الموثقة ({report.sources.length})</span>
                          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            <span>مؤشر موثوقية المصادر نشط</span>
                          </span>
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {report.sources.map((src, i) => (
                            <a
                              key={i}
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between p-2 rounded bg-vscode-input border border-vscode-border hover:border-slate-600 transition group text-[11px] text-vscode-textNormal"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="w-4 h-4 rounded bg-vscode-hover text-blue-400 flex items-center justify-center font-bold text-[9px] flex-shrink-0">
                                  {i + 1}
                                </span>
                                <span className="truncate group-hover:text-blue-400 transition">
                                  {src.title || src.url}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                <span className="text-[9.5px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                                  {src.credibility || 85}%
                                </span>
                                <ExternalLink className="w-3 h-3 text-vscode-textMuted group-hover:text-blue-400" />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sticky Outline (TOC) */}
                  {tocHeadings.length > 1 && (
                    <div className="hidden xl:block w-52 flex-shrink-0 sticky top-4 h-fit max-h-[85vh] overflow-y-auto pl-2">
                      <div className="text-[10px] font-semibold text-vscode-textMuted uppercase tracking-wider mb-2 flex items-center gap-1">
                        <List className="w-3 h-3" />
                        <span>فهرس الأقسام</span>
                      </div>
                      <nav className="space-y-0.5 text-[11px]">
                        {tocHeadings.map((h, idx) => (
                          <a
                            key={idx}
                            href={`#${h.id}`}
                            className={`block py-1 px-1.5 rounded transition line-clamp-1 ${
                              h.level === 1
                                ? 'text-vscode-textActive font-medium hover:bg-vscode-hover'
                                : 'pl-3 text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover'
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
            )}
          </>
        )}

        {/* Tab 2: Visual Multi-Hop Research Graph */}
        {activeTab === 'graph' && (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-vscode-border">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-purple-400" />
                <span className="font-semibold text-vscode-textActive text-xs">
                  {language === 'ar' ? 'خريطة مسار استدلال الوكيل متعدد الخطوات (Reasoning DAG)' : 'Agent Reasoning Graph'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-vscode-textMuted">
                {activeSources.length} Sources Connected
              </span>
            </div>

            {/* Visual Node Tree */}
            <div className="space-y-4">
              {/* Root Objective */}
              <div className="p-3 rounded bg-[#181818] border border-blue-500/30 shadow-sm">
                <div className="text-[10px] font-mono text-blue-400 mb-1 uppercase tracking-wider">
                  [ROOT OBJECTIVE]
                </div>
                <div className="text-xs text-vscode-textActive font-medium">
                  {report?.query || query || 'في انتظار إطلاق استعلام البحث...'}
                </div>
              </div>

              {/* Multi-Perspective & Decomposition Nodes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-4 border-l-2 border-purple-500/30">
                <div className="p-2.5 rounded bg-vscode-input border border-vscode-border">
                  <div className="text-[10px] font-mono text-indigo-400 mb-1 flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    <span>Technical Architecture</span>
                  </div>
                  <p className="text-[10.5px] text-vscode-textMuted">
                    تحليل الأنماط الهندسية والمعايير البرمجية
                  </p>
                </div>
                <div className="p-2.5 rounded bg-vscode-input border border-vscode-border">
                  <div className="text-[10px] font-mono text-emerald-400 mb-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>Market & Commercial</span>
                  </div>
                  <p className="text-[10.5px] text-vscode-textMuted">
                    دراسة حركة السوق والشركات الرائدة والتبني
                  </p>
                </div>
                <div className="p-2.5 rounded bg-vscode-input border border-vscode-border">
                  <div className="text-[10px] font-mono text-amber-400 mb-1 flex items-center gap-1">
                    <Scale className="w-3 h-3" />
                    <span>Critical Debate & Risks</span>
                  </div>
                  <p className="text-[10.5px] text-vscode-textMuted">
                    فحص القيود ونقاط الضعف والافتراضات المعارضة
                  </p>
                </div>
              </div>

              {/* Explored Sources Cluster */}
              {activeSources.length > 0 && (
                <div className="space-y-2 pl-4 border-l-2 border-emerald-500/30">
                  <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider">
                    [EVIDENCE CLUSTER: {activeSources.length} DISCOVERED SOURCES]
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {activeSources.slice(0, 9).map((src, i) => (
                      <div key={i} className="p-2 rounded bg-vscode-input border border-vscode-border text-[11px] truncate">
                        <div className="flex items-center justify-between text-[9px] font-mono text-vscode-textMuted mb-1">
                          <span>{src.domain || 'web'}</span>
                          <span className="text-emerald-400">{src.credibility || 80}%</span>
                        </div>
                        <span className="truncate text-vscode-textNormal block font-medium">
                          {src.title || src.url}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reflection & Synthesis Node */}
              <div className="p-3 rounded bg-[#181818] border border-vscode-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-vscode-textActive">
                    {report ? 'تم اكتمال التوليف وبناء التقرير الموثق بنجاح' : 'في انتظار اكتمال دورة الاستدلال'}
                  </span>
                </div>
                {report && (
                  <span className="text-[10px] font-mono text-blue-400">
                    {report.wordCount || report.content.trim().split(/\s+/).length} Words Generated
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Sources JSON Matrix */}
        {activeTab === 'sources' && (
          <div className="p-4 max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between text-xs text-vscode-textMuted pb-2 border-b border-vscode-border">
              <span>مصفوفة المصادر وتقييم الموثوقية ({activeSources.length})</span>
              <span className="font-mono text-[10px]">Academic Authority Scored</span>
            </div>

            <div className="bg-vscode-input border border-vscode-border rounded overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#141414] border-b border-vscode-border text-vscode-textMuted font-mono text-[10px]">
                  <tr>
                    <th className="p-2.5">الموقع / النطاق</th>
                    <th className="p-2.5">عنوان الصفحة</th>
                    <th className="p-2.5">مؤشر الموثوقية</th>
                    <th className="p-2.5 text-right">الرابط</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vscode-border">
                  {activeSources.map((src, idx) => (
                    <tr key={idx} className="hover:bg-vscode-hover transition">
                      <td className="p-2.5 font-mono text-blue-400">
                        {src.domain || 'web'}
                      </td>
                      <td className="p-2.5 text-vscode-textNormal truncate max-w-xs">
                        {src.title || src.url}
                      </td>
                      <td className="p-2.5">
                        <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {src.credibility || 85}%
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-vscode-textMuted hover:text-vscode-accent transition"
                        >
                          <span>زيارة</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Telemetry Logs */}
        {activeTab === 'telemetry' && (
          <div className="p-4 max-w-4xl mx-auto font-mono text-[11px]">
            <div className="bg-[#101010] border border-vscode-border rounded p-4 space-y-1 text-vscode-textMuted">
              <div className="text-vscode-textActive font-semibold pb-2 border-b border-vscode-border flex items-center justify-between">
                <span>[GPT-RESEARCHER + DEEP AGENT TELEMETRY]</span>
                <span className="text-[10px] text-blue-400">STATUS: {isSearching ? 'STREAMING' : 'IDLE'}</span>
              </div>
              {telemetryLogs.length === 0 ? (
                <div className="py-6 text-center italic">لا توجد سجلات تتبع حالياً.</div>
              ) : (
                telemetryLogs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed hover:bg-vscode-hover px-1 rounded">
                    <span className="text-vscode-textMuted select-none mr-2">[{idx + 1}]</span>
                    <span className="text-vscode-textNormal">{log}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
