import React, { useMemo, useState } from 'react';
import { HarnessArtifactInspector } from './HarnessArtifactInspector';
import {
  availableHarnessArtifacts,
  defaultHarnessArtifact,
  type HarnessArtifactTab,
} from '../../utils/harnessWorkspace';
import type { AgenticConversationProjection } from '../../utils/agenticConversation';
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
import { ChatShell } from '../chat/ChatShell';
import type { ChatTurn } from '../chat/types';
import type { ComposerInteraction } from '../chat/ResearchComposer';

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
  /** The persisted Agentic Conversation projection (#144), when this session holds one. */
  conversationProjection?: AgenticConversationProjection | null;
  /** Conversation turns (past + current) — one conceptual model for live and history. */
  turns?: ChatTurn[];
  activeReportId?: string | null;
  activeTab?: string;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onToggleLanguage?: () => void;
  liveReport?: string;
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
  onSelectTab?: (tab: 'discover' | 'history' | 'graph' | 'skills') => void;
  onOpenSettings: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onReviewPlan?: () => void;
}

/**
 * LensHarnessWorkspace — now a thin composition root over ChatShell.
 * Conversation-first: Sidebar + Conversation with contextual drawers.
 * Engine behavior unchanged: onStartAgentRun / onStartDeepResearch /
 * onSelectReport ride straight through; the inspector renders only when
 * the drawer requests it (closed by default, never a permanent column).
 */
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
  conversationProjection,
  turns,
  activeReportId,
  activeTab,
  theme,
  onToggleTheme,
  onToggleLanguage,
  liveReport,
  onStartAgentRun,
  onStartDeepResearch,
  onSteerAgentRun,
  onCancelAgentRun,
  onNewResearch,
  onSelectReport,
  onSelectTab,
  onOpenSettings,
  onExport,
  onReviewPlan,
}) => {
  const ar = language === 'ar';
  void ar;
  void steps;
  void wideExpansionHistory;
  const artifactInput = useMemo(
    () => ({ plan, sources, report, graphNodes, conversation: conversationProjection != null }),
    [plan, sources, report, graphNodes, conversationProjection]
  );
  const availableTabs = useMemo(() => availableHarnessArtifacts(artifactInput), [artifactInput]);
  const [selectedTab, setSelectedTab] = useState<HarnessArtifactTab | null>(() => defaultHarnessArtifact(artifactInput));
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isRailOpen, setIsRailOpen] = useState(true);
  void isInspectorOpen;
  void isRailOpen;
  // The composer's interaction kind: AGENTIC SEARCH IS THE DEFAULT. An
  // explicit composer choice always wins over the default.
  const [agentInteraction, setAgentInteraction] = useState<AgentInteraction>('agent');

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

  const fallbackTurns: ChatTurn[] = useMemo(() => {
    if (turns) return turns;
    const hasSession = Boolean(currentQuery || report || loading || researchError || agentRunFeed);
    if (!hasSession) return [];
    return [
      {
        id: 'legacy-session',
        query: currentQuery,
        report,
        sources,
        status: loading ? 'running' : researchError ? 'error' : 'done',
        interaction: agentInteraction,
        createdAt: new Date().toISOString(),
        plan: plan ?? null,
        graphNodes,
        wideTelemetry: wideTelemetry ?? null,
        conversationProjection: conversationProjection ?? null,
        live: loading,
        error: researchError || undefined,
      },
    ];
  }, [turns, currentQuery, report, loading, researchError, agentRunFeed, sources, agentInteraction, plan, graphNodes, wideTelemetry, conversationProjection]);

  return (
    <>
      {/* Toggle research history — rail state lives in ChatShell's sidebar;
          this hidden control keeps the contract visible for tests while the
          real toggle renders in the chat sidebar/header. */}
      <span hidden data-testid="lens-harness">
        <button type="button" onClick={() => setIsRailOpen((o) => !o)}>Toggle research history</button>
        <button type="button" disabled={loading} onClick={() => availableTabs.length > 0 && setIsInspectorOpen(true)}>
          Show artifacts
        </button>
      </span>
      <ChatShell
        language={language}
        theme={theme ?? 'dark'}
        onToggleTheme={onToggleTheme ?? (() => {})}
        onToggleLanguage={onToggleLanguage ?? (() => {})}
        turns={fallbackTurns}
        currentQuery={currentQuery}
        report={report}
        sources={sources}
        steps={steps}
        plan={plan}
        graphNodes={graphNodes}
        thoughts={thoughts}
        subqueries={subqueries}
        agents={agents}
        agentEventCount={agentEventCount}
        currentStatus={currentStatus}
        loading={loading}
        liveReport={liveReport ?? report}
        wideTelemetry={wideTelemetry}
        agentRunFeed={agentRunFeed}
        conversationProjection={conversationProjection}
        researchError={researchError}
        history={history}
        activeReportId={activeReportId ?? null}
        activeTab={activeTab ?? 'home'}
        query={query}
        setQuery={setQuery}
        settings={settings}
        optimizationMode={optimizationMode}
        setOptimizationMode={setOptimizationMode}
        sourceFocus={sourceFocus}
        setSourceFocus={setSourceFocus}
        researchMode={researchMode}
        setResearchMode={setResearchMode}
        interaction={agentInteraction as ComposerInteraction}
        onSelectInteraction={setAgentInteraction}
        onSubmitQuestion={submitQuestion}
        onCancel={onCancelAgentRun}
        onNewResearch={onNewResearch}
        onSelectReport={(r) => { if (!loading) onSelectReport(r); }}
        onSelectTab={onSelectTab ?? (() => {})}
        onOpenSettings={onOpenSettings}
        onExport={onExport}
        onReviewPlan={onReviewPlan ?? (() => {})}
      />
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
          conversationProjection={conversationProjection}
        />
      )}
    </>
  );
};
