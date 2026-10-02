/**
 * The event bridge: Pi AgentSession `subscribe` events onto the LiveEvent
 * backbone (ticket #141; SPEC-028 decision 2; ADR-0014 decision 5).
 *
 * The mapping is total and mechanized. `KNOWN_SESSION_EVENT_TYPES` enumerates
 * every event class the runtime emits (pi-coding-agent 0.85.1), and the
 * mapper returns `{ handled }` for each: `handled: false` means the class is
 * unrecognized — the bridge test fails on it, so a runtime upgrade that adds
 * a class cannot silently fall through. `handled: true` with no `event` means
 * the class is deliberately resolved without a backbone emission (e.g. a
 * non-assistant message delta, or per-entry transcript bookkeeping owned by
 * the persistence seam, ticket #144) — a decision, never an accident. This is
 * the Event Faithfulness law (#119) carried onto the new runtime: silent
 * dropping is a defect, not a simplification.
 *
 * Every emitted payload is JSON-safe: LiveEvents cross the engine's
 * WebSocket, so BigInts, Errors, and other non-JSON values are stringified
 * rather than thrown away or thrown with. Nothing here mutates runtime state;
 * the session's own state stays Pi-side except through explicit seams.
 */

import type { LiveEvent } from './types';

/** The result of mapping one session event class. */
export interface SessionEventMapping {
  /** False only for a class the bridge does not recognize at all. */
  handled: boolean;
  /** The LiveEvent to emit, when the class resolves to one. */
  event?: LiveEvent;
}

/**
 * Every AgentSession event class the runtime emits. Adding a class upstream
 * without extending `mapAgentSessionEvent` fails the bridge test — the
 * never-silent law, mechanized.
 */
export const KNOWN_SESSION_EVENT_TYPES = [
  'agent_start',
  'agent_end',
  'agent_settled',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'queue_update',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'summarization_retry_scheduled',
  'summarization_retry_attempt_start',
  'summarization_retry_attempt_end',
  'summarization_retry_finished',
  'entry_appended',
  'session_info_changed',
] as const;

export type KnownSessionEventType = (typeof KNOWN_SESSION_EVENT_TYPES)[number];

/** Assistant text extracted from a pi message's content blocks. */
function textOf(message: any): string {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('');
  }
  return '';
}

/** Human-readable, bounded rendering of a tool result for the status line. */
function describeToolResult(result: any): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result.length > 160 ? `${result.slice(0, 160)}…` : result;
  try {
    const json = JSON.stringify(result, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
    return json.length > 160 ? `${json.slice(0, 160)}…` : json;
  } catch {
    return '[unserializable result]';
  }
}

/** JSON-safe scalar rendering of any value (Errors, BigInts, objects…). */
function jsonSafe(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'object' && value !== null && 'message' in (value as Record<string, unknown>)) {
      const message = (value as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
    return JSON.stringify(value ?? null, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)) ?? 'null';
  } catch {
    return '[unserializable]';
  }
}

/** No-op resolution: the class is recognized and deliberately emits nothing. */
const resolved = { handled: true } as const;

/**
 * Map one Pi session event onto the backbone. Recognized classes return
 * `handled: true` (with or without an event); only an unrecognized class
 * returns `handled: false` — and the test fails on exactly that.
 */
export function mapAgentSessionEvent(event: any, sessionId: string): SessionEventMapping {
  switch (event?.type) {
    // --- Agent lifecycle → session_state ---------------------------------
    case 'agent_start':
      return {
        handled: true,
        event: { type: 'session_state', sessionId, state: 'running', step: 'agent' },
      };

    case 'agent_end': {
      const willRetry: boolean = event.willRetry === true;
      return {
        handled: true,
        event: {
          type: 'session_state',
          sessionId,
          state: 'completed',
          step: 'agent_end',
          message: willRetry ? 'Agent ended; retry scheduled.' : 'Agent run complete.',
        },
      };
    }

    case 'agent_settled':
      return {
        handled: true,
        event: { type: 'session_state', sessionId, state: 'completed', step: 'agent_settled' },
      };

    // --- Turns → status markers ------------------------------------------
    case 'turn_start':
      return {
        handled: true,
        event: { type: 'status', sessionId, step: 'turn_start', message: 'Agent turn started.' },
      };

    case 'turn_end':
      return {
        handled: true,
        event: { type: 'status', sessionId, step: 'turn_end', message: 'Agent turn finished.' },
      };

    // --- Message lifecycle → report_chunk (the streamed answer) ----------
    case 'message_start': {
      if (event.message?.role !== 'assistant') return resolved;
      return {
        handled: true,
        event: { type: 'report_chunk', sessionId, chunk: '', step: 'message_start' },
      };
    }

    case 'message_update': {
      const deltaEvent = event.assistantMessageEvent;
      if (deltaEvent?.type === 'text_delta' && typeof deltaEvent.delta === 'string') {
        return {
          handled: true,
          event: { type: 'report_chunk', sessionId, chunk: deltaEvent.delta, step: 'streaming' },
        };
      }
      if (deltaEvent?.type === 'thinking_delta' && typeof deltaEvent.delta === 'string') {
        return {
          handled: true,
          event: { type: 'thought', sessionId, thought: deltaEvent.delta },
        };
      }
      // Non-text deltas (tool-call argument streaming) carry no user text.
      return resolved;
    }

    case 'message_end': {
      if (event.message?.role !== 'assistant') return resolved;
      const text = textOf(event.message);
      if (!text) return resolved;
      return {
        handled: true,
        event: { type: 'report_chunk', sessionId, chunk: text, report: text, step: 'message_end' },
      };
    }

    // --- Tool executions → status with real names/results -----------------
    case 'tool_execution_start':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: `tool:${jsonSafe(event.toolName)}`,
          message: `Tool ${jsonSafe(event.toolName)} started (${jsonSafe(event.args ?? {})}).`,
        },
      };

    case 'tool_execution_update':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: `tool:${jsonSafe(event.toolName)}`,
          message: `Tool ${jsonSafe(event.toolName)} running…`,
        },
      };

    case 'tool_execution_end': {
      const name = jsonSafe(event.toolName);
      const detail = describeToolResult(event.result);
      const isError = event.isError === true;
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: `tool:${name}`,
          message: isError
            ? `Tool ${name} error${detail ? `: ${detail}` : '.'}`
            : `Tool ${name} finished${detail ? ` — ${detail}` : '.'}`,
        },
      };
    }

    // --- Queues, compaction, retries → visible states ----------------------
    case 'queue_update': {
      const steering: string[] = Array.isArray(event.steering) ? [...event.steering] : [];
      const followUp: string[] = Array.isArray(event.followUp) ? [...event.followUp] : [];
      const parts: string[] = [];
      if (steering.length) parts.push(`Steering queued: ${steering.join(' | ')}`);
      if (followUp.length) parts.push(`Follow-up queued: ${followUp.join(' | ')}`);
      if (!parts.length) parts.push('Queue empty.');
      return {
        handled: true,
        event: { type: 'status', sessionId, step: 'queue', message: parts.join(' — ') },
      };
    }

    case 'compaction_start':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'compaction',
          message: `Compaction started (${jsonSafe(event.reason)}).`,
        },
      };

    case 'compaction_end':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'compaction',
          message: `Compaction finished (${jsonSafe(event.reason)}).`,
        },
      };

    case 'auto_retry_start': {
      // pi-coding-agent 0.85.1 names the cause `errorMessage` (older shapes
      // carried `error`): read both, so neither a runtime upgrade nor a
      // downgrade renders a bare "null" where the provider cause belongs.
      const cause = event.errorMessage ?? event.error;
      const causeText = cause === undefined || cause === null ? 'unknown error' : jsonSafe(cause);
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'retry',
          message: `Provider error — retrying (attempt ${jsonSafe(event.attempt)}/${
            event.maxAttempts === undefined ? '?' : jsonSafe(event.maxAttempts)
          }): ${causeText}`,
        },
      };
    }

    case 'auto_retry_end': {
      // The runtime reports the outcome as `{ success, finalError }` (older
      // shapes carried `willRetry`): a failed retry loop must surface the
      // final provider error, never a bare "finished".
      if (event.success === false) {
        const final = event.finalError ?? event.error ?? event.errorMessage;
        const finalText = final === undefined || final === null ? 'unknown error' : jsonSafe(final);
        return {
          handled: true,
          event: {
            type: 'status',
            sessionId,
            step: 'retry',
            message: `Retry failed: ${finalText}`,
          },
        };
      }
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'retry',
          message: event.willRetry === true ? 'Retry scheduled.' : 'Retry loop finished.',
        },
      };
    }

    case 'summarization_retry_scheduled': {
      const cause = event.errorMessage ?? event.error;
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'retry',
          message:
            cause === undefined || cause === null
              ? 'Summarization retry scheduled.'
              : `Summarization retry scheduled: ${jsonSafe(cause)}.`,
        },
      };
    }

    case 'summarization_retry_attempt_start':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'retry',
          // The attempt events carry a `source` label, not an attempt number
          // — either way the line names what it can, never "null".
          message: `Summarization retry attempt ${jsonSafe(event.attempt ?? event.source ?? '?')} started.`,
        },
      };

    case 'summarization_retry_attempt_end':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'retry',
          message: `Summarization retry attempt ${jsonSafe(event.attempt ?? event.source ?? '?')} finished.`,
        },
      };

    case 'summarization_retry_finished':
      return {
        handled: true,
        event: { type: 'status', sessionId, step: 'retry', message: 'Summarization retries finished.' },
      };

    // --- Bookkeeping classes: recognized, deliberately no backbone emission
    case 'entry_appended':
      // Per-entry transcript growth; the persistence seam (#144) owns it.
      return resolved;

    case 'session_info_changed':
      return {
        handled: true,
        event: {
          type: 'status',
          sessionId,
          step: 'session_info',
          message: event.name ? `Session named “${jsonSafe(event.name)}”.` : 'Session name cleared.',
        },
      };

    default:
      return { handled: false };
  }
}

/**
 * Subscribe the bridge to a live session. Every handled mapping with an
 * event is emitted onto the backbone tagged with the owning `sessionId`;
 * the returned function detaches (the subscription's own unsubscribe).
 */
export function attachAgentSessionBridge(
  session: { subscribe(listener: (event: any) => void): () => void },
  options: { sessionId: string; emit: (event: LiveEvent) => void }
): () => void {
  const { sessionId, emit } = options;
  return session.subscribe((event: any) => {
    const mapping = mapAgentSessionEvent(event, sessionId);
    if (mapping.handled && mapping.event) emit(mapping.event);
  });
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = { attachAgentSessionBridge, mapAgentSessionEvent, KNOWN_SESSION_EVENT_TYPES };
