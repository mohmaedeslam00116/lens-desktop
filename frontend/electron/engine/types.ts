export type SearchDepth = 'quick' | 'deep' | 'storm';
export type SearchPerspective = 'balanced' | 'technical' | 'market' | 'critical' | 'storm';
export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'openrouter' | 'mistral' | 'ollama';
export type EmbeddingProvider = 'gemini' | 'openai' | 'ollama' | 'none';

export interface ModelOption {
  id: string;
  name: string;
  context?: string;
  tags?: string[];
  recommended?: boolean;
}

export interface ResearchGraphNode {
  id: string;
  label: string;
  type: 'root' | 'perspective' | 'subquery' | 'source' | 'reflection' | 'section';
  status: 'pending' | 'active' | 'completed' | 'failed';
  parentId?: string;
  details?: string;
  credibility?: number;
}

export interface SourceItem {
  url: string;
  title: string;
  domain: string;
  favicon?: string;
  snippet?: string;
  credibilityScore: number;
}

export type ResearchMode = 'standard' | 'wide';

export type SessionState =
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'budget_exhausted';

export interface PlanMilestone {
  id: string;
  query: string;
  rationale: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface ResearchPlan {
  id: string;
  version: number;
  objective: string;
  milestones: PlanMilestone[];
  suggestedSkills: string[];
  estimatedScope: {
    targetSources: number;
    maxHops: number;
  };
  status?: 'draft' | 'approved' | 'rejected';
  createdAt?: number;
  updatedAt?: number;
}

export interface PartialEvidenceDraft {
  report: string;
  sources: SourceItem[];
  subqueries: string[];
  reflections: string[];
  graphNodes?: ResearchGraphNode[];
  interruptedAt?: number;
  reason?: string;
}

export interface LiveEvent {
  type:
    | 'status'
    | 'thought'
    | 'subqueries'
    | 'source'
    | 'report_chunk'
    | 'finished'
    | 'error'
    | 'reflection'
    | 'graph_node'
    | 'plan_created'
    | 'plan_updated'
    | 'plan_approved'
    | 'session_state'
    | 'cancelled';
  eventId?: number;
  sessionId?: string;
  state?: SessionState;
  plan?: ResearchPlan;
  partialDraft?: PartialEvidenceDraft;
  message?: string;
  step?: string;
  thought?: string;
  subqueries?: string[];
  url?: string;
  title?: string;
  domain?: string;
  credibility?: number;
  snippet?: string;
  chunk?: string;
  report?: string;
  sources?: SourceItem[];
  costs?: number;
  reflection?: string;
  followups?: string[];
  node?: ResearchGraphNode;
  reflections?: string[];
  coverage?: {
    overallScore: number;
    subqueryScore: number;
    aspectScore: number;
    metricScore: number;
    diversityScore: number;
    uncoveredSubqueries: string[];
  };
}

export interface ResearchRequest {
  query: string;
  report_type?: SearchDepth;
  report_source?: string;
  perspective?: SearchPerspective;
  language?: string;
  tone?: string;
  search_provider?: 'duckduckgo' | 'tavily' | 'serper';
  llm_provider?: LLMProvider;
  model_name?: string;
  api_keys?: Record<string, string>;
  ollama_endpoint?: string;
  embedding_provider?: EmbeddingProvider;
  embedding_model?: string;
  embedding_api_key?: string;
  embedding_endpoint?: string;
  embedding_enabled?: boolean;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WideResearchRequest extends ResearchRequest {
  mode?: ResearchMode;
  plan?: ResearchPlan;
  approvedSkills?: string[];
  maxSources?: number;
  maxHops?: number;
}

export interface WideResearchResult {
  report: string;
  plan: ResearchPlan;
  sources: SourceItem[];
  coverageAudit?: LiveEvent['coverage'];
  metrics?: {
    totalSources?: number;
    durationMs?: number;
    hopsExecuted?: number;
    costs?: number;
  };
  state: SessionState;
  partialDraft?: PartialEvidenceDraft;
}

