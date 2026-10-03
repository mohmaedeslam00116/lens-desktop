import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Track G — evidence honesty (SPEC #155, #162).
 *
 * Zero-evidence and unresolved-conflict runs surface unsupported/uncertain
 * instead of dossiers. Regression proof: a no-evidence run cannot emit an
 * authoritative report (abstain/uncertain surfacing + zero citation
 * brackets) on all three paths — standard loop, HierarchicalSynthesis, and
 * wide mode — and the auditor marks unresolved conflicts.
 *
 * Offline: stubbed fetch (empty or routed fixtures) + the pi faux provider.
 * No live network, no operator keys.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const readSrc = async (rel) =>
  readFileSync(join(process.cwd(), 'electron', 'engine', rel), 'utf8');

const { buildAbstentionReport, ABSTAIN_MARKER } = await importEngine('abstention.js');
const { HierarchicalSynthesis } = await importEngine('synthesis.js');
const { DeepResearchAgent } = await importEngine('agent.js');
const { WideResearchAgent } = await importEngine('wideAgent.js');
const { auditEvidenceClaims } = await importEngine('evidenceAuditor.js');
const { setActiveCore, resetActiveCore } = await importEngine('modelGateway.js');

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;
function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const CITATION_BRACKETS = /\[\d+\]/;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveCore();
});

describe('Track G — abstention report builder (bilingual, machine-marked)', () => {
  it('a no-evidence EN report abstains with the marker, the query, and zero citation brackets', async () => {
    const report = buildAbstentionReport({ query: 'tokamak records 2026', language: 'en', reason: 'no-evidence' });
    assert.match(report, /tokamak records 2026/);
    assert.ok(report.includes(ABSTAIN_MARKER), 'machine-readable abstention marker');
    assert.match(report, /no evidence|unsupported|uncertain/i, 'unsupported/uncertain surfacing, not a dossier');
    assert.doesNotMatch(report, CITATION_BRACKETS, 'abstention cites nothing');
  });

  it('a no-evidence AR report abstains the same way', async () => {
    const report = buildAbstentionReport({ query: 'أرقام التوكاماك', language: 'ar', reason: 'no-evidence' });
    assert.match(report, /أرقام التوكاماك/);
    assert.ok(report.includes(ABSTAIN_MARKER));
    assert.doesNotMatch(report, CITATION_BRACKETS, 'abstention cites nothing');
  });
});

describe('Track G — fabrication surface is deleted', () => {
  it('the empty-evidence prompt substitution and the fallback generators are gone', async () => {
    const agentSrc = await readSrc('agent.ts');
    assert.doesNotMatch(agentSrc, /verified knowledge/, 'no synthesize-from-nothing instruction survives');
    assert.doesNotMatch(agentSrc, /No external evidence retrieved\. Synthesize/, 'no empty-evidence dossier prompt survives');
    const synthesisSrc = await readSrc('synthesis.ts');
    assert.doesNotMatch(synthesisSrc, /generateFallbackMilestoneSection/, 'fabricating milestone fallback is deleted');
    assert.doesNotMatch(synthesisSrc, /generateFallbackMetaPass/, 'fabricating meta fallback is deleted');
    assert.doesNotMatch(synthesisSrc, /substantial advancements/, 'authoritative-from-nothing prose is deleted');
    assert.doesNotMatch(synthesisSrc, /High-confidence verification/, 'false confidence prose is deleted');
    assert.doesNotMatch(synthesisSrc, /Production Benchmarks Met/, 'invented matrix metrics are deleted');
    assert.match(agentSrc, /buildAbstentionReport/, 'the standard loop owns an abstain branch');
    assert.match(synthesisSrc, /buildAbstentionReport/, 'hierarchical synthesis owns an abstain branch');
    const wideSrc = await readSrc('wideAgent.ts');
    assert.match(wideSrc, /buildAbstentionReport/, 'wide mode owns an abstain branch');
  });
});

describe('Track G — HierarchicalSynthesis abstains without evidence', () => {
  const plan = {
    id: 'plan-g', version: 1, objective: 'tokamak records 2026',
    milestones: [{ id: 'm-1', query: 'tokamak records', rationale: 'records' }],
    suggestedSkills: [],
  };

  it('zero excerpts yield an abstention, not a dossier (no generator, no LLM, no network)', async () => {
    const synthesis = new HierarchicalSynthesis({ plan, evidence: [], query: 'tokamak records 2026', language: 'en' });
    const result = await synthesis.synthesize();
    assert.ok(result.report.includes(ABSTAIN_MARKER), 'the dossier is replaced by abstention');
    assert.doesNotMatch(result.report, CITATION_BRACKETS, 'abstention cites nothing');
    assert.deepEqual(result.references, [], 'no references without evidence');
    assert.equal(result.totalAdmittedSources, 0);
  });

  it('a dead generator yields uncertain sections with verbatim excerpts, never authoritative claims', async () => {
    const evidence = [
      {
        id: 'c1', text: 'The tokamak sustained plasma for 400 seconds in trial runs.', url: 'https://a.example/1',
        title: 'Trial report', domain: 'a.example', score: 0.9,
      },
      {
        id: 'c2', text: 'Follow-up runs confirmed confinement above 300 seconds.', url: 'https://b.example/2',
        title: 'Follow-up', domain: 'b.example', score: 0.8,
      },
    ];
    const synthesis = new HierarchicalSynthesis({
      plan, evidence, query: 'tokamak records 2026', language: 'en',
      generator: async () => { throw new Error('synthesis transport down'); },
    });
    const result = await synthesis.synthesize();
    assert.doesNotMatch(result.report, /substantial advancements|High-confidence verification|Production Benchmarks Met/);
    assert.match(result.report, /400 seconds/, 'admitted excerpts still surface verbatim');
    assert.match(result.report, /\[1\]/, 'real citations survive (registered excerpts)');
    assert.match(result.report, /uncertain|unavailable|unable/i, 'the failure is labeled uncertain, not authoritative');
  });
});

describe('Track G — standard loop abstains on zero evidence (offline)', () => {
  it('a no-evidence run cannot emit an authoritative report', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    // Plan-less runs make one subqueries LLM call first; synthesis must
    // NEVER be reached (abstain precedes it), so only one response queues.
    faux.setResponses([ai.fauxAssistantMessage('["tokamak records", "tokamak confinement"]')]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new DeepResearchAgent('s-trackg-abstain', (e) => emitted.push(e));
    await agent.run({
      query: 'tokamak records 2026', report_type: 'quick', language: 'en', llm_provider: 'openai',
      model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
      embedding_enabled: false, plan: undefined, tool_packages: false,
    });

    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'the run still terminates explicitly');
    assert.deepEqual(finished.sources ?? [], [], 'no sources admitted');
    assert.ok(String(finished.report).includes(ABSTAIN_MARKER), 'the report is an abstention');
    assert.doesNotMatch(String(finished.report), CITATION_BRACKETS, 'abstention cites nothing');
    const chunks = emitted.filter((e) => e.type === 'report_chunk').map((e) => e.chunk).join('');
    assert.equal(chunks, finished.report, 'streamed vs final equality holds for abstentions too');
  });
});

describe('Track G — wide mode abstains on zero evidence (offline, no synthesis call)', () => {
  const approvedPlan = {
    id: 'wide-plan-g', version: 1, objective: 'tokamak records 2026',
    milestones: [{ id: 'm-1', query: 'tokamak records', rationale: 'records', status: 'pending' }],
    suggestedSkills: [],
    estimatedScope: { targetSources: 100, maxHops: 2 },
    status: 'approved',
  };

  it('zero pages finish as abstention without invoking synthesis', async () => {
    let synthesized = false;
    const events = [];
    const agent = new WideResearchAgent('wide-trackg-abstain', (e) => events.push(e), {
      search: async () => [],
      createPool: () => ({
        scrapeAll: async () => [],
        getDeduplicationStats: () => ({ urlDuplicates: 0, exactContentDuplicates: 0, nearDuplicates: 0, admitted: 0 }),
      }),
      synthesize: async () => {
        synthesized = true;
        throw new Error('must not be called without evidence');
      },
    });
    const result = await agent.run({ query: 'tokamak records 2026', mode: 'wide', language: 'en', plan: approvedPlan });
    assert.equal(synthesized, false, 'synthesis never runs without evidence');
    assert.ok(String(result.report).includes(ABSTAIN_MARKER), 'wide finishes as abstention');
    assert.doesNotMatch(String(result.report), CITATION_BRACKETS, 'abstention cites nothing');
    assert.deepEqual(result.sources, [], 'no sources admitted');
    const finished = events.find((e) => e.type === 'finished');
    assert.ok(finished, 'the wide run still terminates explicitly');
  });
});

describe('Track G — auditor marks unresolved conflicts', () => {
  const conflictingSources = [
    {
      content: 'Independent lab measurements put tokamak accuracy at 95% on the benchmark suite.',
      url: 'https://lab-a.example/r',
    },
    {
      content: 'A second laboratory reports tokamak accuracy at only 60% on the same benchmark suite.',
      url: 'https://lab-b.example/r',
    },
  ];
  const conflictingReport = 'Tokamak accuracy is strong. Lab measurements put tokamak accuracy at 95% on the benchmark suite. A second laboratory reports tokamak accuracy at only 60% on the same benchmark suite.';

  it('flags evidence conflicts the report never calls out', async () => {
    const { detectMetricContradictions } = await importEngine('synthesis.js');
    const contradictions = detectMetricContradictions([
      { index: 1, text: conflictingSources[0].content, sourceDomain: 'lab-a.example' },
      { index: 2, text: conflictingSources[1].content, sourceDomain: 'lab-b.example' },
    ]);
    assert.ok(contradictions.length >= 1, 'the evidence pair genuinely conflicts');
    const audit = auditEvidenceClaims(conflictingReport, conflictingSources, {
      language: 'en',
      contradictions,
    });
    assert.ok((audit.unresolvedConflicts ?? []).length >= 1, 'unmarked conflicts surface as unresolved');
    assert.match(audit.unresolvedConflicts[0].topicOrMetric, /accuracy/i);
  });

  it('clears conflicts the report explicitly calls out', async () => {
    const { detectMetricContradictions } = await importEngine('synthesis.js');
    const contradictions = detectMetricContradictions([
      { index: 1, text: conflictingSources[0].content, sourceDomain: 'lab-a.example' },
      { index: 2, text: conflictingSources[1].content, sourceDomain: 'lab-b.example' },
    ]);
    const calledOut =
      conflictingReport +
      '\n> [!WARNING]\n> **Contradiction Callout: Empirical Discrepancy in Accuracy**\n> - Source [1] (`lab-a.example`): 95%\n> - Source [2] (`lab-b.example`): 60%\n> *Discrepancy Analysis*: distinct testing regimes.';
    const audit = auditEvidenceClaims(calledOut, conflictingSources, { language: 'en', contradictions });
    assert.deepEqual(audit.unresolvedConflicts ?? [], [], 'called-out conflicts resolve');
  });
});
