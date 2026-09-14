import type { ResearchStep } from '../types';

/** Minimal structural view of the LiveEvent payloads the renderer consumes.
 * The engine is the source of truth for these shapes (types.ts in the engine). */
export interface LiveEventLike {
  type: string;
  state?: string;
  message?: string;
  /** researcher_telemetry / role selection (ticket #93 shapes). */
  researcherTelemetry?: {
    researcherId?: string;
    role?: string;
    facet?: string;
    phase?: string;
    rationale?: string;
    counts?: { facetIndex?: number; facetCount?: number; respecialization?: boolean; rationale?: string };
  };
  /** fanout_telemetry aggregate (ticket #90 shape). */
  fanoutTelemetry?: {
    concurrencyLimit?: number;
    facetsTotal?: number;
    researchersLaunched?: number;
    researchersCompleted?: number;
    researchersFailed?: number;
    facetsDelegated?: number;
    urlsShared?: number;
    budgetFindingsAdmitted?: number;
  };
  /** audit_telemetry aggregate (ticket #91 shape, advisory). */
  auditTelemetry?: {
    supported?: number;
    partiallySupported?: number;
    unsupported?: number;
    overallSupport?: number;
    mode?: string;
  };
}

/** Per-agent card state for the workspace feed (visibility fix, ticket #119).
 * One entry per researcher/agentic worker; parent-level progress stays in the
 * steps feed. */
export interface AgentFeedState {
  id: string;
  role: string;
  label: string;
  facet?: string;
  phase: string;
  /** Wall-clock span from the card's first activity; frozen at terminal
   * phases (completed/run_completed) so the display clock stops. */
  startedAt: number;
  elapsedMs: number;
  lastActivity: string;
  lastActivityAt: number;
  status: 'running' | 'waiting' | 'retrying' | 'success' | 'failed';
}

/** Maps a `session_state` event into a status step (bilingual). */
export function sessionStateStep(ev: LiveEventLike, isArabic: boolean): string | null {
  switch (ev.state) {
    case 'planning':
      return isArabic ? 'تهيئة جلسة البحث' : 'Initializing research session';
    case 'awaiting_approval':
      return isArabic ? 'بانتظار اعتماد خطة البحث' : 'Awaiting plan approval';
    case 'running':
      return isArabic ? 'البحث قيد التنفيذ' : 'Research running';
    case 'completed':
      return isArabic ? 'انتهت جلسة البحث' : 'Research session completed';
    case 'cancelled':
      return isArabic ? 'أُلغيت جلسة البحث' : 'Research session cancelled';
    case 'failed':
      return isArabic ? 'فشلت جلسة البحث' : 'Research session failed';
    case 'budget_exhausted':
      return isArabic ? 'استُهلكت ميزانية الجلسة' : 'Session budget exhausted';
    default:
      return null;
  }
}

/** Maps multi-agent telemetry events into live-feed steps. Returns null for
 * events that are already surfaced elsewhere (handled in App.tsx's switch). */
export function telemetryStep(ev: LiveEventLike, isArabic: boolean): string | null {
  switch (ev.type) {
    case 'researcher_telemetry': {
      const t = ev.researcherTelemetry || {};
      const idx = t.counts?.facetIndex;
      const total = t.counts?.facetCount;
      const pos = typeof idx === 'number' && typeof total === 'number' ? ` ${idx + 1}/${total}` : '';
      const facet = t.facet ? ` — ${t.facet}` : '';
      switch (t.phase) {
        case 'started':
          return isArabic
            ? `انطلق باحث${pos}${facet} (${t.role || 'دور أساسي'})`
            : `Researcher${pos} started${facet} (${t.role || 'primary'})`;
        case 'role_selected':
          return isArabic
            ? `اختير دور "${t.role}" للباحث${pos}${t.rationale || t.counts?.rationale ? ` — ${t.rationale || t.counts?.rationale}` : ''}`
            : `Role "${t.role}" selected for researcher${pos}${t.rationale || t.counts?.rationale ? ` — ${t.rationale || t.counts?.rationale}` : ''}`;
        case 'retrieval':
          return isArabic ? `جارٍ استرجاع الأدلة للباحث${pos}` : `Researcher${pos} retrieving evidence`;
        case 'tool_activity':
          return isArabic ? `نشاط أدوات لدى الباحث${pos}` : `Researcher${pos} tool activity`;
        case 'run_started':
          return isArabic ? `بدأت حلقة الباحث${pos}` : `Researcher${pos} loop started`;
        case 'run_completed':
          return isArabic ? `أنجز الباحث${pos} عمله` : `Researcher${pos} finished`;
        case 'completed':
          return isArabic ? `اكتمل عمل الباحث${pos}${facet}` : `Researcher${pos} completed${facet}`;
        default:
          return null;
      }
    }
    case 'fanout_telemetry': {
      const f = ev.fanoutTelemetry || {};
      const launched = typeof f.researchersLaunched === 'number' ? f.researchersLaunched : 0;
      const completed = typeof f.researchersCompleted === 'number' ? f.researchersCompleted : 0;
      const failed = typeof f.researchersFailed === 'number' ? f.researchersFailed : 0;
      const shared = typeof f.urlsShared === 'number' ? f.urlsShared : 0;
      const limit = f.concurrencyLimit;
      const limitTxt = typeof limit === 'number' ? ` (تزامن ≤ ${limit})` : '';
      if (launched > completed + failed) {
        return isArabic
          ? `توزيع متوازٍ: ${launched} باحثين يعملون الآن${limitTxt}`
          : `Fan-out: ${launched} researchers running in parallel${typeof limit === 'number' ? ` (concurrency ≤ ${limit})` : ''}`;
      }
      return isArabic
        ? `انتهى التوزيع المتوازي: ${completed} نجح، ${failed} فشل، ${shared} مصادر مشتركة`
        : `Fan-out complete: ${completed} succeeded, ${failed} failed, ${shared} shared URLs`;
    }
    case 'audit_telemetry': {
      const a = ev.auditTelemetry || {};
      const s = a.supported ?? 0;
      const p = a.partiallySupported ?? 0;
      const u = a.unsupported ?? 0;
      return isArabic
        ? `تدقيق الأدلة (استشاري): ${s} مدعومة، ${p} جزئياً، ${u} غير مدعومة`
        : `Evidence audit (advisory): ${s} supported, ${p} partial, ${u} unsupported`;
    }
    case 'session_state':
      return sessionStateStep(ev, isArabic);
    default:
      return null;
  }
}
