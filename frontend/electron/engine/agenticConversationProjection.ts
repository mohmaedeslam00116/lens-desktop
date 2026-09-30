/**
 * Agentic transcript domain — the pure, isomorphic half (ticket #144;
 * SPEC-028 Decision 2). No node IO here: the renderer bundle imports this
 * module directly, so the card renders through the SAME projection the
 * engine's node tests pin. The persistence layer (node-only) lives in
 * `agenticTranscript.ts` and re-exports these.
 *
 * Seam laws this module owns:
 *  - Plain JSON only: messages survive JSON round-trip without loss or
 *    reinterpretation; function handles and runtime objects never enter
 *    a transcript.
 *  - Visible emptiness: an absent, failed, or corrupt record projects as
 *    null/empty — the UI degrades visibly and never fabricates.
 *  - Runtime isolation: the projection consumes only the persisted record;
 *    no live AgentSession reference ever crosses this boundary.
 */

/** One captured turn-group: the question, the messages as they happened, the terminal. */
export interface TranscriptTurnGroup {
  question: string;
  terminal: 'finished' | 'cancelled' | 'budget_exhausted' | 'error';
  capturedAt: number;
  messages: Array<Record<string, unknown>>;
}

/** The LENS-side transcript record for one ResearchSession. */
export interface TranscriptRecord {
  sessionId: string;
  version: 1;
  turnGroups: TranscriptTurnGroup[];
}

/**
 * Normalize one value into plain JSON: drop function handles and non-
 * serializable runtime objects, stringify BigInts, recurse arrays and
 * plain objects. Guarantees transcripts only ever hold round-trippable JSON.
 */
export function toPlainJson(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Class instances (runtime handles, streams, abort controllers) are not
      // transcript material — reduced to a stable descriptor, not fabricated.
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return { type: typeof value };
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'function') continue;
      out[key] = toPlainJson(item);
    }
    return out;
  }
  return undefined;
}

/**
 * Capture the turn-group transcript at terminal time and append it to the
 * store. The RUN calls this exactly once per terminal, inside its own
 * terminal path — persistence failure never breaks the terminal (the run's
 * explicit-terminal law outranks storage).
 */
export function captureTranscriptAtTerminal(
  store: { write: (sessionId: string, turn: Omit<TranscriptTurnGroup, 'capturedAt'>) => unknown } | undefined,
  sessionId: string,
  turn: Omit<TranscriptTurnGroup, 'capturedAt'>
): void {
  if (!store) return;
  try {
    store.write(sessionId, turn);
  } catch {
    // Never break the run for persistence: the terminal already landed.
  }
}

/** The projection the artifact inspector renders (no runtime state involved). */
export interface AgenticConversationProjection {
  sessionId: string;
  turns: Array<{
    question: string;
    terminal: TranscriptTurnGroup['terminal'];
    capturedAt: number;
    entries: Array<
      | { kind: 'user'; text: string }
      | { kind: 'assistant'; text: string }
      | { kind: 'tool_call'; toolName: string; args: Record<string, unknown> }
      | { kind: 'tool_result'; text: string }
      | { kind: 'other' }
    >;
  }>;
}

/** Extract readable text from one message's content (string or blocks). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && typeof (block as any).text === 'string' ? (block as any).text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

/**
 * Project a persisted transcript record for the Agentic Conversation card.
 * The projection renders ONLY what the transcript holds — entries appear in
 * the order they happened, with nothing interpolated. Failed or absent
 * persistence projects as null; an empty record projects as an empty
 * conversation (visible emptiness, not fabrication).
 */
export function buildConversationProjection(record: TranscriptRecord | undefined | null): AgenticConversationProjection | null {
  if (!record || !Array.isArray(record.turnGroups)) return null;
  return {
    sessionId: record.sessionId,
    turns: record.turnGroups.map((turn) => ({
      question: turn.question,
      terminal: turn.terminal,
      capturedAt: turn.capturedAt,
      entries: (turn.messages ?? []).flatMap((message: Record<string, unknown>): AgenticConversationProjection['turns'][number]['entries'] => {
        const role = String((message as any).role ?? '');
        const content = (message as any).content;
        if (role === 'user') return [{ kind: 'user' as const, text: textOf(content) }];
        if (role === 'toolResult' || role === 'tool_result') return [{ kind: 'tool_result' as const, text: textOf(content) }];
        if (role !== 'assistant') return [{ kind: 'other' as const }];
        if (Array.isArray(content)) {
          return content.map((block): AgenticConversationProjection['turns'][number]['entries'][number] => {
            if (block && typeof block === 'object' && block.type === 'toolCall') {
              return {
                kind: 'tool_call' as const,
                toolName: String(block.name ?? ''),
                args: toPlainJson((block as any).arguments ?? {}) as Record<string, unknown>,
              };
            }
            if (block && typeof block === 'object' && block.type === 'text') {
              return { kind: 'assistant' as const, text: String(block.text ?? '') };
            }
            return { kind: 'other' as const };
          });
        }
        return [{ kind: 'assistant' as const, text: textOf(content) }];
      }),
    })),
  };
}
