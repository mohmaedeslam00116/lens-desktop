export type Language = 'ar' | 'en';
export type ResearchDepth = 'quick' | 'deep' | 'storm';
export type ResearchPerspective = 'balanced' | 'technical' | 'market' | 'critical' | 'storm';
export type ResearchMode = 'standard' | 'wide';
export type LLMProvider = 'openai' | 'gemini' | 'anthropic' | 'groq' | 'deepseek' | 'openrouter' | 'mistral' | 'ollama';
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
  domain?: string;
  favicon?: string;
  snippet?: string;
  credibility?: number;
  credibilityScore?: number;
  passage?: string;
  originalSnippet?: string;
  score?: number;
  relevanceTier?: 'high' | 'medium' | 'low';
  milestoneId?: string;
  milestoneTitle?: string;
  citationIndex?: number;
  citationIndices?: number[];
  isCited?: boolean;
}

export interface ResearchStep {
  step: string;
  details?: string;
}

export interface ResearchHistoryItem {
  id: string;
  query: string;
  report: string;
  timestamp: string;
  sources?: SourceItem[];
}

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

export interface WideResearchTelemetry {
  initialBudget: number;
  activeBudget: number;
  maximumBudget: number;
  discovered: number;
  fetched: number;
  unique: number;
  admitted: number;
  cited: number;
  hop: number;
  coverageScore?: number;
  expansion?: {
    from: number;
    to: number;
    reason: string;
    uncoveredMilestones: string[];
    uncoveredSubqueries: string[];
  };
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
    | 'plan_proposed'
    | 'plan_updated'
    | 'plan_approved'
    | 'plan_rejected'
    | 'session_state'
    | 'cancelled'
    | 'budget_exhausted'
    | 'wide_telemetry';
  sessionId?: string;
  state?: string;
  plan?: ResearchPlan;
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
  sources?: any[];
  costs?: number;
  reflection?: string;
  followups?: string[];
  node?: ResearchGraphNode;
  reflections?: string[];
  wideTelemetry?: WideResearchTelemetry;
}

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

export interface ExtractedTable {
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
  rawMarkdown: string;
}

export interface ExtractedDiagram {
  id: string;
  title: string;
  code: string;
}

export interface KeyMetric {
  label: string;
  value: string;
  change?: string;
  description?: string;
}

export interface ReportArtifacts {
  tables: ExtractedTable[];
  diagrams: ExtractedDiagram[];
  metrics: KeyMetric[];
}

export interface ReportData {
  id: string;
  query: string;
  title: string;
  content: string;
  sources: SourceItem[];
  depth: ResearchDepth;
  perspective?: ResearchPerspective;
  plan?: ResearchPlan;
  graphNodes?: ResearchGraphNode[];
  reflections?: string[];
  createdAt: string;
  costs?: number;
  language: string;
  mode?: ResearchMode;
  wideTelemetry?: WideResearchTelemetry;
  wideExpansionHistory?: WideResearchTelemetry[];
  readingTimeMinutes?: number;
  wordCount?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface EmbeddingSettings {
  enabled: boolean;
  provider: EmbeddingProvider;
  model_name: string;
  custom_model_name?: string;
  api_key?: string;
  use_chat_key?: boolean;
  endpoint?: string;
}

export interface ApiSettings {
  search_provider: 'duckduckgo' | 'tavily' | 'serper';
  llm_provider: LLMProvider;
  model_name: string;
  custom_model_name?: string;
  ollama_endpoint: string;
  embedding?: EmbeddingSettings;
  keys: {
    openai?: string;
    gemini?: string;
    anthropic?: string;
    groq?: string;
    deepseek?: string;
    openrouter?: string;
    mistral?: string;
    tavily?: string;
    serper?: string;
  };
}

export interface DiscoverArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  domain: string;
  snippet?: string;
  pubDate?: string;
  timeAgo?: string;
  category: string;
  thumbnail?: string;
  researchQuery: string;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      secureStore: {
        set: (key: string, value: string) => Promise<boolean>;
        get: (key: string) => Promise<string | null>;
      };
      openExternal: (url: string) => void;
    };
  }
}
