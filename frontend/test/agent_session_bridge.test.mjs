import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Ticket #141 — the event bridge maps Pi AgentSession `subscribe` events onto
 * the LiveEvent backbone, one class at a time (SPEC-028 decision 2; ADR-0014
 * decision 5). The Event Faithfulness law is mechanized here: every session
 * event class must reach the mapper, and a newly unmapped class fails the
 * suite instead of being silently dropped. Emitted payloads are JSON-safe —
 * they cross the engine's WebSocket.
 *
 * The suite imports `dist-electron/` (repo law: build:electron precedes
 * `npm test`), so the bridge is exercised as the compiled artifact the app
 * runs. The session itself is faked with the exact listener contract
 * `session.subscribe` provides — the bridge maps events; it owns no loop.
 */

const { __testSeams } = await import(
  pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', 'agentSessionBridge.js')).href
);
const { attachAgentSessionBridge, mapAgentSessionEvent } = __testSeams;

/** A fake AgentSession capturing the subscription, per the real contract. */
function fakeSession() {
  const listeners = new Set();
  return {
    session: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

/** The full Pi session event class list (pi-coding-agent 0.85.1). */
const ALL_SESSION_EVENT_CLASSES = [
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
];

describe('AgentSession → LiveEvent bridge — per-class mapping', () => {
  it('maps agent lifecycle: start → session_state running; end/settled → session_state completed', () => {
    const running = mapAgentSessionEvent({ type: 'agent_start' }, 'agentic');
    assert.equal(running.handled, true);
    assert.equal(running.event.type, 'session_state');
    assert.equal(running.event.state, 'running');

    const ended = mapAgentSessionEvent({ type: 'agent_end', messages: [] }, 'agentic');
    assert.equal(ended.event.type, 'session_state');
    assert.equal(ended.event.state, 'completed');

    const settled = mapAgentSessionEvent({ type: 'agent_settled' }, 'agentic');
    assert.equal(settled.event.type, 'session_state');
    assert.equal(settled.event.state, 'completed');
  });

  it('maps message deltas → report_chunk; message_end → report_chunk with the full text', () => {
    const streaming = mapAgentSessionEvent(
      {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      },
      'agentic'
    );
    assert.equal(streaming.event.type, 'report_chunk');
    assert.equal(streaming.event.chunk, 'Hello');

    const ended = mapAgentSessionEvent(
      {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      },
      'agentic'
    );
    assert.equal(ended.event.type, 'report_chunk');
    assert.equal(ended.event.chunk, 'Hello world');
    assert.equal(ended.event.report, 'Hello world');
  });

  it('maps tool executions → status with real names, args, and isError', () => {
    const start = mapAgentSessionEvent(
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'web_search', args: { query: 'lens' } },
      'agentic'
    );
    assert.equal(start.event.type, 'status');
    assert.equal(start.event.step, 'tool:web_search');
    assert.match(start.event.message, /web_search/);

    const endOk = mapAgentSessionEvent(
      { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'web_search', result: { hits: 3 }, isError: false },
      'agentic'
    );
    assert.equal(endOk.event.type, 'status');
    assert.match(endOk.event.message, /web_search/);
    assert.ok(!/error/i.test(endOk.event.message));

    const endErr = mapAgentSessionEvent(
      { type: 'tool_execution_end', toolCallId: 'c2', toolName: 'fetch_content', result: 'boom', isError: true },
      'agentic'
    );
    assert.equal(endErr.event.type, 'status');
    assert.match(endErr.event.message, /error/i);
    assert.match(endErr.event.message, /fetch_content/);
  });

  it('maps queue_update, compaction, and retries to visible states — never silent', () => {
    const queued = mapAgentSessionEvent(
      { type: 'queue_update', steering: ['focus 2025'], followUp: ['and summarize'] },
      'agentic'
    );
    assert.equal(queued.event.type, 'status');
    assert.match(queued.event.message, /steer/i);
    assert.match(queued.event.message, /focus 2025/);
    assert.match(queued.event.message, /summarize/);

    const compaction = mapAgentSessionEvent({ type: 'compaction_start', reason: 'threshold' }, 'agentic');
    assert.equal(compaction.event.type, 'status');
    assert.match(compaction.event.message, /compaction/i);

    const retry = mapAgentSessionEvent(
      { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, error: new Error('429 rate limited') },
      'agentic'
    );
    assert.equal(retry.event.type, 'status');
    assert.match(retry.event.message, /retry/i);
    assert.match(retry.event.message, /429/);

    const retryEnd = mapAgentSessionEvent(
      { type: 'auto_retry_end', attempt: 1, willRetry: false },
      'agentic'
    );
    assert.equal(retryEnd.event.type, 'status');
  });

  it('maps the runtime retry shapes: errorMessage/finalError/success survive to the status line', () => {
    // pi-coding-agent 0.85.1 emits `errorMessage` (not `error`) on
    // auto_retry_start, and `{ success, finalError }` (not `willRetry`) on
    // auto_retry_end. Reading the wrong fields renders a bare "null" where
    // the provider cause belongs — the exact symptom of a run that retries
    // three times with no actionable message.
    const retry = mapAgentSessionEvent(
      { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: '401 Unauthorized' },
      'agentic'
    );
    assert.equal(retry.event.type, 'status');
    assert.match(retry.event.message, /401 Unauthorized/);
    assert.doesNotMatch(retry.event.message, /null/);

    const failed = mapAgentSessionEvent(
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: '401 Unauthorized' },
      'agentic'
    );
    assert.equal(failed.event.type, 'status');
    assert.match(failed.event.message, /401 Unauthorized/);
    assert.doesNotMatch(failed.event.message, /null/);

    const scheduled = mapAgentSessionEvent(
      { type: 'summarization_retry_scheduled', attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: 'stream dropped' },
      'agentic'
    );
    assert.match(scheduled.event.message, /stream dropped/);

    // The summarization attempt events carry a `source` label, not an
    // attempt number — either way the line must never read "null".
    const attemptStart = mapAgentSessionEvent(
      { type: 'summarization_retry_attempt_start', source: 'branchSummary' },
      'agentic'
    );
    assert.doesNotMatch(attemptStart.event.message, /null/);
    const attemptEnd = mapAgentSessionEvent(
      { type: 'summarization_retry_attempt_end', source: 'branchSummary' },
      'agentic'
    );
    assert.doesNotMatch(attemptEnd.event.message, /null/);
  });

  it('JSON-safe: emitted payloads survive JSON round-trip without loss or throw', () => {
    const sampleEvents = [
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'web_search', args: { query: 'x' } },
      { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'web_search', result: { ok: 1n }, isError: false },
      { type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, assistantMessageEvent: { type: 'text_delta', delta: 'hi' } },
      { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }], willRetry: false },
      { type: 'auto_retry_start', attempt: 2, maxAttempts: 3, error: new Error('boom') },
    ];
    for (const event of sampleEvents) {
      const mapped = mapAgentSessionEvent(event, 'agentic');
      if (!mapped.event) continue;
      const roundTrip = JSON.parse(JSON.stringify(mapped.event));
      assert.deepEqual(roundTrip, mapped.event);
    }
  });

  it('THE FAITHFULNESS LAW: every session event class is handled — an unrecognized class is a failure', () => {
    // Every class must be *handled* (recognized, with a deliberate emission
    // or a deliberate no-op). Only a class the bridge does not recognize at
    // all returns handled:false — and that fails the suite.
    const unhandled = ALL_SESSION_EVENT_CLASSES.filter(
      (type) => mapAgentSessionEvent({ type }, 'agentic').handled === false
    );
    assert.deepEqual(
      unhandled,
      [],
      `session event classes the bridge does not recognize: ${unhandled.join(', ')}`
    );
  });
});

describe('attachAgentSessionBridge — wiring onto a live session', () => {
  it('subscribes once, tags every emission with type + sessionId, and returns its own detach', async () => {
    const fake = fakeSession();
    const emitted = [];
    const detach = attachAgentSessionBridge(fake.session, {
      sessionId: 's-141',
      emit: (event) => emitted.push(event),
    });
    assert.equal(typeof detach, 'function');
    assert.equal(fake.listenerCount(), 1);

    fake.emit({ type: 'agent_start' });
    fake.emit({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'web_search', args: {} });
    assert.equal(emitted.length, 2);
    for (const event of emitted) {
      assert.equal(event.sessionId, 's-141');
      assert.equal(typeof event.type, 'string');
    }

    detach();
    assert.equal(fake.listenerCount(), 0);
  });

  it('counts emissions per class for coverage checks', async () => {
    const fake = fakeSession();
    const detach = attachAgentSessionBridge(fake.session, { sessionId: 's-141', emit: () => {} });
    fake.emit({ type: 'agent_start' });
    fake.emit({ type: 'agent_settled' });
    detach();
  });

  it('terminal truthfulness: agent_end(willRetry=false) after a run surfaces an explicit completed state', () => {
    const ended = mapAgentSessionEvent(
      { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'final' }] }], willRetry: false },
      'agentic'
    );
    assert.equal(ended.event.type, 'session_state');
    assert.equal(ended.event.state, 'completed');
  });
});
