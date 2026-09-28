import React, { Suspense } from 'react';
import { GitGraph, RefreshCw } from 'lucide-react';

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
 */
const MermaidDiagram = React.lazy(() =>
  import('./MermaidDiagram').then((module) => ({ default: module.MermaidDiagram }))
);

interface DiagramCanvasProps {
  code: string;
  title?: string;
}

const DiagramFramePlaceholder: React.FC<{ title?: string }> = ({ title }) => (
  <div className="my-6 rounded-xl border border-line bg-canvas overflow-hidden select-text">
    <div className="px-4 py-2.5 bg-panel border-b border-line flex items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center">
          <GitGraph className="w-3 h-3" />
        </div>
        <span className="font-semibold text-slate-200 text-xs">
          {title || 'مخطط المعمارية وتدفق العمليات (Architecture Diagram)'}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-accent">
          Mermaid
        </span>
      </div>
    </div>

    <div className="p-4 flex items-center justify-center min-h-[140px] bg-canvas/60">
      <div className="py-6 flex items-center gap-2 text-xs text-slate-500">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
        <span>جاري تصيير المخطط المعماري...</span>
      </div>
    </div>
  </div>
);

export const DiagramCanvas: React.FC<DiagramCanvasProps> = ({ code, title }) => (
  <Suspense fallback={<DiagramFramePlaceholder title={title} />}>
    <MermaidDiagram code={code} title={title} />
  </Suspense>
);
