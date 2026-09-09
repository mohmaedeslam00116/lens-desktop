import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Clock, 
  FileText, 
  Table as TableIcon, 
  GitGraph, 
  ShieldCheck, 
  ListTree, 
  Copy, 
  Check, 
  ChevronRight,
  X
} from 'lucide-react';
import { CustomTable } from './CustomTable';
import { MermaidDiagram } from './MermaidDiagram';
import { CalloutAlert } from './CalloutAlert';
import { CitationBadge } from './CitationBadge';
import { SourceItem, Language } from '../../types';
import { extractTocHeadings } from '../../utils/markdownArtifacts';
import { normalizeEasternNumerals } from '../../utils/evidenceShelf';

interface ReportRendererProps {
  content: string;
  sources: SourceItem[];
  language: Language;
  onInspectCitation?: (index: number) => void;
  onOpenShelf?: () => void;
}

export const ReportRenderer: React.FC<ReportRendererProps> = ({
  content,
  sources,
  language,
  onInspectCitation,
  onOpenShelf,
}) => {
  const isArabic = language === 'ar';
  const [showToc, setShowToc] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Extract ToC headings
  const headings = useMemo(() => extractTocHeadings(content), [content]);

  // Statistics
  const stats = useMemo(() => {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.ceil(words / 220));
    const tableCount = (content.match(/((?:^[ \t]*\|.+?\|[ \t]*\r?\n){3,})/gm) || []).length;
    const diagramCount = (content.match(/```mermaid/g) || []).length;
    return {
      words,
      readingTime,
      tableCount,
      diagramCount,
      sourcesCount: sources.length
    };
  }, [content, sources]);

  // Helper to parse citations inside text with full multi-citation, range, and Arabic numeral support
  const renderTextWithCitations = (text: string) => {
    if (!text || typeof text !== 'string') return text;

    // Match any bracket containing digits, eastern arabic digits, commas, semicolons, dashes
    const bracketRegex = /(\[[\d٠-٩۰-۹\s,;،\-\u2013\u2014]+\])/g;
    const parts = text.split(bracketRegex);
    if (parts.length === 1) return text;

    const result: React.ReactNode[] = [];

    parts.forEach((part, idx) => {
      const match = part.match(/^\[([\d٠-٩۰-۹\s,;،\-\u2013\u2014]+)\]$/);
      if (match && /[\d٠-٩۰-۹]/.test(match[1])) {
        // Extract all individual citation numbers
        const inner = normalizeEasternNumerals(match[1].trim());
        const subparts = inner.split(/[,;،]/);
        const numbers: number[] = [];

        for (const raw of subparts) {
          const s = raw.trim();
          if (!s) continue;
          const rangeMatch = s.match(/^(\d+)\s*[\-\u2013\u2014]\s*(\d+)$/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            if (start <= end && end - start <= 100) {
              const maxValid = sources.length > 0 ? sources.length : Infinity;
              for (let k = start; k <= end; k++) {
                if (k > 0 && k <= maxValid) numbers.push(k);
              }
            }
          } else {
            const num = parseInt(s, 10);
            const maxValid = sources.length > 0 ? sources.length : Infinity;
            if (!isNaN(num) && num > 0 && num <= maxValid) {
              numbers.push(num);
            }
          }
        }

        if (numbers.length > 0) {
          numbers.forEach((num, subIdx) => {
            result.push(
              <CitationBadge
                key={`cit-${idx}-${subIdx}-${num}`}
                index={num}
                sources={sources}
                onInspect={onInspectCitation}
              />
            );
          });
          return;
        }
      }
      result.push(part);
    });

    return result;
  };

  // Helper to recursively process React children for inline citations
  const processChildrenForCitations = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === 'string') {
        return renderTextWithCitations(child);
      }
      if (React.isValidElement(child) && (child.props as any)?.children) {
        return React.cloneElement(child, {
          ...(child.props as any),
          children: processChildrenForCitations((child.props as any).children)
        });
      }
      return child;
    });
  };

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const markdownComponents = {
    // Custom Table Container
    table: ({ children }: any) => <CustomTable language={language}>{children}</CustomTable>,

    thead: ({ children }: any) => (
      <thead className="bg-surface text-slate-200 border-b border-white/[0.08] font-semibold text-xs">
        {children}
      </thead>
    ),

    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-white/[0.04] text-slate-300">
        {children}
      </tbody>
    ),

    th: ({ children }: any) => (
      <th className="px-3.5 py-3 text-left rtl:text-right font-semibold text-slate-200 tracking-wider">
        {children}
      </th>
    ),

    td: ({ children }: any) => (
      <td className="px-3.5 py-3 text-left rtl:text-right align-top border-t border-white/[0.04]">
        {processChildrenForCitations(children)}
      </td>
    ),

    // Blockquote Callout
    blockquote: ({ children }: any) => <CalloutAlert>{children}</CalloutAlert>,

    // Code & Mermaid Diagrams
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const languageName = match ? match[1] : '';
      const rawCode = String(children).replace(/\n$/, '');

      if (!inline && languageName === 'mermaid') {
        return <MermaidDiagram code={rawCode} />;
      }

      if (!inline) {
        const codeId = `code-${Math.random().toString(36).substring(2, 7)}`;
        return (
          <div className="my-4 rounded-xl border border-white/[0.08] bg-canvas overflow-hidden select-text">
            <div className="px-4 py-2 bg-panel border-b border-white/[0.06] flex items-center justify-between text-xs text-slate-400 select-none">
              <span className="font-mono text-[11px] text-accent uppercase">{languageName || 'code'}</span>
              <button
                type="button"
                onClick={() => handleCopyCode(rawCode, codeId)}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] transition"
              >
                {copiedCodeId === codeId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCodeId === codeId ? (isArabic ? 'تم النسخ' : 'Copied') : (isArabic ? 'نسخ' : 'Copy')}</span>
              </button>
            </div>
            <pre className="p-4 overflow-x-auto text-xs text-slate-200 font-mono leading-relaxed bg-canvas/70">
              <code>{rawCode}</code>
            </pre>
          </div>
        );
      }

      return (
        <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-accent font-mono text-[12px] border border-white/[0.06]" {...props}>
          {children}
        </code>
      );
    },

    // Paragraphs with inline citation parsing
    p: ({ children }: any) => (
      <p className="my-3.5 leading-relaxed text-[15px] text-slate-300 font-normal">
        {processChildrenForCitations(children)}
      </p>
    ),

    // List items with citation parsing
    li: ({ children }: any) => (
      <li className="my-1.5 leading-relaxed text-[14.5px] text-slate-300">
        {processChildrenForCitations(children)}
      </li>
    ),

    // Headings with clean typography
    h1: ({ children }: any) => {
      const text = String(children);
      const id = text.toLowerCase().replace(/[^\w\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '-');
      return (
        <h1 id={id} className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight mt-8 mb-4 pb-2 border-b border-white/[0.06]">
          {children}
        </h1>
      );
    },

    h2: ({ children }: any) => {
      const text = String(children);
      const id = text.toLowerCase().replace(/[^\w\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '-');
      return (
        <h2 id={id} className="text-xl sm:text-2xl font-semibold text-slate-100 mt-8 mb-3 pt-4 border-t border-white/[0.04]">
          {children}
        </h2>
      );
    },

    h3: ({ children }: any) => {
      const text = String(children);
      const id = text.toLowerCase().replace(/[^\w\u0600-\u06FF\s-]/g, '').replace(/\s+/g, '-');
      return (
        <h3 id={id} className="text-base sm:text-lg font-medium text-slate-200 mt-6 mb-2">
          {children}
        </h3>
      );
    },

    hr: () => <hr className="my-6 border-white/[0.06]" />
  };

  return (
    <div className="space-y-6 select-text">
      {/* 1. Document Reading Metadata Stats Bar */}
      <div className="py-3 border-b border-line flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 select-none">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Clock className="w-3.5 h-3.5 text-accent" />
            <span>{stats.readingTime} {isArabic ? 'دقائق قراءة' : 'min read'}</span>
          </span>

          <span className="flex items-center gap-1.5 text-slate-300">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>{stats.words.toLocaleString()} {isArabic ? 'كلمة' : 'words'}</span>
          </span>

          {stats.tableCount > 0 && (
            <span className="flex items-center gap-1.5 text-slate-300">
              <TableIcon className="w-3.5 h-3.5 text-muted" />
              <span>{stats.tableCount} {isArabic ? 'جداول' : 'tables'}</span>
            </span>
          )}

          {stats.diagramCount > 0 && (
            <span className="flex items-center gap-1.5 text-slate-300">
              <GitGraph className="w-3.5 h-3.5 text-muted" />
              <span>{stats.diagramCount} {isArabic ? 'مخططات' : 'diagrams'}</span>
            </span>
          )}

          {onOpenShelf ? (
            <button
              type="button"
              onClick={onOpenShelf}
              className="flex items-center gap-1.5 text-slate-300 hover:text-accent transition cursor-pointer p-0.5 rounded hover:bg-white/5"
              title={isArabic ? 'فتح رف المصادر المصنفة' : 'Open facet-grouped source shelf'}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>{stats.sourcesCount} {isArabic ? 'مصادر موثقة' : 'citations'}</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>{stats.sourcesCount} {isArabic ? 'مصادر موثقة' : 'citations'}</span>
            </span>
          )}
        </div>

        {/* ToC Toggle Button */}
        {headings.length > 0 && (
          <button
            type="button"
            onClick={() => setShowToc(!showToc)}
            aria-expanded={showToc}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 hover:text-white border border-white/[0.06] text-xs font-medium transition"
          >
            <ListTree className="w-3.5 h-3.5 text-accent" />
            <span>{isArabic ? 'فهرس المحتويات' : 'Table of Contents'}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-accent/10 text-accent text-[10px] font-mono">
              {headings.length}
            </span>
          </button>
        )}
      </div>

      {/* 2. Interactive Table of Contents Drawer */}
      {showToc && headings.length > 0 && (
        <div className="p-4 rounded-xl bg-panel border border-white/[0.08]  space-y-2 animate-fadeIn select-none">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <ListTree className="w-4 h-4 text-accent" />
              <span>{isArabic ? 'الانتقال السريع لأقسام التقرير' : 'Jump to Section'}</span>
            </h4>
            <button
              onClick={() => setShowToc(false)}
              aria-label={isArabic ? 'إغلاق الفهرس' : 'Close contents'}
              className="text-xs text-slate-400 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto custom-scrollbar pt-1">
            {headings.map((h, i) => (
              <button
                key={i}
                onClick={() => {
                  scrollToHeading(h.id);
                  setShowToc(false);
                }}
                className={`text-left rtl:text-right p-2 rounded-lg text-xs hover:bg-white/[0.04] text-slate-300 hover:text-accent transition truncate flex items-center gap-2 ${
                  h.level === 1 ? 'font-semibold text-white' : h.level === 2 ? 'font-medium pl-3 rtl:pr-3' : 'text-slate-400 pl-5 rtl:pr-5 text-[11px]'
                }`}
              >
                <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{h.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. The Living Document Content */}
      <article className="document-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
};
