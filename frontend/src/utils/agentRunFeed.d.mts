export interface AgentToolChip {
  toolName: string;
  args: Record<string, unknown>;
  resultText: string | null;
  status: 'running' | 'done' | 'failed';
}

export interface AgentSteerEntry {
  message: string;
  queuedAt: number;
  label: string;
}

export interface AgentRetryEntry {
  attempt: number;
  reason: string;
  label: string;
}

export type AgentRunPhase = 'idle' | 'running' | 'retrying' | 'finished' | 'cancelled' | 'budget_exhausted' | 'error';

export interface AgentRunFeedState {
  sessionId: string;
  phase: AgentRunPhase;
  toolChips: AgentToolChip[];
  sources: Array<{ url: string; title: string; domain?: string; snippet: string }>;
  steerQueue: AgentSteerEntry[];
  steerNotice: AgentSteerEntry | null;
  retries: AgentRetryEntry[];
  reportText: string;
  lastEvent: string | null;
}

export declare function initialAgentRunState(sessionId: string): AgentRunFeedState;

export declare function reduceAgentRun(
  state: AgentRunFeedState | null | undefined,
  action: {
    type: string;
    sessionId?: string;
    message?: string;
    url?: string;
    title?: string;
    domain?: string;
    snippet?: string;
    source?: { url: string; title?: string; domain?: string; snippet?: string };
    chunk?: string;
    text?: string;
    state?: string;
    [key: string]: unknown;
  }
): AgentRunFeedState;
