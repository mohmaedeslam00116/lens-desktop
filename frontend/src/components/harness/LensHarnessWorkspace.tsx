import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, FileText, History, PanelLeft, Plus, Square } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import { EmptyChatMessageInput } from '../vane/EmptyChatMessageInput';
import { MessageBox } from '../vane/MessageBox';
import { MessageInput } from '../vane/MessageInput';
import { AgentFeedList } from '../AgentFeedList';
import { AgentRunFeed } from './AgentRunFeed';
import { HarnessArtifactInspector } from './HarnessArtifactInspector';
import {
  availableHarnessArtifacts,
  defaultHarnessArtifact,
  deriveHarnessSessionCard,
  type HarnessArtifactTab,
} from '../../utils/harnessWorkspace';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';
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

/**
 * How the composer's question will be answered. AGENTIC SEARCH IS THE
 * DEFAULT (ticket #145; SPEC-028) — the gate-free, agent-first loop; Deep
 * Research remains an explicit opt-in with its plan-first path and approval
 * overlay untouched.
 */
export type AgentInteraction = 'agent' | 'deep-research';

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
  /** The live agentic run feed (reduced real events; null when no live run). */
  agentRunFeed: AgentRunFeedState | null;
  /** Start an Agentic Search run (the default interaction). */
  onStartAgentRun: (query: string) => void;
  /** Start a Deep Research run (plan-first; the explicit opt-in). */
  onStartDeepResearch: (query: string) => void;
  /** Steer the live agentic run (queues visibly before applying). */
  onSteerAgentRun: (message: string) => void;
  /** Cancel the live agentic run (explicit terminal, evidence retained). */
  onCancelAgentRun: () => void;
  onNewResearch: () => void;
  onSelectReport: (report: ReportData) => void;
  onOpenSettings: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
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
  agentRunFeed,
  onStartAgentRun,
  onStartDeepResearch,
  onSteerAgentRun,
  onCancelAgentRun,
  onNewResearch,
  onSelectReport,
  onOpenSettings,
  onExport,
}) => {
  const ar = language === 'ar';
  const artifactInput = useMemo(() => ({ plan, sources, report, graphNodes }), [plan, sources, report, graphNodes]);
  const availableTabs = useMemo(() => availableHarnessArtifacts(artifactInput), [artifactInput]);
  const [selectedTab, setSelectedTab] = useState<HarnessArtifactTab | null>(() => defaultHarnessArtifact(artifactInput));
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isRailOpen, setIsRailOpen] = useState(false);
  // The composer's interaction kind: AGENTIC SEARCH IS THE DEFAULT. An
  // explicit composer choice always wins over the default.
  const [agentInteraction, setAgentInteraction] = useState<AgentInteraction>('agent');

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
  const hasSession = Boolean(currentQuery || report || loading || researchError || agentRunFeed);
  const runLive = Boolean(agentRunFeed && (agentRunFeed.phase === 'running' || agentRunFeed.phase === 'retrying'));

  const submitQuestion = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    // Steering outranks the loading guard: while a run is live, a new
    // question STEERS it (queued visibly) instead of starting a rival run —
    // one loop, explicit cancel (v1 scope). The guard must not make a live
    // run unreachable for steering.
    if (runLive && agentRunFeed) {
      onSteerAgentRun(trimmed);
      return;
    }
    if (loading) return;
    if (agentInteraction === 'deep-research') {
      onStartDeepResearch(trimmed);
      return;
    }
    onStartAgentRun(trimmed);
  };

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
                    disabled={loading}
                    aria-current={item.query === currentQuery ? 'page' : undefined}
                    onClick={() => { if (!loading) { onSelectReport(item); setIsRailOpen(false); } }}
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
          </div>
        </header>

        <main className="harness-canvas" id="main-content">
          {!hasSession ? (
            <div className="harness-empty-state">
              <div className="harness-empty-intro">
                <h1>{ar ? 'ابدأ بسؤال يستحق نظرة أعمق.' : 'Start with a question worth a closer look.'}</h1>
                <p>{ar ? 'سيبقى الدليل ومسار البحث واضحين مع تقدّم الجلسة.' : 'Evidence and the research path remain clear as the session develops.'}</p>
              </div>
              <EmptyChatMessageInput
                query={query}
                setQuery={setQuery}
                onSubmit={() => submitQuestion(query)}
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
                    <h1>{currentQuery}</h1>
                    {sessionCard.detail && <p>{sessionCard.detail}</p>}
                  </div>
                  <span className={cardStateClass[sessionCard.status]}>{sessionCard.status}</span>
                </section>
              )}

              {agentRunFeed && (
                <AgentRunFeed feed={agentRunFeed} language={language} onCancel={onCancelAgentRun} />
              )}

              {subqueries.length > 0 && (
                <section className="harness-tool-activity" aria-label={ar ? 'استعلامات البحث' : 'Research queries'}>
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
                onFollowUp={submitQuestion}
                wideTelemetry={wideTelemetry}
                wideExpansionHistory={wideExpansionHistory}
                agents={agents}
                agentEventCount={agentEventCount}
              />
              <MessageInput onSendMessage={submitQuestion} loading={runLive ? false : loading} language={language} />
            </div>
          )}
        </main>

        <footer className="harness-composer-foot">
          <fieldset className="harness-interaction" aria-label={ar ? 'نمط الإجابة' : 'Answer mode'}>
            <legend className="sr-only">{ar ? 'نمط الإجابة' : 'Answer mode'}</legend>
            <label className={`harness-interaction-option${agentInteraction === 'agent' ? ' is-active' : ''}`}>
              <input
                className="sr-only"
                type="radio"
                name="agent-interaction"
                value="agent"
                checked={agentInteraction === 'agent'}
                onChange={() => setAgentInteraction('agent')}
              />
              <span>{ar ? 'بحث وكيل' : 'Agentic Search'}</span>
            </label>
            <label className={`harness-interaction-option${agentInteraction === 'deep-research' ? ' is-active' : ''}`}>
              <input
                className="sr-only"
                type="radio"
                name="agent-interaction"
                value="deep-research"
                checked={agentInteraction === 'deep-research'}
                onChange={() => setAgentInteraction('deep-research')}
              />
              <span>{ar ? 'البحث المعمّق' : 'Deep Research'}</span>
            </label>
          </fieldset>
        </footer>
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
