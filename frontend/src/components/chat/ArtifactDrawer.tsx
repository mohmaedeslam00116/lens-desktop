import React, { Suspense } from 'react';
import { X } from 'lucide-react';
import type { Language } from '../../types';
import type { ChatArtifact, ChatTurn } from './types';
import { HarnessArtifactInspector } from '../harness/HarnessArtifactInspector';
import type { HarnessArtifactTab } from '../../utils/harnessWorkspace';
import { FacetGroupedShelf } from '../research/FacetGroupedShelf';
import { AgenticConversation } from '../vane/AgenticConversation';

const LazyGraphView = React.lazy(() =>
  import('../vane/GraphView').then((m) => ({ default: m.GraphView }))
);
const LazyReportCanvas = React.lazy(() =>
  import('../vane/ReportCanvas').then((m) => ({ default: m.ReportCanvas }))
);

interface ArtifactDrawerProps {
  language: Language;
  artifact: ChatArtifact | null;
  turn: ChatTurn | null;
  availableTabs: HarnessArtifactTab[];
  onClose: () => void;
  onSelectTab: (tab: HarnessArtifactTab) => void;
  selectedTab: HarnessArtifactTab | null;
  onInspectCitation: (index: number) => void;
}

/**
 * ArtifactDrawer — the contextual artifact surface. Closed by default,
 * opens only on request (sources, plan, graph, report, conversation),
 * Escape closes, focus is trapped by the inner drawers. The legacy
 * HarnessArtifactInspector stays the tabbed companion for plan/evidence
 * summaries; the full shelf, graph and report ride lazy chunks so the
 * conversation shell stays cheap before a report exists.
 */
export const ArtifactDrawer: React.FC<ArtifactDrawerProps> = ({
  language,
  artifact,
  turn,
  availableTabs,
  onClose,
  onSelectTab,
  selectedTab,
  onInspectCitation,
}) => {
  const ar = language === 'ar';
  React.useEffect(() => {
    if (!artifact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [artifact, onClose]);

  if (!artifact || !turn) return null;
  const title: Record<string, string> = {
    sources: ar ? 'المصادر' : 'Sources',
    plan: ar ? 'خطة البحث' : 'Research plan',
    graph: ar ? 'خريطة البحث' : 'Research graph',
    report: ar ? 'التقرير الكامل' : 'Full report',
    conversation: ar ? 'المحادثة الأجنتية' : 'Agentic conversation',
  };

  return (
    <div className="chat-drawer-scrim" data-testid="chat-artifact-drawer">
      <div className="chat-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="chat-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title[artifact.kind] ?? (ar ? 'مقتنيات البحث' : 'Research artifacts')}
        dir={ar ? 'rtl' : 'ltr'}
        tabIndex={-1}
      >
        <header className="chat-drawer-head">
          <h2>{title[artifact.kind]}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
            <X size={16} />
          </button>
        </header>
        <div className="chat-drawer-body">
          {artifact.kind === 'sources' && (
            <FacetGroupedShelf
              sources={turn.sources}
              plan={turn.plan}
              reportContent={turn.report}
              language={language}
              onInspectEvidence={onInspectCitation}
            />
          )}
          {artifact.kind === 'plan' && turn.plan && (
            <section className="chat-drawer-plan" dir="auto">
              <p className="chat-plan-objective">{turn.plan.objective}</p>
              <ol className="chat-plan-steps">
                {turn.plan.milestones.map((m, i) => (
                  <li key={m.id}><span aria-hidden="true">{i + 1}. </span>{m.query}</li>
                ))}
              </ol>
            </section>
          )}
          {artifact.kind === 'graph' && (
            <Suspense fallback={<p className="chat-drawer-pending">{ar ? 'جاري تحضير الخريطة…' : 'Preparing the graph…'}</p>}>
              <LazyGraphView graphNodes={turn.graphNodes ?? []} query={turn.query} loading={false} language={language} />
            </Suspense>
          )}
          {artifact.kind === 'report' && (
            <Suspense fallback={<p className="chat-drawer-pending">{ar ? 'جاري تحضير التقرير…' : 'Preparing the report…'}</p>}>
              <LazyReportCanvas content={turn.report} sources={turn.sources} language={language} onInspectCitation={onInspectCitation} />
            </Suspense>
          )}
          {artifact.kind === 'conversation' && (
            <AgenticConversation projection={turn.conversationProjection ?? null} language={language} />
          )}
          {(artifact.kind === 'plan' || artifact.kind === 'sources') && selectedTab && (
            <HarnessArtifactInspector
              availableTabs={availableTabs}
              selectedTab={selectedTab}
              onSelectTab={onSelectTab}
              onClose={() => {}}
              language={language}
              plan={turn.plan}
              sources={turn.sources}
              report={turn.report}
              graphNodes={turn.graphNodes ?? []}
              conversationProjection={turn.conversationProjection}
            />
          )}
        </div>
      </aside>
    </div>
  );
};
