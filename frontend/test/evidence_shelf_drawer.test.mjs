import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractCitedIndices,
  categorizeRelevanceTier,
  extractDomain,
  enrichSources,
  filterSources,
  groupSourcesByMilestone,
  computeShelfStats,
  extractSurroundingClaim,
  detectBilingualMismatch,
  extractCitationInspection,
  normalizeEasternNumerals
} from '../dist-electron/engine/evidenceShelf.js';

describe('Tracer 8: Evidence Inspection Drawer & Facet-Grouped Source Shelf', () => {
  describe('Citation Index Scanner (extractCitedIndices)', () => {
    it('extracts single and comma-separated bracketed citations [1], [2, 3]', () => {
      const text = 'Recent breakthroughs in quantum computing [1] and topological qubits [2, 3] demonstrate scaling.';
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2, 3]);
    });

    it('handles semicolons and Modern Standard Arabic commas [1; 2] and [1، 4]', () => {
      const text = 'أثبتت النماذج العصبية كفاءة عالية في الترجمة [1; 2] والتحليل الدلالي [3، 4].';
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2, 3, 4]);
    });

    it('expands ranges across ASCII and Unicode dashes [1-4], [5–7], [8—10]', () => {
      const text = 'Literature review covers early baselines [1-3], contemporary methods [4–6], and future roadmaps [7—8].';
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('normalizes Eastern Arabic-Indic and Persian digits [١] and [٢، ٣]', () => {
      const text = 'أظهرت التجارب المعملية تحسناً بنسبة 35% [١] مقارنة بالدراسات السابقة [٢، ٣].';
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2, 3]);
    });

    it('strictly protects fenced code blocks, inline code, and markdown links', () => {
      const text = `
Here is a citation [1].

\`\`\`python
# This [99] in a code block must be ignored
array = [100, 200]
\`\`\`

Also inline \`const x = [42];\` should be ignored.
And [Link Title](https://example.com) should not be treated as citation.
Finally a valid citation [2].
`;
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2]);
    });

    it('strictly protects GFM callout badges and task list checkboxes', () => {
      const text = `
> [!NOTE]
> Strategic takeaway citing source [1].

> [!WARNING]
> Empirical contradiction observed between sources [2] and [3].

- [ ] Task checkbox item
- [x] Completed task item with citation [4]
`;
      const cited = extractCitedIndices(text);
      assert.deepEqual(Array.from(cited).sort((a, b) => a - b), [1, 2, 3, 4]);
    });

    it('returns empty Set on empty string, null, or text without citations', () => {
      assert.equal(extractCitedIndices('').size, 0);
      assert.equal(extractCitedIndices(null).size, 0);
      assert.equal(extractCitedIndices('Plain text without any brackets.').size, 0);
    });
  });

  describe('Relevance Tier Categorization (categorizeRelevanceTier)', () => {
    it('categorizes 0..1 scale correctly', () => {
      assert.equal(categorizeRelevanceTier(0.95), 'high');
      assert.equal(categorizeRelevanceTier(0.80), 'high');
      assert.equal(categorizeRelevanceTier(0.79), 'medium');
      assert.equal(categorizeRelevanceTier(0.60), 'medium');
      assert.equal(categorizeRelevanceTier(0.59), 'low');
      assert.equal(categorizeRelevanceTier(0.20), 'low');
    });

    it('normalizes 0..100 percentage scale values', () => {
      assert.equal(categorizeRelevanceTier(92), 'high');
      assert.equal(categorizeRelevanceTier(80), 'high');
      assert.equal(categorizeRelevanceTier(72), 'medium');
      assert.equal(categorizeRelevanceTier(60), 'medium');
      assert.equal(categorizeRelevanceTier(45), 'low');
    });

    it('handles undefined, NaN, and negative edge cases with robust defaults', () => {
      assert.equal(categorizeRelevanceTier(undefined), 'medium');
      assert.equal(categorizeRelevanceTier(NaN), 'medium');
      assert.equal(categorizeRelevanceTier(-0.5), 'low');
    });
  });

  describe('Source Enrichment (enrichSources)', () => {
    const mockPlan = {
      id: 'plan-1',
      version: 1,
      objective: 'Comprehensive Quantum Computing Research',
      suggestedSkills: ['academic-paper-analysis'],
      estimatedScope: { targetSources: 10, maxHops: 2 },
      milestones: [
        { id: 'm1', query: 'Superconducting Qubits', rationale: 'Hardware foundation' },
        { id: 'm2', query: 'Quantum Error Correction', rationale: 'Fault tolerance mechanisms' },
        { id: 'm3', query: 'Commercial Market Milestones', rationale: 'Industry adoption' }
      ]
    };

    const mockSources = [
      {
        url: 'https://nature.com/articles/q1',
        title: 'Transmon Qubit Coherence Breakthrough',
        domain: 'nature.com',
        snippet: 'Superconducting transmon qubits achieved 300 µs coherence times.',
        credibilityScore: 95,
        milestoneId: 'm1'
      },
      {
        url: 'https://arxiv.org/abs/2601.0001',
        title: 'Surface Code Thresholds Under Correlated Noise',
        domain: 'arxiv.org',
        snippet: 'Fault-tolerant syndrome measurement demonstrated error rates below 0.1%.',
        credibilityScore: 90,
        milestoneId: 'm2'
      },
      {
        url: 'https://techcrunch.com/2026/quantum-round',
        title: 'Quantum Startup Raises $150M Series B',
        domain: 'techcrunch.com',
        snippet: 'Investment in commercial neutral atom systems accelerates in 2026.',
        credibilityScore: 75,
        milestoneId: 'm3'
      },
      {
        url: 'https://blog.quantum.example/opinion',
        title: 'Perspective on Quantum Decoherence',
        domain: 'blog.quantum.example',
        snippet: 'Decoherence remains the central obstacle for near-term NISQ devices.',
        credibilityScore: 60
      }
    ];

    it('enriches raw sources with 1-based indices, citation status, and relevance tiers', () => {
      const reportText = 'Superconducting qubits showed long coherence [1], while surface code error correction [2] matured.';
      const enriched = enrichSources(mockSources, mockPlan, reportText);

      assert.equal(enriched.length, 4);

      // Source 1: Cited in report
      assert.equal(enriched[0].index, 1);
      assert.equal(enriched[0].citationIndex, 1);
      assert.equal(enriched[0].isCited, true);
      assert.equal(enriched[0].relevanceTier, 'high');
      assert.equal(enriched[0].milestoneId, 'm1');
      assert.equal(enriched[0].milestoneTitle, 'Superconducting Qubits');
      assert.equal(enriched[0].passage, 'Superconducting transmon qubits achieved 300 µs coherence times.');

      // Source 2: Cited in report
      assert.equal(enriched[1].index, 2);
      assert.equal(enriched[1].citationIndex, 2);
      assert.equal(enriched[1].isCited, true);
      assert.equal(enriched[1].relevanceTier, 'high');
      assert.equal(enriched[1].milestoneId, 'm2');

      // Source 3: Admitted background (not cited)
      assert.equal(enriched[2].index, 3);
      assert.equal(enriched[2].isCited, false);
      assert.equal(enriched[2].milestoneId, 'm3');

      // Source 4: Unassigned milestone mapped gracefully
      assert.equal(enriched[3].index, 4);
      assert.equal(enriched[3].isCited, false);
      assert.ok(enriched[3].milestoneId.length > 0);
    });

    it('handles empty sources array and missing fields safely', () => {
      assert.deepEqual(enrichSources([]), []);
      const defective = [{ url: '', title: '' }];
      const res = enrichSources(defective);
      assert.equal(res.length, 1);
      assert.equal(res[0].domain, 'web');
      assert.equal(res[0].index, 1);
      assert.equal(res[0].isCited, false);
    });
  });

  describe('Multi-Dimensional Filtering (filterSources)', () => {
    const enrichedList = [
      {
        index: 1,
        citationIndex: 1,
        citationIndices: [1],
        url: 'https://nature.com/articles/q1',
        title: 'Transmon Qubit Coherence Breakthrough',
        domain: 'nature.com',
        passage: 'Coherence times exceeded 300 µs under dilution refrigeration.',
        score: 0.95,
        relevanceTier: 'high',
        credibilityScore: 95,
        milestoneId: 'm1',
        milestoneTitle: 'Superconducting Qubits',
        isCited: true
      },
      {
        index: 2,
        citationIndex: 2,
        citationIndices: [2],
        url: 'https://arxiv.org/abs/2601.0001',
        title: 'Surface Code Thresholds Under Correlated Noise',
        domain: 'arxiv.org',
        passage: 'Error rates dropped below 0.1% using 17-qubit surface patches.',
        score: 0.88,
        relevanceTier: 'high',
        credibilityScore: 90,
        milestoneId: 'm2',
        milestoneTitle: 'Quantum Error Correction',
        isCited: true
      },
      {
        index: 3,
        citationIndex: 3,
        citationIndices: [],
        url: 'https://techcrunch.com/2026/round',
        title: 'Commercial Quantum Venture Roundup',
        domain: 'techcrunch.com',
        passage: 'Venture funding in hardware startups surpassed $1B in 2026.',
        score: 0.72,
        relevanceTier: 'medium',
        credibilityScore: 75,
        milestoneId: 'm3',
        milestoneTitle: 'Commercial Landscape',
        isCited: false
      },
      {
        index: 4,
        citationIndex: 4,
        citationIndices: [],
        url: 'https://nature.com/articles/review-2025',
        title: 'Decoherence Noise Models in Solid State',
        domain: 'nature.com',
        passage: 'Two-level systems at dielectric interfaces induce flux noise.',
        score: 0.55,
        relevanceTier: 'low',
        credibilityScore: 92,
        milestoneId: 'm1',
        milestoneTitle: 'Superconducting Qubits',
        isCited: false
      }
    ];

    it('filters by milestone facet accurately', () => {
      const filtered = filterSources(enrichedList, { milestoneId: 'm1' });
      assert.equal(filtered.length, 2);
      assert.ok(filtered.every((s) => s.milestoneId === 'm1'));
    });

    it('filters by citation status: cited vs background admitted', () => {
      const citedOnly = filterSources(enrichedList, { citationStatus: 'cited' });
      assert.equal(citedOnly.length, 2);
      assert.ok(citedOnly.every((s) => s.isCited === true));

      const backgroundOnly = filterSources(enrichedList, { citationStatus: 'background' });
      assert.equal(backgroundOnly.length, 2);
      assert.ok(backgroundOnly.every((s) => s.isCited === false));
    });

    it('filters by relevance tier: high, medium, low', () => {
      const high = filterSources(enrichedList, { relevanceTier: 'high' });
      assert.equal(high.length, 2);
      assert.ok(high.every((s) => s.relevanceTier === 'high'));

      const medium = filterSources(enrichedList, { relevanceTier: 'medium' });
      assert.equal(medium.length, 1);
      assert.equal(medium[0].index, 3);

      const low = filterSources(enrichedList, { relevanceTier: 'low' });
      assert.equal(low.length, 1);
      assert.equal(low[0].index, 4);
    });

    it('filters by source domain', () => {
      const natureSources = filterSources(enrichedList, { domain: 'nature.com' });
      assert.equal(natureSources.length, 2);
      assert.ok(natureSources.every((s) => s.domain === 'nature.com'));
    });

    it('filters by keyword search across title, passage, and URL', () => {
      const byTitle = filterSources(enrichedList, { searchQuery: 'Surface Code' });
      assert.equal(byTitle.length, 1);
      assert.equal(byTitle[0].index, 2);

      const byPassage = filterSources(enrichedList, { searchQuery: 'dilution refrigeration' });
      assert.equal(byPassage.length, 1);
      assert.equal(byPassage[0].index, 1);

      const byDomain = filterSources(enrichedList, { searchQuery: 'techcrunch' });
      assert.equal(byDomain.length, 1);
      assert.equal(byDomain[0].index, 3);
    });

    it('executes compound multi-dimensional filtering seamlessly', () => {
      const compound = filterSources(enrichedList, {
        milestoneId: 'm1',
        citationStatus: 'cited',
        relevanceTier: 'high',
        domain: 'nature.com'
      });
      assert.equal(compound.length, 1);
      assert.equal(compound[0].index, 1);
    });

    it('filters sources by citation index [2] or #2', () => {
      const byBracketIndex = filterSources(enrichedList, { searchQuery: '[2]' });
      assert.equal(byBracketIndex.length, 1);
      assert.equal(byBracketIndex[0].citationIndex, 2);

      const byHashIndex = filterSources(enrichedList, { searchQuery: '#2' });
      assert.equal(byHashIndex.length, 1);
      assert.equal(byHashIndex[0].citationIndex, 2);
    });

    it('filters sources by Eastern Arabic numeral citation query [٢]', () => {
      const byArabicDigit = filterSources(enrichedList, { searchQuery: '[٢]' });
      assert.equal(byArabicDigit.length, 1);
      assert.equal(byArabicDigit[0].citationIndex, 2);
    });

    it('returns all sources when filters are set to default "all"', () => {
      const all = filterSources(enrichedList, {
        milestoneId: 'all',
        citationStatus: 'all',
        relevanceTier: 'all',
        domain: 'all',
        searchQuery: ''
      });
      assert.equal(all.length, 4);
    });
  });

  describe('Milestone Grouping & Shelf Statistics', () => {
    const mockPlan = {
      id: 'plan-q',
      version: 1,
      objective: 'Quantum Hardware & Architecture',
      suggestedSkills: ['academic-paper-analysis'],
      estimatedScope: { targetSources: 30, maxHops: 2 },
      milestones: [
        { id: 'm1', query: 'Superconducting Qubits', rationale: 'Core physical layer' },
        { id: 'm2', query: 'Fault Tolerant Codes', rationale: 'Logical qubit scaling' },
        { id: 'm3', query: 'Cryogenic Interconnects', rationale: 'Wiring and thermal dissipation' }
      ]
    };

    const mockEnriched = [
      {
        index: 1,
        citationIndex: 1,
        citationIndices: [1],
        url: 'https://nature.com/q1',
        title: 'Qubit Coherence',
        domain: 'nature.com',
        passage: 'Coherence reached 300 µs.',
        score: 0.95,
        relevanceTier: 'high',
        credibilityScore: 95,
        milestoneId: 'm1',
        milestoneTitle: 'Superconducting Qubits',
        isCited: true
      },
      {
        index: 2,
        citationIndex: 2,
        citationIndices: [2],
        url: 'https://arxiv.org/q2',
        title: 'Surface Codes',
        domain: 'arxiv.org',
        passage: 'Syndrome extraction latency.',
        score: 0.88,
        relevanceTier: 'high',
        credibilityScore: 90,
        milestoneId: 'm2',
        milestoneTitle: 'Fault Tolerant Codes',
        isCited: true
      },
      {
        index: 3,
        citationIndex: 3,
        citationIndices: [],
        url: 'https://ieee.org/q3',
        title: 'Cryogenic Packaging',
        domain: 'ieee.org',
        passage: 'Coaxial cable thermal loads.',
        score: 0.68,
        relevanceTier: 'medium',
        credibilityScore: 85,
        milestoneId: 'm3',
        milestoneTitle: 'Cryogenic Interconnects',
        isCited: false
      }
    ];

    it('groups sources by approved plan milestones and computes counts', () => {
      const groups = groupSourcesByMilestone(mockEnriched, mockPlan);
      assert.equal(groups.length, 3);

      assert.equal(groups[0].milestoneId, 'm1');
      assert.equal(groups[0].totalCount, 1);
      assert.equal(groups[0].citedCount, 1);

      assert.equal(groups[1].milestoneId, 'm2');
      assert.equal(groups[1].totalCount, 1);
      assert.equal(groups[1].citedCount, 1);

      assert.equal(groups[2].milestoneId, 'm3');
      assert.equal(groups[2].totalCount, 1);
      assert.equal(groups[2].citedCount, 0);
    });

    it('computes accurate shelf stats: admitted, cited, background, domains, tiers', () => {
      const stats = computeShelfStats(mockEnriched, mockPlan);
      assert.equal(stats.totalAdmitted, 3);
      assert.equal(stats.totalCited, 2);
      assert.equal(stats.totalBackground, 1);
      assert.equal(stats.uniqueDomainsCount, 3);
      assert.equal(stats.tierCounts.high, 2);
      assert.equal(stats.tierCounts.medium, 1);
      assert.equal(stats.tierCounts.low, 0);

      assert.equal(stats.topDomains.length, 3);
      assert.equal(stats.milestoneBreakdown.length, 3);
      assert.equal(stats.milestoneBreakdown[0].cited, 1);
      assert.equal(stats.milestoneBreakdown[2].cited, 0);
    });
  });

  describe('Evidence Inspection Drawer Detail Extraction', () => {
    const mockEnriched = [
      {
        index: 1,
        citationIndex: 1,
        citationIndices: [1],
        url: 'https://nature.com/articles/q1',
        title: 'Superconducting Transmon Coherence in Cryogenic Dilution',
        domain: 'nature.com',
        passage: 'We observed T1 relaxation times of 312 ± 14 µs at 15 mK base temperature.',
        originalSnippet: 'We observed T1 relaxation times of 312 ± 14 µs at 15 mK base temperature.',
        score: 0.94,
        relevanceTier: 'high',
        credibilityScore: 96,
        milestoneId: 'm1',
        milestoneTitle: 'Superconducting Qubits',
        isCited: true
      }
    ];

    it('extracts surrounding claim from report text', () => {
      const report = `
# تقرير الحوسبة الكمومية

أظهرت القياسات المعملية الحديثة وصول زمن التماسك الكمومي إلى أكثر من 300 ميكروثانية [1] في درجات حرارة التبريد الفائق.

## فصل إضافي
معلومات أخرى غير مرتبطة.
`;
      const claim = extractSurroundingClaim(report, 1);
      assert.ok(claim);
      assert.ok(claim.includes('300 ميكروثانية [1]'));
    });

    it('detects bilingual fidelity condition when Arabic claim cites English passage', () => {
      const arClaim = 'أظهرت القياسات المعملية وصول زمن التماسك الكمومي إلى 300 ميكروثانية [1].';
      const enPassage = 'We observed T1 relaxation times of 312 ± 14 µs at 15 mK base temperature.';
      assert.equal(detectBilingualMismatch(arClaim, enPassage), true);

      // Same language returns false
      assert.equal(detectBilingualMismatch('English claim [1]', 'English passage'), false);
    });

    it('extracts complete CitationInspectionDetail schema for drawer', () => {
      const report = 'وصلت أزمنة التماسك إلى 312 ميكروثانية [1] في درجات حرارة بالغة الانخفاض.';
      const detail = extractCitationInspection(1, mockEnriched, report, 'ar');

      assert.equal(detail.citationIndex, 1);
      assert.equal(detail.sourceTitle, 'Superconducting Transmon Coherence in Cryogenic Dilution');
      assert.equal(detail.sourceDomain, 'nature.com');
      assert.equal(detail.sourceUrl, 'https://nature.com/articles/q1');
      assert.equal(detail.relevanceScore, 0.94);
      assert.equal(detail.relevanceTier, 'high');
      assert.equal(detail.credibilityScore, 96);
      assert.equal(detail.milestoneTitle, 'Superconducting Qubits');
      assert.equal(detail.exactPassage, 'We observed T1 relaxation times of 312 ± 14 µs at 15 mK base temperature.');
      assert.ok(detail.surroundingClaim);
      assert.equal(detail.isBilingual, true);
    });

    it('handles out-of-bounds citation index with safe fallback values', () => {
      const detail = extractCitationInspection(999, mockEnriched, '', 'en');
      assert.equal(detail.citationIndex, 999);
      assert.equal(detail.source, null);
      assert.equal(detail.sourceDomain, 'web');
      assert.ok(detail.exactPassage.length > 0);
    });

    it('extracts surrounding claim when citation is part of a range [1-3] for index 2', () => {
      const report = 'Superconducting qubits achieved fault tolerance thresholds [1-3] under cryogenic cooling.';
      const claim = extractSurroundingClaim(report, 2);
      assert.ok(claim);
      assert.ok(claim.includes('[1-3]'));
    });

    it('ignores code blocks when extracting surrounding claims', () => {
      const report = `
\`\`\`python
# This [1] is in a code block
values = [1, 2]
\`\`\`

Actual finding regarding coherence [1].
`;
      const claim = extractSurroundingClaim(report, 1);
      assert.ok(claim);
      assert.ok(claim.includes('Actual finding regarding coherence [1]'));
      assert.ok(!claim.includes('python'));
    });

    it('does not falsely trigger bilingual mismatch on Arabic texts with English acronyms', () => {
      const arClaim = 'أثبتت تقنية CRISPR كفاءة عالية في التعديل الجيني [1].';
      const arPassage = 'تعتبر أداة CRISPR من أهم الابتكارات في علم الأحياء المعاصر.';
      assert.equal(detectBilingualMismatch(arClaim, arPassage), false);
    });

    it('resolves source by sequential index when citationIndex is unassigned', () => {
      const rawList = [
        {
          index: 1,
          citationIndices: [],
          url: 'https://example.com/item1',
          title: 'First Item',
          domain: 'example.com',
          passage: 'Passage 1',
          score: 0.9,
          relevanceTier: 'high',
          credibilityScore: 85,
          milestoneId: 'm1',
          milestoneTitle: 'Facet 1',
          isCited: false
        }
      ];
      const detail = extractCitationInspection(1, rawList, '', 'en');
      assert.equal(detail.citationIndex, 1);
      assert.equal(detail.sourceTitle, 'First Item');
    });
  });

  describe('200-Source Scale & Multi-Facet Stress Benchmark', () => {
    it('enriches, groups, and filters 200 sources across 5 milestones in under 50ms', () => {
      const plan = {
        id: 'plan-scale',
        version: 1,
        objective: 'Massive Cross-Disciplinary Research Dossier',
        suggestedSkills: ['academic-paper-analysis', 'competitive-market-intelligence'],
        estimatedScope: { targetSources: 200, maxHops: 3 },
        milestones: [
          { id: 'm1', query: 'Milestone 1: Mathematical Foundations', rationale: 'R1' },
          { id: 'm2', query: 'Milestone 2: Empirical Benchmarks', rationale: 'R2' },
          { id: 'm3', query: 'Milestone 3: Algorithmic Complexity', rationale: 'R3' },
          { id: 'm4', query: 'Milestone 4: Industrial Hardware', rationale: 'R4' },
          { id: 'm5', query: 'Milestone 5: Economic Viability', rationale: 'R5' }
        ]
      };

      // Generate 200 sources across 20 domains and 5 milestones
      const domains = ['nature.com', 'arxiv.org', 'ieee.org', 'acm.org', 'science.org', 'techcrunch.com', 'bloomberg.com', 'reuters.com'];
      const rawSources = [];
      for (let i = 1; i <= 200; i++) {
        const mid = `m${((i - 1) % 5) + 1}`;
        const domain = domains[i % domains.length];
        rawSources.push({
          url: `https://${domain}/paper-${i}`,
          title: `Research Investigation Article #${i}`,
          domain,
          snippet: `Empirical evidence chunk #${i} evaluating milestone ${mid} parameters.`,
          credibilityScore: 70 + (i % 30),
          milestoneId: mid
        });
      }

      // 40 citations cited in report
      let reportMarkdown = '# Dossier\n\n';
      for (let c = 1; c <= 40; c++) {
        reportMarkdown += `Finding number ${c} is grounded by verified evidence [${c}].\n\n`;
      }

      const tStart = performance.now();
      const enriched = enrichSources(rawSources, plan, reportMarkdown);
      const groups = groupSourcesByMilestone(enriched, plan);
      const stats = computeShelfStats(enriched, plan);
      const filtered = filterSources(enriched, {
        citationStatus: 'cited',
        relevanceTier: 'high'
      });
      const tDuration = performance.now() - tStart;

      assert.equal(enriched.length, 200);
      assert.equal(groups.length, 5);
      assert.equal(stats.totalAdmitted, 200);
      assert.equal(stats.totalCited, 40);
      assert.equal(stats.totalBackground, 160);
      assert.ok(filtered.length > 0);
      assert.ok(tDuration < 50, `Scale benchmark completed in ${tDuration.toFixed(2)}ms (<50ms limit)`);
    });

    it('preserves general background sources in fallback group without forcing round-robin', () => {
      const plan = {
        milestones: [
          { id: 'm1', query: 'Quantum error correction surface codes' },
          { id: 'm2', query: 'Superconducting qubit coherence times' }
        ]
      };

      const sources = [
        // Matches m1
        { url: 'https://nature.com/qec', title: 'Surface code thresholds', snippet: 'Quantum error correction testing' },
        // Matches m2
        { url: 'https://arxiv.org/coherence', title: 'Qubit coherence dynamics', snippet: 'Superconducting qubit coherence' },
        // Completely unrelated background context
        { url: 'https://example.com/macro', title: 'Macroeconomic inflation forecasts 2026', snippet: 'Central bank interest rate decisions' },
        { url: 'https://example.com/weather', title: 'Global weather patterns', snippet: 'El Nino atmospheric analysis' }
      ];

      const enriched = enrichSources(sources, plan, 'Summary report citing quantum [1].');
      const groups = groupSourcesByMilestone(enriched, plan);

      // Should have 2 plan milestone groups plus 1 general background group
      assert.equal(groups.length, 3);
      const generalGroup = groups.find((g) => g.milestoneId === 'general');
      assert.ok(generalGroup, 'General background group must exist');
      assert.equal(generalGroup.sources.length, 2);
      assert.equal(generalGroup.milestoneQuery, 'General Background Evidence');
      assert.equal(groups[0].sources.length, 1);
      assert.equal(groups[1].sources.length, 1);
    });
  });
});

