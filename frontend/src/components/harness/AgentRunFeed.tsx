import React from 'react';
import { Square, Wrench, CircleAlert, CircleCheck, ArrowDownUp } from 'lucide-react';
import type { Language } from '../../types';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';

/**
 * The agent run feed — the live visual surface of ONE agentic run (ticket
 * #145). Everything rendered here comes from the reduced live feed
 * (`AgentRunFeedState`): tool chips with real names/arguments/outputs, the
 * sources admitted so far, the steering queue (visible from the moment it is
 * queued), the auto-retry trail, and the explicit terminal with the evidence
 * admitted so far. Nothing is invented here; absent stays absent.
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
  budget_exhausted: { ar: 'استُنفدت الميزانية', en: 'Budget exhausted' },
  error: { ar: 'فشل', en: 'Failed' },
};

const chipStateClass: Record<'running' | 'done' | 'failed', string> = {
  running: 'is-running',
  done: 'is-done',
  failed: 'is-failed',
};

export const AgentRunFeed: React.FC<AgentRunFeedProps> = ({ feed, language, onCancel }) => {
  const ar = language === 'ar';
  const phase = phaseLabel[feed.phase];
  const running = feed.phase === 'running' || feed.phase === 'retrying';

  return (
    <section className="harness-agent-feed" aria-live="polite" aria-label={ar ? 'سير التشغيل الأجنتي' : 'Agentic run feed'}>
      <header className="harness-agent-feed-head">
        <span className={`harness-agent-phase harness-agent-phase-${feed.phase}`}>
          {ar ? phase.ar : phase.en}
        </span>
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
        <div className="harness-agent-chips" aria-label={ar ? 'استدعاءات الأدوات' : 'Tool calls'}>
          {feed.toolChips.map((chip, index) => (
            <span
              key={`${chip.toolName}-${index}`}
              className={`harness-tool-chip ${chipStateClass[chip.status]}`}
              title={chip.resultText ?? undefined}
            >
              <Wrench size={11} aria-hidden="true" />
              <span className="harness-tool-chip-name">{chip.toolName}</span>
              <span aria-hidden="true">·</span>
              <span className="harness-tool-chip-args">{JSON.stringify(chip.args)}</span>
              {chip.status !== 'running' && (
                chip.status === 'done' ? (
                  <CircleCheck size={11} aria-hidden="true" />
                ) : (
                  <CircleAlert size={11} aria-hidden="true" />
                )
              )}
            </span>
          ))}
        </div>
      )}

      {feed.sources.length > 0 && (
        <p className="harness-agent-sources" aria-label={ar ? 'المصادر المقبولة' : 'Admitted sources'}>
          {ar
            ? `${feed.sources.length} مصدر مقبول حتى الآن`
            : `${feed.sources.length} source${feed.sources.length === 1 ? '' : 's'} admitted so far`}
        </p>
      )}
    </section>
  );
};
