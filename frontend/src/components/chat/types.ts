import type {
  Language,
  ResearchGraphNode,
  ResearchPlan,
  SourceItem,
  WideResearchTelemetry,
} from '../../types';
import type { AgenticConversationProjection } from '../../utils/agenticConversation';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';
import type { AgentFeedState } from '../../utils/liveFeed';

/** One conversation turn: a user question plus everything LENS produced for it. */
export interface ChatTurn {
  id: string;
  query: string;
  report: string;
  sources: SourceItem[];
  status: 'running' | 'done' | 'error';
  interaction: 'agent' | 'deep-research';
  createdAt: string;
  plan?: ResearchPlan | null;
  graphNodes?: ResearchGraphNode[];
  wideTelemetry?: WideResearchTelemetry | null;
  conversationProjection?: AgenticConversationProjection | null;
  live?: boolean;
  error?: string;
}

export interface ChatLiveState {
  currentStatus: string;
  thoughts: string[];
  subqueries: string[];
  agents: AgentFeedState[];
  agentEventCount: number;
  agentRunFeed: AgentRunFeedState | null;
  loading: boolean;
  liveReport: string;
  wideTelemetry?: WideResearchTelemetry | null;
}

export type ChatArtifactKind =
  | 'sources'
  | 'plan'
  | 'graph'
  | 'report'
  | 'conversation';

export interface ChatArtifact {
  kind: ChatArtifactKind;
  turnId: string;
  citationIndex?: number | null;
}

export type { Language };
