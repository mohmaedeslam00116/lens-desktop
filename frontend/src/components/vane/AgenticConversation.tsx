import React, { useMemo } from 'react';
import { MessageSquare, Wrench, User, CircleStop, AlertTriangle, CircleCheck, Clock } from 'lucide-react';
import type { Language } from '../../types';
import type {
  AgenticConversationProjection,
  TranscriptRecord,
} from '../../utils/agenticConversation';
import { buildConversationProjection } from '../../utils/agenticConversation';

/**
 * Agentic Conversation — the fifth typed artifact (ticket #144, SPEC-028
 * Decision 2). A projection of the PERSISTED transcript, replayable exactly
 * as it happened: user turns, assistant text, tool-call chips with real
 * names and arguments, and the turn's explicit terminal. The card renders
 * only what the transcript holds — an absent or failed persistence renders
 * its visible-empty state and never fabricates. No runtime session objects
 * cross this boundary: the input is the persisted record (or an already-
 * built projection), never the live AgentSession.
 */

interface AgenticConversationProps {
  /** The persisted record read back from the LENS-side transcript store. */
  record?: TranscriptRecord | null;
  /** Or an already-built projection (the history path may prebuild it). */
  projection?: AgenticConversationProjection | null;
  language: Language;
}

const TERMINAL_BADGE: Record<string, { ar: string; en: string; icon: React.ReactNode }> = {
  finished: { ar: 'اكتملت', en: 'Completed', icon: <CircleCheck size={13} /> },
  cancelled: { ar: 'أُلغيت', en: 'Cancelled', icon: <CircleStop size={13} /> },
  budget_exhausted: { ar: 'استُنفدت الميزانية', en: 'Budget exhausted', icon: <AlertTriangle size={13} /> },
  error: { ar: 'فشلت', en: 'Failed', icon: <AlertTriangle size={13} /> },
};

export const AgenticConversation: React.FC<AgenticConversationProps> = ({ record, projection, language }) => {
  const isArabic = language === 'ar';
  // The card always renders through the engine's projection builder — the
  // same implementation the node tests pin — so what shows is exactly what
  // the transcript holds, in the order it happened.
  const normalized = useMemo(
    () => (projection !== undefined && projection !== null ? projection : buildConversationProjection(record ?? undefined)),
    [projection, record]
  );

  if (!normalized) {
    return (
      <section className="border border-line rounded-lg p-4" aria-live="polite">
        <header className="flex items-center gap-2 text-muted">
          <MessageSquare size={15} />
          <h3 className="text-sm font-medium">
            {isArabic ? 'المحادثة الأجنتية' : 'Agentic Conversation'}
          </h3>
        </header>
        <p className="mt-3 text-sm text-muted">
          {isArabic
            ? 'لا يوجد سجل محفوظ لهذه الجلسة — لم تُكتب المحادثة أو تعذّر حفظها.'
            : 'No persisted transcript for this session — the conversation was never written or could not be saved.'}
        </p>
      </section>
    );
  }

  return (
    <section className="border border-line rounded-lg p-4" aria-live="polite">
      <header className="flex items-center gap-2 text-muted">
        <MessageSquare size={15} />
        <h3 className="text-sm font-medium">
          {isArabic ? 'المحادثة الأجنتية' : 'Agentic Conversation'}
        </h3>
        <span className="text-xs text-muted">
          {isArabic
            ? normalized.turns.length === 1
              ? 'مجموعة دور واحدة'
              : `${normalized.turns.length} مجموعات أدوار`
            : `${normalized.turns.length} turn-group${normalized.turns.length === 1 ? '' : 's'}`}
        </span>
      </header>

      {normalized.turns.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          {isArabic ? 'محادثة فارغة — لا أدوار محفوظة.' : 'An empty conversation — no persisted turn-groups.'}
        </p>
      )}

      <ol className="mt-3 space-y-4">
        {normalized.turns.map((turn, turnIndex) => {
          const badge = TERMINAL_BADGE[turn.terminal] ?? TERMINAL_BADGE.error;
          return (
            <li key={turnIndex} className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                <Clock size={12} />
                <time dateTime={new Date(turn.capturedAt).toISOString()}>
                  {new Date(turn.capturedAt).toLocaleString(isArabic ? 'ar' : 'en')}
                </time>
                <span className="inline-flex items-center gap-1 text-muted">
                  {badge.icon}
                  {isArabic ? badge.ar : badge.en}
                </span>
              </div>

              <ul className="space-y-2">
                {turn.entries.map((entry, entryIndex) => {
                  if (entry.kind === 'user') {
                    return (
                      <li key={entryIndex} className="flex items-start gap-2">
                        <span className="mt-0.5 text-muted"><User size={14} /></span>
                        <p className="text-sm">{entry.text}</p>
                      </li>
                    );
                  }
                  if (entry.kind === 'tool_call') {
                    return (
                      <li key={entryIndex} className="flex items-start gap-2">
                        <span className="mt-0.5 text-muted"><Wrench size={13} /></span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted max-w-full">
                          <span className="font-medium shrink-0">{entry.toolName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{JSON.stringify(entry.args)}</span>
                        </span>
                      </li>
                    );
                  }
                  if (entry.kind === 'tool_result') {
                    return (
                      <li key={entryIndex} className="ps-6">
                        <p className="text-xs text-muted line-clamp-3">{entry.text}</p>
                      </li>
                    );
                  }
                  if (entry.kind === 'assistant') {
                    return (
                      <li key={entryIndex} className="ps-6 border-s border-line">
                        <p className="text-sm whitespace-pre-wrap">{entry.text}</p>
                      </li>
                    );
                  }
                  return null;
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
