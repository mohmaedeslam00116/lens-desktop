import { LiveEvent } from './types';

/**
 * Maps pi-agent-core agent events onto the engine's LiveEvent contract
 * (ADR-0009, spec #66, ticket #03). Pure mapping: no transport, no state.
 *
 * Explicit mapping table (every pi event type has a row — some intentionally
 * emit nothing because the owning loop produces richer LENS-native events):
 *
 *  | pi event              | LiveEvent                                  |
 *  |-----------------------|--------------------------------------------|
 *  | agent_start           | graph_node { root, active }                |
 *  | turn_start            | (none — structural)                        |
 *  | message_start         | (none — root already represents the query) |
 *  | message_update        | thought (text/thinking deltas)             |
 *  | message_end           | (none — loop owns synthesis events)        |
 *  | tool_execution_start  | thought (tool marker) or skill_activated   |
 *  | tool_execution_end    | (none — loop owns results/grounding)       |
 *  | turn_end              | (none — loop owns report chunks)           |
 *  | agent_end             | session_state { completed }                |
 *  | (unknown)             | (none — forward-compatible silence)        |
 */

export interface PiAgentEventLike {
  type: string;
  message?: any;
  assistantMessageEvent?: { type?: string; delta?: string; partial?: any };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PiEventBridgeContext {
  sessionId?: string;
  query: string;
  emit: (event: LiveEvent) => void;
  rootNodeId?: string;
  nextNodeId?: () => string;
}

let internalCounter = 0;
function defaultNextNodeId(): string {
  internalCounter++;
  return `pi_${internalCounter}`;
}

function baseEvent(ctx: PiEventBridgeContext, type: LiveEvent['type']): LiveEvent {
  const event: LiveEvent = { type };
  if (ctx.sessionId) event.sessionId = ctx.sessionId;
  return event;
}

/** Pure mapper: one pi agent event → zero or more LiveEvents. */
export function mapPiEventToLiveEvents(
  event: PiAgentEventLike,
  ctx: PiEventBridgeContext
): LiveEvent[] {
  const events: LiveEvent[] = [];
  const push = (e: LiveEvent) => events.push(e);
  const nextNodeId = ctx.nextNodeId || defaultNextNodeId;

  switch (event?.type) {
    case 'agent_start': {
      const node = baseEvent(ctx, 'graph_node') as LiveEvent & { node?: any };
      node.node = {
        id: ctx.rootNodeId || nextNodeId(),
        label: ctx.query,
        type: 'root',
        status: 'active',
      };
      push(node);
      break;
    }
    case 'turn_start':
    case 'message_start':
    case 'message_end':
    case 'tool_execution_end':
    case 'turn_end':
      // Explicit no-emit rows: the owning loop produces the richer LENS-native
      // events (report_chunk, source, reflection, budget telemetry) itself.
      break;
    case 'message_update': {
      const inner = event.assistantMessageEvent || {};
      if (inner.type === 'text_delta' && typeof inner.delta === 'string') {
        const thought = baseEvent(ctx, 'thought') as LiveEvent & { thought?: string };
        thought.thought = inner.delta;
        push(thought);
      } else if (inner.type === 'thinking_delta' && typeof inner.delta === 'string') {
        const thought = baseEvent(ctx, 'thought') as LiveEvent & { thought?: string };
        thought.thought = inner.delta;
        push(thought);
      } else if (inner.type === 'toolcall_end' && inner.partial) {
        // A completed tool call in the assistant message: surface it as a thought marker.
        const blocks = inner.partial.content || [];
        for (const block of blocks) {
          if (block?.type === 'toolCall' && block.name) {
            const thought = baseEvent(ctx, 'thought') as LiveEvent & { thought?: string };
            thought.thought = `[tool] ${block.name}`;
            push(thought);
          }
        }
      }
      break;
    }
    case 'tool_execution_start': {
      const toolName = event.toolName || '';
      if (toolName === 'activate_skill') {
        const args = (event.args || {}) as Record<string, unknown>;
        const skill = baseEvent(ctx, 'skill_activated') as LiveEvent & { skillName?: string; activationMethod?: string };
        skill.skillName = typeof args.name === 'string' ? args.name : String(args.name ?? 'unknown');
        skill.activationMethod = 'dynamic_tool';
        push(skill);
      } else if (toolName) {
        const thought = baseEvent(ctx, 'thought') as LiveEvent & { thought?: string };
        thought.thought = `[tool] ${toolName}`;
        push(thought);
      }
      break;
    }
    case 'agent_end': {
      const state = baseEvent(ctx, 'session_state') as LiveEvent & { state?: string };
      state.state = 'completed';
      push(state);
      break;
    }
    default:
      // Unknown pi events are silently ignored (forward compatibility).
      break;
  }
  return events;
}

/**
 * Subscribes to a pi Agent (pi-agent-core) and forwards mapped LiveEvents to
 * the provided emitter. Returns an unsubscribe function.
 */
export function wirePiEvents(
  piAgent: { subscribe?: (listener: (event: PiAgentEventLike) => Promise<void> | void) => void },
  ctx: PiEventBridgeContext
): () => void {
  if (typeof piAgent?.subscribe !== 'function') return () => {};
  const listener = (event: PiAgentEventLike) => {
    for (const live of mapPiEventToLiveEvents(event, ctx)) {
      ctx.emit(live);
    }
  };
  piAgent.subscribe(listener);
  return () => {};
}