import React, { useState } from 'react';
import { Square, Wrench, CircleAlert, CircleCheck, ArrowDownUp, ChevronDown, TriangleAlert } from 'lucide-react';
import type { Language } from '../../types';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';

/**
 * The agent run feed — the live visual surface of ONE agentic run (ticket
 * #145). Everything rendered here comes from the reduced live feed
 * (`AgentRunFeedState`): the current activity in plain language, tool calls
 * with their real arguments and outputs, the sources admitted so far, the
 * steering queue (visible from the moment it is queued), the auto-retry
 * trail, and the explicit terminal with the evidence admitted so far.
 * Nothing is invented here; absent stays absent.
 */

interface AgentRunFeedProps {
  feed: AgentRunFeedState;
  language: Language;
  onCancel: () => void;
}

const phaseLabel: Record<AgentRunFeedState['phase'], { ar: string; en: string }> = {
  idle: { ar: 'خامل', en: 'Idle' },
  running: { ar: 'يعمل الآن', en: 'Running' },
  retrying: { ar: 'إعادة محاولة تلقائية', en: 'Auto-retrying' },
  finished: { ar: 'اكتمل', en: 'Completed' },
  cancelled: { ar: 'أُلغي', en: 'Cancelled' },
  error: { ar: 'فشل', en: 'Failed' },
  // Retained for type completeness only: since the budget fix, the reducer
  // never sets this phase (the warning records via lastEvent instead).
  budget_exhausted: { ar: 'استُنفدت الميزانية', en: 'Budget exhausted' },
};

/** One-line human reading of a tool call's arguments — never a raw JSON dump. */
function describeArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  if (toolName === 'web_search' && typeof record.query === 'string') return `“${record.query}”`;
  if (toolName === 'fetch_content' && typeof record.url === 'string') {
    try {
      const url = new URL(record.url);
      const path = url.pathname === '/' ? '' : url.pathname;
      return `${url.hostname}${path.length > 40 ? `${path.slice(0, 40)}…` : path}`;
    } catch {
      return String(record.url).slice(0, 60);
    }
  }
  const keys = Object.keys(record);
  if (keys.length === 0) return '';
  const first = record[keys[0]];
  return typeof first === 'string' && first ? `${keys[0]}: ${first.slice(0, 60)}` : keys.join(', ');
}

/** The agent's current activity in plain language, derived from the live feed. */
function currentActivity(feed: AgentRunFeedState, ar: boolean): string | null {
  if (feed.phase !== 'running' && feed.phase !== 'retrying') return null;
  if (feed.phase === 'retrying' && feed.retries.length > 0) {
    const latest = feed.retries[feed.retries.length - 1];
    return ar ? `إعادة محاولة ${latest.attempt}${latest.reason ? ` — ${latest.reason}` : ''}` : latest.label;
  }
  for (let i = feed.toolChips.length - 1; i >= 0; i -= 1) {
    const chip = feed.toolChips[i];
    if (chip.status !== 'running') continue;
    const detail = describeArgs(chip.toolName, chip.args);
    if (chip.toolName === 'web_search') return ar ? `يبحث: ${detail || '…'}` : `Searching ${detail || '…'}`;
    if (chip.toolName === 'fetch_content') return ar ? `يجلب: ${detail || '…'}` : `Fetching ${detail || '…'}`;
    return ar ? `يستخدم ${chip.toolName}${detail ? `: ${detail}` : ''}` : `Running ${chip.toolName}${detail ? ` ${detail}` : ''}`;
  }
  return ar ? 'يعمل الوكيل…' : 'Agent working…';
}

export const AgentRunFeed: React.FC<AgentRunFeedProps> = ({ feed, language, onCancel }) => {
  const ar = language === 'ar';
  const phase = phaseLabel[feed.phase] ?? phaseLabel.idle;
  const running = feed.phase === 'running' || feed.phase === 'retrying';
  const activity = currentActivity(feed, ar);
  const budgetWarning = feed.lastEvent === 'budget_exhausted';
  const [expandedChips, setExpandedChips] = useState<ReadonlySet<number>>(new Set());
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const toggleChip = (index: number) => {
    setExpandedChips((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <section className="harness-agent-feed" aria-live="polite" aria-label={ar ? 'سير التشغيل الأجنتي' : 'Agentic run feed'}>
      <header className="harness-agent-feed-head">
        <span className={`harness-agent-phase harness-agent-phase-${feed.phase}`}>
          {ar ? phase.ar : phase.en}
        </span>
        {activity && (
          <span className="harness-agent-activity" role="status">
            <span className="harness-agent-activity-dot" aria-hidden="true" />
            {activity}
          </span>
        )}
        {running && (
          <button
            type="button"
            className="harness-agent-cancel"
            onClick={onCancel}
            aria-label={ar ? 'إيقاف التشغيل الأجنتي' : 'Cancel the agentic run'}
          >
            <Square size={13} />
            <span>{ar ? 'إيقاف' : 'Stop'}</span>
          </button>
        )}
      </header>

      {budgetWarning && running && (
        <p className="harness-agent-warning" role="status">
          <TriangleAlert size={13} aria-hidden="true" />
          <span>
            {ar
              ? 'استُنفدت ميزانية الاسترجاع — يواصل الوكيل بما جُمع من أدلة.'
              : 'Retrieval budget reached — the agent continues with the evidence gathered so far.'}
          </span>
        </p>
      )}

      {feed.steerNotice && (
        <p className="harness-agent-steer" role="status">
          <ArrowDownUp size={13} aria-hidden="true" />
          <span>{ar ? `في قائمة الانتظار: ${feed.steerNotice.message}` : feed.steerNotice.label}</span>
        </p>
      )}

      {feed.retries.length > 0 && (
        <ul className="harness-agent-retries" aria-label={ar ? 'إعادات المحاولة التلقائية' : 'Automatic retries'}>
          {feed.retries.slice(-3).map((retry, index) => (
            <li key={`${retry.attempt}-${index}`}>
              <CircleAlert size={12} aria-hidden="true" />
              <span>{ar ? `إعادة محاولة ${retry.attempt}${retry.reason ? ` — ${retry.reason}` : ''}` : retry.label}</span>
            </li>
          ))}
        </ul>
      )}

      {feed.toolChips.length > 0 && (
        <ul className="harness-agent-chips" aria-label={ar ? 'استدعاءات الأدوات' : 'Tool calls'}>
          {feed.toolChips.map((chip, index) => {
            const expanded = expandedChips.has(index);
            const detail = describeArgs(chip.toolName, chip.args);
            return (
              <li key={`${chip.toolName}-${index}`}>
                <button
                  type="button"
                  className={`harness-tool-chip ${chip.status === 'running' ? 'is-running' : chip.status === 'done' ? 'is-done' : 'is-failed'}`}
                  onClick={() => toggleChip(index)}
                  aria-expanded={expanded}
                  title={chip.resultText ?? undefined}
                >
                  <Wrench size={11} aria-hidden="true" />
                  <span className="harness-tool-chip-name">{chip.toolName}</span>
                  {detail && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="harness-tool-chip-args">{detail}</span>
                    </>
                  )}
                  {chip.status !== 'running' && (
                    chip.status === 'done' ? (
                      <CircleCheck size={11} aria-hidden="true" />
                    ) : (
                      <CircleAlert size={11} aria-hidden="true" />
                    )
                  )}
                  <ChevronDown size={11} aria-hidden="true" className={`harness-tool-chip-chevron${expanded ? ' is-open' : ''}`} />
                </button>
                {expanded && (
                  <div className="harness-tool-chip-detail">
                    {chip.resultText ? (
                      <p dir="auto">{chip.resultText}</p>
                    ) : (
                      <p className="harness-tool-chip-pending">
                        {ar ? 'بانتظار النتيجة…' : 'Awaiting result…'}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {feed.sources.length > 0 && (
        <div className="harness-agent-sources-block">
          <button
            type="button"
            className="harness-agent-sources-toggle"
            onClick={() => setSourcesOpen((open) => !open)}
            aria-expanded={sourcesOpen}
          >
            <span>
              {ar
                ? `${feed.sources.length} مصدر مقبول حتى الآن`
                : `${feed.sources.length} source${feed.sources.length === 1 ? '' : 's'} admitted so far`}
            </span>
            <ChevronDown size={12} aria-hidden="true" className={`harness-tool-chip-chevron${sourcesOpen ? ' is-open' : ''}`} />
          </button>
          {sourcesOpen && (
            <ol className="harness-agent-sources-list">
              {feed.sources.map((source) => (
                <li key={source.url}>
                  <strong>{source.title || source.url}</strong>
                  {source.domain && <bdi dir="ltr">{source.domain}</bdi>}
                  {source.snippet && <p dir="auto">{source.snippet}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};
