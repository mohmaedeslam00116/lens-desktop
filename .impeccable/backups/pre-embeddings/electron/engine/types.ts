export type SearchDepth = 'quick' | 'deep' | 'storm';
export type SearchPerspective = 'balanced' | 'technical' | 'market' | 'critical' | 'storm';
export type LLMProvider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'openrouter' | 'mistral' | 'ollama';

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

export interface LiveEvent {
  type: 'status' | 'thought' | 'subqueries' | 'source' | 'report_chunk' | 'finished' | 'error' | 'reflection' | 'graph_node';
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
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}
