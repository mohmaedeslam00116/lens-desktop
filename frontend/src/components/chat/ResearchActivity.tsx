import React, { useEffect, useState } from 'react';
import { ChevronDown, Square, Wrench } from 'lucide-react';
import type { Language } from '../../types';
import type { ChatLiveState } from './types';

/**
 * ResearchActivity — the AgentRunFeed demoted to a compact expandable
 * section inside the assistant turn. Auto-expands while running, collapses
 * to a one-line summary after completion. Every line maps to a real engine
 * event (feed chips, thoughts, subqueries, agent cards); nothing invented.
 */

function humanizeTool(toolName: string, args: unknown, ar: boolean): string {
  if (!args || typeof args !== 'object') return toolName;
  const r = args as Record<string, unknown>;
  if (toolName === 'web_search' && typeof r.query === 'string') {
    return ar ? `البحث في الويب "${r.query.slice(0, 80)}"` : `Searching the web "${r.query.slice(0, 80)}"`;
  }
  if (toolName === 'fetch_content' && typeof r.url === 'string') {
    try {
      const u = new URL(r.url);
      return ar ? `قراءة المصدر ${u.hostname}` : `Reading source ${u.hostname}`;
    } catch {
      return ar ? 'قراءة مصدر' : 'Reading source';
    }
  }
  if (toolName === 'source_check') return ar ? 'التحقق من المصدر' : 'Checking source';
  if (toolName === 'get_search_content') return ar ? 'استرجاع محتوى البحث' : 'Retrieving search content';
  return toolName;
}

interface ResearchActivityProps {
  language: Language;
  live: ChatLiveState;
  onCancel: () => void;
}

export const ResearchActivity: React.FC<ResearchActivityProps> = ({ language, live, onCancel }) => {
  const ar = language === 'ar';
  const running = live.loading;
  const [open, setOpen] = useState(running);
  useEffect(() => {
    setOpen(running);
  }, [running]);

  const feed = live.agentRunFeed;
  const toolChips = feed?.toolChips ?? [];
  const searchCount = toolChips.filter((c) => c.toolName === 'web_search').length;
  const sourceCount = feed?.sources.length ?? 0;
  const hasActivity =
    toolChips.length > 0 || live.thoughts.length > 0 || live.subqueries.length > 0 || live.agents.length > 0 || Boolean(live.currentStatus);

  const currentStep = (() => {
    if (!running) return null;
    for (let i = toolChips.length - 1; i >= 0; i -= 1) {
      const chip = toolChips[i];
      if (chip.status === 'running') return humanizeTool(chip.toolName, chip.args, ar);
    }
    if (live.currentStatus) return live.currentStatus;
    return ar ? 'يبحث…' : 'Researching…';
  })();

  if (!hasActivity && !running) return null;

  const summary = running
    ? (currentStep ?? (ar ? 'يبحث…' : 'Researching…'))
    : ar
      ? `نشاط البحث · ${searchCount} بحث · ${sourceCount} مصدر`
      : `Research activity · ${searchCount} searches · ${sourceCount} sources`;

  return (
    <section className="chat-activity" aria-label={ar ? 'نشاط البحث' : 'Research activity'} data-testid="chat-research-activity">
      <button
        type="button"
        className="chat-activity-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="chat-activity-dot" aria-hidden="true" data-running={running ? 'true' : 'false'} />
        <span className="chat-activity-summary">{summary}</span>
        <ChevronDown size={13} aria-hidden="true" className={`chat-activity-chevron${open ? ' is-open' : ''}`} />
        {running && (
          <span
            role="button"
            tabIndex={0}
            className="chat-activity-stop"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onCancel(); } }}
            aria-label={ar ? 'إيقاف البحث' : 'Stop research'}
          >
            <Square size={11} aria-hidden="true" />
          </span>
        )}
      </button>
      {open && (
        <div className="chat-activity-body">
          {currentStep && running && (
            <p className="chat-activity-current" role="status">{currentStep}</p>
          )}
          {live.subqueries.length > 0 && (
            <ul className="chat-activity-subqueries" aria-label={ar ? 'استعلامات البحث' : 'Search queries'}>
              {live.subqueries.slice(0, 6).map((q) => (
                <li key={q} dir="auto">{ar ? `البحث: ${q}` : `Searching "${q}"`}</li>
              ))}
            </ul>
          )}
          {toolChips.length > 0 && (
            <ul className="chat-activity-tools">
              {toolChips.slice(-8).map((chip, i) => (
                <li key={`${chip.toolName}-${i}`} className="chat-activity-tool">
                  <Wrench size={11} aria-hidden="true" />
                  <span dir="auto">{humanizeTool(chip.toolName, chip.args, ar)}</span>
                  <span className="chat-activity-tool-status" aria-hidden="true">
                    {chip.status === 'running' ? '●' : chip.status === 'done' ? '✓' : '✕'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {live.thoughts.length > 0 && (
            <ul className="chat-activity-thoughts">
              {live.thoughts.slice(-3).map((t, i) => (
                <li key={`${i}-${t.slice(0, 24)}`} dir="auto">{t}</li>
              ))}
            </ul>
          )}
          {live.agents.length > 0 && (
            <p className="chat-activity-agents">
              {ar
                ? `${live.agents.length} باحث · ${live.agentEventCount} حدث`
                : `${live.agents.length} researcher${live.agents.length === 1 ? '' : 's'} · ${live.agentEventCount} events`}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
