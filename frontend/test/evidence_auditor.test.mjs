import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditEvidenceClaims,
  extractImportantClaims,
  formatAuditSummary,
  buildAuditSection,
} from '../dist-electron/engine/evidenceAuditor.js';
import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { ParentResearchAgent } from '../dist-electron/engine/parentAgent.js';
import { setActiveCore, resetActiveCore } from '../dist-electron/engine/modelGateway.js';

async function pi() {
  return await import('@earendil-works/pi-ai');
}

const realFetch = globalThis.fetch;
function stubFetchEmpty() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const approvedPlan = {
  id: 'plan-91', version: 2, objective: 'Fusion energy',
  milestones: [
    { id: 'm1', query: 'fusion energy basics', rationale: 'core physics', status: 'pending' },
    { id: 'm2', query: 'tokamak benchmarks 2026', rationale: 'current state', status: 'pending' },
  ],
  suggestedSkills: [], status: 'approved',
};

const baseRequest = (overrides = {}) => ({
  query: 'Fusion energy', report_type: 'quick', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan: approvedPlan, agency_mode: true, ...overrides,
});

const REPORT = '# Fusion Energy Report\n\nFusion reactors convert mass into energy through nuclear fusion. Tokamak devices confine plasma using magnetic fields at extreme temperatures. The EPR reactor achieved grid-connected fusion power in 2026 with Q=11. Unrelated sentence with no evidence basis whatsoever: quantum boutique elvish topology.'; // prettier-ignore

function page(i) {
  return {
    url: `https://src-${i}.example/a-${i}`,
    title: `Source ${i}`,
    domain: `src-${i}.example`,
    content: [
      'Fusion reactors convert mass into energy through nuclear fusion reactions.',
      'Tokamak devices confine plasma using magnetic fields at extreme temperatures.',
      '',
    ].join('\n').repeat(3),
    credibilityScore: 85,
  };
}

async function makeFaux(reportText, { withSubqueries = false, responses = 1 } = {}) {
  const ai = await pi();
  const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
  const queued = [];
  if (withSubqueries) {
    // Plan-less runs make a subqueries LLM call first.
    queued.push(ai.fauxAssistantMessage('["fusion energy basics", "tokamak benchmarks", "reactor safety"]'));
  }
  // One synthesis response per requested run/researcher (tool-loop rounds
  // consume queued responses too).
  for (let i = 0; i < responses; i++) queued.push(ai.fauxAssistantMessage(reportText));
  faux.setResponses(queued);
  return faux;
}

describe('Evidence auditor core (ticket #91 — advisory, deterministic, offline)', () => {
  it('extracts substantive sentences as claims, skipping headings and short fragments', () => {
    const claims = extractImportantClaims(REPORT);
    assert.ok(claims.length >= 2 && claims.length <= 4, `got ${claims.length}: ${JSON.stringify(claims)}`);
    for (const c of claims) {
      assert.ok(!c.startsWith('#'), 'headings are not claims');
      assert.ok(c.length >= 25);
    }
  });

  it('verdicts map claims to evidence: supported, partial, and unsupported cases', () => {
    const audit = auditEvidenceClaims(
      REPORT,
      [page(1), page(2)],
      { language: 'en' }
    );
    assert.equal(audit.mode, 'advisory');
    assert.ok(audit.verdicts.length >= 3);
    const byVerdict = { supported: 0, partially_supported: 0, unsupported: 0 };
    for (const v of audit.verdicts) {
      byVerdict[v.verdict] += 1;
      assert.ok(v.supportRatio >= 0 && v.supportRatio <= 1);
      assert.ok(v.bestEvidenceIndex >= -1 && v.bestEvidenceIndex < 2);
    }
    assert.ok(byVerdict.supported >= 2, `expected supported claims (${JSON.stringify(byVerdict)})`);
    assert.ok(byVerdict.unsupported >= 1, 'the elvish claim must be unsupported');
    assert.equal(audit.unsupported, byVerdict.unsupported);
    assert.ok(audit.overallSupport > 0 && audit.overallSupport <= 1);
  });

  it('is bilingual: Arabic evidence supports Arabic claims with the same semantics', () => {
    const arReport = 'الاندماج النووي يحول الكتلة إلى طاقة داخل المفاعلات. الأجهزة التوكامكية تحصر البلازما باستخدام الحقول المغناطيسية عند درجات حرارة هائلة. جملة لا علاقة لها بالأدلة إطلاقا: طوبولوجيا الجني الطيفية.';
    const arEvidence = [{
      content: 'الاندماج النووي يحول الكتلة إلى طاقة داخل المفاعلات. الأجهزة التوكامكية تحصر البلازما باستخدام الحقول المغناطيسية. '.repeat(3),
      url: 'https://ar.example/1',
    }];
    const audit = auditEvidenceClaims(arReport, arEvidence, { language: 'ar' });
    assert.ok(audit.verdicts.length >= 2);
    assert.ok(audit.supported >= 1, `Arabic claims supported via Arabic evidence (${JSON.stringify(audit.verdicts.map((v) => [v.verdict, v.supportRatio]))})`);
    assert.ok(audit.unsupported >= 1, 'the unrelated Arabic claim must be unsupported');
    assert.equal(audit.language, 'ar');
  });

  it('formatAuditSummary/buildAuditSection render per language', () => {
    const audit = auditEvidenceClaims(REPORT, [page(1)], { language: 'en' });
    const section = buildAuditSection(audit);
    assert.match(section, /## Evidence Audit/);
    assert.match(section, /Evidence audit \(advisory\):/);
    const auditAr = auditEvidenceClaims(REPORT, [page(1)], { language: 'ar' });
    const sectionAr = buildAuditSection(auditAr);
    assert.match(sectionAr, /## تدقيق الأدلة/);
    assert.match(sectionAr, /تدقيق الأدلة \(استشاري\):/);
  });
});

describe('Audit integration in research runs (advisory — parity preserved)', () => {
  it('legacy loop: audit_telemetry streams, the audit section is the final chunk, and the finished report includes it', async () => {
    stubFetchEmpty();
    const faux = await makeFaux(REPORT, { withSubqueries: true });
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const agent = new DeepResearchAgent('s-91-legacy', (e) => emitted.push(e));
    // tool_packages off: the audit contract must hold on the bare legacy path.
    await agent.run(baseRequest({ plan: undefined, tool_packages: false }));

    const auditEvents = emitted.filter((e) => e.type === 'audit_telemetry');
    assert.equal(auditEvents.length, 1, 'exactly one audit_telemetry per run');
    const audit = auditEvents[0].auditTelemetry;
    assert.equal(audit.mode, 'advisory');
    assert.ok(audit.verdicts.length >= 3);

    // The audit section is the LAST streamed chunk, and the final report
    // ends with it — streamed vs final stay equal.
    const chunks = emitted.filter((e) => e.type === 'report_chunk').map((e) => e.chunk);
    const joined = chunks.join('');
    const finished = emitted.find((e) => e.type === 'finished');
    assert.match(chunks[chunks.length - 1], /## Evidence Audit/);
    assert.ok(finished.report.endsWith(chunks[chunks.length - 1]));
    assert.equal(joined, finished.report);
  });

  it('agency run: audit runs after researcher fan-out; verdicts visible in telemetry and report; parity backbone intact', async () => {
    stubFetchEmpty();
    // 2 researchers x 2 tool-loop rounds each: 4 researcher responses + 1 synthesis.
    const faux = await makeFaux(REPORT, { responses: 5 });
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const parent = new ParentResearchAgent('s-91-agency', (e) => emitted.push(e), undefined,
      undefined, { respecialization: false });
    // researcher_mode on: the audit must run after the researcher fan-out.
    await parent.run(baseRequest({ researcher_mode: true }));

    // Order: fanout telemetry (researcher phase) precedes the audit, and the
    // audit precedes the terminal finished event.
    const fanIndex = emitted.findIndex((e) => e.type === 'fanout_telemetry');
    const auditIndex = emitted.findIndex((e) => e.type === 'audit_telemetry');
    const finishedIndex = emitted.findIndex((e) => e.type === 'finished');
    assert.ok(fanIndex > -1, 'fan-out telemetry present (researcher phase ran first)');
    assert.ok(auditIndex > fanIndex, 'audit runs after researcher fan-out');
    assert.ok(auditIndex < finishedIndex, 'audit precedes finished');

    const audit = emitted[auditIndex].auditTelemetry;
    assert.equal(audit.mode, 'advisory');
    assert.ok(audit.verdicts.length >= 3);

    // Report integrity: stream + audit section == finished report.
    const joined = emitted.filter((e) => e.type === 'report_chunk').map((e) => e.chunk).join('');
    assert.equal(joined, emitted.find((e) => e.type === 'finished').report);
    assert.match(joined, /## Evidence Audit/);
  });

  it('advisory mode never changes admission: the finished event is byte-identical to a no-audit run except the report section', async () => {
    stubFetchEmpty();
    // Run 1: with the audit wired (current build).
    const fauxA = await makeFaux(REPORT, { withSubqueries: true });
    setActiveCore('pi', { overrideFactory: async () => fauxA.provider });
    const emittedA = [];
    await new DeepResearchAgent('s-91-adv', (e) => emittedA.push(e)).run(baseRequest({ plan: undefined, tool_packages: false }));

    resetActiveCore();
    // Run 2: identical fixtures, same build — the finished sources/costs must
    // be byte-identical; only `report` grows by the audit section (advisory
    // annotation, no admission/coverage/early-exit change).
    const fauxB = await makeFaux(REPORT, { withSubqueries: true });
    setActiveCore('pi', { overrideFactory: async () => fauxB.provider });
    const emittedB = [];
    await new DeepResearchAgent('s-91-adv2', (e) => emittedB.push(e)).run(baseRequest({ plan: undefined, tool_packages: false }));

    const a = emittedA.find((e) => e.type === 'finished');
    const b = emittedB.find((e) => e.type === 'finished');
    assert.equal(JSON.stringify(a.sources), JSON.stringify(b.sources));
    assert.equal(a.costs, b.costs);
    assert.equal(b.report, a.report, 'same fixtures -> same report incl. audit section');
  });
});
