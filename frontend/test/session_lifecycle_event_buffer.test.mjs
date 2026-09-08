import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { EventRingBuffer } from '../dist-electron/engine/eventBuffer.js';
import {
  SessionLifecycleManager,
  ResearchSession
} from '../dist-electron/engine/sessionLifecycle.js';

describe('EventRingBuffer - Monotonic Delta Replay Buffer', () => {
  it('assigns strictly monotonic 1-based sequential event IDs', () => {
    const buffer = new EventRingBuffer(10);
    assert.equal(buffer.size(), 0);
    assert.equal(buffer.capacity(), 10);
    assert.equal(buffer.isFull(), false);
    assert.equal(buffer.getLatestEventId(), 0);
    assert.equal(buffer.getOldestEventId(), 0);
    assert.deepEqual(buffer.getEventsSince(0), []);

    const ev1 = buffer.push({ type: 'status', message: 'Initializing' });
    const ev2 = buffer.append({ type: 'thought', thought: 'Analyzing inquiry' });
    const ev3 = buffer.push({ type: 'subqueries', subqueries: ['q1', 'q2'] });

    assert.equal(ev1.eventId, 1);
    assert.equal(ev2.eventId, 2);
    assert.equal(ev3.eventId, 3);
    assert.equal(buffer.size(), 3);
    assert.equal(buffer.getLatestEventId(), 3);
    assert.equal(buffer.getOldestEventId(), 1);
  });

  it('enforces capacity bounds and evicts oldest events in FIFO order', () => {
    const capacity = 5;
    const buffer = new EventRingBuffer(capacity);

    for (let i = 1; i <= 8; i++) {
      buffer.push({ type: 'status', message: `Event ${i}` });
    }

    assert.equal(buffer.size(), capacity);
    assert.equal(buffer.isFull(), true);
    assert.equal(buffer.getLatestEventId(), 8);
    assert.equal(buffer.getOldestEventId(), 4);

    const allEvents = buffer.getAll();
    assert.equal(allEvents.length, 5);
    assert.equal(allEvents[0].eventId, 4);
    assert.equal(allEvents[0].message, 'Event 4');
    assert.equal(allEvents[4].eventId, 8);
    assert.equal(allEvents[4].message, 'Event 8');
  });

  it('supports delta replay via getEventsSince with monotonic filtering', () => {
    const buffer = new EventRingBuffer(10);
    for (let i = 1; i <= 6; i++) {
      buffer.push({ type: 'status', message: `Step ${i}` });
    }

    // Client requests all events from start (lastEventId = 0)
    const fromStart = buffer.getEventsSince(0);
    assert.equal(fromStart.length, 6);
    assert.equal(fromStart[0].eventId, 1);
    assert.equal(fromStart[5].eventId, 6);

    // Negative lastEventId returns all events
    const fromNegative = buffer.getEventsSince(-5);
    assert.equal(fromNegative.length, 6);

    // Client reconnects having seen event 4
    const delta = buffer.getEventsSince(4);
    assert.equal(delta.length, 2);
    assert.equal(delta[0].eventId, 5);
    assert.equal(delta[0].message, 'Step 5');
    assert.equal(delta[1].eventId, 6);
    assert.equal(delta[1].message, 'Step 6');

    // Client is completely up to date
    const upToDate = buffer.getEventsSince(6);
    assert.equal(upToDate.length, 0);

    // Client sends an invalid or future eventId
    const future = buffer.getEventsSince(99);
    assert.equal(future.length, 0);
  });

  it('detects dropped events when client reconnects after buffer eviction', () => {
    const buffer = new EventRingBuffer(4);
    assert.equal(buffer.hasDroppedEventsSince(0), false);
    assert.equal(buffer.hasDroppedEventsSince(-1), false);

    for (let i = 1; i <= 10; i++) {
      buffer.push({ type: 'status', message: `Msg ${i}` });
    }

    // Retained events: 7, 8, 9, 10
    assert.equal(buffer.getOldestEventId(), 7);
    assert.equal(buffer.hasDroppedEventsSince(2), true);
    assert.equal(buffer.hasDroppedEventsSince(7), false);
    assert.equal(buffer.hasDroppedEventsSince(8), false);
    assert.equal(buffer.hasDroppedEventsSince(0), false);

    // Replay since 2 should return all available remaining events (7, 8, 9, 10)
    const recovered = buffer.getEventsSince(2);
    assert.equal(recovered.length, 4);
    assert.equal(recovered[0].eventId, 7);
    assert.equal(recovered[3].eventId, 10);
  });

  it('handles clearing buffer while preserving monotonic sequence progression', () => {
    const buffer = new EventRingBuffer(5);
    buffer.push({ type: 'status', message: 'A' });
    buffer.push({ type: 'status', message: 'B' });
    assert.equal(buffer.getLatestEventId(), 2);

    buffer.clear();
    assert.equal(buffer.size(), 0);
    assert.equal(buffer.getAll().length, 0);
    assert.equal(buffer.getLatestEventId(), 0);
    assert.equal(buffer.getOldestEventId(), 0);

    // Next event after clear continues monotonic numbering to prevent client collision
    const nextEv = buffer.push({ type: 'status', message: 'C' });
    assert.equal(nextEv.eventId, 3);
  });
});

describe('Session Lifecycle State Machine & Transition Rules', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionLifecycleManager();
  });

  it('initializes wide research session in planning state with EventRingBuffer', () => {
    const session = manager.createSession({
      query: 'Quantum Computing Fault Tolerance',
      mode: 'wide'
    });

    assert.ok(session.id);
    assert.equal(session.mode, 'wide');
    assert.equal(session.state, 'planning');
    assert.ok(session.eventBuffer instanceof EventRingBuffer);
    assert.equal(session.eventBuffer.size() >= 1, true); // initial state event
    assert.equal(session.partialDraft.sources.length, 0);
    assert.ok(session.signal);
  });

  it('uses wide mode only when it is explicitly requested', () => {
    const stormSession = new ResearchSession({ query: 'AI Chips', report_type: 'storm' });
    assert.equal(stormSession.mode, 'standard');

    const wideSession = new ResearchSession({ query: 'AI Chips', report_type: 'storm', mode: 'wide' });
    assert.equal(wideSession.mode, 'wide');

    const standardSession = new ResearchSession({ query: 'AI Chips', report_type: 'quick' });
    assert.equal(standardSession.mode, 'standard');
  });

  it('supports subscription, unsubscription, and subscriber error resilience', () => {
    const session = manager.createSession({ query: 'Solid State Batteries' });
    const received = [];

    // Sub 1: normal
    const unsubscribe = session.subscribe((ev) => {
      received.push(ev);
    });

    // Sub 2: throwing error
    session.subscribe(() => {
      throw new Error('Subscriber intentional error');
    });

    session.emitEvent({
      type: 'report_chunk',
      chunk: 'Chunk 1',
      sources: [{ url: 'https://battery.org', title: 'Solid State Tech', domain: 'battery.org', credibilityScore: 0.9 }],
      subqueries: ['electrolyte conductivity'],
      reflection: 'Promising ionic conductivity'
    });

    assert.ok(received.length > 0);
    assert.equal(session.partialDraft.report.includes('Chunk 1'), true);
    assert.equal(session.partialDraft.sources.length, 1);
    assert.equal(session.partialDraft.subqueries.length, 1);
    assert.equal(session.partialDraft.reflections.length, 1);

    const countBefore = received.length;
    unsubscribe();
    session.emitEvent({ type: 'report_chunk', chunk: 'Chunk 2' });
    assert.equal(received.length, countBefore); // No new events after unsubscribe
  });

  it('progresses through valid 4-state lifecycle: planning -> awaiting_approval -> running -> completed', () => {
    const session = manager.createSession({
      query: 'Autonomous Vehicle Safety Standards',
      mode: 'wide'
    });

    // 1. Planning -> Awaiting Approval with generated plan
    const plan = {
      id: 'plan-1',
      version: 1,
      objective: 'Comprehensive safety analysis',
      milestones: [
        { id: 'm1', query: 'sensor redundancy', rationale: 'Hardware fault tolerance' },
        { id: 'm2', query: 'regulatory frameworks', rationale: 'Legal compliance' }
      ],
      suggestedSkills: ['academic-paper-analysis'],
      estimatedScope: { targetSources: 100, maxHops: 2 }
    };

    session.submitPlanForApproval(plan);
    assert.equal(session.state, 'awaiting_approval');
    assert.equal(session.plan?.milestones.length, 2);

    // Plan approval without argument uses existing draft plan
    session.approvePlan();
    assert.equal(session.state, 'running');
    assert.equal(session.plan?.status, 'approved');

    // 3. Running -> Completed
    session.complete({
      report: '# Final Analysis\nAll milestones satisfied.',
      sources: [{ url: 'https://iso.org', title: 'ISO 26262', domain: 'iso.org', credibilityScore: 0.95 }]
    });
    assert.equal(session.state, 'completed');
    assert.equal(session.isTerminal(), true);

    // Re-completing or re-failing a terminal session is a no-op
    session.complete({ report: 'New text' });
    assert.equal(session.state, 'completed');
    session.fail('Some failure');
    assert.equal(session.state, 'completed');
  });

  it('supports budget_exhausted state and plan modification in awaiting_approval', () => {
    const session = manager.createSession({ query: 'Fusion Tech', mode: 'wide' });
    session.transitionTo('running');

    session.markBudgetExhausted('Search budget limit reached (200 sources)');
    assert.equal(session.state, 'budget_exhausted');
    assert.equal(session.isTerminal(), false);

    // Can transition back to running on budget extend
    session.transitionTo('running', 'User granted extended quota');
    assert.equal(session.state, 'running');

    // Re-marking budget exhausted when terminal is a no-op
    session.complete();
    session.markBudgetExhausted('Should be ignored');
    assert.equal(session.state, 'completed');
  });

  it('rejects invalid state transitions and prevents mutating terminal sessions', () => {
    const session = manager.createSession({ query: 'Microbiome Therapeutics', mode: 'standard' });

    // Same state transition returns true
    assert.equal(session.transitionTo('planning'), true);

    // Transition directly to running
    session.transitionTo('running');
    assert.equal(session.state, 'running');

    // Complete session
    session.complete();
    assert.equal(session.state, 'completed');

    // Attempting to transition from terminal completed state throws
    assert.throws(() => {
      session.transitionTo('running');
    }, /Invalid state transition/);

    assert.equal(session.state, 'completed');
  });

  it('transitions to failed state upon unrecoverable error and records failure details', () => {
    const session = manager.createSession({ query: 'Fusion Energy', mode: 'wide' });
    session.transitionTo('running');

    session.fail(new Error('Network gateway timeout after 3 retries'));
    assert.equal(session.state, 'failed');
    assert.equal(session.isTerminal(), true);
    assert.ok(session.failureReason?.includes('Network gateway timeout'));

    const latestEvent = session.eventBuffer.getAll().pop();
    assert.equal(latestEvent.type, 'error');
  });

  it('deduplicates recorded evidence and sources cleanly', () => {
    const session = manager.createSession({ query: 'Quantum Key Distribution' });

    const src = { url: 'https://nist.gov/pqc', title: 'PQC Standards', domain: 'nist.gov', credibilityScore: 0.98 };
    session.recordSource(src);
    session.recordSource(src); // duplicate url
    assert.equal(session.partialDraft.sources.length, 1);

    session.recordSubqueries(['lattice cryptography', 'lattice cryptography']);
    assert.equal(session.partialDraft.subqueries.length, 1);

    session.recordReflection('Insight 1');
    session.recordReflection('Insight 1'); // duplicate
    assert.equal(session.partialDraft.reflections.length, 1);
  });
});

describe('Sub-Second Cancellation & Partial Evidence Preservation', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionLifecycleManager();
  });

  it('cancels an in-progress session in under 100ms and triggers AbortSignal', async () => {
    const session = manager.createSession({ query: 'High Temperature Superconductors', mode: 'wide' });
    session.transitionTo('running');

    let abortSignalTriggered = false;
    session.abortController.signal.addEventListener('abort', () => {
      abortSignalTriggered = true;
    });

    const start = Date.now();
    const draft = await session.cancel('User requested cancellation');
    const duration = Date.now() - start;

    assert.ok(duration < 100, `Cancellation took ${duration}ms, expected sub-second (<1000ms)`);
    assert.equal(abortSignalTriggered, true);
    assert.equal(session.state, 'cancelled');
    assert.equal(session.isTerminal(), true);
    assert.ok(draft);

    // Cancel again returns draft without changes
    const draftAgain = await session.cancel('Again');
    assert.equal(draftAgain, draft);
  });

  it('faithfully preserves partial collected evidence upon cancellation', async () => {
    const session = manager.createSession({ query: 'Semiconductor Lithography', mode: 'wide' });
    session.transitionTo('running');

    // Simulate partial evidence ingestion during run
    session.recordSource({
      url: 'https://asml.com/euv',
      title: 'High-NA EUV Systems',
      domain: 'asml.com',
      credibilityScore: 0.92
    });
    session.recordSource({
      url: 'https://tsmc.com/nodes',
      title: '2nm Gate-All-Around Roadmap',
      domain: 'tsmc.com',
      credibilityScore: 0.90
    });
    session.recordReportChunk('### Introduction\nHigh-NA EUV introduces 0.55 NA optics.');
    session.recordSubqueries(['High-NA EUV throughput', 'Anamorphic magnification']);

    // Cancel while running
    const draft = await session.cancel('Terminated by researcher');

    assert.equal(session.state, 'cancelled');
    assert.equal(draft.sources.length, 2);
    assert.equal(draft.sources[0].domain, 'asml.com');
    assert.equal(draft.sources[1].domain, 'tsmc.com');
    assert.ok(draft.report.includes('High-NA EUV introduces 0.55 NA optics'));
    assert.equal(draft.subqueries.length, 2);
    assert.equal(draft.reason, 'Terminated by researcher');
    assert.ok(draft.interruptedAt > 0);

    // Verify cancellation event is emitted in buffer with partial draft
    const allEvents = session.eventBuffer.getAll();
    const cancelEvent = allEvents.find(e => e.type === 'cancelled');
    assert.ok(cancelEvent);
    assert.equal(cancelEvent.partialDraft?.sources.length, 2);

    // Delta replay through session method
    const missed = session.getEventsSince(0);
    assert.ok(missed.length > 0);
  });

  it('handles in-flight async promises aborting cleanly without unhandled rejection', async () => {
    const session = manager.createSession({ query: 'Battery Cathode Chemistry' });
    session.transitionTo('running');

    // Simulated long-running worker that listens to session.signal
    const longRunningWorker = new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ completed: true });
      }, 5000);

      session.abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve({ completed: false, aborted: true });
      });
    });

    const cancelPromise = session.cancel('User stopped research');
    const workerResult = await longRunningWorker;
    const draft = await cancelPromise;

    assert.equal(workerResult.aborted, true);
    assert.equal(workerResult.completed, false);
    assert.equal(session.state, 'cancelled');
    assert.ok(draft);
  });
});

describe('Manager Session Coordination & Edge Case Resilience', () => {
  let manager;

  beforeEach(() => {
    manager = new SessionLifecycleManager();
  });

  it('rejects invalid buffer capacity <= 0', () => {
    assert.throws(() => {
      new EventRingBuffer(0);
    }, /EventRingBuffer capacity must be >= 1/);

    assert.throws(() => {
      new EventRingBuffer(-5);
    }, /EventRingBuffer capacity must be >= 1/);
  });

  it('handles high-throughput rapid burst of 500 events maintaining circular integrity', () => {
    const buffer = new EventRingBuffer(50);
    for (let i = 1; i <= 500; i++) {
      buffer.push({ type: 'report_chunk', chunk: `token_${i}` });
    }

    assert.equal(buffer.size(), 50);
    assert.equal(buffer.isFull(), true);
    assert.equal(buffer.getLatestEventId(), 500);
    assert.equal(buffer.getOldestEventId(), 451);

    const events = buffer.getAll();
    assert.equal(events.length, 50);
    assert.equal(events[0].eventId, 451);
    assert.equal(events[49].eventId, 500);
  });

  it('manages multiple independent sessions concurrently through manager methods', async () => {
    const session1 = manager.createSession({ query: 'Graphene Supercapacitors', mode: 'wide' });
    const session2 = manager.createSession({ query: 'Carbon Nanotube Fibers', mode: 'standard' });

    assert.equal(manager.hasSession(session1.id), true);
    assert.equal(manager.hasSession(session2.id), true);
    assert.equal(manager.getSession('non_existent'), undefined);
    assert.equal(manager.listActiveSessions().length, 2);

    session1.submitPlanForApproval({
      id: 'p1',
      version: 1,
      objective: 'Analyze graphene energy density',
      milestones: [{ id: 'm1', query: 'specific capacitance', rationale: 'performance' }],
      suggestedSkills: [],
      estimatedScope: { targetSources: 50, maxHops: 1 }
    });

    const approvedPlan = manager.approveSessionPlan(session1.id);
    assert.ok(approvedPlan);
    assert.equal(session1.state, 'running');

    // Approving non-existent session returns null
    assert.equal(manager.approveSessionPlan('invalid_id'), null);

    // Cancel session 2 via manager
    const draft2 = await manager.cancelSession(session2.id, 'No longer needed');
    assert.ok(draft2);
    assert.equal(session2.state, 'cancelled');

    // Cancelling non-existent session returns null
    assert.equal(await manager.cancelSession('invalid_id'), null);

    // Remove session 2
    assert.equal(manager.removeSession(session2.id), true);
    assert.equal(manager.hasSession(session2.id), false);
    assert.equal(manager.listActiveSessions().length, 1);

    // Clear all
    manager.clearAll();
    assert.equal(manager.listActiveSessions().length, 0);
  });
});
