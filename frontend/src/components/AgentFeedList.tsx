import React from 'react';
import { Loader2, CircleCheck, CircleAlert, Clock3 } from 'lucide-react';
import { AgentFeedState } from '../utils/liveFeed';

interface AgentFeedListProps {
  agents: AgentFeedState[];
  language: 'ar' | 'en';
  /** Total telemetry events received — a liveness signal in the header. */
  eventCount?: number;
}

/** Elapsed-time display with Arabic unit parity (CodeRabbit finding). */
function formatElapsed(ms: number, isArabic: boolean): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (isArabic) {
    if (s < 60) return `${s} ث`;
    if (m < 60) return `${m} د ${rem} ث`;
    return `${Math.floor(m / 60)} س ${m % 60} د`;
  }
  if (s < 60) return `${s}s`;
  if (m < 60) return `${m}m ${rem}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Per-agent activity cards: state, elapsed time, last engine event. Purely
 * presentational — the engine's researcher_telemetry stream is the source of
 * truth (visibility fix, map ticket #119). Monochrome neutral tokens only
 * (BRAND/DESIGN discipline). */
export const AgentFeedList: React.FC<AgentFeedListProps> = ({ agents, language, eventCount }) => {
  if (agents.length === 0) return null;
  const isArabic = language === 'ar';
  return (
    <div className="space-y-2" data-testid="agent-feed">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {isArabic ? 'الوكلاء النشطون' : 'Active agents'}
        {typeof eventCount === 'number' && eventCount > 0 && (
          <span className="mx-1.5 text-muted">· {eventCount}</span>
        )}
      </div>
      {agents.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {a.status === 'success' ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-accent" />
            ) : a.status === 'failed' ? (
              <CircleAlert className="h-4 w-4 shrink-0 text-accent" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
            )}
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-ink">
                {a.label}
                <span className="mx-1.5 text-muted">·</span>
                <span className="text-muted">{a.role}</span>
              </div>
              {a.facet && (
                <div className="truncate text-[11px] text-muted" title={a.facet}>{a.facet}</div>
              )}
              <div className="truncate text-[11px] text-muted">{a.lastActivity}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
            <Clock3 className="h-3.5 w-3.5" />
            <span>{formatElapsed(a.elapsedMs, isArabic)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
