import * as crypto from 'crypto';
import {
  LiveEvent,
  PartialEvidenceDraft,
  ResearchMode,
  ResearchPlan,
  SessionState,
  SourceItem,
  WideResearchRequest
} from './types';
import { EventRingBuffer } from './eventBuffer';

/**
 * Permitted state transitions in the Research Session Lifecycle State Machine.
 */
const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  planning: ['awaiting_approval', 'running', 'cancelled', 'failed'],
  awaiting_approval: ['running', 'planning', 'cancelled', 'failed'],
  running: ['completed', 'cancelled', 'failed', 'budget_exhausted'],
  completed: [],
  cancelled: [],
  failed: [],
  budget_exhausted: ['planning', 'running', 'cancelled']
};

/**
 * Encapsulates an active research session with state machine validation,
 * circular event buffering for reconnection recovery, and sub-second cancellation.
 */
export class ResearchSession {
  public readonly id: string;
  public readonly mode: ResearchMode;
  public readonly request: WideResearchRequest;
  public state: SessionState;
  public plan?: ResearchPlan;
  public readonly eventBuffer: EventRingBuffer;
  public readonly abortController: AbortController;
  public readonly partialDraft: PartialEvidenceDraft;
  public readonly createdAt: number;
  public updatedAt: number;
  public failureReason?: string;

  private listeners: Set<(event: LiveEvent) => void> = new Set();

  constructor(
    request: WideResearchRequest,
    id: string = crypto.randomUUID(),
    bufferCapacity: number = 300
  ) {
    this.id = id;
    this.request = request;
    this.mode = request.mode === 'wide' ? 'wide' : 'standard';
    this.state = 'planning';
    this.eventBuffer = new EventRingBuffer(bufferCapacity);
    this.abortController = new AbortController();
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;

    this.partialDraft = {
      report: '',
      sources: [],
      subqueries: [],
      reflections: []
    };

    // Emit initial session creation state event
    this.emitEvent({
      type: 'session_state',
      sessionId: this.id,
      state: this.state,
      message: `Session initialized in ${this.state} state (${this.mode} mode)`
    });
  }

  /**
   * Subscribes a listener callback to real-time events emitted by this session.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emits an event, stamping it with a monotonic sequence ID via EventRingBuffer,
   * updating internal state drafts if relevant, and notifying active subscribers.
   */
  public emitEvent(event: LiveEvent): LiveEvent {
    const stamped = this.eventBuffer.push({
      ...event,
      sessionId: this.id,
      state: this.state
    });

    // Mirror progress into partial evidence draft
    if (stamped.chunk) {
      this.partialDraft.report += stamped.chunk;
    }
    if (stamped.sources && stamped.sources.length > 0) {
      for (const src of stamped.sources) {
        this.recordSource(src);
      }
    }
    if (stamped.type === 'source' && stamped.url) {
      this.recordSource({
        url: stamped.url,
        title: stamped.title || stamped.domain || stamped.url,
        domain: stamped.domain || '',
        snippet: stamped.snippet,
        credibilityScore: stamped.credibility || 0,
      });
    }
    if (stamped.subqueries && stamped.subqueries.length > 0) {
      this.recordSubqueries(stamped.subqueries);
    }
    if (stamped.reflection) {
      this.recordReflection(stamped.reflection);
    }

    this.updatedAt = Date.now();

    for (const listener of this.listeners) {
      try {
        listener(stamped);
      } catch (err) {
        console.error(`[ResearchSession ${this.id}] Error in event listener:`, err);
      }
    }

    return stamped;
  }

  /**
   * Checks whether transitioning to nextState is permitted from the current state.
   */
  public canTransitionTo(nextState: SessionState): boolean {
    if (this.state === nextState) {
      return true;
    }
    const permitted = VALID_TRANSITIONS[this.state];
    return Boolean(permitted && permitted.includes(nextState));
  }

  /**
   * Safely transitions session to a new state according to valid state machine rules.
   * Throws an error if an invalid transition is attempted.
   */
  public transitionTo(nextState: SessionState, reason?: string): boolean {
    if (this.state === nextState) {
      return true;
    }

    const permitted = VALID_TRANSITIONS[this.state];
    if (!permitted || !permitted.includes(nextState)) {
      throw new Error(
        `Invalid state transition from '${this.state}' to '${nextState}'. Terminal or prohibited transition.`
      );
    }

    const previousState = this.state;
    this.state = nextState;
    this.updatedAt = Date.now();

    this.emitEvent({
      type: 'session_state',
      sessionId: this.id,
      state: this.state,
      message: reason || `Transitioned from ${previousState} to ${nextState}`
    });

    return true;
  }

  /**
   * Submits a newly scoped research plan for user review and approval (Phase 1).
   * Transitions session state to 'awaiting_approval' and emits 'plan_proposed'.
   */
  public submitPlanProposed(plan: ResearchPlan): void {
    this.plan = plan;
    this.transitionTo('awaiting_approval', 'Research plan drafted and awaiting user approval');
    this.emitEvent({
      type: 'plan_proposed',
      sessionId: this.id,
      plan: this.plan,
      message: `Research plan v${plan.version} proposed for user scoping and approval`
    });
  }

  /**
   * Submits a newly drafted research plan for user inspection and collaborative approval.
   * Emits both plan_proposed and plan_created for backwards compatibility.
   */
  public submitPlanForApproval(plan: ResearchPlan): void {
    this.submitPlanProposed(plan);
    this.emitEvent({
      type: 'plan_created',
      sessionId: this.id,
      plan: this.plan,
      message: `Plan version ${plan.version} submitted with ${plan.milestones.length} milestones`
    });
  }

  /**
   * Allows live edits to milestones or skills during 'awaiting_approval' state before approval.
   */
  public updatePlan(updatedPlan: ResearchPlan): void {
    if (this.isTerminal()) {
      return;
    }
    this.plan = {
      ...updatedPlan,
      status: this.plan?.status || 'draft',
      updatedAt: Date.now()
    };
    this.emitEvent({
      type: 'plan_updated',
      sessionId: this.id,
      plan: this.plan,
      message: `Plan version ${this.plan.version} updated`
    });
  }

  /**
   * Convenience getter for session abort signal.
   */
  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Replays events strictly after lastEventId directly through the session interface.
   */
  public getEventsSince(lastEventId: number): LiveEvent[] {
    return this.eventBuffer.getEventsSince(lastEventId);
  }

  /**
   * Approves the proposed research plan (optionally with user modifications) and transitions
   * the session to 'running' to begin parallel retrieval. Freezes the retrieval trajectory.
   */
  public approvePlan(approvedPlan?: ResearchPlan): void {
    if (!this.canTransitionTo('running')) {
      return;
    }
    const target = approvedPlan || this.plan;
    if (target) {
      this.plan = {
        ...target,
        status: 'approved',
        updatedAt: Date.now()
      };
    }

    this.transitionTo('running', 'Plan approved by user; beginning research execution');
    this.emitEvent({
      type: 'plan_approved',
      sessionId: this.id,
      plan: this.plan,
      message: 'Research plan approved'
    });
  }

  /**
   * Rejects the proposed research plan, transitions session to 'cancelled', and emits 'plan_rejected'.
   */
  public rejectPlan(reason: string = 'Research plan rejected by user'): void {
    if (this.isTerminal()) {
      return;
    }
    if (this.plan) {
      this.plan = {
        ...this.plan,
        status: 'rejected',
        updatedAt: Date.now()
      };
    }
    this.transitionTo('cancelled', reason);
    this.emitEvent({
      type: 'plan_rejected',
      sessionId: this.id,
      plan: this.plan,
      message: reason
    });
  }

  /**
   * Strictly verifies whether the plan is authorized before retrieval execution begins.
   */
  public isPlanAuthorized(): boolean {
    return Boolean(this.plan && this.plan.status === 'approved');
  }

  /**
   * Transitions session to 'budget_exhausted' when source/depth quota is reached
   * before satisfying target evidence coverage.
   */
  public markBudgetExhausted(reason: string = 'Source budget exhausted before full coverage'): void {
    if (this.isTerminal()) {
      return;
    }
    this.transitionTo('budget_exhausted', reason);
    this.emitEvent({
      type: 'status',
      sessionId: this.id,
      state: 'budget_exhausted',
      message: reason
    });
  }

  /**
   * Appends an admitted source item to the partial evidence draft if not already present.
   */
  public recordSource(source: SourceItem): void {
    const exists = this.partialDraft.sources.some(s => s.url === source.url);
    if (!exists) {
      this.partialDraft.sources.push(source);
      this.updatedAt = Date.now();
    }
  }

  /**
   * Appends a chunk of synthesized text to the partial report draft.
   */
  public recordReportChunk(chunk: string): void {
    this.partialDraft.report += chunk;
    this.updatedAt = Date.now();
  }

  /**
   * Records discovered subqueries into the evidence draft.
   */
  public recordSubqueries(subqueries: string[]): void {
    for (const q of subqueries) {
      if (!this.partialDraft.subqueries.includes(q)) {
        this.partialDraft.subqueries.push(q);
      }
    }
    this.updatedAt = Date.now();
  }

  /**
   * Records an agent reflection into the evidence draft.
   */
  public recordReflection(reflection: string): void {
    if (!this.partialDraft.reflections.includes(reflection)) {
      this.partialDraft.reflections.push(reflection);
      this.updatedAt = Date.now();
    }
  }

  /**
   * Sub-second cancellation via AbortController.
   * Immediately aborts in-flight operations, transitions state to 'cancelled',
   * preserves all partial evidence gathered so far, and notifies subscribers without unhandled rejections.
   */
  public async cancel(reason: string = 'Cancelled by user'): Promise<PartialEvidenceDraft> {
    if (this.isTerminal()) {
      return this.partialDraft;
    }

    // Sub-second immediate abort propagation
    this.abortController.abort(reason);

    this.partialDraft.interruptedAt = Date.now();
    this.partialDraft.reason = reason;

    this.transitionTo('cancelled', reason);

    this.emitEvent({
      type: 'cancelled',
      sessionId: this.id,
      state: 'cancelled',
      message: reason,
      partialDraft: this.partialDraft
    });

    return this.partialDraft;
  }

  /**
   * Marks the session as completed successfully.
   */
  public complete(
    result?: { report?: string; sources?: SourceItem[]; metrics?: any },
    options: { emitFinished?: boolean } = {},
  ): void {
    if (this.isTerminal() || !this.canTransitionTo('completed')) {
      return;
    }

    if (result?.report) {
      this.partialDraft.report = result.report;
    }
    if (result?.sources) {
      for (const s of result.sources) {
        this.recordSource(s);
      }
    }

    this.transitionTo('completed', 'Research session completed successfully');

    if (options.emitFinished === false) {
      return;
    }

    this.emitEvent({
      type: 'finished',
      sessionId: this.id,
      state: 'completed',
      report: this.partialDraft.report,
      sources: this.partialDraft.sources,
      costs: result?.metrics?.costs ?? 0
    });
  }

  /**
   * Marks the session as failed upon unrecoverable error.
   */
  public fail(error: Error | string): void {
    if (this.isTerminal() || !this.canTransitionTo('failed')) {
      return;
    }

    const message = typeof error === 'string' ? error : error.message;
    this.failureReason = message;
    this.partialDraft.interruptedAt = Date.now();
    this.partialDraft.reason = message;

    this.transitionTo('failed', message);

    this.emitEvent({
      type: 'error',
      sessionId: this.id,
      state: 'failed',
      message: `Research execution failed: ${message}`,
      partialDraft: this.partialDraft
    });
  }

  /**
   * Returns true if session is in a terminal state (completed, cancelled, or failed).
   */
  public isTerminal(): boolean {
    return ['completed', 'cancelled', 'failed'].includes(this.state);
  }
}

/**
 * Session Lifecycle Manager
 *
 * Tracks, coordinates, and manages active research sessions across their full lifecycle.
 */
export class SessionLifecycleManager {
  private sessions: Map<string, ResearchSession> = new Map();

  /**
   * Creates and registers a new research session.
   */
  public createSession(
    request: WideResearchRequest,
    customSessionId?: string,
    bufferCapacity: number = 300
  ): ResearchSession {
    const session = new ResearchSession(request, customSessionId, bufferCapacity);
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Retrieves a session by ID.
   */
  public getSession(sessionId: string): ResearchSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Checks if a session exists.
   */
  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Cancels an active session by ID.
   */
  public async cancelSession(sessionId: string, reason?: string): Promise<PartialEvidenceDraft | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session.cancel(reason);
  }

  /**
   * Submits a scoped research plan for approval on a session.
   */
  public submitPlanProposed(sessionId: string, plan: ResearchPlan): ResearchPlan | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    session.submitPlanProposed(plan);
    return session.plan ?? null;
  }

  /**
   * Approves a research plan for a session in 'awaiting_approval' state.
   */
  public approveSessionPlan(sessionId: string, approvedPlan?: ResearchPlan): ResearchPlan | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    session.approvePlan(approvedPlan);
    return session.plan ?? null;
  }

  /**
   * Rejects a research plan for a session.
   */
  public rejectSessionPlan(sessionId: string, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.rejectPlan(reason);
    return true;
  }

  /**
   * Checks whether the session plan has been authorized by user.
   */
  public isSessionPlanAuthorized(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(session?.isPlanAuthorized());
  }

  /**
   * Removes a session from the manager.
   */
  public removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Lists all active sessions.
   */
  public listActiveSessions(): ResearchSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clears all sessions.
   */
  public clearAll(): void {
    this.sessions.clear();
  }
}
