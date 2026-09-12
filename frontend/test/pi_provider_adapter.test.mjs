import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PiAdapter,
  generateWithPi,
  createOpenAiCompatibleProvider,
  PI_PROVIDER_IDS,
} from '../dist-electron/engine/piAdapter.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

describe('Pi provider adapter (dormant behind the model seam, ticket 02)', () => {
  it('maps every LENS provider id onto its pi-ai provider', () => {
    assert.equal(PI_PROVIDER_IDS.gemini, 'google');
    assert.equal(PI_PROVIDER_IDS.openai, 'openai');
    assert.equal(PI_PROVIDER_IDS.anthropic, 'anthropic');
    assert.equal(PI_PROVIDER_IDS.groq, 'groq');
    assert.equal(PI_PROVIDER_IDS.deepseek, 'deepseek');
    assert.equal(PI_PROVIDER_IDS.openrouter, 'openrouter');
    assert.equal(PI_PROVIDER_IDS.mistral, 'mistral');
    assert.equal(PI_PROVIDER_IDS.ollama, 'ollama');
  });

  it('streams token deltas through onChunk and returns the full text (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('hello world')]);
    const chunks = [];
    const text = await PiAdapter.generate(
      {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Say hello' }],
        temperature: 0.1,
        onChunk: (c) => chunks.push(c),
      },
      { overrideFactory: async () => faux.provider }
    );
    assert.equal(text, 'hello world');
    assert.equal(chunks.join(''), 'hello world');
  });

  it('surfaces tool calls to the tool handler and resumes the loop (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('get_weather', { city: 'cairo' })]),
      ai.fauxAssistantMessage('temperature 30c'),
    ]);
    const calls = [];
    const res = await generateWithPi(
      {
        provider: 'anthropic',
        model: 'test-model',
        messages: [{ role: 'user', content: 'Weather in cairo?' }],
        tools: [{ name: 'get_weather', description: 'Get the weather', parameters: { type: 'object', properties: {} } }],
        toolHandler: async (c) => {
          calls.push(c);
          return { success: true, result: '30c' };
        },
      },
      { overrideFactory: async () => faux.provider }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'get_weather');
    assert.equal(calls[0].arguments.city, 'cairo');
    assert.equal(res.text, 'temperature 30c');
    assert.equal(res.toolCallCount, 1);
    assert.ok(res.providerRequests >= 2);
  });

  it('honors an already-aborted signal promptly (no model request)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('never reaches here')]);
    const aborted = AbortSignal.abort('test-abort');
    let message = '';
    try {
      await PiAdapter.generate(
        { provider: 'ollama', model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
        { signal: aborted, overrideFactory: async () => faux.provider }
      );
    } catch (err) {
      message = String(err);
    }
    assert.ok(message.includes('aborted'), `expected abort, got: ${message}`);
  });

  it('builds the Ollama OpenAI-compatible custom provider configuration', async () => {
    const p = await createOpenAiCompatibleProvider('ollama', 'http://127.0.0.1:11434');
    assert.equal(p.id, 'ollama');
    assert.equal(p.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(typeof p.stream, 'function');
    assert.equal(typeof p.streamSimple, 'function');
  });

  it('confirms the hand-rolled client is retired and the gateway defaults to the pi core', async () => {
    // Ticket #73: ModelClient.generate and the SSE parser are retired.
    const models = await import('../dist-electron/engine/models.js');
    assert.equal(typeof models.ModelClient.generate, 'undefined');
    let threw = null;
    try {
      models.parseProviderSseEvents('gemini', 'data: {}\n\n');
    } catch (err) {
      threw = err;
    }
    assert.ok(threw && /retired/.test(String(threw)), 'retired SSE parser must fail loudly');
    const { getActiveCore } = await import('../dist-electron/engine/modelGateway.js');
    assert.equal(getActiveCore(), 'pi');
  });
});