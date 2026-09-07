import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditEvidenceCoverage,
  generateAdaptiveHopPlan
} from '../dist-electron/engine/evidenceCoverage.js';

describe('Evidence Coverage Audit Core', () => {
  it('handles empty sources gracefully with zero coverage and actionable recommendation', () => {
    const audit = auditEvidenceCoverage('Quantum Computing', ['qubit architectures', 'error mitigation'], []);

    assert.equal(audit.overallScore, 0);
    assert.equal(audit.subqueryScore, 0);
    assert.equal(audit.metricScore, 0);
    assert.equal(audit.diversityScore, 0);
    assert.equal(audit.uncoveredSubqueries.length, 2);
    assert.equal(audit.uniqueDomains.length, 0);
    assert.ok(audit.missingAspects.includes('architecture'));
    assert.ok(audit.missingAspects.includes('benchmarks'));
    assert.ok(audit.missingAspects.includes('risks'));
  });

  it('calculates subquery topic coverage and identifies uncovered facet gaps', () => {
    const subqueries = [
      'fault tolerant quantum computing architectures',
      'superconducting transmon qubit coherence times',
      'macroeconomic inflation in emerging markets' // Intentionally absent
    ];

    const sources = [
      {
        content: 'Fault-tolerant quantum computing architectures utilize surface codes to detect phase flips. Superconducting transmon qubit systems demonstrate coherence times exceeding 100 microseconds in 2025 benchmarks with 99.8% fidelity.',
        domain: 'arxiv.org'
      },
      {
        content: 'Analysis of transmon qubit hardware, cryogenic dilution refrigerators, and quantum gates performance.',
        domain: 'nature.com'
      }
    ];

    const audit = auditEvidenceCoverage('Quantum Computing', subqueries, sources);

    assert.ok(audit.subqueryFacets.length === 3);

    // Subquery 1 & 2 should be covered
    assert.ok(audit.subqueryFacets[0].isCovered, 'Subquery 1 should be covered');
    assert.ok(audit.subqueryFacets[1].isCovered, 'Subquery 2 should be covered');

    // Subquery 3 should be uncovered
    assert.ok(!audit.subqueryFacets[2].isCovered, 'Subquery 3 must be flagged uncovered');
    assert.ok(audit.uncoveredSubqueries.includes('macroeconomic inflation in emerging markets'));
  });

  it('detects quantitative empirical metrics across percentages, benchmarks, and units', () => {
    const sources = [
      {
        content: 'In 2025 experiments, model accuracy reached 94.2% while latency dropped to 12 ms across 15000 tokens/sec. The initial investment was $45M.',
        domain: 'techreview.com'
      }
    ];

    const audit = auditEvidenceCoverage('AI Benchmarks', ['latency and throughput'], sources);
    assert.ok(audit.metricMatchesCount >= 4, 'Should detect at least 4 quantitative metrics');
    assert.ok(audit.metricScore > 0.4);
  });

  it('audits perspective aspect breadth (architecture, benchmarks, risks)', () => {
    // Only architecture and benchmarks, no risks
    const sources = [
      {
        content: 'The system architecture uses a decentralized pipeline. Empirical benchmark results show high throughput and 99% accuracy in evaluation tests.',
        domain: 'systems.org'
      }
    ];

    const audit = auditEvidenceCoverage('Distributed Systems', ['pipeline architecture'], sources);
    assert.equal(audit.aspectsDetected.architecture, true);
    assert.equal(audit.aspectsDetected.benchmarks, true);
    assert.equal(audit.aspectsDetected.risks, false);
    assert.ok(audit.missingAspects.includes('risks'));
  });

  it('evaluates domain diversity across multiple distinct sources', () => {
    const sources = [
      { content: 'Quantum algorithms review', domain: 'arxiv.org' },
      { content: 'Superconducting circuits study', domain: 'nature.com' },
      { content: 'Hardware cryogenic testing', domain: 'ibm.com' },
      { content: 'Benchmark results 2025', domain: 'mit.edu' }
    ];

    const audit = auditEvidenceCoverage('Quantum Tech', ['quantum algorithms'], sources);
    assert.equal(audit.uniqueDomains.length, 4);
    assert.equal(audit.diversityScore, 1.0);
  });

  it('supports Arabic morphological stemming in subquery coverage evaluation', () => {
    const subqueries = ['الحوسبة الكمومية وخوارزميات التشفير'];
    const sources = [
      {
        content: 'تعتمد حوسبة كمومية حديثة على خوارزميات تشفير ما بعد الكوانتم لحماية البيانات.',
        domain: 'aljazeera.net'
      }
    ];

    const audit = auditEvidenceCoverage('الحوسبة الكمومية', subqueries, sources);
    assert.ok(audit.subqueryFacets[0].isCovered, 'Arabic stemmed tokens should match and cover subquery');
    assert.equal(audit.uncoveredSubqueries.length, 0);
  });
});

describe('Adaptive Multi-Hop Retrieval Triggering & Guardrails', () => {
  it('enforces single-pass retrieval (zero multi-hop) in quick mode', () => {
    const lowCoverageAudit = {
      overallScore: 0.35,
      subqueryScore: 0.30,
      aspectScore: 0.33,
      metricScore: 0.20,
      diversityScore: 0.25,
      subqueryFacets: [],
      uncoveredSubqueries: ['quantum error correction'],
      metricMatchesCount: 1,
      uniqueDomains: ['blog.com'],
      aspectsDetected: { architecture: true, benchmarks: false, risks: false },
      missingAspects: ['benchmarks', 'risks'],
      recommendation: 'Low coverage'
    };

    const plan = generateAdaptiveHopPlan(lowCoverageAudit, 'Quantum Computing', {
      depth: 'quick',
      currentHop: 0
    });

    assert.equal(plan.shouldHop, false, 'Quick mode must never trigger additional hops');
    assert.equal(plan.targetQueries.length, 0);
  });

  it('executes early exit when evidence coverage satisfies threshold', () => {
    const highCoverageAudit = {
      overallScore: 0.85,
      subqueryScore: 0.90,
      aspectScore: 1.0,
      metricScore: 0.80,
      diversityScore: 1.0,
      subqueryFacets: [],
      uncoveredSubqueries: [],
      metricMatchesCount: 10,
      uniqueDomains: ['arxiv.org', 'nature.com', 'ieee.org', 'mit.edu'],
      aspectsDetected: { architecture: true, benchmarks: true, risks: true },
      missingAspects: [],
      recommendation: 'Coverage optimal'
    };

    const plan = generateAdaptiveHopPlan(highCoverageAudit, 'Quantum Computing', {
      depth: 'deep',
      currentHop: 0,
      threshold: 0.70
    });

    assert.equal(plan.shouldHop, false, 'Should early exit when coverage >= threshold');
    assert.match(plan.reason, /Early exit/i);
    assert.equal(plan.targetQueries.length, 0);
  });

  it('triggers targeted adaptive hop when coverage is below threshold in deep mode', () => {
    const gapAudit = {
      overallScore: 0.52,
      subqueryScore: 0.40,
      aspectScore: 0.66,
      metricScore: 0.20,
      diversityScore: 0.50,
      subqueryFacets: [],
      uncoveredSubqueries: ['transmon qubit coherence limits'],
      metricMatchesCount: 1,
      uniqueDomains: ['arxiv.org', 'medium.com'],
      aspectsDetected: { architecture: true, benchmarks: false, risks: true },
      missingAspects: ['benchmarks'],
      recommendation: 'Deficit detected'
    };

    const plan = generateAdaptiveHopPlan(gapAudit, 'Quantum Computing', {
      depth: 'deep',
      currentHop: 0,
      threshold: 0.70
    });

    assert.equal(plan.shouldHop, true, 'Must trigger hop when coverage < threshold');
    assert.ok(plan.targetQueries.length >= 1 && plan.targetQueries.length <= 2);
    // Should target uncovered subquery
    assert.ok(plan.targetQueries[0].includes('transmon qubit coherence limits'));
  });

  it('respects maximum hop caps and source budget limits', () => {
    const gapAudit = {
      overallScore: 0.45,
      subqueryScore: 0.40,
      aspectScore: 0.33,
      metricScore: 0.20,
      diversityScore: 0.25,
      subqueryFacets: [],
      uncoveredSubqueries: ['fault tolerance'],
      metricMatchesCount: 0,
      uniqueDomains: ['a.com'],
      aspectsDetected: { architecture: false, benchmarks: false, risks: false },
      missingAspects: ['architecture', 'benchmarks', 'risks'],
      recommendation: 'Gaps'
    };

    // Case 1: Hop limit reached
    const hopLimited = generateAdaptiveHopPlan(gapAudit, 'Quantum Computing', {
      depth: 'deep',
      currentHop: 1 // maxHops for deep is 1
    });
    assert.equal(hopLimited.shouldHop, false, 'Should not hop when currentHop >= maxHops');

    // Case 2: Source budget filled
    const sourceLimited = generateAdaptiveHopPlan(gapAudit, 'Quantum Computing', {
      depth: 'deep',
      currentHop: 0,
      currentSourcesCount: 10,
      maxSources: 8
    });
    assert.equal(sourceLimited.shouldHop, false, 'Should not hop when source budget is exhausted');
  });

  it('generates Arabic targeted gap queries cleanly', () => {
    const gapAudit = {
      overallScore: 0.48,
      subqueryScore: 0.30,
      aspectScore: 0.33,
      metricScore: 0.10,
      diversityScore: 0.25,
      subqueryFacets: [],
      uncoveredSubqueries: ['تصحيح الخطأ الكمومي في الكيوبتات'],
      metricMatchesCount: 0,
      uniqueDomains: ['news.com'],
      aspectsDetected: { architecture: true, benchmarks: false, risks: false },
      missingAspects: ['benchmarks', 'risks'],
      recommendation: 'Gaps'
    };

    const plan = generateAdaptiveHopPlan(gapAudit, 'الحوسبة الكمومية', {
      depth: 'deep',
      currentHop: 0,
      language: 'ar'
    });

    assert.equal(plan.shouldHop, true);
    assert.ok(plan.targetQueries.length > 0);
    assert.match(plan.targetQueries[0], /[\u0600-\u06FF]/, 'Target query must be in Arabic');
    assert.ok(plan.targetQueries[0].includes('تصحيح الخطأ الكمومي'));
  });
});
