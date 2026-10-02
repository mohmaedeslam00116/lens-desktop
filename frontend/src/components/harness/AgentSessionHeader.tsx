import React, { useEffect, useRef, useState } from 'react';
import { Bot, Square } from 'lucide-react';
import type { Language } from '../../types';
import type { AgentRunFeedState } from '../../utils/agentRunFeed.mjs';
import type { AgentInteraction } from './LensHarnessWorkspace';

/**
 * The agent session header — the run's identity at the top of the canvas.
 * One question, one live agent: the question it is working, which loop runs
 * it (gate-free Agentic Search or plan-first Deep Research), the live phase,
 * how long it has been working, what it has produced so far (tool calls,
 * admitted sources), and the single Stop control while it is live.
 *
 * Everything here is derived from the reduced live feed and the run state
 * the workspace already owns — the header invents no activity of its own.
 */

interface AgentSessionHeaderProps {
  question: string;
  mode: AgentInteraction;
  /** Null for Deep Research runs and idle sessions (no agentic feed). */
  feed: AgentRunFeedState | null;
  /** True while any run (agentic or Deep Research) is in flight. */
  live: boolean;
  language: Language;
  onCancel: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

export const AgentSessionHeader: React.FC<AgentSessionHeaderProps> = ({
  question,
  mode,
  feed,
  live,
  language,
  onCancel,
}) => {
  const ar = language === 'ar';
  // The run clock starts when work visibly starts and resets per question.
  // It is display-only: terminals and evidence stay owned by the feed.
  const startedAtRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  if (startedAtRef.current === null && live) startedAtRef.current = Date.now();
  if (!live) startedAtRef.current = null;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, question]);

  const phase = feed?.phase ?? (live ? 'running' : 'idle');
  const phaseLabel =
    phase === 'running'
      ? ar ? 'يعمل الآن' : 'Working'
      : phase === 'retrying'
        ? ar ? 'إعادة محاولة' : 'Retrying'
        : phase === 'finished'
          ? ar ? 'اكتمل' : 'Done'
          : phase === 'cancelled'
            ? ar ? 'أُوقف' : 'Stopped'
            : phase === 'error'
              ? ar ? 'فشل' : 'Failed'
              : ar ? 'الوكيل' : 'Agent';
  const toolCount = feed?.toolChips.length ?? 0;
  const sourceCount = feed?.sources.length ?? 0;
  const elapsed = startedAtRef.current !== null ? formatElapsed(now - startedAtRef.current) : null;

  return (
    <section className="harness-session-head" aria-live="polite" aria-label={ar ? 'جلسة الوكيل' : 'Agent session'}>
      <div className="harness-session-head-main">
        <span className="harness-session-agent-mark" aria-hidden="true">
          <Bot size={15} />
        </span>
        <div className="harness-session-head-text">
          <h1>{question}</h1>
          <p>
            <span className={`harness-agent-phase harness-agent-phase-${phase}`}>{phaseLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{mode === 'agent' ? (ar ? 'بحث وكيل' : 'Agentic Search') : (ar ? 'البحث المعمّق' : 'Deep Research')}</span>
            {elapsed && (
              <>
                <span aria-hidden="true">·</span>
                <time className="font-mono" dir="ltr">{elapsed}</time>
              </>
            )}
            {(toolCount > 0 || sourceCount > 0) && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {ar
                    ? `${toolCount} أداة · ${sourceCount} مصدر`
                    : `${toolCount} tool${toolCount === 1 ? '' : 's'} · ${sourceCount} source${sourceCount === 1 ? '' : 's'}`}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      {live && (
        <button
          type="button"
          className="harness-agent-cancel"
          onClick={onCancel}
          aria-label={ar ? 'إيقاف الوكيل' : 'Stop the agent'}
        >
          <Square size={13} aria-hidden="true" />
          <span>{ar ? 'إيقاف' : 'Stop'}</span>
        </button>
      )}
    </section>
  );
};
