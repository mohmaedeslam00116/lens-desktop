import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, FileText, History, PanelLeft, Plus } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import { EmptyChatMessageInput } from '../vane/EmptyChatMessageInput';
import { MessageBox } from '../vane/MessageBox';
import { MessageInput } from '../vane/MessageInput';
import { AgentFeedList } from '../AgentFeedList';
import { HarnessArtifactInspector } from './HarnessArtifactInspector';
import {
  availableHarnessArtifacts,
  defaultHarnessArtifact,
  deriveHarnessSessionCard,
  type HarnessArtifactTab,
} from '../../utils/harnessWorkspace';
import type { AgentFeedState } from '../../utils/liveFeed';
import type {
  ApiSettings,
  Language,
  ReportData,
  ResearchGraphNode,
  ResearchMode,
  ResearchPlan,
  ResearchStep,
  SourceItem,
  WideResearchTelemetry,
} from '../../types';

interface LensHarnessWorkspaceProps {
  language: Language;
  query: string;
  setQuery: (query: string) => void;
  settings: ApiSettings;
  loading: boolean;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  setOptimizationMode: (mode: 'speed' | 'balanced' | 'quality') => void;
  sourceFocus: 'web' | 'academic' | 'social';
  setSourceFocus: (focus: 'web' | 'academic' | 'social') => void;
  researchMode: ResearchMode;
  setResearchMode: (mode: ResearchMode) => void;
  currentQuery: string;
  currentStatus: string;
  researchError: string;
  report: string;
  sources: SourceItem[];
  steps: ResearchStep[];
  plan?: ResearchPlan | null;
  graphNodes: ResearchGraphNode[];
  thoughts: string[];
  subqueries: string[];
  agents: AgentFeedState[];
  agentEventCount: number;
  history: ReportData[];
  wideTelemetry?: WideResearchTelemetry | null;
  wideExpansionHistory?: WideResearchTelemetry[];
  onStartResearch: (query: string) => void;
  onNewResearch: () => void;
  onSelectReport: (report: ReportData) => void;
  onOpenSettings: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onExit: () => void;
}

const cardStateClass: Record<AgentFeedState['status'], string> = {
  running: 'text-muted',
  waiting: 'text-muted',
  retrying: 'text-amber-400',
  success: 'text-emerald-400',
  failed: 'text-rose-400',
};

export const LensHarnessWorkspace: React.FC<LensHarnessWorkspaceProps> = ({
  language,
  query,
  setQuery,
  settings,
  loading,
  optimizationMode,
  setOptimizationMode,
  sourceFocus,
  setSourceFocus,
  researchMode,
  setResearchMode,
  currentQuery,
  currentStatus,
  researchError,
  report,
  sources,
  steps,
  plan,
  graphNodes,
  thoughts,
  subqueries,
  agents,
  agentEventCount,
  history,
  wideTelemetry,
  wideExpansionHistory,
  onStartResearch,
  onNewResearch,
  onSelectReport,
  onOpenSettings,
  onExport,
  onExit,
}) => {
  const ar = language === 'ar';
  const artifactInput = useMemo(() => ({ plan, sources, report, graphNodes }), [plan, sources, report, graphNodes]);
  const availableTabs = useMemo(() => availableHarnessArtifacts(artifactInput), [artifactInput]);
  const [selectedTab, setSelectedTab] = useState<HarnessArtifactTab | null>(() => defaultHarnessArtifact(artifactInput));
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isRailOpen, setIsRailOpen] = useState(false);

  useEffect(() => {
    if (availableTabs.length === 0) {
      setSelectedTab(null);
      return;
    }
    if (!selectedTab || !availableTabs.includes(selectedTab)) {
      setSelectedTab(defaultHarnessArtifact(artifactInput));
      setIsInspectorOpen(true);
    }
  }, [artifactInput, availableTabs, selectedTab]);

  const sessionCard = deriveHarnessSessionCard({ loading, status: currentStatus, error: researchError });
  const hasSession = Boolean(currentQuery || report || loading || researchError);
  const exitLabel = ar ? 'العودة إلى LENS' : 'Back to LENS';

  return (
    <div className="lens-harness" data-testid="lens-harness" dir={ar ? 'rtl' : 'ltr'}>
      <aside className={`harness-rail${isRailOpen ? ' is-open' : ''}`} aria-label={ar ? 'سجل البحث والتنقل' : 'Research history and navigation'}>
        <button className="harness-brand" type="button" onClick={onNewResearch} aria-label={ar ? 'LENS — بحث جديد' : 'LENS — New research'}>
          <BrandLogo />
        </button>
        <button className="harness-new-research" type="button" onClick={() => { onNewResearch(); setIsRailOpen(false); }}>
          <Plus size={16} />
          <span>{ar ? 'بحث جديد' : 'New research'}</span>
        </button>

        <section className="harness-history" aria-labelledby="harness-history-title">
          <div className="harness-section-heading">
            <History size={14} />
            <h2 id="harness-history-title">{ar ? 'الأبحاث الأخيرة' : 'Recent research'}</h2>
          </div>
          {history.length === 0 ? (
            <p className="harness-history-empty">{ar ? 'ستظهر الأبحاث المحفوظة هنا.' : 'Saved research will appear here.'}</p>
          ) : (
            <ol className="harness-history-list">
              {history.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={item.query === currentQuery ? 'page' : undefined}
                    onClick={() => { onSelectReport(item); setIsRailOpen(false); }}
                    title={item.query}
                  >
                    <FileText size={14} />
                    <span>{item.title || item.query}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>

      <section className="harness-workspace">
        <header className="harness-utility-bar">
          <div className="harness-location"><span dir="ltr">LENS</span><span aria-hidden="true">/</span><strong>{ar ? 'مساحة البحث' : 'Research workspace'}</strong></div>
          <div className="harness-utility-actions">
            <button
              type="button"
              className="harness-utility-button harness-rail-toggle"
              onClick={() => setIsRailOpen((open) => !open)}
              aria-label={ar ? 'تبديل سجل البحث' : 'Toggle research history'}
            >
              <PanelLeft size={15} />
              <span>{ar ? 'السجل' : 'History'}</span>
            </button>
            {availableTabs.length > 0 && !isInspectorOpen && (
              <button type="button" className="harness-utility-button" onClick={() => setIsInspectorOpen(true)}>
                <Eye size={15} />
                <span>{ar ? 'إظهار المقتنيات' : 'Show artifacts'}</span>
              </button>
            )}
            <button type="button" className="harness-utility-button" onClick={onExit}>
              {ar ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}
              <span>{exitLabel}</span>
            </button>
          </div>
        </header>

        <main className="harness-canvas" id="main-content">
          {!hasSession ? (
            <div className="harness-empty-state">
              <div className="harness-empty-intro">
                <p className="harness-eyebrow">{ar ? 'بحث، في بؤرة التركيز.' : 'Research, in focus.'}</p>
                <h1>{ar ? 'ابدأ بسؤال يستحق نظرة أعمق.' : 'Start with a question worth a closer look.'}</h1>
                <p>{ar ? 'سيبقى الدليل ومسار البحث واضحين مع تقدّم الجلسة.' : 'Evidence and the research path remain clear as the session develops.'}</p>
              </div>
              <EmptyChatMessageInput
                query={query}
                setQuery={setQuery}
                onSubmit={() => onStartResearch(query)}
                loading={loading}
                language={language}
                settings={settings}
                onOpenSettings={onOpenSettings}
                optimizationMode={optimizationMode}
                setOptimizationMode={setOptimizationMode}
                sourceFocus={sourceFocus}
                setSourceFocus={setSourceFocus}
                researchMode={researchMode}
                setResearchMode={setResearchMode}
              />
            </div>
          ) : (
            <div className="harness-active-state">
              {sessionCard && (
                <section className="harness-session-card" aria-live="polite">
                  <div>
                    <p className="harness-eyebrow">{ar ? 'الجلسة الأصلية' : 'Parent session'}</p>
                    <h1>{currentQuery}</h1>
                    {sessionCard.detail && <p>{sessionCard.detail}</p>}
                  </div>
                  <span className={cardStateClass[sessionCard.status]}>{sessionCard.status}</span>
                </section>
              )}

              {subqueries.length > 0 && (
                <section className="harness-tool-activity" aria-label={ar ? 'استعلامات البحث' : 'Research queries'}>
                  <p className="harness-eyebrow">{ar ? 'استعلامات فعلية' : 'Live queries'}</p>
                  <div>{subqueries.map((subquery) => <span key={subquery} className="harness-tool-chip">{subquery}</span>)}</div>
                </section>
              )}

              {thoughts.length > 0 && (
                <section className="harness-event-feed" aria-label={ar ? 'تحديثات الجلسة' : 'Session updates'}>
                  {thoughts.slice(-4).map((thought, index) => <p key={`${thought}-${index}`}>{thought}</p>)}
                </section>
              )}

              {loading && <AgentFeedList agents={agents} language={language} eventCount={agentEventCount} />}

              <MessageBox
                query={currentQuery}
                report={report}
                sources={sources}
                steps={steps}
                loading={loading}
                language={language}
                plan={plan}
                onExport={onExport}
                onFollowUp={onStartResearch}
                wideTelemetry={wideTelemetry}
                wideExpansionHistory={wideExpansionHistory}
                agents={agents}
                agentEventCount={agentEventCount}
              />
              <MessageInput onSendMessage={onStartResearch} loading={loading} language={language} />
            </div>
          )}
        </main>
      </section>

      {isInspectorOpen && selectedTab && (
        <HarnessArtifactInspector
          availableTabs={availableTabs}
          selectedTab={selectedTab}
          onSelectTab={setSelectedTab}
          onClose={() => setIsInspectorOpen(false)}
          language={language}
          plan={plan}
          sources={sources}
          report={report}
          graphNodes={graphNodes}
        />
      )}
    </div>
  );
};
