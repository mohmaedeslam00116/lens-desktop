import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { setActiveCore, resetActiveCore, getActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;

function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

function baseRequest(overrides = {}) {
  return {
    query: 'Fusion energy',
    report_type: 'quick',
    language: 'en',
    llm_provider: 'openai',
    model_name: 'test-model',
    api_keys: { openai: 'test-key' },
    search_provider: 'duckduckgo',
    embedding_enabled: false,
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
});

describe('Standard research loop on the pi core (ticket 05)', () => {
  it('runs a standard request end-to-end with the same LiveEvent stream (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage('["fusion energy basics","tokamak benchmarks 2026"]'),
      ai.fauxAssistantMessage('# Fusion Energy Report\n\nKey findings summarized.'),
    ]);
    stubFetchEmpty();
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    assert.equal(getActiveCore(), 'pi');

    const emitted = [];
    const agent = new DeepResearchAgent('s-std', (e) => emitted.push(e));
    await agent.run(baseRequest());

    const types = emitted.map((e) => e.type);
    const root = emitted.find((e) => e.type === 'graph_node' && e.node?.id === 'root_1');
    assert.ok(root, 'expected an active root graph node');
    assert.equal(root.node.status, 'active');
    assert.equal(root.node.label, 'Fusion energy');

    const subq = emitted.find((e) => e.type === 'subqueries');
    assert.ok(subq, 'expected a subqueries event');
    assert.deepEqual(subq.subqueries, ['fusion energy basics', 'tokamak benchmarks 2026']);

    const report = emitted.filter((e) => e.type === 'report_chunk').map((e) => e.chunk).join('');
    assert.equal(report, '# Fusion Energy Report\n\nKey findings summarized.');

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'expected a finished event');
  });

  it('executes the approved frozen plan trajectory on the pi core (post-approval resume path)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage('# Approved Plan Report\n\nExecuted the authorized trajectory.'),
    ]);
    stubFetchEmpty();
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new DeepResearchAgent('s-plan', (e) => emitted.push(e));
    await agent.run(baseRequest({
      plan: {
        id: 'plan-1',
        version: 2,
        objective: 'Fusion energy',
        milestones: [{ id: 'm1', query: 'milestone one', rationale: 'core physics' }],
        suggestedSkills: [],
      },
    }));

    const subq = emitted.find((e) => e.type === 'subqueries');
    assert.ok(subq, 'expected subqueries from the approved plan milestones');
    assert.deepEqual(subq.subqueries, ['milestone one']);

    const frozenThought = emitted.find(
      (e) => e.type === 'thought' && typeof e.thought === 'string' && e.thought.includes('frozen authorized research trajectory')
    );
    assert.ok(frozenThought, 'expected the frozen-trajectory thought (approval resume path)');

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'expected completion without a new planning LLM call');
    assert.ok(faux.state.callCount <= 1, `expected at most 1 LLM call (no replanning), got ${faux.state.callCount}`);
  });

  it('aborts a pi-core run promptly when the signal fires', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('never')]);
    stubFetchEmpty();
    const aborted = AbortSignal.abort('test-abort');
    setActiveCore('pi', { signal: aborted, overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new DeepResearchAgent('s-abort', (e) => emitted.push(e));
    await agent.run(baseRequest());
    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'loop should still settle (report fallback) after abort');
  });

  it('forwards the per-request session signal from the gateway without touching global defaults', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('never')]);
    // Global defaults carry NO signal here: forwarding happens per request.
    setActiveCore('pi', { overrideFactory: async () => faux.provider });
    const { generate: gatewayGenerate, getActiveCore: coreOf } = await import('../dist-electron/engine/modelGateway.js');
    assert.equal(coreOf(), 'pi');
    const aborted = AbortSignal.abort('test-abort');
    let message = '';
    try {
      await gatewayGenerate(
        { provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
        { signal: aborted }
      );
    } catch (err) {
      message = String(err);
    }
    assert.ok(message.includes('aborted'), `expected abort, got: ${message}`);
    assert.ok(faux.state.callCount === 0, `no model request should have started, got ${faux.state.callCount}`);
  });
});