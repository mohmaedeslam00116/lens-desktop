import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  StratifiedEvidenceAdmission,
  admitStratifiedEvidence,
  createBudgetExhaustedEvent
} from '../dist-electron/engine/admission.js';

describe('Stratified Evidence Admission & Milestone Quota Guarantees', () => {
  it('guarantees minimum quota K_min = 8 admitted chunks per milestone', () => {
    // Create 3 milestones, each with 15 candidate chunks of varying scores
    const milestones = [
      { id: 'm1', query: 'Quantum error correction surface codes', rationale: 'Core fault tolerance' },
      { id: 'm2', query: 'Superconducting transmon qubit coherence', rationale: 'Physical qubit specs' },
      { id: 'm3', query: 'Commercial quantum hardware roadmap 2026', rationale: 'Market trajectory' }
    ];

    const candidates = [];
    for (const m of milestones) {
      for (let i = 1; i <= 15; i++) {
        candidates.push({
          id: `${m.id}-chunk-${i}`,
          milestoneId: m.id,
          text: `Evidence snippet for ${m.query} with detail #${i}. Performance metric ${90 + i}%.`,
          sourceUrl: `https://${m.id}.example.com/page/${i}`,
          sourceDomain: `${m.id}.example.com`,
          score: 0.5 + (i * 0.02) // scores from 0.52 to 0.80
        });
      }
    }

    const admission = new StratifiedEvidenceAdmission({
      minQuotaPerMilestone: 8,
      maxTotalChunks: 40
    });

    const result = admission.admit(candidates, milestones, 'Quantum Computing Architecture');

    // 1. Total admitted chunks should not exceed maxTotalChunks
    assert.ok(result.admittedChunks.length <= 40);
    assert.equal(result.totalAdmitted, result.admittedChunks.length);

    // 2. Each milestone must receive at least 8 quota chunks
    const m1Quota = result.admittedChunks.filter(c => c.milestoneId === 'm1' && c.admittedReason === 'quota');
    const m2Quota = result.admittedChunks.filter(c => c.milestoneId === 'm2' && c.admittedReason === 'quota');
    const m3Quota = result.admittedChunks.filter(c => c.milestoneId === 'm3' && c.admittedReason === 'quota');

    assert.equal(m1Quota.length, 8, 'Milestone 1 must have exactly 8 quota chunks');
    assert.equal(m2Quota.length, 8, 'Milestone 2 must have exactly 8 quota chunks');
    assert.equal(m3Quota.length, 8, 'Milestone 3 must have exactly 8 quota chunks');

    // Total quota chunks = 24. Remaining 16 chunks should be admitted as residual
    const residualChunks = result.admittedChunks.filter(c => c.admittedReason === 'residual');
    assert.equal(residualChunks.length, 16, 'Remaining slots must be allocated to residual pool');
    assert.equal(result.admittedChunks.length, 40);

    // 3. Telemetry verification
    const stats1 = result.milestoneStats.get('m1');
    assert.ok(stats1);
    assert.equal(stats1.candidateCount, 15);
    assert.equal(stats1.admittedQuotaCount, 8);
    assert.equal(stats1.quotaSatisfied, true);
    assert.equal(stats1.underQuotaShortfall, 0);
  });

  it('handles under-quota milestones gracefully and returns spare slots to residual pool', () => {
    // M1 has only 3 candidates (under K_min=8)
    // M2 has 20 candidates
    // M3 has 20 candidates
    const milestones = [
      { id: 'm1', query: 'Rare quantum algorithmic limits', rationale: 'Sparse evidence' },
      { id: 'm2', query: 'Transmon hardware cryogenic systems', rationale: 'Abundant evidence' },
      { id: 'm3', query: 'Neutral atom quantum processors', rationale: 'Abundant evidence' }
    ];

    const candidates = [];
    // M1 has only 3 candidates
    for (let i = 1; i <= 3; i++) {
      candidates.push({
        id: `m1-${i}`,
        milestoneId: 'm1',
        text: `Sparse evidence for rare quantum algorithms #${i}`,
        sourceUrl: `https://rare.org/${i}`,
        sourceDomain: 'rare.org',
        score: 0.90 - i * 0.05
      });
    }
    // M2 has 20 candidates
    for (let i = 1; i <= 20; i++) {
      candidates.push({
        id: `m2-${i}`,
        milestoneId: 'm2',
        text: `Transmon hardware cryogenic specs #${i}`,
        sourceUrl: `https://hardware.com/${i}`,
        sourceDomain: 'hardware.com',
        score: 0.40 + i * 0.02
      });
    }
    // M3 has 20 candidates
    for (let i = 1; i <= 20; i++) {
      candidates.push({
        id: `m3-${i}`,
        milestoneId: 'm3',
        text: `Neutral atom processor benchmarks #${i}`,
        sourceUrl: `https://atoms.com/${i}`,
        sourceDomain: 'atoms.com',
        score: 0.35 + i * 0.02
      });
    }

    const result = admitStratifiedEvidence(candidates, milestones, 'Quantum Hardware', {
      minQuotaPerMilestone: 8,
      maxTotalChunks: 30
    });

    const m1Admitted = result.admittedChunks.filter(c => c.milestoneId === 'm1');
    assert.equal(m1Admitted.length, 3, 'All 3 available candidates for M1 must be admitted');
    assert.ok(m1Admitted.every(c => c.admittedReason === 'quota'));

    const stats1 = result.milestoneStats.get('m1');
    assert.equal(stats1.candidateCount, 3);
    assert.equal(stats1.admittedQuotaCount, 3);
    assert.equal(stats1.quotaSatisfied, true, 'Quota marked satisfied since all candidates admitted');
    assert.equal(stats1.underQuotaShortfall, 5, 'Shortfall should record 5 missing chunks');

    // Total quota admitted: 3 (m1) + 8 (m2) + 8 (m3) = 19.
    // Spare quota slots (5) return to residual: 30 - 19 = 11 residual slots.
    const residualChunks = result.admittedChunks.filter(c => c.admittedReason === 'residual');
    assert.equal(residualChunks.length, 11);
    assert.equal(result.admittedChunks.length, 30);
  });

  it('allocates residual capacity strictly by global hybrid relevance score', () => {
    const milestones = [{ id: 'm1', query: 'Q1' }, { id: 'm2', query: 'Q2' }];

    const candidates = [
      // M1 candidates
      { id: 'm1-1', milestoneId: 'm1', text: 'Text 1', sourceUrl: 'u1', score: 0.95 },
      { id: 'm1-2', milestoneId: 'm1', text: 'Text 2', sourceUrl: 'u2', score: 0.90 },
      { id: 'm1-3', milestoneId: 'm1', text: 'Text 3', sourceUrl: 'u3', score: 0.30 }, // low score residual candidate
      // M2 candidates
      { id: 'm2-1', milestoneId: 'm2', text: 'Text 4', sourceUrl: 'u4', score: 0.88 },
      { id: 'm2-2', milestoneId: 'm2', text: 'Text 5', sourceUrl: 'u5', score: 0.85 },
      { id: 'm2-3', milestoneId: 'm2', text: 'Text 6', sourceUrl: 'u6', score: 0.80 }  // high score residual candidate
    ];

    // minQuota = 2, maxTotal = 5 (Quota consumes 4, 1 residual slot remains)
    const result = admitStratifiedEvidence(candidates, milestones, 'Test', {
      minQuotaPerMilestone: 2,
      maxTotalChunks: 5
    });

    assert.equal(result.admittedChunks.length, 5);
    const residual = result.admittedChunks.find(c => c.admittedReason === 'residual');
    assert.ok(residual);
    // m2-3 has score 0.80, which is higher than m1-3's score of 0.30
    assert.equal(residual.id, 'm2-3', 'Highest scoring residual candidate must be selected');
    assert.equal(residual.score, 0.80);
  });

  it('proporationally bounds quota when milestones count * K_min exceeds maxTotalChunks', () => {
    // 10 milestones, maxTotalChunks = 30, requested K_min = 8
    // 10 * 8 = 80 > 30. Effective quota should be floor(30 / 10) = 3
    const milestones = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      query: `Subtopic query #${i}`
    }));

    const candidates = [];
    for (const m of milestones) {
      for (let j = 0; j < 5; j++) {
        candidates.push({
          id: `${m.id}-${j}`,
          milestoneId: m.id,
          text: `Text for ${m.id} sample ${j}`,
          sourceUrl: `https://ex.com/${m.id}/${j}`,
          score: 0.5 + j * 0.1
        });
      }
    }

    const result = admitStratifiedEvidence(candidates, milestones, 'Fairness Test', {
      minQuotaPerMilestone: 8,
      maxTotalChunks: 30
    });

    assert.equal(result.admittedChunks.length, 30);
    // Every single one of the 10 milestones must have received quota chunks without starvation
    for (const m of milestones) {
      const quotaChunks = result.admittedChunks.filter(c => c.milestoneId === m.id && c.admittedReason === 'quota');
      assert.ok(quotaChunks.length >= 3, `Milestone ${m.id} must receive at least effective quota of 3`);
    }
  });
});

describe('Evidence Coverage Auditing & Smart Early Exit', () => {
  it('triggers early exit when admitted evidence satisfies coverage threshold (>= 80%)', () => {
    const milestones = [
      { id: 'm1', query: 'deep neural network transformer architecture' },
      { id: 'm2', query: 'benchmark evaluation throughput latency accuracy' }
    ];

    // Rich evidence containing subqueries, quantitative metrics, aspects, and diverse domains
    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Deep neural network transformer architecture utilizes self-attention mechanics and multi-head pipelines. The framework achieves 99.2% accuracy.',
        sourceUrl: 'https://arxiv.org/abs/1',
        sourceDomain: 'arxiv.org',
        score: 0.95
      },
      {
        id: 'c2',
        milestoneId: 'm2',
        text: 'Empirical benchmark evaluation demonstrates 15000 tokens/sec throughput and 12 ms latency. Limitations include memory bandwidth risks and trade-offs.',
        sourceUrl: 'https://nature.com/articles/2',
        sourceDomain: 'nature.com',
        score: 0.94
      },
      {
        id: 'c3',
        milestoneId: 'm1',
        text: 'System engineering pipeline with 175B parameters cost $45M USD in cluster compute.',
        sourceUrl: 'https://ieee.org/paper/3',
        sourceDomain: 'ieee.org',
        score: 0.91
      },
      {
        id: 'c4',
        milestoneId: 'm2',
        text: 'Comparative performance evaluation shows 4.5x speedup across 8 GPUs.',
        sourceUrl: 'https://acm.org/proc/4',
        sourceDomain: 'acm.org',
        score: 0.89
      }
    ];

    const result = admitStratifiedEvidence(candidates, milestones, 'Transformer Architecture and Benchmarks', {
      minQuotaPerMilestone: 2,
      maxTotalChunks: 10,
      coverageThreshold: 0.80,
      currentHop: 0,
      maxHops: 2
    });

    assert.ok(result.coverageAudit.overallScore >= 0.80, `Score ${result.coverageAudit.overallScore} must be >= 0.80`);
    assert.equal(result.earlyExit, true, 'Early exit must be true when coverage >= 80%');
    assert.equal(result.shouldHop, false, 'Should not hop on early exit');
    assert.equal(result.budgetExhausted, false);
  });

  it('triggers adaptive multi-hop when coverage is below 80% and budget remains', () => {
    const milestones = [
      { id: 'm1', query: 'quantum transmon architecture' },
      { id: 'm2', query: 'cryptographic post-quantum lattice benchmarks' } // Intentionally uncovered
    ];

    // Minimal evidence covering only M1, missing metrics and benchmarks
    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Quantum transmon architecture overview and cryogenic mechanics.',
        sourceUrl: 'https://arxiv.org/abs/1',
        sourceDomain: 'arxiv.org',
        score: 0.85
      }
    ];

    const result = admitStratifiedEvidence(candidates, milestones, 'Quantum Technologies', {
      minQuotaPerMilestone: 2,
      maxTotalChunks: 10,
      coverageThreshold: 0.80,
      currentHop: 0,
      maxHops: 2,
      currentSourcesCount: 5,
      maxSourcesBudget: 50
    });

    assert.ok(result.coverageAudit.overallScore < 0.80);
    assert.equal(result.earlyExit, false);
    assert.equal(result.shouldHop, true, 'Must trigger adaptive hop when gaps remain and budget is available');
    assert.equal(result.budgetExhausted, false);
    assert.ok(result.hopPlan);
    assert.ok(result.hopPlan.targetQueries.length > 0);
  });
});

describe('Honest Budget Exhaustion & Research Extension Action Payload', () => {
  it('emits budget_exhausted when max hops limit is reached with remaining coverage gaps', () => {
    const milestones = [
      { id: 'm1', query: 'autonomous driving safety protocols' },
      { id: 'm2', query: 'regulatory compliance and liability frameworks' }
    ];

    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Autonomous driving safety protocols outline lidar redundancy.',
        sourceUrl: 'https://safety.org/1',
        sourceDomain: 'safety.org',
        score: 0.75
      }
    ];

    // currentHop = 2, maxHops = 2 => Hop limit reached!
    const result = admitStratifiedEvidence(candidates, milestones, 'Autonomous Driving Safety', {
      minQuotaPerMilestone: 4,
      maxTotalChunks: 20,
      coverageThreshold: 0.80,
      currentHop: 2,
      maxHops: 2,
      currentSourcesCount: 20,
      maxSourcesBudget: 100
    });

    assert.equal(result.earlyExit, false);
    assert.equal(result.shouldHop, false);
    assert.equal(result.budgetExhausted, true, 'Must flag budgetExhausted when hop limit reached with gaps');

    // Verify extension payload
    const payload = result.extensionPayload;
    assert.ok(payload, 'Extension payload must be present');
    assert.equal(payload.budgetExhausted, true);
    assert.equal(payload.suggestedAdditionalSources, 20);
    assert.equal(payload.suggestedAdditionalHops, 1);
    assert.equal(payload.actionText.en, 'Extend Research');
    assert.equal(payload.actionText.ar, 'توسيع نطاق البحث');

    // Verify LiveEvent serialization
    const event = createBudgetExhaustedEvent(result, 'session-test-123');
    assert.equal(event.type, 'session_state');
    assert.equal(event.state, 'budget_exhausted');
    assert.equal(event.sessionId, 'session-test-123');
    assert.ok(event.coverage);
    assert.equal(event.coverage.overallScore, result.coverageAudit.overallScore);
  });

  it('emits budget_exhausted when source collection budget is reached with gaps', () => {
    const milestones = [{ id: 'm1', query: 'fusion energy reactor materials' }];
    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Fusion reactor containment magnetic coils.',
        sourceUrl: 'https://iter.org/1',
        sourceDomain: 'iter.org',
        score: 0.70
      }
    ];

    // currentSourcesCount = 50, maxSourcesBudget = 50 => Source limit reached!
    const result = admitStratifiedEvidence(candidates, milestones, 'Fusion Energy', {
      coverageThreshold: 0.80,
      currentHop: 0,
      maxHops: 2,
      currentSourcesCount: 50,
      maxSourcesBudget: 50
    });

    assert.equal(result.budgetExhausted, true);
    assert.equal(result.shouldHop, false);
    assert.ok(result.extensionPayload);
  });

  it('provides bilingual Arabic parity in recommendations and gap descriptions', () => {
    const milestones = [
      { id: 'm1', query: 'معمارية الحوسبة السحابية الموزعة' },
      { id: 'm2', query: 'معايير الأداء والنتائج القياسية' }
    ];

    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'معمارية الحوسبة السحابية وهندسة الخوادم الموزعة.',
        sourceUrl: 'https://arabic-tech.com/1',
        sourceDomain: 'arabic-tech.com',
        score: 0.70
      }
    ];

    const result = admitStratifiedEvidence(candidates, milestones, 'الحوسبة السحابية', {
      language: 'ar',
      coverageThreshold: 0.80,
      currentHop: 1,
      maxHops: 1 // Exhausted
    });

    assert.equal(result.budgetExhausted, true);
    assert.match(result.extensionPayload.reason, /[\u0600-\u06FF]/, 'Reason must be in Arabic');
    assert.equal(result.extensionPayload.actionText.ar, 'توسيع نطاق البحث');
  });

  it('respects runtime depth option when evaluating adaptive multi-hop', () => {
    const milestones = [{ id: 'm1', query: 'quantum computing algorithms' }];
    const candidates = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Basic quantum computing concepts.',
        sourceUrl: 'https://ex.com/1',
        score: 0.5
      }
    ];

    // depth: 'quick' enforces single-pass retrieval (zero hops)
    const result = admitStratifiedEvidence(candidates, milestones, 'Quantum Computing', {
      depth: 'quick',
      coverageThreshold: 0.80,
      currentHop: 0,
      maxHops: 2
    });

    assert.equal(result.shouldHop, false, 'Quick depth mode must enforce single-pass retrieval without multi-hop');
    assert.ok(result.hopPlan);
    assert.equal(result.hopPlan.shouldHop, false);
  });
});
