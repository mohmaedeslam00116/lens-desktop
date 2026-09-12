import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapPiEventToLiveEvents,
  wirePiEvents,
} from '../dist-electron/engine/piEventAdapter.js';

function ctx(overrides = {}) {
  const emitted = [];
  return {
    ctx: { query: 'Systematic review of fusion energy', sessionId: 's-1', emit: (e) => emitted.push(e), ...overrides },
    emitted,
  };
}

describe('Pi event adapter: pi agent events to LiveEvent (ticket 03)', () => {
  it('agent_start emits an active root graph node labeled with the query', () => {
    const { ctx: c, emitted } = ctx({ rootNodeId: 'root_1' });
    const events = mapPiEventToLiveEvents({ type: 'agent_start' }, c);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'graph_node');
    assert.equal(events[0].node.id, 'root_1');
    assert.equal(events[0].node.label, 'Systematic review of fusion energy');
    assert.equal(events[0].node.type, 'root');
    assert.equal(events[0].node.status, 'active');
    assert.equal(events[0].sessionId, 's-1');
    assert.equal(emitted.length, 0); // pure mapper: no side effects
  });

  it('message_update text_delta becomes a thought with the delta text', () => {
    const { ctx: c } = ctx();
    const events = mapPiEventToLiveEvents(
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Analyzing sources…' } },
      c
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'thought');
    assert.equal(events[0].thought, 'Analyzing sources…');
  });

  it('message_update thinking_delta also becomes a thought', () => {
    const { ctx: c } = ctx();
    const events = mapPiEventToLiveEvents(
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'plan next hop' } },
      c
    );
    assert.equal(events[0].type, 'thought');
    assert.equal(events[0].thought, 'plan next hop');
  });

  it('tool_execution_start for activate_skill emits skill_activated (dynamic tool)', () => {
    const { ctx: c } = ctx();
    const events = mapPiEventToLiveEvents(
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'activate_skill', args: { name: 'market-research' } },
      c
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'skill_activated');
    assert.equal(events[0].skillName, 'market-research');
    assert.equal(events[0].activationMethod, 'dynamic_tool');
  });

  it('tool_execution_start for other tools emits a tool thought marker', () => {
    const { ctx: c } = ctx();
    const events = mapPiEventToLiveEvents(
      { type: 'tool_execution_start', toolCallId: 't2', toolName: 'search', args: { q: 'x' } },
      c
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'thought');
    assert.equal(events[0].thought, '[tool] search');
  });

  it('structural events (turn_start/message_start/message_end/tool_execution_end/turn_end) emit nothing', () => {
    const { ctx: c } = ctx();
    for (const type of ['turn_start', 'message_start', 'message_end', 'tool_execution_end', 'turn_end']) {
      const events = mapPiEventToLiveEvents({ type }, c);
      assert.deepEqual(events, [], `${type} should map to zero events`);
    }
  });

  it('agent_end emits a completed session state', () => {
    const { ctx: c } = ctx();
    const events = mapPiEventToLiveEvents({ type: 'agent_end', messages: [] }, c);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'session_state');
    assert.equal(events[0].state, 'completed');
  });

  it('unknown pi events are silently ignored (forward compatibility)', () => {
    const { ctx: c } = ctx();
    assert.deepEqual(mapPiEventToLiveEvents({ type: 'future_event' }, c), []);
  });

  it('wirePiEvents subscribes and forwards mapped events to the emitter', async () => {
    const { ctx: c, emitted } = ctx();
    const listeners = [];
    const fakeAgent = { subscribe: (l) => listeners.push(l) };
    wirePiEvents(fakeAgent, c);
    assert.equal(listeners.length, 1);
    await listeners[0]({ type: 'agent_start' });
    await listeners[0]({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } });
    await listeners[0]({ type: 'agent_end' });
    assert.equal(emitted.length, 3);
    assert.equal(emitted[0].type, 'graph_node');
    assert.equal(emitted[1].type, 'thought');
    assert.equal(emitted[2].type, 'session_state');
  });
});