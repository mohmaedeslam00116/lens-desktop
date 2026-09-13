import { LiveEvent, ResearchPlan, ResearchRequest } from './types';
import { DeepResearchAgent } from './agent';
import { ResearcherAgent, ResearcherOptions, ResearcherRunResult } from './researcherAgent';
import { SkillActivationManager } from './skills';
import { loadTodoPlanStore, TodoPlanStore } from './piPackages';
import { auditEvidenceCoverage } from './evidenceCoverage';
import { resetFetchLedger } from './fetchLedger';
import { routeCompression, disposeCompression } from './compressionRouting';

/** Researcher construction seam (pi-subagents-shaped): the default factory
 * builds in-process researchers; tests and later phases can supply
 * specialized constructions without changing the orchestration flow. */
export type ResearcherFactory = (sessionId: string, emitEvent: (event: LiveEvent) => void, options: ResearcherOptions) => ResearcherAgent;

const defaultResearcherFactory: ResearcherFactory =
  (sessionId, emitEvent, options) => new ResearcherAgent(sessionId, emitEvent, options);

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

/** Memory-boundedness guard (ADR-0010 decision 6): the read-only todo
 * projection carried per telemetry event is capped; truncation is flagged
 * additively so consumers can detect it. */
const MAX_PROJECTION_TASKS = 50;

/** Session-wide researcher-execution caps (ADR-0010 decision 8: researchers
 * draw from the single session evidence budget — no second pool). Bounded so
 * a large approved plan cannot fan out unbounded external calls or memory.
 * Counters live at SESSION scope (module map keyed by sessionId, evicted on
 * session teardown) — repeated runs for one session share the allowance. */
const MAX_RESEARCHERS_PER_SESSION = 8;
const MAX_RESEARCHER_FINDINGS_PER_SESSION = 48;

/** Parallel fan-out concurrency (ADR-0010 decision 8): researchers run
 * concurrently up to min(#facets, 4); the underlying BoundedScraperPool
 * caps (C_global=10, C_host=2) remain the ingestion throttle. */
const MAX_CONCURRENT_RESEARCHERS = 4

interface ResearcherBudget {
  researchersLaunched: number;
  findingsAdmitted: number;
}

const researcherBudgets = new Map<string, ResearcherBudget>();

/** Clears one session's researcher allowance — call on session teardown. */
export function resetResearcherBudget(sessionId: string): void {
  researcherBudgets.delete(sessionId);
  resetFetchLedger(sessionId);
}

/** Effective parallel researcher concurrency for a fan-out. */
export function effectiveConcurrency(facetCount: number, requested?: number): number {
  const base = Math.min(facetCount, MAX_CONCURRENT_RESEARCHERS);
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return Math.max(1, Math.min(base, Math.floor(requested)));
  }
  return base;
}

/** Runs an async worker over items with a hard concurrency bound. Preserves
 * result order (index-keyed) and stops scheduling new work once the signal
 * aborts; in-flight workers are awaited (they observe the signal). */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length || shouldStop()) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

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

  private researcherFactory: ResearcherFactory;

  constructor(
    sessionId: string,
    emitEvent: (event: LiveEvent) => void,
    activationManager?: SkillActivationManager,
    researcherFactory: ResearcherFactory = defaultResearcherFactory
  ) {
    this.sessionId = sessionId;
    this.emitEvent = emitEvent;
    this.activationManager = activationManager;
    this.researcherFactory = researcherFactory;
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

    // Authorization guard (mirrors SessionLifecycleManager.isPlanAuthorized):
    // only a plan the user actually approved may drive agency execution — a
    // pending/rejected plan with milestones must never pass this seam.
    const approvedPlan = (request as { plan?: ResearchPlan }).plan;
    if (
      approvedPlan?.status !== 'approved'
      || !approvedPlan.milestones
      || approvedPlan.milestones.length === 0
    ) {
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
      try {
        for (const a of assignments) {
          a.taskId = todoStore.createTask(a.facet, {
            activeForm: `Researching: ${a.facet}`,
          });
        }
      } catch (err) {
        // The todo plan is orchestration bookkeeping, not research output:
        // a store fault degrades to telemetry-only tracking (documented
        // contract) instead of failing the whole research run. Roll back any
        // partially created tasks so the session plan holds no orphans.
        console.warn('[ParentResearchAgent] todo plan write failed; rolling back and degrading to telemetry-only tracking:', err);
        for (const a of assignments) {
          if (a.taskId !== undefined) {
            try { todoStore.deleteTask(a.taskId); } catch { /* best-effort rollback */ }
            a.taskId = undefined;
          }
        }
        todoStore = null;
      }
    }

    // Completed-lifecycle bookkeeping must land BEFORE the delegated run's
    // terminal `finished` event: the delegated loop emits `finished` itself
    // right before returning, and a consumer that closes the stream on
    // `finished` would never see completion telemetry. So the delegated
    // `finished` is intercepted and deferred: on success the parent first
    // completes the todo tasks + emits completed telemetry, then forwards the
    // captured event verbatim (byte-parity of the terminal event is kept).
    let deferredFinished: LiveEvent | undefined;
    const interceptingEmit = (event: LiveEvent) => {
      if (event.type === 'finished' && !deferredFinished) {
        deferredFinished = event;
        return;
      }
      this.emitEvent(event);
    };

    // Everything from the first lifecycle emission onward runs inside the
    // cleanup-protected block: a throwing emit callback (consumers may abort
    // the signal synchronously from their callback) or a delegation fault
    // must never leave the todo plan with stale in_progress tasks.
    try {
      // Researcher lifecycle — assignment mirrors the phase-3 parallel fan-out
      // (ADR-0010 decision 8): every assigned researcher is marked in_progress
      // BEFORE any started telemetry is emitted, so every started snapshot
      // shows the full assignment set, not a sequential work-in-progress trail.
      if (todoStore) {
        try {
          for (const a of assignments) {
            if (a.taskId !== undefined) todoStore.updateTask(a.taskId, { status: 'in_progress' });
          }
        } catch (err) {
          console.warn('[ParentResearchAgent] todo status write failed:', err);
        }
      }

      for (const a of assignments) {
        this.emitTelemetry(a, facetCount, 'started', todoStore);
        // The consumer's emit callback may abort the signal synchronously;
        // stop the lifecycle immediately and clean up abandoned tasks.
        if (signal?.aborted) {
          if (todoStore) this.markTasksForCleanup(todoStore, assignments);
          return;
        }
      }

      this.emitEvent({
        type: 'status',
        message: `Assigning ${facetCount} research facet${facetCount === 1 ? '' : 's'} to researchers (agency mode)...`,
        step: 'planning',
      });

      // ADR-0010 phase 2 (ticket #89): with researcher_mode, each facet executes
      // inside an in-process researcher subagent — a scoped pi-core run using
      // the pi-web-access toolset (supplementary plane) over the LENS retrieval
      // backbone — and its findings flow into the delegated loop's evidence
      // pool pre-tagged with the facet's milestone provenance. Evidence
      // admission, dedupe, and the single session budget stay authoritative.
      const researcherMode = (request as { researcher_mode?: boolean }).researcher_mode === true;
      if (researcherMode) {
        // Compression lease (ticket #92): acquired ONCE at parent scope for
        // the whole fan-out — researchers run concurrently against the
        // process-wide supervisor, so per-researcher acquire/release would
        // leak children. Released in a finally block after the fan-out.
        let proxyBaseUrl: string | undefined;
        let compressionNotices: string[] = [];
        let ownsProxyLease = false;
        if ((request as { compression_mode?: boolean }).compression_mode === true) {
          const lease = await routeCompression({
            enabled: true,
            signal,
          });
          proxyBaseUrl = lease.proxyBaseUrl ?? undefined;
          compressionNotices = lease.notices;
          ownsProxyLease = lease.ownsProxy;
          for (const notice of compressionNotices) {
            this.emitEvent({ type: 'status', message: notice, step: 'compression' });
          }
        }

        try {
        const budget = researcherBudgets.get(this.sessionId) ?? { researchersLaunched: 0, findingsAdmitted: 0 };
        researcherBudgets.set(this.sessionId, budget);

        // Parallel fan-out under explicit caps (ADR-0010 decision 8, #90):
        // concurrency = min(#facets, 4) unless the request overrides it (still
        // clamped), with the single session budget gating every launch.
        const concurrencyLimit = effectiveConcurrency(
          facetCount,
          (request as { researcher_concurrency?: number }).researcher_concurrency
        );
        const seed: ResearcherRunResult[] = new Array(assignments.length);
        let researchersLaunched = 0;
        let researchersCompleted = 0;
        let researchersFailed = 0;
        let facetsDelegated = 0;

        await runPool(
          assignments,
          concurrencyLimit,
          async (a) => {
            // Session-wide caps: a researcher launches only while the session
            // has researcher and source allowance left (single session budget,
            // no second pool). Overshoot facets stay with the delegated loop.
            if (
              budget.researchersLaunched >= MAX_RESEARCHERS_PER_SESSION
              || budget.findingsAdmitted >= MAX_RESEARCHER_FINDINGS_PER_SESSION
            ) {
              facetsDelegated += 1;
              return;
            }
            budget.researchersLaunched += 1;
            researchersLaunched += 1;
            const researcher = this.researcherFactory(this.sessionId, this.emitEvent, {
              researcherId: researcherId(this.sessionId, a.facetIndex),
              facetIndex: a.facetIndex,
              facet: a.facet,
              facetCount,
              milestoneId: approvedPlan.milestones[a.facetIndex]?.id || `m${a.facetIndex + 1}`,
              milestoneTitle: approvedPlan.milestones[a.facetIndex]?.query || a.facet,
            toolPackages: true,
            activationManager: this.activationManager,
            searchProvider: request.search_provider,
            // Ticket #92: consume the parent's compression lease URL (absent
            // = uncompressed; degradation notices were already emitted).
            proxyBaseUrl,
            compressionNotices,
          });
            // A transient researcher failure must not prevent the delegated
            // retrieval/synthesis path from running: contain it and leave the
            // facet to the delegated loop's own retrieval. On abort, stop.
            let result: ResearcherRunResult;
            try {
              result = await researcher.run(request, signal);
            } catch (err) {
              if (signal?.aborted) return;
              researchersFailed += 1;
              facetsDelegated += 1;
              console.warn(
                `[ParentResearchAgent] researcher failed for facet ${a.facetIndex}; delegating without its findings:`,
                err
              );
              return;
            }
            if (signal?.aborted) return;
            researchersCompleted += 1;
            // Admit only the remaining session allowance — one researcher's
            // result can never overshoot the stated session-wide cap.
            const remaining = MAX_RESEARCHER_FINDINGS_PER_SESSION - budget.findingsAdmitted;
            const admitted = result.findings.slice(0, Math.max(0, remaining));
            if (admitted.length < result.findings.length) {
              console.warn(`[ParentResearchAgent] researcher findings truncated to the session allowance (${admitted.length}/${result.findings.length} admitted).`);
            }
            budget.findingsAdmitted += admitted.length;
            seed[a.facetIndex] = { ...result, findings: admitted };
          },
          () => signal?.aborted === true
        );

        // Aggregate fan-out telemetry (additive event, wide_telemetry
        // precedent): limits, dedupe yield, budget state, and per-facet
        // coverage aggregation over each facet's admitted findings.
        const coverageByFacet: Record<string, number> = {};
        for (const a of assignments) {
          const r = seed[a.facetIndex];
          if (!r || r.findings.length === 0) continue;
          coverageByFacet[a.facet] = auditEvidenceCoverage(
            a.facet,
            [],
            r.findings.map((f) => ({ content: f.content, domain: f.domain })),
            { language: request.language === 'ar' ? 'ar' : 'en' }
          ).overallScore;
        }
        this.emitEvent({
          type: 'fanout_telemetry',
          fanoutTelemetry: {
            concurrencyLimit,
            facetsTotal: facetCount,
            researchersLaunched,
            researchersCompleted,
            researchersFailed,
            facetsDelegated,
            urlsShared: seed.reduce((sum, r) => sum + (r?.dedupeShared ?? 0), 0),
            budgetFindingsAdmitted: budget.findingsAdmitted,
            coverageByFacet,
          },
        });

        // Findings enter the delegated loop's evidence pool with per-facet
        // provenance; admission/coverage keep enforcing the LENS contracts.
        (request as { scraped_sources?: unknown[] }).scraped_sources = [
          ...((request as { scraped_sources?: unknown[] }).scraped_sources ?? []),
          ...seed.flatMap((r) => (r ? r.findings : [])),
        ];
        } finally {
          // Release the compression lease on every path (success, failure,
          // abort) so the supervised child never outlives the fan-out.
          if (ownsProxyLease) {
            await disposeCompression();
          }
        }
      }

      // Delegate retrieval + synthesis verbatim to the legacy loop. The request
      // already carries the approved plan (trajectory freeze), so the delegated
      // run executes the identical fixture path and the final report is
      // byte-equivalent by construction. Later phases replace this delegation
      // with real parallel researchers behind the same seams.
      const delegate = new DeepResearchAgent(this.sessionId, interceptingEmit, this.activationManager);
      await delegate.run(request, signal);

      if (signal?.aborted) {
        if (todoStore) this.markTasksForCleanup(todoStore, assignments);
        return;
      }

      for (const a of assignments) {
        if (todoStore && a.taskId !== undefined) {
          try {
            todoStore.updateTask(a.taskId, { status: 'completed', activeForm: `Researched: ${a.facet}` });
          } catch (err) {
            console.warn('[ParentResearchAgent] todo completion write failed:', err);
          }
        }
        this.emitTelemetry(a, facetCount, 'completed', todoStore);
        if (signal?.aborted) {
          if (todoStore) this.markTasksForCleanup(todoStore, assignments);
          return;
        }
      }

      // Forward the deferred terminal event verbatim, now that the parent's
      // completion lifecycle is fully emitted — unless the consumer aborted
      // during completion telemetry.
      if (deferredFinished && !signal?.aborted) {
        this.emitEvent(deferredFinished);
      }
    } catch (err) {
      if (todoStore) this.markTasksForCleanup(todoStore, assignments);
      throw err;
    }
  }

  /** Failure/cancellation cleanup: transitions abandoned in_progress tasks
   * back to pending (the store supports pending → in_progress → completed
   * plus tombstone delete; pending is the honest non-terminal state for
   * unfinished facets) so the projection never retains stale in_progress. */
  private markTasksForCleanup(
    todoStore: TodoPlanStore,
    assignments: FacetAssignment[]
  ): void {
    for (const a of assignments) {
      if (a.taskId === undefined) continue;
      try {
        const task = todoStore.projection().find((t) => t.id === a.taskId);
        if (task?.status === 'in_progress') {
          todoStore.updateTask(a.taskId, { status: 'pending' });
        }
      } catch (err) {
        console.warn(`[ParentResearchAgent] todo cleanup failed for task #${a.taskId}:`, err);
      }
    }
  }
}
