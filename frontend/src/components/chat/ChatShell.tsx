import React, { useMemo, useState } from 'react';
import type {
  ApiSettings,
  Language,
  ReportData,
  ResearchGraphNode,
  ResearchMode,
  ResearchPlan,
  SourceItem,
  WideResearchTelemetry,
} from '../../types';
import type { AgenticConversationProjection } from '../../utils/agenticConversation';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';
import type { AgentFeedState } from '../../utils/liveFeed';
import { availableHarnessArtifacts, type HarnessArtifactTab } from '../../utils/harnessWorkspace';
import { EvidenceInspectionDrawer } from '../research/EvidenceInspectionDrawer';
import { ChatSidebar } from './ChatSidebar';
import { ChatHeader } from './ChatHeader';
import { ConversationThread } from './ConversationThread';
import { ResearchComposer, type ComposerInteraction } from './ResearchComposer';
import { ArtifactDrawer } from './ArtifactDrawer';
import type { ChatArtifact, ChatTurn } from './types';

interface ChatShellProps {
  language: Language;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  turns: ChatTurn[];
  currentQuery: string;
  report: string;
  sources: SourceItem[];
  plan?: ResearchPlan | null;
  graphNodes: ResearchGraphNode[];
  thoughts: string[];
  subqueries: string[];
  agents: AgentFeedState[];
  agentEventCount: number;
  currentStatus: string;
  loading: boolean;
  liveReport: string;
  wideTelemetry?: WideResearchTelemetry | null;
  agentRunFeed: AgentRunFeedState | null;
  conversationProjection?: AgenticConversationProjection | null;
  researchError: string;
  history: ReportData[];
  activeReportId: string | null;
  activeTab: string;
  query: string;
  setQuery: (q: string) => void;
  settings: ApiSettings;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  setOptimizationMode: (m: 'speed' | 'balanced' | 'quality') => void;
  sourceFocus: 'web' | 'academic' | 'social';
  setSourceFocus: (f: 'web' | 'academic' | 'social') => void;
  researchMode: ResearchMode;
  setResearchMode: (m: ResearchMode) => void;
  interaction: ComposerInteraction;
  onSelectInteraction: (i: ComposerInteraction) => void;
  onSubmitQuestion: (q: string) => void;
  onCancel: () => void;
  onNewResearch: () => void;
  onSelectReport: (r: ReportData) => void;
  onSelectTab: (tab: 'discover' | 'history' | 'graph' | 'skills') => void;
  onOpenSettings: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onReviewPlan: () => void;
}

/**
 * ChatShell — Sidebar + Conversation, contextual drawers only. The
 * conversation is the product; research artifacts are supporting surfaces.
 * The permanent inspector is gone: the drawer opens only on request.
 */
export const ChatShell: React.FC<ChatShellProps> = (props) => {
  const ar = props.language === 'ar';
  const [isRailOpen, setIsRailOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [artifact, setArtifact] = useState<ChatArtifact | null>(null);
  const [evidenceIndex, setEvidenceIndex] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<HarnessArtifactTab | null>(null);

  const activeTurn = useMemo<ChatTurn | null>(() => {
    if (props.turns.length === 0) return null;
    return props.turns[props.turns.length - 1];
  }, [props.turns]);

  const artifactTurn = useMemo<ChatTurn | null>(() => {
    if (!artifact) return null;
    return props.turns.find((t) => t.id === artifact.turnId) ?? activeTurn;
  }, [artifact, props.turns, activeTurn]);

  const artifactInput = useMemo(
    () => ({
      plan: artifactTurn?.plan ?? props.plan,
      sources: artifactTurn?.sources ?? props.sources,
      report: artifactTurn?.report ?? props.report,
      graphNodes: artifactTurn?.graphNodes ?? props.graphNodes,
      conversation: (artifactTurn?.conversationProjection ?? props.conversationProjection) != null,
    }),
    [artifactTurn, props.plan, props.sources, props.report, props.graphNodes, props.conversationProjection]
  );
  const availableTabs = useMemo(() => availableHarnessArtifacts(artifactInput), [artifactInput]);

  const openArtifact = (turnId: string, kind: ChatArtifact['kind']) => {
    setInspectorTab(availableTabs[0] ?? null);
    setArtifact({ kind, turnId });
  };
  const inspectCitation = (turnId: string, index: number) => {
    const target = props.turns.find((t) => t.id === turnId) ?? activeTurn;
    if (target) setArtifact({ kind: 'sources', turnId: target.id, citationIndex: index });
    setEvidenceIndex(index);
  };

  const conversationTitle = activeTurn?.query || props.currentQuery || '';
  const collapsed = !isRailOpen;

  const live = useMemo(
    () => ({
      currentStatus: props.currentStatus,
      thoughts: props.thoughts,
      subqueries: props.subqueries,
      agents: props.agents,
      agentEventCount: props.agentEventCount,
      agentRunFeed: props.agentRunFeed,
      loading: props.loading,
      liveReport: props.liveReport,
      wideTelemetry: props.wideTelemetry,
    }),
    [props.currentStatus, props.thoughts, props.subqueries, props.agents, props.agentEventCount, props.agentRunFeed, props.loading, props.liveReport, props.wideTelemetry]
  );

  const emptyHero = (
    <div className="chat-empty" data-testid="chat-empty-state">
      <h1>{ar ? 'ما الذي تريد فهمه بعمق؟' : 'What would you like to research?'}</h1>
      <p>{ar ? 'ابدأ بسؤال يستحق نظرة أعمق.' : 'Start with a question worth a closer look.'}</p>
      <ResearchComposer
        language={props.language}
        variant="new"
        loading={props.loading}
        runLive={false}
        interaction={props.interaction}
        onSelectInteraction={props.onSelectInteraction}
        settings={props.settings}
        onOpenSettings={props.onOpenSettings}
        optimizationMode={props.optimizationMode}
        setOptimizationMode={props.setOptimizationMode}
        sourceFocus={props.sourceFocus}
        setSourceFocus={props.setSourceFocus}
        researchMode={props.researchMode}
        setResearchMode={props.setResearchMode}
        initialValue={props.query}
        onValueChange={props.setQuery}
        onSubmit={props.onSubmitQuestion}
      />
    </div>
  );

  return (
    <div className="chat-shell lens-harness" data-testid="lens-harness" dir={ar ? 'rtl' : 'ltr'}>
      <div className={`chat-sidebar-slot${mobileNavOpen ? ' is-mobile-open' : ''}`}>
        <ChatSidebar
          language={props.language}
          history={props.history}
          activeId={props.activeReportId}
          loading={props.loading}
          collapsed={collapsed}
          onToggleCollapse={() => setIsRailOpen((o) => !o)}
          onNewResearch={props.onNewResearch}
          onSelectReport={(r) => { setMobileNavOpen(false); props.onSelectReport(r); }}
          onSelectTab={props.onSelectTab}
          onOpenSettings={props.onOpenSettings}
          activeTab={props.activeTab}
        />
        {mobileNavOpen && <div className="chat-sidebar-scrim" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      </div>

      <section className="chat-main">
        <ChatHeader
          language={props.language}
          conversationTitle={conversationTitle}
          researching={props.loading}
          theme={props.theme}
          onToggleTheme={props.onToggleTheme}
          onToggleLanguage={props.onToggleLanguage}
          onToggleSidebar={() => {
            if (window.matchMedia('(max-width: 900px)').matches) setMobileNavOpen((o) => !o);
            else setIsRailOpen((o) => !o);
          }}
          settings={props.settings}
          onOpenSettings={props.onOpenSettings}
        />

        {props.researchError && (
          <div className="chat-error" role="alert"><p dir="auto">{props.researchError}</p></div>
        )}

        <main className="chat-canvas" id="main-content">
          <ConversationThread
            language={props.language}
            turns={props.turns}
            live={live}
            onCancel={props.onCancel}
            onFollowUp={props.onSubmitQuestion}
            onExport={props.onExport}
            onInspectCitation={inspectCitation}
            onOpenArtifact={openArtifact}
            onReviewPlan={props.onReviewPlan}
            emptyHero={emptyHero}
          />
        </main>

        {props.turns.length > 0 && (
          <div className="chat-composer-dock">
            <ResearchComposer
              language={props.language}
              variant="active"
              loading={props.loading}
              runLive={Boolean(props.agentRunFeed && (props.agentRunFeed.phase === 'running' || props.agentRunFeed.phase === 'retrying'))}
              interaction={props.interaction}
              onSelectInteraction={props.onSelectInteraction}
              settings={props.settings}
              onOpenSettings={props.onOpenSettings}
              optimizationMode={props.optimizationMode}
              setOptimizationMode={props.setOptimizationMode}
              sourceFocus={props.sourceFocus}
              setSourceFocus={props.setSourceFocus}
              researchMode={props.researchMode}
              setResearchMode={props.setResearchMode}
              onSubmit={props.onSubmitQuestion}
            />
          </div>
        )}
      </section>

      <ArtifactDrawer
        language={props.language}
        artifact={artifact}
        turn={artifactTurn}
        availableTabs={availableTabs}
        selectedTab={inspectorTab}
        onSelectTab={setInspectorTab}
        onClose={() => { setArtifact(null); setEvidenceIndex(null); }}
        onInspectCitation={(index) => setEvidenceIndex(index)}
      />
      {/* Evidence drawer — contextual source inspector, never permanent space. */}
      <EvidenceInspectionDrawer
        isOpen={evidenceIndex !== null}
        onClose={() => setEvidenceIndex(null)}
        targetCitationIndex={evidenceIndex}
        sources={artifactTurn?.sources ?? props.sources}
        plan={artifactTurn?.plan ?? props.plan}
        reportContent={artifactTurn?.report ?? props.report}
        language={props.language}
        onNavigateCitation={(n) => setEvidenceIndex(n)}
      />
    </div>
  );
};
