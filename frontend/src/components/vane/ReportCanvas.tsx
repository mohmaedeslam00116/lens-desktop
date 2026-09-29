import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, FileText, RefreshCw } from 'lucide-react';
import { SourceItem, Language } from '../../types';

/**
 * Deferred entry point for `ReportRenderer`.
 *
 * The markdown pipeline behind the report view (react-markdown plus the
 * micromark/mdast/hast chain it pulls in) was carried in the initial bundle by
 * a single static import in `MessageBox`, even though a report can only exist
 * once a run has produced one. Every launch that never reached a finished
 * report — including the first one — paid for a renderer it had nothing to
 * render, so the component is split into its own chunk and fetched when a
 * report view actually mounts.
 *
 * Deferring introduces a failure the static import could not have: the chunk is
 * fetched at the moment the report appears, so that fetch can fail, and
 * `React.lazy` throws during render when it does. `Suspense` waits for pending
 * work but has no rejection path, so without a boundary here the error would
 * escape to the nearest ancestor — dropping the workspace around a report that
 * is otherwise complete. `ReportErrorBoundary` keeps the failure inside the
 * report frame, keeps the report text readable and copyable, and retries by
 * fetching the chunk again.
 */
const loadReportRenderer = () =>
  import('./ReportRenderer').then((module) => ({ default: module.ReportRenderer }));

interface ReportCanvasProps {
  content: string;
  sources: SourceItem[];
  language: Language;
  onInspectCitation?: (index: number) => void;
  onOpenShelf?: () => void;
}

const ReportPlaceholder: React.FC<{ language: Language }> = ({ language }) => (
  <div className="rounded-xl border border-line bg-canvas overflow-hidden">
    <div className="px-4 py-2.5 bg-panel border-b border-line flex items-center gap-2 select-none">
      <div className="w-5 h-5 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center">
        <FileText className="w-3 h-3" />
      </div>
      <span className="font-semibold text-slate-200 text-xs">
        {language === 'ar' ? 'التقرير البحثي' : 'Research Report'}
      </span>
    </div>
    <div className="p-4 flex items-center justify-center min-h-[160px] bg-canvas/60">
      <div className="py-6 flex items-center gap-2 text-xs text-slate-500">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
        <span>{language === 'ar' ? 'جاري تحضير عرض التقرير...' : 'Preparing the report view...'}</span>
      </div>
    </div>
  </div>
);

const ReportFailure: React.FC<{ content: string; language: Language; onRetry: () => void }> = ({
  content,
  language,
  onRetry,
}) => (
  <div className="rounded-xl border border-line bg-canvas overflow-hidden">
    <div className="px-4 py-2.5 bg-panel border-b border-line flex items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center">
          <FileText className="w-3 h-3" />
        </div>
        <span className="font-semibold text-slate-200 text-xs">
          {language === 'ar' ? 'التقرير البحثي' : 'Research Report'}
        </span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition text-[11px] border border-white/5"
      >
        <RefreshCw className="w-3 h-3" />
        <span>{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</span>
      </button>
    </div>

    <div className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <span className="text-slate-200">
          {language === 'ar' ? 'تعذّر تحميل عارض التقرير' : 'Report renderer could not load'}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        {language === 'ar'
          ? 'لم يتمكن التطبيق من تحميل مكوّن عرض التقرير من حزمة التطبيق. نص التقرير محفوظ بالأسفل، ويمكنك إعادة المحاولة.'
          : 'The application could not load the report renderer from its bundle. The report text is preserved below, and you can retry.'}
      </p>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-left font-mono text-[11px] p-3 rounded-lg bg-panel border border-line text-slate-300">
        {content}
      </pre>
    </div>
  </div>
);

interface ReportErrorBoundaryProps {
  content: string;
  language: Language;
  onRetry: () => void;
  children: React.ReactNode;
}

/**
 * Holds the failure state for the report frame — the only place a chunk
 * rejection can be handled, since `Suspense` does not catch errors.
 */
class ReportErrorBoundary extends React.Component<ReportErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A failure reaching here is a transport or packaging problem rather than
    // invalid report content: the renderer reports content problems in place.
    console.warn('[LENS] Report renderer chunk failed to load:', error);
  }

  render() {
    if (this.state.failed) {
      return <ReportFailure content={this.props.content} language={this.props.language} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

export const ReportCanvas: React.FC<ReportCanvasProps> = ({
  content,
  sources,
  language,
  onInspectCitation,
  onOpenShelf,
}) => {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // Rebuilt per attempt on purpose: `React.lazy` keeps the rejected promise of a
  // failed import, so asking again has to mean a new `import()` call. The key on
  // the boundary clears its failure state in the same step.
  const LazyReport = useMemo(() => React.lazy(loadReportRenderer), [attempt]);

  return (
    <ReportErrorBoundary key={attempt} content={content} language={language} onRetry={retry}>
      <Suspense fallback={<ReportPlaceholder language={language} />}>
        <LazyReport
          content={content}
          sources={sources}
          language={language}
          onInspectCitation={onInspectCitation}
          onOpenShelf={onOpenShelf}
        />
      </Suspense>
    </ReportErrorBoundary>
  );
};
