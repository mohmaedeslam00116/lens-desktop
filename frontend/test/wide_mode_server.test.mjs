import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeResearchRequest, createResearchAgent } from '../dist-electron/engine/server.js';
import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { WideResearchAgent } from '../dist-electron/engine/wideAgent.js';

describe('Explicit Wide Research server routing', () => {
  it('routes only explicit wide mode through the dedicated agent', () => {
    const request = normalizeResearchRequest({ query: 'Systematic evidence review', mode: 'wide' });
    assert.equal(request.mode, 'wide');
    assert.equal(request.maxSources, 200);
    assert.ok(createResearchAgent(request, 'wide-session', () => {}) instanceof WideResearchAgent);
  });

  it('keeps legacy storm depth on the standard direct agent path (legacy_mode escape hatch)', () => {
    const request = normalizeResearchRequest({ query: 'Fast deep report', report_type: 'storm' });
    assert.equal(request.mode, 'standard');
    // ADR-0012 default flip: the standard loop routes to the agency path by
    // default; the legacy single-loop needs the explicit escape flag.
    const legacyRequest = { ...request, legacy_mode: true };
    assert.ok(
      createResearchAgent(legacyRequest, 'storm-session', () => {}) instanceof DeepResearchAgent
    );
  });

  it('normalizes missing and invalid modes to standard', () => {
    assert.equal(normalizeResearchRequest({ query: 'Normal' }).mode, 'standard');
    assert.equal(normalizeResearchRequest({ query: 'Invalid', mode: 'anything' }).mode, 'standard');
  });
});
