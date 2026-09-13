import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeResearchRequest, createResearchAgent } from '../dist-electron/engine/server.js';
import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { WideResearchAgent } from '../dist-electron/engine/wideAgent.js';

describe('Explicit Wide Research server routing', () => {
  it('routes only explicit wide mode through the dedicated agent', () => {
    const request = normalizeResearchRequest({ query: 'Systematic evidence review', mode: 'wide' });
    assert.equal(request.mode, 'wide');
    assert.equal(request.maxSources, 200);
    assert.ok(createResearchAgent(request, 'wide-session', () => {}) instanceof WideResearchAgent);
  });

  it('keeps storm depth on the agency path; wide routing is unaffected by the closure', () => {
    const request = normalizeResearchRequest({ query: 'Fast deep report', report_type: 'storm' });
    assert.equal(request.mode, 'standard');
    // ADR-0010 closure (#104): storm depth is just another standard run —
    // it routes through the agency path like every standard request.
    assert.ok(createResearchAgent(request, 'storm-session', () => {}) instanceof ParentResearchAgent);
  });

  it('normalizes missing and invalid modes to standard', () => {
    assert.equal(normalizeResearchRequest({ query: 'Normal' }).mode, 'standard');
    assert.equal(normalizeResearchRequest({ query: 'Invalid', mode: 'anything' }).mode, 'standard');
  });
});
