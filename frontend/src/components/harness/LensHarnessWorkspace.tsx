import React, { useMemo, useState } from 'react';
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
  /** Cancel the live run — agentic or Deep Research, evidence retained. */
  onCancelAgentRun: () => void;
  onNewResearch: () => void;
  onSelectReport: (report: ReportData) => void;
  onSelectTab?: (tab: 'discover' | 'history' | 'graph' | 'skills') => void;
  onOpenSettings: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onReviewPlan?: () => void;
}

/**
 * LensHarnessWorkspace — a thin composition root over ChatShell.
 * Conversation-first: Sidebar + Conversation with contextual drawers.
 * Engine behavior unchanged: onStartAgentRun / onStartDeepResearch /
 * onSteerAgentRun / onCancelAgentRun ride straight through; the artifact
 * inspector lives only inside the contextual drawer (closed by default,
 * never a permanent column, never a hidden mounted tree).
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
  plan,
  graphNodes,
  thoughts,
  subqueries,
  agents,
  agentEventCount,
  history,
  wideTelemetry,
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
    <ChatShell
      language={language}
      theme={theme ?? 'dark'}
      onToggleTheme={onToggleTheme ?? (() => {})}
      onToggleLanguage={onToggleLanguage ?? (() => {})}
      turns={fallbackTurns}
      currentQuery={currentQuery}
      report={report}
      sources={sources}
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
  );
};
