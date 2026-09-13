import { LiveEvent, ResearchPlan, ResearchRequest } from './types';
import { DeepResearchAgent } from './agent';
import { SkillActivationManager } from './skills';
import { loadTodoPlanStore, TodoPlanStore } from './piPackages';

/** Memory-boundedness guard (ADR-0010 decision 6): the read-only todo
 * projection carried per telemetry event is capped; truncation is flagged
 * additively so consumers can detect it. */
const MAX_PROJECTION_TASKS = 50;

/**
 * parentAgent.ts — Parent Research Agent orchestration seam (ADR-0010 phase 1,
 * ticket #88).
 *
 * The parent owns ONLY orchestration in v1:
 *  - it derives research facets from the approved plan (a 1:1
 *    milestone-to-facet pass-through; the closed role catalog and
 *    deficit-driven re-specialization arrive with #93),
 *  - it maintains the session-scoped rpiv-todo research plan as
 *    engine-internal truth (parent-only writes, ADR-0010 decision 7) and
 *    exposes it solely as read-only projections inside telemetry events,
 *  - it emits additive `researcher_telemetry` lifecycle events (ADR-0010
 *    decision 6, wide_telemetry precedent) while evidence keeps flowing as
 *    ordinary `source` events.
 *
 * Retrieval and synthesis are DELEGATED verbatim to the legacy
 * DeepResearchAgent loop — the parity gate ("final report byte-equivalent to
 * the legacy loop on identical fixtures") holds by construction: the parent
 * adds only orchestration events around an unchanged execution. Researchers
 * become real per-facet in-process loops in #89; the parent/researcher seams
 * here (brief, lifecycle telemetry, todo plan) are the stable surface.
 */

/** One derived facet assignment: which facet (query) runs, in what order. */
export interface FacetAssignment {
  facetIndex: number;
  facet: string;
  /** rpiv-todo task id assigned by the store at creation time. Set during
   * run() when the todo plan store is available; consumers must treat it as
   * optional (the store may degrade to telemetry-only tracking). */
  taskId?: number;
}

/**
 * Derives facet assignments from the approved plan — the v1 contract is a
 * strict 1:1 milestone-to-facet pass-through in plan order.
 */
export function deriveFacetAssignments(plan: ResearchPlan): FacetAssignment[] {
  return plan.milestones.map((milestone, index) => ({
    facetIndex: index,
    facet: milestone.query,
  }));
}

/** Stable researcher id (v1: one sequential researcher per facet). */
function researcherId(sessionId: string, facetIndex: number): string {
  return `researcher_${sessionId}_${facetIndex + 1}`;
}

export class ParentResearchAgent {
  private sessionId: string;
  private emitEvent: (event: LiveEvent) => void;
  private activationManager?: SkillActivationManager;

  constructor(
    sessionId: string,
    emitEvent: (event: LiveEvent) => void,
    activationManager?: SkillActivationManager
  ) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
    this.activationManager = activationManager;
  }

  /** Emits one researcher_telemetry lifecycle event with the (optional,
   * size-capped) read-only todo-plan projection snapshot. */
  private emitTelemetry(
    assignment: FacetAssignment,
    facetCount: number,
    phase: 'started' | 'completed',
    todoStore: TodoPlanStore | null
  ): void {
    let projectionFields: Pick<NonNullable<LiveEvent['researcherTelemetry']>, 'todoProjection' | 'todoProjectionTruncated'> = {};
    if (todoStore) {
      const projection = todoStore.projection();
      projectionFields = {
        todoProjection: projection.slice(0, MAX_PROJECTION_TASKS),
        ...(projection.length > MAX_PROJECTION_TASKS ? { todoProjectionTruncated: true } : {}),
      };
    }
    this.emitEvent({
      type: 'researcher_telemetry',
      researcherTelemetry: {
        researcherId: researcherId(this.sessionId, assignment.facetIndex),
        // v1 pass-through role; the closed 5-role catalog lands with #93.
        role: 'primary',
        facet: assignment.facet,
        phase,
        counts: { facetIndex: assignment.facetIndex, facetCount },
        ...projectionFields,
      },
    });
  }

  async run(request: ResearchRequest, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;

    const approvedPlan = (request as { plan?: ResearchPlan }).plan;
    if (!approvedPlan?.milestones || approvedPlan.milestones.length === 0) {
      throw new Error(
        '[ParentResearchAgent] agency mode requires an approved research plan with milestones'
      );
    }

    const assignments = deriveFacetAssignments(approvedPlan);
    const facetCount = assignments.length;

    // Parent-only rpiv-todo research plan (session-scoped). Degrades to
    // telemetry-only tracking when the vendored store is unavailable.
    let todoStore: TodoPlanStore | null = null;
    try {
      todoStore = await loadTodoPlanStore(this.sessionId);
    } catch (err) {
      console.warn('[ParentResearchAgent] todo plan store unavailable:', err);
    }
    // Recheck cancellation after the async store load so an aborted run never
    // creates tasks or emits lifecycle events.
    if (signal?.aborted) return;

    if (todoStore) {
      for (const a of assignments) {
        a.taskId = todoStore.createTask(a.facet, {
          activeForm: `Researching: ${a.facet}`,
        });
      }
    }

    // Researcher lifecycle — assignment mirrors the phase-3 parallel fan-out
    // (ADR-0010 decision 8): every assigned researcher is marked in_progress
    // BEFORE any started telemetry is emitted, so every started snapshot shows
    // the full assignment set, not a sequential work-in-progress trail.
    if (todoStore) {
      for (const a of assignments) {
        todoStore.updateTask(a.taskId!, { status: 'in_progress' });
      }
    }
    for (const a of assignments) {
      this.emitTelemetry(a, facetCount, 'started', todoStore);
    }

    this.emitEvent({
      type: 'status',
      message: `Assigning ${facetCount} research facet${facetCount === 1 ? '' : 's'} to researchers (agency mode)...`,
      step: 'planning',
    });

    // Delegate retrieval + synthesis verbatim to the legacy loop. The request
    // already carries the approved plan (trajectory freeze), so the delegated
    // run executes the identical fixture path and the final report is
    // byte-equivalent by construction. #89 replaces this delegation with a
    // real in-process researcher behind the same seams.
    const delegate = new DeepResearchAgent(this.sessionId, this.emitEvent, this.activationManager);
    await delegate.run(request, signal);

    if (signal?.aborted) return;

    for (const a of assignments) {
      if (todoStore) {
        todoStore.updateTask(a.taskId!, { status: 'completed', activeForm: `Researched: ${a.facet}` });
      }
      this.emitTelemetry(a, facetCount, 'completed', todoStore);
    }
  }
}
