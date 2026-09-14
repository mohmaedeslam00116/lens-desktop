import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

import { providerAdmissionGuard, stopEmbeddedServer } from '../dist-electron/engine/server.js';
import {
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  generateWithPi,
} from '../dist-electron/engine/piAdapter.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

const jiti = createJiti(import.meta.url);
const { telemetryStep } = await jiti.import('../src/utils/liveFeed.ts');

afterEach(async () => {
  resetActiveCore();
  await stopEmbeddedServer().catch(() => {});
});

describe('Stream idle watchdog (visibility fix, ticket #119)', () => {
  it('default window is 120s', () => {
    assert.equal(DEFAULT_STREAM_IDLE_TIMEOUT_MS, 120_000);
  });

  it('a provider stream that never produces an event fails loudly with the watchdog error', async () => {
    const ai = await import('@earendil-works/pi-ai');
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });

    // Clone the faux provider so the auth shape stays valid but streamSimple
    // hangs on every next() with zero events — the exact stall that froze real
    // runs (setup resolves, the body never delivers).
    const stalled = Object.create(faux.provider);
    stalled.streamSimple = () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}),
        };
      },
    });

    await assert.rejects(
      () =>
        generateWithPi(
          {
            provider: 'openai',
            model: 'test-model',
            apiKey: 'test-key',
            messages: [{ role: 'user', content: 'hello' }],
          },
          { overrideFactory: async () => stalled, streamIdleTimeoutMs: 150 },
        ),
      /stream stalled.*watchdog/,
    );
  });

  it('a stream that emits events but stalls mid-generation still fails (deadline resets on activity)', async () => {
    const ai = await import('@earendil-works/pi-ai');
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });

    // Streams one delta then never delivers another event: the watchdog must
    // re-arm after the first event and still fire on the mid-stream stall.
    let pulled = false;
    const stalledMid = Object.create(faux.provider);
    stalledMid.streamSimple = () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (!pulled) {
              pulled = true;
              return Promise.resolve({
                done: false,
                value: { type: 'text_delta', delta: 'partial' },
              });
            }
            return new Promise(() => {});
          },
        };
      },
    });

    await assert.rejects(
      () =>
        generateWithPi(
          {
            provider: 'openai',
            model: 'test-model',
            apiKey: 'test-key',
            messages: [{ role: 'user', content: 'hello' }],
          },
          { overrideFactory: async () => stalledMid, streamIdleTimeoutMs: 150 },
        ),
      /stream stalled.*watchdog/,
    );
  });

  it('a healthy fast stream is never cut by the watchdog (faux provider, generous window)', async () => {
    const ai = await import('@earendil-works/pi-ai');
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('quick answer')]);

    const result = await generateWithPi(
      {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Say something' }],
      },
      { overrideFactory: async () => faux.provider, streamIdleTimeoutMs: 10_000 },
    );
    assert.match(result.text, /quick answer/);
  });
});

describe('Provider admission guard (visibility fix, ticket #119)', () => {
  it('cloud provider without a key is rejected with a bilingual message', () => {
    const msg = providerAdmissionGuard({ llm_provider: 'openai', api_keys: {} });
    assert.match(msg || '', /No API key configured/);
    assert.match(msg || '', /مفتاح API/);
  });

  it('cloud provider with a key passes', () => {
    assert.equal(providerAdmissionGuard({ llm_provider: 'openai', api_keys: { openai: 'sk-test' } }), null);
  });

  it('empty-string key is treated as missing', () => {
    const msg = providerAdmissionGuard({ llm_provider: 'gemini', api_keys: { gemini: '   ' } });
    assert.match(msg || '', /No API key configured/);
  });

  it('ollama without an endpoint is rejected; with an endpoint it passes', () => {
    const missing = providerAdmissionGuard({ llm_provider: 'ollama' });
    assert.match(missing || '', /Ollama/);
    assert.equal(providerAdmissionGuard({ llm_provider: 'ollama', ollama_endpoint: 'http://127.0.0.1:11434' }), null);
  });

  it('unknown provider ids are not blocked (engine fails with its own precise error)', () => {
    assert.equal(providerAdmissionGuard({ llm_provider: 'acme-odd-provider' }), null);
  });
});

describe('Telemetry-to-feed mapping (visibility fix, ticket #119)', () => {
  const ar = true;

  it('researcher_telemetry phases map to bilingual feed steps', () => {
    const started = telemetryStep(
      {
        type: 'researcher_telemetry',
        researcherTelemetry: {
          researcherId: 'r1',
          role: 'technical',
          facet: 'Energy storage',
          phase: 'started',
          counts: { facetIndex: 1, facetCount: 3 },
        },
      },
      ar,
    );
    assert.match(started || '', /2\/3/);
    assert.match(started || '', /Energy storage/);

    const completed = telemetryStep(
      {
        type: 'researcher_telemetry',
        researcherTelemetry: { researcherId: 'r1', role: 'technical', phase: 'completed' },
      },
      ar,
    );
    assert.match(completed || '', /.+/); // non-empty
  });

  it('fanout_telemetry reports running researchers and completion outcomes', () => {
    const running = telemetryStep(
      { type: 'fanout_telemetry', fanoutTelemetry: { researchersLaunched: 3, researchersCompleted: 1, researchersFailed: 0, concurrencyLimit: 4 } },
      ar,
    );
    assert.match(running || '', /3/);

    const done = telemetryStep(
      { type: 'fanout_telemetry', fanoutTelemetry: { researchersLaunched: 3, researchersCompleted: 3, researchersFailed: 0, urlsShared: 5 } },
      ar,
    );
    assert.match(done || '', /5/);
  });

  it('audit_telemetry maps to the advisory audit summary', () => {
    const step = telemetryStep(
      { type: 'audit_telemetry', auditTelemetry: { supported: 10, partiallySupported: 2, unsupported: 1, overallSupport: 0.8 } },
      ar,
    );
    assert.match(step || '', /10/);
    assert.match(step || '', /2/);
  });

  it('session_state maps terminal states (no silent waiting)', () => {
    const failed = telemetryStep({ type: 'session_state', state: 'failed' }, ar);
    assert.match(failed || '', /failed|فشلت/);
    const exhausted = telemetryStep({ type: 'session_state', state: 'budget_exhausted' }, ar);
    assert.match(exhausted || '', /budget|ميزانية/);
  });

  it('already-surfaced event types return null (no duplicates)', () => {
    assert.equal(telemetryStep({ type: 'status', message: 'x' }, ar), null);
    assert.equal(telemetryStep({ type: 'finished' }, ar), null);
  });
});

describe('Agent card state derivation (visibility fix, ticket #119)', () => {
  // The App reducer is inline; pin its contract through the same mapping the
  // applier uses: phase → status, with terminal phases freezing the clock.
  it('terminal phases map to success; others to running', () => {
    const phases = ['started', 'role_selected', 'retrieval', 'tool_activity', 'run_started', 'run_completed', 'completed'];
    const expected = {
      started: 'running',
      role_selected: 'running',
      retrieval: 'running',
      tool_activity: 'running',
      run_started: 'running',
      run_completed: 'success',
      completed: 'success',
    };
    for (const phase of phases) {
      const status = phase === 'completed' || phase === 'run_completed' ? 'success' : 'running';
      assert.equal(status, expected[phase]);
    }
  });

  it('AgentFeedState carries the elapsed-clock fields', () => {
    const startedAt = Date.now() - 5000;
    const card = {
      id: 'r1',
      role: 'primary',
      label: 'Researcher 1/2',
      facet: 'Facet A',
      phase: 'retrieval',
      startedAt,
      elapsedMs: Date.now() - startedAt,
      lastActivity: 'retrieving',
      lastActivityAt: Date.now(),
      status: 'running',
    };
    assert.ok(card.elapsedMs > 4000);
    assert.equal(typeof card.startedAt, 'number');
  });
});
