import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * Ticket #145 — Agent workspace default: rail, composer, cards and chips on
 * the real feed (SPEC-028; direction #126). The harness workspace becomes the
 * DEFAULT workspace and Agentic Search the default-in-chat interaction
 * (v1 agent-management scope: one loop, explicit cancel):
 *
 *  - Default launch lands in the harness workspace (no opt-in preview gate).
 *  - A chat question starts an Agentic Search run against the engine's
 *    `/api/agent/start` surface; cards/chips render from the live feed only.
 *  - Steering queues visibly before applying; auto-retries are shown; cancel
 *    surfaces the explicit terminal state with the evidence admitted so far.
 *  - Deep Research keeps its plan-first path and the plan-approval overlay.
 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/** Source with comment lines stripped, so a mention in prose never satisfies a pin. */
const readSrc = async (path) => {
  const source = await read(path);
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
};

describe('The harness workspace is the default workspace', () => {
  it('App renders the harness workspace unconditionally — no opt-in preview gate', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(
      app,
      /isHarnessPreviewOpen/,
      'the opt-in harness-preview gate is gone from App',
    );
    assert.match(app, /<LensHarnessWorkspace/, 'App mounts the harness workspace as its root surface');
    assert.doesNotMatch(app, /onOpenHarness/, 'no sidebar harness opt-in prop remains');
  });

  it('the harness workspace is no longer an exit-able preview — it is the workspace', async () => {
    const codeOnly = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.doesNotMatch(
      codeOnly,
      /onExit/,
      'the harness workspace has no exit-to-legacy escape hatch',
    );
    assert.match(codeOnly, /data-testid="lens-harness"/, 'the harness shell is pinned');
  });
});

describe('A chat question starts an Agentic Search run', () => {
  it('App owns a startAgentRun transport to the engine agentic surface', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /startAgentRun/i, 'App has a named agentic-start transport');
    assert.match(app, /\/api\/agent\/start/, 'it posts to the engine agentic start route');
    assert.match(app, /\/ws\/agent\//, 'it attaches the live agentic event stream');
    assert.match(app, /session_url/, 'the accept payload names the stream to attach');
  });

  it('the workspace composer default is Agentic Search, with Deep Research opt-in', async () => {
    const codeOnly = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(codeOnly, /agentInteraction|interaction:\s*'agent'/, 'the workspace models the interaction kind explicitly');
    assert.match(codeOnly, /'deep-research'/, 'Deep Research remains an explicit opt-in in the composer');
    assert.match(codeOnly, /useState<AgentInteraction>\('agent'\)/, 'AGENTIC SEARCH IS THE DEFAULT when the composer has no explicit choice');
    assert.match(codeOnly, /onStartAgentRun/, 'the workspace hands the question to the agentic transport');
    assert.match(codeOnly, /onStartDeepResearch/, 'the Deep Research path keeps its own entry point');
    // Tool chips render from the live agentic feed only — never invented.
    assert.match(codeOnly, /agentRunFeed/, 'the workspace consumes the reduced live feed');
    assert.match(codeOnly, /<AgentRunFeed/, 'the workspace mounts the live run feed section');
    const feedSection = await readSrc('../src/components/harness/AgentRunFeed.tsx');
    assert.match(feedSection, /feed\.toolChips/, 'tool chips render from the live feed');
    assert.match(feedSection, /feed\.sources/, 'admitted sources render from the live feed');
    assert.match(feedSection, /feed\.retries/, 'auto-retries render as visible states');
    assert.match(feedSection, /feed\.steerNotice/, 'the steering queue renders as a visible state');
  });

  it('the request payload is real: question plus credentials, resolved endpoint — never a fabricated call', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /question:\s*trimmed|question:\s*query|question/, 'the payload carries the user question');
    assert.match(app, /agentAbortControllersRef|AbortController/, 'the agentic run is abortable client-side');
  });
});

describe('Steering, retries, and cancel are visible states', () => {
  it('the pure reducer models steering-queued, retry, and cancelled visibility', async () => {
    const { reduceAgentRun } = await import('../src/utils/agentRunFeed.mjs');
    const s0 = reduceAgentRun(undefined, { type: 'started', sessionId: 's1' });
    assert.equal(s0.phase, 'running');
    assert.deepEqual(s0.toolChips, []);

    const s1 = reduceAgentRun(s0, { type: 'tool_call', sessionId: 's1', toolName: 'web_search', args: { query: 'evidence' } });
    assert.equal(s1.toolChips.length, 1, 'a tool chip appears from the real event');
    assert.equal(s1.toolChips[0].toolName, 'web_search');
    assert.deepEqual(s1.toolChips[0].args, { query: 'evidence' });

    const s2 = reduceAgentRun(s1, { type: 'tool_result', sessionId: 's1', toolName: 'web_search', output: '[1] evidence found' });
    assert.match(s2.toolChips[0].resultText ?? '', /evidence found/, 'the chip shows the real tool output');

    const s3 = reduceAgentRun(s2, { type: 'source', sessionId: 's1', source: { url: 'https://x.example/1', title: 'X' } });
    assert.equal(s3.sources.length, 1, 'admitted sources accumulate live');
    assert.equal(s3.sources[0].url, 'https://x.example/1');

    const s4 = reduceAgentRun(s3, { type: 'steer_queued', sessionId: 's1', message: 'focus on the ledger' });
    assert.equal(s4.steerQueue.length, 1, 'a steering message shows as queued BEFORE it applies');
    assert.equal(s4.steerQueue[0].message, 'focus on the ledger');
    assert.equal(s4.steerNotice !== null, true, 'the queue state is visible');
    assert.match(s4.steerNotice.label, /queued|queued/i, 'the notice says queued, not applied');

    const s5 = reduceAgentRun(s4, { type: 'steer_applied', sessionId: 's1' });
    assert.equal(s5.steerQueue.length, 0, 'the queued entry leaves the queue when applied');
    assert.equal(s5.steerNotice, null);

    const s6 = reduceAgentRun(s5, { type: 'retry', sessionId: 's1', attempt: 1, reason: 'rate limited' });
    assert.equal(s6.retries.length, 1, 'an auto-retry is a visible state');
    assert.match(s6.retries[0].label, /attempt 1|rate limited/, 'the retry names its attempt and reason');

    const s7 = reduceAgentRun(s6, { type: 'cancelled', sessionId: 's1' });
    assert.equal(s7.phase, 'cancelled', 'cancel is an explicit terminal');
    assert.equal(s7.sources.length, 1, 'the evidence admitted so far survives cancel');
    assert.equal(s7.toolChips.length, 1, 'the tool trail survives cancel');
  });

  it('the reducer ignores events from other sessions and never fabricates a terminal', async () => {
    const { reduceAgentRun } = await import('../src/utils/agentRunFeed.mjs');
    const s0 = reduceAgentRun(undefined, { type: 'started', sessionId: 's1' });
    const ignored = reduceAgentRun(s0, { type: 'tool_call', sessionId: 'other', toolName: 'web_search', args: {} });
    assert.equal(ignored, s0, 'another session’s events do not mutate this run');
    const s1 = reduceAgentRun(s0, { type: 'tool_call', sessionId: 's1', toolName: 'fetch_content', args: { url: 'https://y.example' } });
    const s2 = reduceAgentRun(s1, { type: 'finished', sessionId: 's1' });
    assert.equal(s2.phase, 'finished', 'the real terminal lands');
  });

  it('cancel is wired end-to-end: a stop control posting to the engine cancel route', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /cancelAgentRun/i, 'App owns a cancel transport');
    assert.match(app, /\/api\/agent\/cancel/, 'it posts to the engine cancel route');
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /onCancelAgentRun|onCancel/, 'the workspace exposes the stop control');
    assert.match(workspace, /Square|StopCircle|octagon/i, 'the stop control carries a visible affordance');
  });

  it('steering is wired end-to-end: the workspace hands a follow-up to the steer transport while a run is live', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /onSteerAgentRun|onSteer/, 'the workspace exposes steering');
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /\/api\/agent\/steer/, 'App posts to the engine steer route');
    assert.match(app, /steer_queued|type: 'steer_queued'/, 'App applies the steer as a QUEUED visible state');
  });
});

describe('Deep Research keeps its plan-first path', () => {
  it('the plan-approval overlay survives and the deep-research route is intact', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /PlanApprovalModal/, 'the approval overlay is still mounted');
    assert.match(app, /handleApprovePlan|handleRegeneratePlan|handleDiscardPlan/, 'the plan actions are intact');
    assert.match(app, /research_mode|approvedPlan|\/api\/research\/start/, 'the Deep Research request path is intact');
  });

  it('the workspace keeps an explicit deep-research entry — agentic default, never agentic monopoly', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /deep-research|Deep Research|البحث المعمّق/, 'Deep Research stays visible in the workspace');
  });
});
