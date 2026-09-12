import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPiSkillTool,
  createPiSkillHandler,
  wireSkillsBridge,
  generateWithSkills,
} from '../dist-electron/engine/piSkillsBridge.js';
import { SkillActivationManager } from '../dist-electron/engine/skills/activation.js';
import { SkillRegistry } from '../dist-electron/engine/skills/registry.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

function makeFakeManager(responses = []) {
  const emitted = [];
  const activations = [];
  return {
    emitted,
    activations,
    manager: {
      getToolDefinition() {
        return {
          name: 'activate_skill',
          description: 'Activates an Agent Skill from the catalog.',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', description: 'skill name' } },
            required: ['name'],
          },
        };
      },
      async handleActivateSkillToolCall(args, emitEvent, options) {
        activations.push({ args, language: options?.language });
        if (typeof emitEvent === 'function') {
          emitEvent({ type: 'skill_activated', skillName: args.name, activationMethod: 'dynamic_tool' });
        }
        const r = responses.length ? responses.shift() : { success: true, name: args.name, instructions: 'do the thing' };
        return r;
      },
    },
  };
}

describe('Pi skills bridge: the single tool-registration point (ticket 04)', () => {
  it('real SkillActivationManager produces exactly one activate_skill tool with its schema', () => {
    const registry = new SkillRegistry();
    const manager = new SkillActivationManager(registry);
    const tool = buildPiSkillTool({ manager });
    assert.equal(tool.name, 'activate_skill');
    assert.ok(tool.description.includes('Agent Skill'));
    assert.equal(tool.parameters.type, 'object');
    assert.ok(tool.parameters.properties.name);
    assert.deepEqual(tool.parameters.required, ['name']);
  });

  it('rejects managers that try to register anything other than activate_skill', () => {
    const rogue = { getToolDefinition: () => ({ name: 'run_shell', description: 'x', parameters: {} }) };
    assert.throws(() => buildPiSkillTool({ manager: rogue }), /exactly one tool named 'activate_skill'/);
  });

  it('handler dispatches to the manager with forwarded language and LiveEvent emitter', async () => {
    const fake = makeFakeManager([{ success: true, name: 'market-research', instructions: 'guidance' }]);
    const emitted = [];
    const handler = createPiSkillHandler({ manager: fake.manager, emit: (e) => emitted.push(e), language: 'ar' });
    const result = await handler({ name: 'activate_skill', arguments: { name: 'market-research' } });
    assert.equal(result.success, true);
    assert.equal(result.instructions, 'guidance');
    assert.equal(fake.activations.length, 1);
    assert.equal(fake.activations[0].language, 'ar');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'skill_activated');
    assert.equal(emitted[0].skillName, 'market-research');
    assert.equal(emitted[0].activationMethod, 'dynamic_tool');
  });

  it('handler rejects non-activate_skill tool names', async () => {
    const fake = makeFakeManager();
    const handler = createPiSkillHandler({ manager: fake.manager });
    const result = await handler({ name: 'run_shell', arguments: {} });
    assert.equal(result.success, false);
    assert.ok(String(result.error).includes('Unsupported tool'));
  });

  it('end-to-end: the skills tool flows through the pi tool-calling loop (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage([ai.fauxToolCall('activate_skill', { name: 'market-research' })]),
      ai.fauxAssistantMessage('skill guidance loaded'),
    ]);
    const fake = makeFakeManager([{ success: true, name: 'market-research', instructions: 'guidance' }]);
    const text = await generateWithSkills(
      {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Activate market research' }],
        temperature: 0.2,
      },
      { manager: fake.manager, emit: (e) => fake.emitted.push(e), language: 'en' },
      { overrideFactory: async () => faux.provider }
    );
    assert.equal(text, 'skill guidance loaded');
    assert.equal(fake.activations.length, 1);
    assert.equal(fake.activations[0].args.name, 'market-research');
    assert.equal(fake.activations[0].language, 'en');
    assert.equal(fake.emitted.filter((e) => e.type === 'skill_activated').length, 1);
  });

  it('wireSkillsBridge returns the paired tool + handler', () => {
    const fake = makeFakeManager();
    const pair = wireSkillsBridge({ manager: fake.manager });
    assert.equal(pair.tool.name, 'activate_skill');
    assert.equal(typeof pair.handler, 'function');
  });
});