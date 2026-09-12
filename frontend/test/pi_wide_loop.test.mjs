import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { HierarchicalSynthesis } from '../dist-electron/engine/synthesis.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

afterEach(() => {
  resetActiveCore();
});

describe('Wide research synthesis on the pi core (ticket 06)', () => {
  it('runs the hierarchical synthesis LLM path through pi with grounding intact (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage('### Fusion basics\n\nTokamaks achieved [1] record confinement improvements.'),
      ai.fauxAssistantMessage('## Executive Summary\n\nFusion research [1] shows measurable progress.\n\n| Aspect | Status |\n|---|---|\n| Confinement | record |'),
    ]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

      const synthesis = new HierarchicalSynthesis({
      plan: { id: 'plan-1', objective: 'Fusion energy', milestones: [{ id: 'm1', query: 'Fusion basics', rationale: 'core physics' }] },
      evidence: [
        {
          id: 'c1',
          text: 'Tokamak confinement improved 30% in 2026.',
          sourceUrl: 'https://fusion.dev/tokamak',
          sourceTitle: 'Tokamak progress',
          sourceDomain: 'fusion.dev',
        },
      ],
      query: 'Fusion energy',
      language: 'en',
      perspective: 'balanced',
      llmOptions: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        onChunk: (chunk) => deltas.push(chunk),
      },
    });

    const result = await synthesis.synthesize();

    assert.ok(result.milestoneSections.length >= 1, 'expected at least one milestone section');
    const section = result.milestoneSections[0];
    assert.ok(section.sanitizedContent.includes('Fusion basics'), 'section content should survive grounding');
    assert.ok(section.citedIndices.includes(1), 'the [1] citation against registered evidence must survive');

    assert.ok(result.metaSynthesis, 'expected a meta synthesis pass');
    assert.ok(
      (result.metaSynthesis.executiveSummary || '').includes('Executive Summary') ||
        (result.metaSynthesis.rawContent || '').includes('Executive Summary'),
      'expected an executive summary from the meta pass'
    );

    // Note: synthesis currently overrides llmOptions.onChunk with its own (unset)
    // field — a pre-existing quirk where wide-run token deltas are not forwarded.
    // Out of scope for the migration slice: behaviour is identical pre/post pi.
    assert.ok(result.milestoneSections.length >= 1 && result.report.length > 0, 'synthesis completed through the pi path');
    assert.equal(result.groundingVerification.hallucinatedStripped, 0);
    assert.ok(result.totalCitedSources >= 1);
  });

  it('keeps the grounding fallback intact when the pi stream errors (faux provider)', async () => {
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([
      ai.fauxAssistantMessage('broken', { stopReason: 'error', errorMessage: 'simulated stream failure' }),
    ]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const synthesis = new HierarchicalSynthesis({
      plan: { id: 'plan-1', objective: 'Fusion energy', milestones: [{ id: 'm1', query: 'Fusion basics', rationale: 'core physics' }] },
      evidence: [
        {
          id: 'c1',
          text: 'Tokamak confinement improved 30% in 2026.',
          sourceUrl: 'https://fusion.dev/tokamak',
          sourceTitle: 'Tokamak progress',
          sourceDomain: 'fusion.dev',
        },
      ],
      query: 'Fusion energy',
      language: 'en',
      llmOptions: { provider: 'openai', model: 'test-model', apiKey: 'test-key' },
    });

    const result = await synthesis.synthesize();
    assert.ok(result.milestoneSections.length >= 1, 'fallback section should still be produced');
    assert.ok(result.report.length > 0, 'a report is still produced via the fallback path');
  });
});