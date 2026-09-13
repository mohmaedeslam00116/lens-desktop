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

export interface ResearchExtensionPayload {
  budgetExhausted: boolean;
  reason: string;
  suggestedAdditionalSources: number;
  suggestedAdditionalHops: number;
  uncoveredMilestones: string[];
  uncoveredSubqueries: string[];
  missingAspects: string[];
  actionText: {
    ar: string;
    en: string;
  };
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

export type PlanApprovalAction = 'approve_plan' | 'reject_plan' | 'regenerate_plan';

/** Read-only projection of one rpiv-todo research-plan task (ADR-0010 #7:
 * parent-only writes; the renderer never reads the todo store directly). */
export interface TodoTaskProjection {
  id: number;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  activeForm?: string;
}

/** Researcher lifecycle/progress telemetry for the Research Agency path
 * (ADR-0010 #6) — follows the wide_telemetry additive-event precedent.
 * Evidence found by researchers keeps flowing as ordinary `source` events. */
export interface ResearcherTelemetry {
  researcherId: string;
  /** Facet role tag. v1 pass-through uses 'primary'; the closed 5-role
   * catalog + deficit re-specialization land with ticket #93. */
  role: string;
  /** The research facet (milestone query) assigned to this researcher. */
  facet: string;
  phase: 'started' | 'completed' | 'run_started' | 'run_completed' | 'retrieval' | 'tool_activity'
    | 'role_selected';
  counts: {
    facetIndex: number;
    facetCount: number;
    /** URLs this researcher skipped because another researcher already
     * fetched them (cross-researcher dedupe, ticket #90). Optional —
     * assignment-lifecycle events omit it. */
    dedupeShared?: number;
    /** Re-specialization marker + rationale (ticket #93): present on
     * role_selected events for deficit-driven follow-up researchers. */
    respecialization?: boolean;
    rationale?: string;
  };
  /** Why this role was chosen (ticket #93): deterministic keyword mapping
   * for plan facets, or the coverage-deficit reason for re-specialized
   * follow-ups. Optional additive surface. */
  rationale?: string;
  /** Read-only todo-plan projection at emission time (parent-owned state).
   * Size-capped by the engine; see todoProjectionTruncated. */
  todoProjection?: TodoTaskProjection[];
  /** True when todoProjection was truncated to the engine's cap. */
  todoProjectionTruncated?: boolean;
}

/** Aggregate fan-out telemetry for a parallel researcher phase (ADR-0010
 * decision 8, ticket #90): concurrency + budget limits, cross-researcher
 * dedupe yield, and per-facet coverage aggregation over admitted findings. */
export interface FanoutTelemetry {
  /** Effective concurrency limit = min(#facets, 4) unless overridden. */
  concurrencyLimit: number;
  facetsTotal: number;
  researchersLaunched: number;
  researchersCompleted: number;
  researchersFailed: number;
  /** Facets left to the delegated loop's own retrieval (caps reached). */
  facetsDelegated: number;
  /** URLs a researcher skipped because another already fetched them. */
  urlsShared: number;
  /** Session-wide admitted researcher findings after this fan-out. */
  budgetFindingsAdmitted: number;
  /** Per-facet evidence-coverage aggregation (facet query → overall score)
   * computed over that facet's admitted findings (LENS contracts). */
  coverageByFacet: Record<string, number>;
}

/** Advisory evidence-audit types (ADR-0010 decision 4, ticket #91). */
export type EvidenceAudit = import('./evidenceAuditor').EvidenceAudit;

export interface PlanScopingOptions {
  language?: 'ar' | 'en' | string;
  targetSources?: number;
  maxHops?: number;
  reportType?: string;
  mode?: ResearchMode;
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
    | 'skill_activated'
    | 'wide_telemetry'
    | 'researcher_telemetry'
    | 'fanout_telemetry'
    | 'audit_telemetry';
  eventId?: number;
  sessionId?: string;
  state?: SessionState;
  plan?: ResearchPlan;
  partialDraft?: PartialEvidenceDraft;
  extensionPayload?: ResearchExtensionPayload;
  skillName?: string;
  skillScope?: 'workspace' | 'user' | 'builtin';
  activationMethod?: 'pre_activated' | 'dynamic_tool';
  mappedTools?: string[];
  unmappedTools?: string[];
  notices?: string[];
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
  wideTelemetry?: WideResearchTelemetry;
  researcherTelemetry?: ResearcherTelemetry;
  /** Aggregate parallel fan-out telemetry (ticket #90). */
  fanoutTelemetry?: FanoutTelemetry;
  /** Advisory evidence-audit verdicts for the synthesized report
   * (ADR-0010 decision 4, ticket #91). Advisory only — never gates. */
  auditTelemetry?: EvidenceAudit;
  /** Research-facet provenance on `source` events emitted by researcher
   * subagents (ADR-0010 phase 2, ticket #89). */
  milestoneId?: string;
  milestoneTitle?: string;
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
  /** Opt-in: attach the vendored pi ecosystem research tools (pi-web-access
   * + rpiv-todo) to the agent's tool loop. Defaults to false so existing
   * behavior and tests are unchanged. */
  tool_packages?: boolean;
  /** Opt-in: run research through the Parent Research Agent orchestration
   * seam (ADR-0010 phase 1, ticket #88). Dormant by default — unflagged runs
   * execute the legacy loop unchanged. */
  agency_mode?: boolean;
  /** Opt-in (requires agency_mode): each facet executes inside an in-process
   * researcher subagent with the pi-web-access toolset (ADR-0010 phase 2,
   * ticket #89). Dormant by default. */
  researcher_mode?: boolean;
  /** Optional override of the parallel researcher concurrency limit
   * (default: min(#facets, 4), ADR-0010 decision 8). Clamped to [1, 4]. */
  researcher_concurrency?: number;
  /** Opt-in (requires researcher_mode): route researcher long-context model
   * traffic through the supervised billion-context proxy (ADR-0010, ticket
   * #92). Dormant by default; degrades gracefully to uncompressed runs. */
  compression_mode?: boolean;
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
  groundingVerification?: {
    totalFoundInReport: number;
    validCitations: number;
    hallucinatedStripped: number;
    deterministicVerification: boolean;
    citedIndices: number[];
  };
  metrics?: {
    totalSources?: number;
    durationMs?: number;
    hopsExecuted?: number;
    costs?: number;
  };
  state: SessionState;
  partialDraft?: PartialEvidenceDraft;
}

