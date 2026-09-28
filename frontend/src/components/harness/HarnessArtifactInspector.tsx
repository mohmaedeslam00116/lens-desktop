import React from 'react';
import { BookOpen, FileText, ListTree, Network, X } from 'lucide-react';
import type { Language, ResearchGraphNode, ResearchPlan, SourceItem } from '../../types';
import type { HarnessArtifactTab } from '../../utils/harnessWorkspace';

interface HarnessArtifactInspectorProps {
  availableTabs: HarnessArtifactTab[];
  selectedTab: HarnessArtifactTab;
  onSelectTab: (tab: HarnessArtifactTab) => void;
  onClose: () => void;
  language: Language;
  plan?: ResearchPlan | null;
  sources: SourceItem[];
  report: string;
  graphNodes: ResearchGraphNode[];
}

const tabMeta: Record<HarnessArtifactTab, { en: string; ar: string; icon: typeof ListTree }> = {
  plan: { en: 'Plan', ar: 'الخطة', icon: ListTree },
  evidence: { en: 'Evidence', ar: 'الأدلة', icon: BookOpen },
  report: { en: 'Report', ar: 'التقرير', icon: FileText },
  graph: { en: 'Graph', ar: 'الخريطة', icon: Network },
};

/** A compact companion to the canvas: it never invents an unavailable artifact. */
export const HarnessArtifactInspector: React.FC<HarnessArtifactInspectorProps> = ({
  availableTabs,
  selectedTab,
  onSelectTab,
  onClose,
  language,
  plan,
  sources,
  report,
  graphNodes,
}) => {
  if (availableTabs.length === 0) return null;

  const ar = language === 'ar';
  const label = (tab: HarnessArtifactTab) => tabMeta[tab][ar ? 'ar' : 'en'];

  return (
    <aside className="harness-inspector" aria-label={ar ? 'مقتنيات البحث' : 'Research artifacts'}>
      <header className="harness-inspector__header">
        <div>
          <h2>{ar ? `مقتنيات البحث: ${label(selectedTab)}` : `Research artifacts: ${label(selectedTab)}`}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={ar ? 'إغلاق المقتنيات' : 'Close artifacts'}>
          <X size={17} />
        </button>
      </header>

      <div className="harness-tabs" role="tablist" aria-label={ar ? 'أقسام المقتنيات' : 'Artifact sections'}>
        {availableTabs.map((tab) => {
          const Icon = tabMeta[tab].icon;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selectedTab === tab}
              className="harness-tab"
              onClick={() => onSelectTab(tab)}
            >
              <Icon size={14} />
              <span>{label(tab)}</span>
            </button>
          );
        })}
      </div>

      <div className="harness-inspector__body" role="tabpanel">
        {selectedTab === 'plan' && plan && (
          <section className="harness-artifact-list">
            <p className="harness-artifact-summary">{plan.objective}</p>
            <ol>
              {plan.milestones.map((milestone) => <li key={milestone.id}>{milestone.query}</li>)}
            </ol>
          </section>
        )}

        {selectedTab === 'evidence' && (
          <section className="harness-artifact-list">
            <p className="harness-artifact-summary">
              {ar ? `${sources.length} مصدر متاح لهذه الجلسة` : `${sources.length} sources available in this session`}
            </p>
            <ol>
              {sources.map((source, index) => (
                <li key={`${source.url}-${index}`}>
                  <strong>{source.title || source.domain || source.url}</strong>
                  {source.url && <bdi dir="ltr">{source.domain || source.url}</bdi>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {selectedTab === 'report' && (
          <section className="harness-artifact-list">
            <p className="harness-artifact-summary">
              {ar ? 'يتوفر التقرير في مساحة القراءة الرئيسية.' : 'The report is available in the main reading canvas.'}
            </p>
            <p className="harness-report-preview">{report.trim().slice(0, 280)}</p>
          </section>
        )}

        {selectedTab === 'graph' && (
          <section className="harness-artifact-list">
            <p className="harness-artifact-summary">
              {ar ? `${graphNodes.length} عقدة وصلَت من جلسة البحث.` : `${graphNodes.length} nodes arrived from this research session.`}
            </p>
            <ol>
              {graphNodes.slice(0, 8).map((node) => <li key={node.id}>{node.label}</li>)}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
};
