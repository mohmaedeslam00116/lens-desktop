/**
 * agentRunFeed.mjs — the agentic run feed reducer (ticket #145; SPEC-028).
 *
 * Reduces the engine's LiveEvent stream for ONE agentic run into the state
 * the workspace renders: the tool-chip trail, the sources admitted live, the
 * steering queue (visible from the moment it is queued until the engine
 * applies it), the auto-retry trail, and the explicit terminal with the
 * evidence admitted so far. Pure and transport-agnostic — the engine is the
 * sole source of truth; nothing here invents, drops, or retries on its own.
 */

/** One tool chip: a real tool call from the live feed, with its real output. */
export class AgentToolChip {
  constructor(toolName, args) {
    this.toolName = toolName;
    this.args = args;
    this.resultText = null;
    this.status = 'running';
  }
}

/** Steering is QUEUED first (visible), then applied by the engine. */
export class AgentSteerEntry {
  constructor(message) {
    this.message = message;
    this.queuedAt = Date.now();
    // The visibility contract: the queue state SAYS queued, not applied —
    // the engine has not taken the message yet.
    this.label = `queued: ${message}`;
  }
}

/** An auto-retry the engine performed, shown as a visible state. */
export class AgentRetryEntry {
  constructor(attempt, reason) {
    this.attempt = attempt;
    this.reason = reason;
    this.label = `attempt ${attempt}${reason ? ` — ${reason}` : ''}`;
  }
}

export function initialAgentRunState(sessionId) {
  return {
    sessionId,
    phase: 'idle',
    toolChips: [],
    sources: [],
    steerQueue: [],
    steerNotice: null,
    retries: [],
    reportText: '',
    lastEvent: null,
  };
}

const TERMINALS = new Set(['finished', 'cancelled', 'budget_exhausted', 'error']);

function isTerminal(phase) {
  return TERMINALS.has(phase);
}

function sameSession(state, sessionId) {
  return state.sessionId === sessionId;
}

/**
 * Reduce one LiveEvent-shaped action into the run state. Events from other
 * sessions are ignored (returned unchanged). A terminal is final: later
 * non-terminal events for the same session cannot resurrect the run.
 */
export function reduceAgentRun(state, action) {
  const event = action ?? {};
  const base = state ?? initialAgentRunState(String(event.sessionId ?? ''));
  const sessionId = event.sessionId;
  if (!sameSession(base, sessionId)) return base;

  if (isTerminal(base.phase)) {
    // The Event Faithfulness law: a run is never seen un-stopping.
    return base;
  }

  switch (event.type) {
    case 'started':
      return { ...base, phase: 'running', lastEvent: event.type };

    case 'status': {
      if (base.phase === 'idle') return base;
      // Auto-retry surfaces (the #141 bridge maps these to visible states).
      const message = String(event.message ?? '');
      const retryMatch = message.match(/attempt\s+(\d+)/i) ?? message.match(/محاولة\s+(\d+)/i);
      if (retryMatch && /retry|auto|إعادة/i.test(message)) {
        const entry = new AgentRetryEntry(Number(retryMatch[1]), message.replace(/attempt\s+\d+\s*—?\s*/i, '').trim());
        return { ...base, phase: 'retrying', retries: [...base.retries, entry], lastEvent: event.type };
      }
      const toolMatch = message.match(/^Tool\s+([a-zA-Z0-9_]+)\s+started\s+(\{.*\})\s*\.?$/);
      if (toolMatch) {
        let args = {};
        try {
          args = JSON.parse(toolMatch[2].replace(/'/g, '"'));
        } catch {
          args = {};
        }
        const chip = new AgentToolChip(toolMatch[1], args);
        return { ...base, phase: 'running', toolChips: [...base.toolChips, chip], lastEvent: event.type };
      }
      const toolEndMatch = message.match(/^Tool\s+([a-zA-Z0-9_]+)\s+finished\s+—\s+(\{.*)$/);
      if (toolEndMatch) {
        const chips = [...base.toolChips];
        for (let i = chips.length - 1; i >= 0; i -= 1) {
          if (chips[i].toolName === toolEndMatch[1] && chips[i].status === 'running') {
            let payload = {};
            try {
              payload = JSON.parse(toolEndMatch[2]);
            } catch {
              payload = { output: toolEndMatch[2] };
            }
            const failed = payload.isError === true || /error/i.test(String(payload.output ?? '').slice(0, 40));
            const next = { ...chips[i] };
            next.status = failed ? 'failed' : 'done';
            next.resultText = failed ? String(payload.output ?? '') : String(payload.output ?? '').slice(0, 300);
            chips[i] = next;
            break;
          }
        }
        return { ...base, phase: 'running', toolChips: chips, lastEvent: event.type };
      }
      // Steering applied by the engine surfaces as a visible status line.
      if (/steer|توجيه/i.test(message) && base.steerQueue.length > 0) {
        const queue = base.steerQueue.slice(1);
        return { ...base, steerQueue: queue, steerNotice: queue[0] ?? null, lastEvent: event.type };
      }
      return { ...base, phase: 'running', lastEvent: event.type };
    }

    case 'source': {
      if (base.phase === 'idle') return base;
      const url = event.url ?? event.source?.url;
      if (!url) return base;
      if (base.sources.some((s) => s.url === url)) return base;
      const source = {
        url,
        title: event.title ?? event.source?.title ?? url,
        domain: event.domain ?? event.source?.domain,
        snippet: event.snippet ?? event.source?.snippet ?? '',
      };
      return { ...base, sources: [...base.sources, source], lastEvent: event.type };
    }

    case 'report_chunk': {
      if (base.phase === 'idle') return base;
      return { ...base, reportText: base.reportText + String(event.chunk ?? event.text ?? ''), lastEvent: event.type };
    }

    case 'retry': {
      // An auto-retry the engine performed — a visible state, named with its
      // attempt and reason, never silent.
      const entry = new AgentRetryEntry(
        Number(event.attempt ?? base.retries.length + 1),
        String(event.reason ?? '')
      );
      return { ...base, phase: 'retrying', retries: [...base.retries, entry], lastEvent: event.type };
    }

    case 'tool_call': {
      // Structured tool-call action (the App path): a real call from the
      // live feed, never an invented one.
      if (base.phase === 'idle') return base;
      const chip = new AgentToolChip(String(event.toolName ?? ''), event.args ?? {});
      return { ...base, phase: 'running', toolChips: [...base.toolChips, chip], lastEvent: event.type };
    }

    case 'tool_result': {
      if (base.phase === 'idle') return base;
      const toolName = String(event.toolName ?? '');
      const chips = [...base.toolChips];
      for (let i = chips.length - 1; i >= 0; i -= 1) {
        if (chips[i].toolName === toolName && chips[i].status === 'running') {
          const next = { ...chips[i] };
          const failed = event.isError === true;
          next.status = failed ? 'failed' : 'done';
          next.resultText = String(event.output ?? '').slice(0, 300);
          chips[i] = next;
          break;
        }
      }
      return { ...base, phase: 'running', toolChips: chips, lastEvent: event.type };
    }

    case 'steer_queued': {
      const entry = new AgentSteerEntry(String(event.message ?? ''));
      const queue = [...base.steerQueue, entry];
      return { ...base, steerQueue: queue, steerNotice: queue[0] ?? null, lastEvent: event.type };
    }

    case 'steer_applied': {
      const queue = base.steerQueue.slice(1);
      return { ...base, steerQueue: queue, steerNotice: queue[0] ?? null, lastEvent: event.type };
    }

    case 'session_state': {
      // The bridge maps the agent lifecycle onto session_state; retry-style
      // payloads inside it are visible states too.
      const stateName = String(event.state ?? '');
      if (/retry/i.test(stateName)) {
        const entry = new AgentRetryEntry(base.retries.length + 1, stateName);
        return { ...base, phase: 'retrying', retries: [...base.retries, entry], lastEvent: event.type };
      }
      if (base.phase === 'idle' && /running/i.test(stateName)) {
        return { ...base, phase: 'running', lastEvent: event.type };
      }
      return { ...base, lastEvent: event.type };
    }

    case 'finished':
    case 'cancelled':
    case 'budget_exhausted':
    case 'error': {
      // Cancel keeps the evidence admitted so far — explicit terminal, never
      // silence, never a reset.
      return { ...base, phase: event.type, lastEvent: event.type };
    }

    default:
      return { ...base, lastEvent: event.type };
  }
}
