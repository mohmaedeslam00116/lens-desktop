import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, GitGraph, RefreshCw } from 'lucide-react';
import { Language } from '../../types';

/**
 * Deferred entry point for `MermaidDiagram`.
 *
 * The diagram runtimes behind mermaid are the heaviest thing the renderer
 * ships — larger, once bundled, than the application code around them — and
 * they are only reachable once a report or workspace actually contains a
 * ```mermaid block. Importing the component statically therefore paid that
 * cost in every session, including the ones that never draw a diagram, so the
 * component is split into its own chunk and fetched on the first diagram that
 * mounts.
 *
 * The placeholder reproduces the frame `MermaidDiagram` renders for itself
 * while it works (same shell, same mark, same caption), so a mounted diagram
 * looks identical whether it is waiting on the chunk or on the render.
 *
 * Deferring also introduced a failure the static import could not have: the
 * chunk is fetched at the moment a diagram appears, so that fetch can fail, and
 * `React.lazy` throws during render when it does. `Suspense` waits for pending
 * work but has no rejection path, so without a boundary here the error would
 * escape to the nearest ancestor — dropping the surrounding report, or the whole
 * interface when there is none — because one diagram could not be downloaded.
 * `DiagramErrorBoundary` keeps that failure inside the frame, keeps the diagram
 * source readable, and retries by fetching the chunk again.
 */
const loadMermaidDiagram = () =>
  import('./MermaidDiagram').then((module) => ({ default: module.MermaidDiagram }));

interface DiagramCanvasProps {
  code: string;
  title?: string;
  language: Language;
}

/**
 * Chrome shared by every diagram state, so a waiting or failed frame is the
 * same object as a rendered one.
 */
const DiagramFrame: React.FC<{
  title?: string;
  language: Language;
  aside: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, language, aside, children }) => (
  <div className="my-6 rounded-xl border border-line bg-canvas overflow-hidden select-text">
    <div className="px-4 py-2.5 bg-panel border-b border-line flex items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center">
          <GitGraph className="w-3 h-3" />
        </div>
        <span className="font-semibold text-slate-200 text-xs">
          {title || (language === 'ar' ? 'مخطط المعمارية وتدفق العمليات' : 'Architecture & Process Diagram')}
        </span>
      </div>
      {aside}
    </div>
    {children}
  </div>
);

const MermaidChip: React.FC = () => (
  <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-accent">
    Mermaid
  </span>
);

const DiagramFramePlaceholder: React.FC<{ title?: string; language: Language }> = ({ title, language }) => (
  <DiagramFrame title={title} language={language} aside={<MermaidChip />}>
    <div className="p-4 flex items-center justify-center min-h-[140px] bg-canvas/60">
      <div className="py-6 flex items-center gap-2 text-xs text-slate-500">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
        <span>{language === 'ar' ? 'جاري تصيير المخطط المعماري...' : 'Rendering the architecture diagram...'}</span>
      </div>
    </div>
  </DiagramFrame>
);


const DiagramFailure: React.FC<{ code: string; language: Language; onRetry: () => void }> = ({
  code,
  language,
  onRetry,
}) => (
  <DiagramFrame
    language={language}
    aside={
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition text-[11px] border border-white/5"
      >
        <RefreshCw className="w-3 h-3" />
        <span>{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</span>
      </button>
    }
  >
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <span className="text-slate-200">
          {language === 'ar' ? 'تعذّر تحميل عارض المخططات' : 'Diagram renderer could not load'}
        </span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        {language === 'ar'
          ? 'لم يتمكن التطبيق من تحميل مكوّن تصيير المخططات من حزمة التطبيق. كود المخطط محفوظ بالأسفل، ويمكنك إعادة المحاولة.'
          : 'The application could not load the diagram renderer from its bundle. The diagram source is preserved below, and you can retry.'}
      </p>
      <pre className="text-left font-mono text-[11px] p-3 rounded-lg bg-panel border border-line text-slate-300 overflow-x-auto">
        {code}
      </pre>
    </div>
  </DiagramFrame>
);

interface DiagramErrorBoundaryProps {
  code: string;
  language: Language;
  onRetry: () => void;
  children: React.ReactNode;
}

/**
 * Holds the failure state for one diagram frame — the only place a chunk
 * rejection can be handled, since `Suspense` does not catch errors.
 */
class DiagramErrorBoundary extends React.Component<DiagramErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A failure reaching here is a transport or packaging problem rather than
    // invalid diagram syntax: `MermaidDiagram` reports syntax errors in frame.
    console.warn('[LENS] Diagram renderer chunk failed to load:', error);
  }

  render() {
    if (this.state.failed) {
      return <DiagramFailure code={this.props.code} language={this.props.language} onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({ code, title, language }) => {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // Rebuilt per attempt on purpose: `React.lazy` keeps the rejected promise of a
  // failed import, so asking again has to mean a new `import()` call. The key on
  // the boundary clears its failure state in the same step.
  const LazyDiagram = useMemo(() => React.lazy(loadMermaidDiagram), [attempt]);

  return (
    <DiagramErrorBoundary key={attempt} code={code} language={language} onRetry={retry}>
      <Suspense fallback={<DiagramFramePlaceholder title={title} language={language} />}>
        <LazyDiagram code={code} title={title} language={language} />
      </Suspense>
    </DiagramErrorBoundary>
  );
};

