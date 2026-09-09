import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CitationGroundingContract,
  HierarchicalSynthesis,
  synthesizeHierarchical,
  formatContradictionCallout,
  extractContradictionCallouts,
  detectMetricContradictions
} from '../dist-electron/engine/synthesis.js';

describe('Tracer 7: Citation Grounding Contract & Deterministic Provenance', () => {
  it('pre-allocates deterministic 1-based sequential citation indices [1], [2]...', () => {
    const contract = new CitationGroundingContract();

    const excerpts = contract.registerExcerpts([
      {
        id: 'chunk-101',
        milestoneId: 'm1',
        text: 'Superconducting transmon qubits achieved 300 µs coherence times in cryogenic tests.',
        sourceUrl: 'https://nature.com/articles/transmon-2026',
        sourceTitle: 'Transmon Qubit Coherence 2026',
        sourceDomain: 'nature.com',
        score: 0.95
      },
      {
        id: 'chunk-102',
        milestoneId: 'm1',
        text: 'Surface code quantum error correction demonstrated physical error rates below 0.1%.',
        sourceUrl: 'https://arxiv.org/abs/2601.1234',
        sourceTitle: 'Surface Code Fault Tolerance',
        sourceDomain: 'arxiv.org',
        score: 0.92
      },
      {
        id: 'chunk-103',
        milestoneId: 'm2',
        text: 'Commercial quantum hardware roadmap projects 10,000 physical qubits by late 2027.',
        sourceUrl: 'https://ieee.org/papers/roadmap',
        sourceTitle: 'IEEE Quantum Roadmap',
        sourceDomain: 'ieee.org',
        score: 0.88
      }
    ]);

    assert.equal(excerpts.length, 3);
    assert.equal(contract.getTotalCount(), 3);

    // 1-based deterministic indices
    assert.equal(excerpts[0].index, 1);
    assert.equal(excerpts[0].bracket, '[1]');
    assert.equal(excerpts[0].sourceDomain, 'nature.com');

    assert.equal(excerpts[1].index, 2);
    assert.equal(excerpts[1].bracket, '[2]');
    assert.equal(excerpts[1].sourceDomain, 'arxiv.org');

    assert.equal(excerpts[2].index, 3);
    assert.equal(excerpts[2].bracket, '[3]');
    assert.equal(excerpts[2].milestoneId, 'm2');

    // Lookups
    assert.ok(contract.hasIndex(1));
    assert.ok(contract.hasIndex(2));
    assert.ok(contract.hasIndex(3));
    assert.equal(contract.hasIndex(4), false);
    assert.equal(contract.hasIndex(0), false);

    // Milestone grouping
    const m1Excerpts = contract.getExcerptsForMilestone('m1');
    assert.equal(m1Excerpts.length, 2);
    assert.equal(m1Excerpts[0].bracket, '[1]');
    assert.equal(m1Excerpts[1].bracket, '[2]');

    const m2Excerpts = contract.getExcerptsForMilestone('m2');
    assert.equal(m2Excerpts.length, 1);
    assert.equal(m2Excerpts[0].bracket, '[3]');
  });

  it('idempotently handles duplicate registrations without shifting indices', () => {
    const contract = new CitationGroundingContract();

    const ex1 = contract.registerExcerpt({
      id: 'chunk-dup',
      text: 'First registration of sample passage.',
      sourceUrl: 'https://example.com/1'
    });
    assert.equal(ex1.index, 1);

    const ex2 = contract.registerExcerpt({
      id: 'chunk-dup',
      text: 'First registration of sample passage.',
      sourceUrl: 'https://example.com/1'
    });
    assert.equal(ex2.index, 1);
    assert.equal(contract.getTotalCount(), 1);
  });

  it('formats prompt evidence with unambiguous citation brackets', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      {
        id: 'c1',
        text: 'Benchmark achieved 15,000 tokens/sec.',
        sourceUrl: 'https://benchmark.org/llm',
        sourceTitle: 'LLM Benchmarks',
        sourceDomain: 'benchmark.org'
      }
    ]);

    const formatted = contract.formatEvidenceForPrompt();
    assert.match(formatted, /\[1\] Source: "LLM Benchmarks" \(https:\/\/benchmark\.org\/llm\)/);
    assert.match(formatted, /Content: Benchmark achieved 15,000 tokens\/sec\./);
  });
});

describe('Automated Post-Synthesis Regex Verifier & Zero-Hallucination Guarantee', () => {
  it('strips single out-of-bounds hallucinated citation brackets', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'Text 1', sourceUrl: 'https://u1.com' },
      { id: 'c2', text: 'Text 2', sourceUrl: 'https://u2.com' }
    ]); // Valid indices: [1], [2]

    const textWithHallucinations = 'Empirical trials confirm 99.4% accuracy [1]. Another speculative blog [99] claimed 90% [2], but unverified forum posts [500] disagreed.';
    const result = contract.verifyAndSanitize(textWithHallucinations);

    assert.equal(result.totalFound, 4);
    assert.equal(result.validCount, 2);
    assert.equal(result.hallucinatedCount, 2);
    assert.deepEqual(result.validIndices, [1, 2]);
    assert.deepEqual(result.hallucinatedIndices, [99, 500]);
    assert.equal(result.zeroHallucinationGuaranteed, true);

    // Text assertions: valid kept, hallucinated stripped, whitespace cleaned
    assert.ok(result.sanitizedText.includes('[1]'));
    assert.ok(result.sanitizedText.includes('[2]'));
    assert.ok(!result.sanitizedText.includes('[99]'));
    assert.ok(!result.sanitizedText.includes('[500]'));
    assert.equal(
      result.sanitizedText,
      'Empirical trials confirm 99.4% accuracy [1]. Another speculative blog claimed 90% [2], but unverified forum posts disagreed.'
    );
  });

  it('filters mixed multi-citation brackets preserving valid and stripping hallucinated', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'T1', sourceUrl: 'https://u1.com' },
      { id: 'c2', text: 'T2', sourceUrl: 'https://u2.com' },
      { id: 'c3', text: 'T3', sourceUrl: 'https://u3.com' }
    ]); // Valid: 1, 2, 3

    // Mixed bracket [1, 99], [2, 3, 400], all-invalid [75, 80], consecutive [1][999]
    const input = 'Comprehensive results [1, 99] indicate consensus [2, 3, 400]. Speculative rumors [75, 80] are refuted [1][999].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1] indicate consensus [2, 3].'));
    assert.ok(!result.sanitizedText.includes('99'));
    assert.ok(!result.sanitizedText.includes('400'));
    assert.ok(!result.sanitizedText.includes('75'));
    assert.ok(!result.sanitizedText.includes('80'));
    assert.ok(!result.sanitizedText.includes('999'));
    assert.ok(result.sanitizedText.includes('are refuted [1].'));
  });

  it('correctly handles range citations [start-end]', () => {
    const contract = new CitationGroundingContract();
    for (let i = 1; i <= 5; i++) {
      contract.registerExcerpt({ id: `c${i}`, text: `T${i}`, sourceUrl: `https://u${i}.com` });
    } // Valid: 1, 2, 3, 4, 5

    // [1-3] is fully valid -> expanded to [1, 2, 3]
    // [4-8] is partially valid (4, 5 valid; 6, 7, 8 invalid) -> [4, 5]
    // [10-15] is completely invalid -> stripped
    const input = 'Core architectures [1-3] are robust [4-8]. Outdated designs [10-15] failed.';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1, 2, 3] are robust [4, 5].'));
    assert.ok(result.sanitizedText.includes('Outdated designs failed.'));
  });

  it('never mutates markdown links, callout tags, or task checkboxes', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([{ id: 'c1', text: 'T1', sourceUrl: 'https://u1.com' }]);

    const markdownInput = `
# System Report [1]

> [!NOTE]
> Strategic takeaway callout.

> [!WARNING]
> Important caution note.

- [ ] Task checkbox item 1
- [x] Completed item 2

For details, visit [OpenAI Official](https://openai.com) or [Research Link](https://arxiv.org/abs/2601.0001).
Section details [Table 1] and [Figure 2] show metrics [1] vs hallucinated [99].
`;

    const result = contract.verifyAndSanitize(markdownInput);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    // Callouts preserved
    assert.ok(result.sanitizedText.includes('> [!NOTE]'));
    assert.ok(result.sanitizedText.includes('> [!WARNING]'));
    // Checkboxes preserved
    assert.ok(result.sanitizedText.includes('- [ ] Task checkbox item 1'));
    assert.ok(result.sanitizedText.includes('- [x] Completed item 2'));
    // Markdown links preserved
    assert.ok(result.sanitizedText.includes('[OpenAI Official](https://openai.com)'));
    assert.ok(result.sanitizedText.includes('[Research Link](https://arxiv.org/abs/2601.0001)'));
    // Non-numeric brackets preserved
    assert.ok(result.sanitizedText.includes('[Table 1]'));
    assert.ok(result.sanitizedText.includes('[Figure 2]'));
    // Valid citation kept, hallucinated stripped
    assert.ok(result.sanitizedText.includes('metrics [1] vs hallucinated.'));
    assert.ok(!result.sanitizedText.includes('[99]'));
  });

  it('preserves numeric markdown links [1](https://example.com) and [12](https://example.com/source) while filtering unlinked and malformed citations', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'T1', sourceUrl: 'https://nature.com' }
    ]);

    const input = `
See documentation at [1](https://example.com) and extended reference at [12](https://example.com/source).
Also visit ordinary link [Official Portal](https://lens.dev/docs).
Valid citation is kept: [1].
Ungrounded citation is filtered: [99].
Malformed markdown with hallucinated citation: [88](
Another ungrounded bracket: [77] (https://detached.example.com).
`;

    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1](https://example.com)'), 'Numeric link [1](...) must be preserved');
    assert.ok(result.sanitizedText.includes('[12](https://example.com/source)'), 'Numeric link [12](...) must be preserved');
    assert.ok(result.sanitizedText.includes('[Official Portal](https://lens.dev/docs)'), 'Ordinary labeled link must be preserved');
    assert.ok(result.sanitizedText.includes('Valid citation is kept: [1].'));
    assert.ok(!result.sanitizedText.includes('[99]'));
    assert.ok(!result.sanitizedText.includes('[88]'));
    assert.ok(!result.sanitizedText.includes('[77]'));
  });

  it('strictly preserves code blocks containing bracket array literals', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([{ id: 'c1', text: 'T1', sourceUrl: 'https://u1.com' }]);

    const inputWithCode = `
Here is the production implementation [1]:

\`\`\`python
# This contains brackets that must NEVER be stripped
def compute_indices():
    matrix = [1, 99, 500]
    return matrix[99]
\`\`\`

Inline code \`array[99]\` must also be preserved.
However, hallucinated citation in text [99] must be stripped.
`;

    const result = contract.verifyAndSanitize(inputWithCode);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('matrix = [1, 99, 500]'));
    assert.ok(result.sanitizedText.includes('return matrix[99]'));
    assert.ok(result.sanitizedText.includes('`array[99]`'));
    assert.ok(result.sanitizedText.includes('production implementation [1]:'));
    assert.ok(result.sanitizedText.includes('However, hallucinated citation in text must be stripped.'));
    assert.ok(!result.sanitizedText.includes('text [99]'));
  });

  it('supports explicit remapping dictionary and closest-match remapping', () => {
    const contract = new CitationGroundingContract({
      remapMap: { 99: 1 } // Explicitly remap [99] -> [1]
    });
    contract.registerExcerpts([
      { id: 'c1', text: 'T1', sourceUrl: 'https://u1.com' },
      { id: 'c2', text: 'T2', sourceUrl: 'https://u2.com' }
    ]);

    const input = 'Study affirms findings [99]. Another unmapped study [500] is removed.';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.remappedCount, 1);
    assert.equal(result.hallucinatedCount, 2);
    assert.equal(result.validCount, 0);
    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('Study affirms findings [1].'));
    assert.ok(!result.sanitizedText.includes('[99]'));
    assert.ok(!result.sanitizedText.includes('[500]'));
  });

  it('preserves bilingual Modern Standard Arabic text and formatting with citations', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      {
        id: 'ar-c1',
        milestoneId: 'm1',
        text: 'أثبتت النتائج المعملية كفاءة الخوارزمية في المعالجة الموزعة بنسبة 98.5%.',
        sourceUrl: 'https://arabic-tech.org/1',
        sourceTitle: 'الحوسبة الموزعة'
      }
    ]);

    const arText = 'تشير الأبحاث الموثقة إلى كفاءة معمارية الخوارزمية [1]، بينما لم تثبت ادعاءات أخرى [88] أي تحسن ملموس.';
    const result = contract.verifyAndSanitize(arText);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('كفاءة معمارية الخوارزمية [1]'));
    assert.ok(!result.sanitizedText.includes('[88]'));
    assert.ok(result.sanitizedText.includes('بينما لم تثبت ادعاءات أخرى أي تحسن ملموس.'));
  });
});

describe('Empirical Contradiction Callouts Formatting & Parsing', () => {
  it('formats standardized GFM alert contradiction callouts with explicit source comparisons', () => {
    const callout = formatContradictionCallout({
      topicOrMetric: 'Llama-3-70B Inference Throughput',
      claims: [
        { sourceIndex: 1, domain: 'vllm.ai', valueOrAssertion: '18,500 tokens/sec', context: 'FP8 8xH100' },
        { sourceIndex: 2, domain: 'huggingface.co', valueOrAssertion: '4,200 tokens/sec', context: 'BF16 single-node A100' }
      ],
      explanation: 'Variance of 4.4x is primarily attributable to FP8 quantization and tensor parallelism scale across 8x H100 SXM GPUs vs A100 PCIe.',
      language: 'en'
    });

    assert.ok(callout.startsWith('> [!WARNING]'));
    assert.match(callout, /> \*\*Contradiction Callout: Empirical Discrepancy in Llama-3-70B Inference Throughput\*\*/);
    assert.match(callout, /> - Source \[1\] \(`vllm\.ai`\): 18,500 tokens\/sec \[FP8 8xH100\]/);
    assert.match(callout, /> - Source \[2\] \(`huggingface\.co`\): 4,200 tokens\/sec \[BF16 single-node A100\]/);
    assert.match(callout, /> \*Discrepancy Analysis\*: Variance of 4\.4x/);
  });

  it('formats bilingual Arabic contradiction callouts with proper terminology', () => {
    const callout = formatContradictionCallout({
      topicOrMetric: 'زمن استجابة النموذج (Inference Latency)',
      claims: [
        { sourceIndex: 1, domain: 'tech.sa', valueOrAssertion: '12 ميلي ثانية', context: 'بيئة اختبارية محلية' },
        { sourceIndex: 2, domain: 'cloud.com', valueOrAssertion: '65 ميلي ثانية', context: 'بيئة إنتاجية موزعة عبر السحابة' }
      ],
      explanation: 'يعود الفارق إلى زمن نقل الشبكة السحابية والتشفير متعدد الأطراف.',
      language: 'ar'
    });

    assert.ok(callout.startsWith('> [!WARNING]'));
    assert.match(callout, /> \*\*تعارض في البيانات ومؤشرات القياس\*\*: زمن استجابة النموذج/);
    assert.match(callout, /> - المصدر \[1\] \(`tech\.sa`\): 12 ميلي ثانية/);
    assert.match(callout, /> - المصدر \[2\] \(`cloud\.com`\): 65 ميلي ثانية/);
    assert.match(callout, /> \*تحليل التباين والسبب الجذري\*: يعود الفارق/);
  });

  it('extracts and parses contradiction callouts from generated markdown text', () => {
    const markdown = `
# Executive Overview

Recent benchmarks demonstrated promising scalability.

> [!WARNING]
> **Contradiction Callout: Memory Bandwidth Utilization**
> - Source [1] (\`nvidia.com\`): 3.35 TB/s peak memory bandwidth [H100 NVLink]
> - Source [2] (\`anandtech.com\`): 2.10 TB/s measured in sustained synthetic gemm kernels
> *Discrepancy Analysis*: Theoretical peak vs measured sustained bandwidth under thermal throttling.

Further analysis continues below.
`;

    const extracted = extractContradictionCallouts(markdown);
    assert.equal(extracted.length, 1);
    assert.equal(extracted[0].topicOrMetric, 'Memory Bandwidth Utilization');
    assert.deepEqual(extracted[0].sourceIndices, [1, 2]);
    assert.equal(extracted[0].claims.length, 2);
    assert.equal(extracted[0].claims[0].index, 1);
    assert.equal(extracted[0].claims[1].index, 2);
    assert.match(extracted[0].explanation || '', /Theoretical peak vs measured/);
  });

  it('heuristically flags empirical metric contradictions between admitted excerpts', () => {
    const contract = new CitationGroundingContract();
    const excerpts = contract.registerExcerpts([
      {
        id: 'e1',
        sourceDomain: 'bench1.org',
        sourceUrl: 'https://bench1.org',
        text: 'The serving engine demonstrated 15000 tokens/sec throughput under optimized tensor-rt llm configurations.'
      },
      {
        id: 'e2',
        sourceDomain: 'bench2.org',
        sourceUrl: 'https://bench2.org',
        text: 'Comparative testing revealed 3500 tokens/sec throughput on stock py-torch serving.'
      }
    ]);

    const contradictions = detectMetricContradictions(excerpts);
    assert.ok(contradictions.length >= 1);
    assert.equal(contradictions[0].sourceA.index, 1);
    assert.equal(contradictions[0].sourceB.index, 2);
    assert.match(contradictions[0].topicOrMetric, /THROUGHPUT/);
  });
});

describe('HierarchicalSynthesis: Per-Milestone Sections & Meta-Synthesis Pass', () => {
  it('generates milestone analytical sections followed by meta-synthesis pass', async () => {
    const plan = {
      id: 'plan-quantum-2026',
      version: 1,
      objective: 'Fault-Tolerant Quantum Computing Roadmap 2026',
      milestones: [
        { id: 'm-surface', query: 'Surface Code Error Correction Architectures', rationale: 'Core logical qubit foundation' },
        { id: 'm-hardware', query: 'Superconducting Transmon Coherence and Scalability', rationale: 'Physical hardware constraints' }
      ],
      suggestedSkills: ['academic-paper-analysis'],
      estimatedScope: { targetSources: 10, maxHops: 1 }
    };

    const evidence = [
      {
        id: 'c1',
        milestoneId: 'm-surface',
        text: 'Planar surface code lattices demonstrated physical error threshold of 0.75% across 72 qubits [1].',
        sourceUrl: 'https://nature.com/articles/qec-surface',
        sourceTitle: 'Surface Codes Nature',
        sourceDomain: 'nature.com'
      },
      {
        id: 'c2',
        milestoneId: 'm-surface',
        text: 'Rotated surface code architecture reduced physical qubit overhead by 22% compared to standard layout [2].',
        sourceUrl: 'https://arxiv.org/abs/2601.7890',
        sourceTitle: 'Rotated Surface Code Optimization',
        sourceDomain: 'arxiv.org'
      },
      {
        id: 'c3',
        milestoneId: 'm-hardware',
        text: 'Silicon-substrate transmon qubits demonstrated 320 µs relaxation time T1 at 15 mK [3].',
        sourceUrl: 'https://science.org/transmon-t1',
        sourceTitle: 'Transmon Coherence Frontiers',
        sourceDomain: 'science.org'
      },
      {
        id: 'c4',
        milestoneId: 'm-hardware',
        text: 'Cryogenic multiplexing enabled 1,024 transmon control lines per dilution refrigerator [4].',
        sourceUrl: 'https://ieee.org/quantum-cryo',
        sourceTitle: 'Cryogenic Control Scale',
        sourceDomain: 'ieee.org'
      }
    ];

    // Mock generator simulating LLM generating sections and meta pass with an accidental hallucinated citation [99]
    const generatorCalls = [];
    const mockGenerator = async (prompt, context) => {
      generatorCalls.push(context);

      if (context.stage === 'milestone') {
        const m = context.milestone;
        if (m.id === 'm-surface') {
          return `### ${m.query}
Planar surface codes achieve sub-threshold error rates [1]. Optimization with rotated lattices [2] demonstrates substantial efficiency gains. However, an unverified rumor [99] suggested optical links.`;
        } else {
          return `### ${m.query}
Cryogenic transmon coherence reached 320 µs [3]. Control scaling was achieved via multiplexed lines [4].`;
        }
      } else {
        // Meta-synthesis pass
        return `> [!NOTE]
> **Strategic Takeaway**: Fault-tolerant quantum computing is transitioning from physical error suppression to scalable logical architecture [1][3].

## Executive Summary & Key Metrics
- Threshold achievement: Surface code thresholds achieved [1] with 22% footprint reduction [2].
- Hardware benchmarks: Coherence times of 320 µs [3] supported by 1024-line cryo multiplexing [4].

## Comparative Analysis & Trade-offs
| Architecture | Primary Advantage | Coherence / Threshold | Scaling Bottleneck | Evidence Citations |
|---|---|---|---|---|
| Surface Codes | High threshold tolerance | 0.75% error margin [1] | 2D lattice routing [2] | [1][2] |
| Transmon Arrays | Mature fabrication | 320 µs T1 [3] | Cryogenic heat load [4] | [3][4] |

## Strategic Recommendations
> [!TIP]
> **Top Recommendation**: Combine rotated surface code decoders with high-purity transmon arrays.`;
      }
    };

    const progressEvents = [];
    const result = await synthesizeHierarchical({
      plan,
      evidence,
      generator: mockGenerator,
      onProgress: (p) => progressEvents.push(p)
    });

    // 1. Check phases executed
    assert.equal(generatorCalls.length, 3, 'Must call generator for 2 milestones + 1 meta-synthesis pass');
    assert.equal(generatorCalls[0].stage, 'milestone');
    assert.equal(generatorCalls[1].stage, 'milestone');
    assert.equal(generatorCalls[2].stage, 'meta');

    // 2. Progress events emitted
    assert.ok(progressEvents.some(p => p.stage === 'milestone'));
    assert.ok(progressEvents.some(p => p.stage === 'meta'));
    assert.ok(progressEvents.some(p => p.stage === 'verification'));

    // 3. Sections generated
    assert.equal(result.milestoneSections.length, 2);
    assert.equal(result.milestoneSections[0].milestoneId, 'm-surface');
    assert.equal(result.milestoneSections[1].milestoneId, 'm-hardware');

    // 4. Zero hallucination guaranteed in milestone sections and final report
    assert.equal(result.groundingVerification.zeroHallucinationGuaranteed, true);
    assert.equal(result.groundingVerification.hallucinatedStripped, 1, 'Accidental [99] in milestone 1 must be stripped');
    assert.ok(!result.report.includes('[99]'), 'Report must NOT contain hallucinated [99]');
    assert.ok(result.report.includes('[1]'));
    assert.ok(result.report.includes('[2]'));
    assert.ok(result.report.includes('[3]'));
    assert.ok(result.report.includes('[4]'));

    // 5. Structure of final report
    assert.ok(result.report.includes('# Fault-Tolerant Quantum Computing Roadmap 2026'));
    assert.ok(result.report.includes('> [!NOTE]'));
    assert.ok(result.report.includes('## Executive Summary & Key Metrics'));
    assert.ok(result.report.includes('## Detailed Milestone & Thematic Analysis'));
    assert.ok(result.report.includes('### Surface Code Error Correction Architectures'));
    assert.ok(result.report.includes('### Superconducting Transmon Coherence and Scalability'));
    assert.ok(result.report.includes('## Comparative Analysis & Trade-offs'));
    assert.ok(result.report.includes('| Surface Codes | High threshold tolerance |'));
    assert.ok(result.report.includes('## References & Evidence Provenance'));

    // 6. Grounded references list
    assert.equal(result.references.length, 4);
    assert.ok(result.references.every(r => r.cited === true));
  });

  it('executes robust deterministic fallback synthesis when LLM provider is offline', async () => {
    const plan = {
      id: 'plan-offline',
      version: 1,
      objective: 'Autonomous Systems Real-Time Scheduling',
      milestones: [
        { id: 'm1', query: 'Hard Real-Time Kernel Preemption', rationale: 'Determinism' }
      ]
    };

    const evidence = [
      {
        id: 'c1',
        milestoneId: 'm1',
        text: 'Preemption latency was guaranteed under 10 microseconds using priority inheritance protocols.',
        sourceUrl: 'https://kernel.org/rt',
        sourceTitle: 'Linux RT Kernel',
        sourceDomain: 'kernel.org'
      }
    ];

    // No generator or llm options passed -> triggers fallback synthesis
    const result = await synthesizeHierarchical({
      plan,
      evidence,
      language: 'en'
    });

    assert.ok(result.report.length > 500);
    assert.equal(result.groundingVerification.zeroHallucinationGuaranteed, true);
    assert.ok(result.report.includes('### Hard Real-Time Kernel Preemption'));
    assert.ok(result.report.includes('## Executive Summary & Key Metrics'));
    assert.ok(result.report.includes('## Comparative Matrix & Trade-offs'));
    assert.ok(result.report.includes('## References & Evidence Provenance'));
    assert.ok(result.report.includes('[1]'));
  });
});

describe('Scale & Verification Suite: 50-Source & 200-Source Zero-Hallucination Stress Tests', () => {
  it('strictly guarantees ZERO hallucinated citations on a 50-source synthesized report', async () => {
    const contract = new CitationGroundingContract();

    // Create 50 unique sources across 3 milestones
    const candidateChunks = [];
    for (let i = 1; i <= 50; i++) {
      const milestoneId = i <= 20 ? 'm1' : i <= 35 ? 'm2' : 'm3';
      candidateChunks.push({
        id: `chunk-50-${i}`,
        milestoneId,
        text: `Empirical finding #${i} establishes key metric for subtopic ${milestoneId}. Performance index: ${100 + i * 5}.`,
        sourceUrl: `https://academic-journal-${i % 10}.org/paper/${i}`,
        sourceTitle: `Research Publication #${i}`,
        sourceDomain: `academic-journal-${i % 10}.org`,
        score: 0.5 + (i * 0.01)
      });
    }

    const preAllocated = contract.registerExcerpts(candidateChunks);
    assert.equal(preAllocated.length, 50);
    assert.equal(contract.getTotalCount(), 50);

    // Simulate an LLM generating a large, detailed report referencing valid citations [1] to [50],
    // while deliberately injecting 25 distinct hallucinated citations:
    // [51], [75], [99], [150], [500], [999], [0], [9999], [1, 75], [50, 999], [80, 85]
    let simulatedReport = `
# 50-Source Enterprise AI Architecture Evaluation

> [!NOTE]
> Strategic overview based on 50 admitted peer-reviewed sources [1][10][25][50].
> Hallucinated rumor [51] should be completely purged.

## Executive Summary & Key Metrics
- Hardware acceleration: Across modern AI clusters, tensor throughput scales by 4.2x [2][5][15].
- False citation injected here [99] and multi-hallucination [150, 500].
- Valid multi-citation: [3, 7, 12, 45] confirm stability under sustained load.
- Mixed citation: [1, 999] has valid index 1 and hallucinated index 999.

## Detailed Milestone 1 Analysis [1][20]
Detailed discussion with valid references [4][8][16] and invalid references [75] and [0].
Another paragraph citing [18, 19, 20] along with invalid range [52-55].

## Detailed Milestone 2 Analysis [21][35]
Discussion with valid references [22][28][33] and invalid [80].
Invalid consecutive brackets: [30][9999][31].

## Detailed Milestone 3 Analysis [36][50]
Discussion with valid references [37][42][49][50] and invalid [100].

## Comparative Matrix
| Dimension | Solution A | Solution B | Evidence Citations |
|---|---|---|---|
| Latency | 5 ms [1] | 12 ms [25] | [1][25][50] |
| Throughput | 10k [10] | 4k [35] | [10][35][88] |
| Reliability | 99.9% [40] | 99.5% [45] | [40][45][999] |
`;

    const verificationResult = contract.verifyAndSanitize(simulatedReport);

    // 1. Zero Hallucination Guarantee must be true
    assert.equal(verificationResult.zeroHallucinationGuaranteed, true);

    // 2. Verify all hallucinated numbers were removed
    const forbiddenIndices = [51, 75, 99, 150, 500, 999, 0, 9999, 52, 53, 54, 55, 80, 88, 100];
    for (const badIdx of forbiddenIndices) {
      assert.ok(
        !verificationResult.sanitizedText.includes(`[${badIdx}]`),
        `Sanitized text must NOT contain hallucinated bracket [${badIdx}]`
      );
    }

    // 3. Scan every single remaining bracket in sanitized text and verify it is <= 50 and >= 1
    const bracketRegex = /\[(\d+)\]/g;
    let match;
    let foundCitationsCount = 0;
    while ((match = bracketRegex.exec(verificationResult.sanitizedText)) !== null) {
      const idx = parseInt(match[1], 10);
      assert.ok(
        idx >= 1 && idx <= 50,
        `Remaining citation [${idx}] must be within valid range 1..50`
      );
      assert.ok(contract.hasIndex(idx), `Remaining citation [${idx}] must exist in catalog`);
      foundCitationsCount++;
    }
    assert.ok(foundCitationsCount > 20, `Expected > 20 valid citations preserved, found ${foundCitationsCount}`);

    // 4. Valid citations preserved
    assert.ok(verificationResult.sanitizedText.includes('[1]'));
    assert.ok(verificationResult.sanitizedText.includes('[50]'));
    assert.ok(verificationResult.sanitizedText.includes('[25]'));
    assert.ok(verificationResult.sanitizedText.includes('[3, 7, 12, 45]'));

    // 5. Hallucination telemetry count verified
    assert.ok(verificationResult.hallucinatedCount >= 15);
    assert.ok(verificationResult.validCount >= 20);
  });

  it('strictly guarantees ZERO hallucinated citations on a 200-source full hierarchical synthesis report', async () => {
    // Generate 200 distinct evidence passages across 5 milestones (40 chunks per milestone)
    const milestones = [
      { id: 'm1', query: 'Frontier Foundation Model Scaling Laws', rationale: 'Compute and parameter boundaries' },
      { id: 'm2', query: 'Low-Precision FP4 and INT4 Inference Kernels', rationale: 'Quantization trade-offs' },
      { id: 'm3', query: 'Speculative Decoding and KV-Cache Compression', rationale: 'Throughput optimization' },
      { id: 'm4', query: 'Distributed MoE Routing and Communication Latency', rationale: 'Cluster interconnects' },
      { id: 'm5', query: 'Post-Training Alignment and Reasoning Distillation', rationale: 'Model quality and safety' }
    ];

    const evidence200 = [];
    for (let i = 1; i <= 200; i++) {
      const milestoneIndex = Math.floor((i - 1) / 40);
      const m = milestones[milestoneIndex];
      evidence200.push({
        id: `chunk-200-${i}`,
        milestoneId: m.id,
        text: `Empirical evidence passage #${i} for milestone "${m.query}". Quantitative benchmark: ${90 + (i % 10)}% efficiency across domain host-${i % 25}.edu.`,
        sourceUrl: `https://host-${i % 25}.edu/papers/study-${i}`,
        sourceTitle: `Study #${i} on ${m.query}`,
        sourceDomain: `host-${i % 25}.edu`,
        score: 0.6 + ((i % 40) * 0.01)
      });
    }

    const plan = {
      id: 'plan-wide-200',
      version: 1,
      objective: 'Comprehensive 200-Source Frontier AI Systems Dossier',
      milestones,
      suggestedSkills: ['academic-paper-analysis', 'competitive-market-intelligence'],
      estimatedScope: { targetSources: 200, maxHops: 2 }
    };

    // Mock generator simulating LLM generating realistic sections for each of the 5 milestones
    // plus the meta-synthesis pass, while aggressively injecting hallucinated citations
    // [201], [250], [300], [500], [999], [1200], [5000] in every section
    const mockGenerator = async (prompt, context) => {
      if (context.stage === 'milestone') {
        const m = context.milestone;
        const mIdx = context.milestoneIndex;
        // Milestone 0 uses sources 1..40, Milestone 1 uses 41..80, etc.
        const startIdx = mIdx * 40 + 1;
        const midIdx = startIdx + 15;
        const endIdx = startIdx + 39;

        return `### ${m.query}
Detailed thematic and empirical investigation for ${m.query}.
Verified studies [${startIdx}] and [${midIdx}] establish baseline metrics. Advanced experiments [${endIdx}] validate scalability.
However, hallucinated source [${200 + mIdx * 10 + 1}] falsely claimed regressions.
Mixed citation: [${startIdx + 1}, ${250 + mIdx}] combines valid and hallucinated.
All-hallucinated citation: [${300 + mIdx}, ${400 + mIdx}] must be completely removed.`;
      } else {
        // Meta-synthesis pass
        return `> [!NOTE]
> **Strategic Takeaway**: Synthesizing 200 admitted sources reveals unprecedented convergence between model capacity and inference efficiency [1][50][100][150][200].
> Hallucinated reference [999] in takeaway must be stripped.

## Executive Summary & Key Metrics
- Compute scaling: Frontier models exhibit predictable power-law scaling across 200 sources [1][40].
- Quantization efficiency: FP4 and INT4 kernels achieve 3.8x speedup [41][80] with <0.5% degradation.
- Speculative decoding: 2.5x latency reduction demonstrated [81][120].
- MoE routing: All-to-all communication overhead contained under 12% [121][160].
- Distillation: Reasoning models retain 94% capability [161][200].
- Erroneous hallucination: [201][500][1200][5000] injected into summary.

## Comparative Analysis & Trade-offs
| Architecture Component | Primary Advantage | Benchmark Metric | Trade-offs | Evidence Citations |
|---|---|---|---|---|
| Dense Scaling | Predictable capabilities | Power-law loss [1] | Exponential training cost [40] | [1][40] |
| FP4 / INT4 Kernels | 3.8x memory reduction | <0.5% perplexity loss [45] | Dynamic range clipping [75] | [45][75][205] |
| Speculative Decoding | 2.5x lower latency | 45 ms TTFT [85] | Speculative draft overhead [115] | [85][115] |
| MoE Routing | Parameter efficiency | 4x active FLOPs [125] | Cross-node bandwidth [155] | [125][155][350] |
| Distillation | Compact footprint | 94% reasoning [165] | Synthetic distribution drift [195] | [165][195] |

## Strategic Recommendations
> [!TIP]
> **Top Strategic Recommendation**: Adopt hybrid MoE architectures with FP4 kv-cache compression and speculative verification.`;
      }
    };

    const startTime = Date.now();
    const result = await synthesizeHierarchical({
      plan,
      evidence: evidence200,
      generator: mockGenerator
    });
    const durationMs = Date.now() - startTime;

    // 1. Verify 200 sources admitted and indexed
    assert.equal(result.totalAdmittedSources, 200);
    assert.equal(result.contract.getTotalCount(), 200);

    // 2. Zero Hallucination Guarantee
    assert.equal(result.groundingVerification.zeroHallucinationGuaranteed, true);

    // 3. Hallucinations stripped count
    assert.ok(
      result.groundingVerification.hallucinatedStripped >= 15,
      `Expected >= 15 hallucinations stripped, got ${result.groundingVerification.hallucinatedStripped}`
    );

    // 4. Exhaustive Regex Verification on the entire assembled 200-source report:
    // Extract every single [number] in the entire text and verify: 1 <= number <= 200!
    const citationRegex = /\[(\d+)\]/g;
    let m;
    const allFoundIndices = [];
    while ((m = citationRegex.exec(result.report)) !== null) {
      const idx = parseInt(m[1], 10);
      assert.ok(
        idx >= 1 && idx <= 200,
        `Hallucination detected in 200-source report! Bracket [${idx}] is outside range [1, 200].`
      );
      assert.ok(
        result.contract.hasIndex(idx),
        `Bracket [${idx}] does not exist in the admitted 200-source catalog!`
      );
      allFoundIndices.push(idx);
    }

    assert.ok(allFoundIndices.length >= 25, `Expected >= 25 valid citations in final report, found ${allFoundIndices.length}`);

    // Specifically verify known hallucinated numbers were completely purged:
    const injectedHallucinations = [201, 205, 211, 221, 231, 241, 250, 300, 350, 400, 500, 999, 1200, 5000];
    for (const bad of injectedHallucinations) {
      assert.ok(
        !result.report.includes(`[${bad}]`),
        `Hallucinated bracket [${bad}] MUST NOT exist in final report`
      );
    }

    // 5. Structure & Milestones verification
    assert.equal(result.milestoneSections.length, 5);
    for (let i = 0; i < 5; i++) {
      const m = milestones[i];
      assert.ok(result.report.includes(`### ${m.query}`), `Must contain heading for milestone ${m.query}`);
    }

    // 6. Meta Synthesis deliverables
    assert.ok(result.report.includes('# Comprehensive 200-Source Frontier AI Systems Dossier'));
    assert.ok(result.report.includes('## Executive Summary & Key Metrics'));
    assert.ok(result.report.includes('## Comparative Analysis & Trade-offs'));
    assert.ok(result.report.includes('| Dense Scaling | Predictable capabilities |'));
    assert.ok(result.report.includes('## References & Evidence Provenance'));

    // 7. References count
    assert.equal(result.references.length, 200);

    // 8. Performance bounds: synthesis and verification of 200 sources should execute in < 2 seconds
    assert.ok(
      durationMs < 2000,
      `200-source hierarchical synthesis and verification took ${durationMs}ms (expected < 2000ms)`
    );
  });
});

describe('Edge Cases & Resilient Parsing Under Multilingual & Academic Regimes', () => {
  it('sanitizes academic semicolon-separated citation brackets [1; 99]', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'Study 1 text', sourceUrl: 'https://c1.org' },
      { id: 'c2', text: 'Study 2 text', sourceUrl: 'https://c2.org' }
    ]);

    const input = 'Validated findings [1; 99] and speculative references [99; 100].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1]'));
    assert.ok(!result.sanitizedText.includes('99'));
    assert.ok(!result.sanitizedText.includes('100'));
    assert.equal(result.sanitizedText, 'Validated findings [1] and speculative references.');
  });

  it('sanitizes Modern Standard Arabic comma delimiters [1، 99]', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'دراسة 1', sourceUrl: 'https://c1.sa' }
    ]);

    const input = 'أثبتت النتائج المعملية [1، 99] دقة الخوارزمية، بينما دحضت أبحاث أخرى [99].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1]'));
    assert.ok(!result.sanitizedText.includes('99'));
    assert.equal(result.sanitizedText, 'أثبتت النتائج المعملية [1] دقة الخوارزمية، بينما دحضت أبحاث أخرى.');
  });

  it('normalizes Arabic-Indic numerals [١] and purges hallucinated [٩٩]', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'دراسة 1', sourceUrl: 'https://c1.sa' }
    ]);

    const input = 'البيانات المعتمدة [\u0661] تدحض الفرضية الوهمية [\u0669\u0669].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1]'));
    assert.ok(!result.sanitizedText.includes('\u0669\u0669'));
    assert.equal(result.sanitizedText, 'البيانات المعتمدة [1] تدحض الفرضية الوهمية.');
  });

  it('handles Unicode dash variants in ranges (em-dash, minus sign)', () => {
    const contract = new CitationGroundingContract();
    for (let i = 1; i <= 5; i++) {
      contract.registerExcerpt({ id: `c${i}`, text: `Study ${i}`, sourceUrl: `https://c${i}.org` });
    }

    // Em-dash [1—3] and minus sign [4−5], hallucinated [8—12]
    const input = 'Valid ranges [1\u20143] and [4\u22125] are robust. Hallucinated [8\u201412] removed.';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('[1, 2, 3]'));
    assert.ok(result.sanitizedText.includes('[4, 5]'));
    assert.ok(!result.sanitizedText.includes('8'));
    assert.ok(!result.sanitizedText.includes('12'));
  });

  it('expands large ranges in 200-source documents without truncation', () => {
    const contract = new CitationGroundingContract();
    for (let i = 1; i <= 200; i++) {
      contract.registerExcerpt({ id: `c${i}`, text: `Study ${i}`, sourceUrl: `https://c${i}.org` });
    }

    const input = 'Comprehensive consensus across literature [1-150].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.equal(result.validIndices.length, 150);
    assert.equal(result.citedIndices.length, 150);
  });

  it('cleans up punctuation artifacts, duplicate commas, and orphaned delimiters', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'T1', sourceUrl: 'https://c1.org' },
      { id: 'c2', text: 'T2', sourceUrl: 'https://c2.org' }
    ]);

    const input = 'Results demonstrated in [1], [99], and [2]. Also [99], [100].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.equal(result.sanitizedText, 'Results demonstrated in [1], and [2]. Also.');
  });

  it('preserves line breaks across consecutive task list checkboxes', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([{ id: 'c1', text: 'T1', sourceUrl: 'https://c1.org' }]);

    const input = '- [ ] Task 1 [1]\n- [x] Task 2 [99]\n- [ ] Task 3\n';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.zeroHallucinationGuaranteed, true);
    assert.ok(result.sanitizedText.includes('- [ ] Task 1 [1]\n'));
    assert.ok(result.sanitizedText.includes('- [x] Task 2\n'));
    assert.ok(result.sanitizedText.includes('- [ ] Task 3\n'));
    assert.ok(!result.sanitizedText.includes('[99]'));
  });

  it('sanitizes internal brackets in verbatim snippets within Grounded References', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpt({
      id: 'c-leaky',
      text: 'Prior survey claimed 95% accuracy [999] under synthetic regimes.',
      sourceUrl: 'https://nature.com/survey',
      sourceTitle: 'Nature Survey'
    });

    const refs = contract.formatReferences({ onlyCited: false });
    assert.ok(refs.includes('[1] **Nature Survey**'));
    // The internal snippet bracket [999] must be escaped to (999) to avoid leaking ungrounded citations
    assert.ok(refs.includes('(999)'));
    assert.ok(!refs.includes('[999]'));
  });

  it('handles whitespace-separated citation brackets like [99 100] and [1 2]', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'Chunk 1', sourceUrl: 'https://site.com/1' },
      { id: 'c2', text: 'Chunk 2', sourceUrl: 'https://site.com/2' }
    ]);

    const input = 'Evidence supported by [1 2] and contradicted by [99 100].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.deterministicVerification, true);
    assert.ok(result.sanitizedText.includes('[1, 2]'));
    assert.ok(!result.sanitizedText.includes('99'));
    assert.ok(!result.sanitizedText.includes('100'));
    assert.equal(result.sanitizedText, 'Evidence supported by [1, 2] and contradicted by.');
  });

  it('verifies all intermediate numbers in range expansions and strips out-of-bounds ranges', () => {
    const contract = new CitationGroundingContract();
    contract.registerExcerpts([
      { id: 'c1', text: 'C1', sourceUrl: 'https://site.com/1' },
      { id: 'c2', text: 'C2', sourceUrl: 'https://site.com/2' },
      { id: 'c3', text: 'C3', sourceUrl: 'https://site.com/3' }
    ]);

    // [1-3] are valid; [5-10] are all out of bounds; [2-4] has 4 out of bounds
    const input = 'Comprehensive proof in [1-3], partial in [2-4], and invalid in [5-10].';
    const result = contract.verifyAndSanitize(input);

    assert.equal(result.deterministicVerification, true);
    assert.ok(result.sanitizedText.includes('[1, 2, 3]'));
    assert.ok(result.sanitizedText.includes('[2, 3]'));
    assert.ok(!result.sanitizedText.includes('5-10'));
    assert.ok(!result.sanitizedText.includes('[5'));
    assert.ok(!result.sanitizedText.includes('10]'));
  });

  it('respects onlyCitedInReferences option in HierarchicalSynthesis', async () => {
    const plan = {
      objective: 'Quantum Cryptography',
      milestones: [{ id: 'm1', query: 'QKD Protocols', rationale: 'Analyze BB84' }]
    };

    const evidence = [
      { id: 'e1', text: 'BB84 verified with 1.2% QBER', sourceUrl: 'https://arxiv.org/abs/1', milestoneId: 'm1' },
      { id: 'e2', text: 'Unused background source', sourceUrl: 'https://arxiv.org/abs/2', milestoneId: 'm1' }
    ];

    const synthesis = new HierarchicalSynthesis({
      plan,
      evidence,
      onlyCitedInReferences: true,
      generator: async () => 'Analysis confirms QKD protocols [1] demonstrate robust security.'
    });

    const result = await synthesis.synthesize('Quantum Cryptography');
    assert.ok(result.report.includes('[1]'));
    assert.ok(result.report.includes('arxiv.org/abs/1'));
    // Uncited source #2 should not appear in References when onlyCitedInReferences is true
    assert.ok(!result.report.includes('arxiv.org/abs/2'));
  });
});

