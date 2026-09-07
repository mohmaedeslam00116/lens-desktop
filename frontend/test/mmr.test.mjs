import test, { describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mmrModule = null;
let embeddingsModule = null;

try {
  const mmrPath = pathToFileURL(path.resolve(__dirname, '../dist-electron/engine/mmr.js')).href;
  mmrModule = await import(mmrPath);
  const embeddingsPath = pathToFileURL(path.resolve(__dirname, '../dist-electron/engine/embeddings.js')).href;
  embeddingsModule = await import(embeddingsPath);
} catch (err) {
  console.warn('Could not load compiled electron engine modules for MMR testing:', err);
}

describe('Maximal Marginal Relevance (MMR) Core Algorithm', () => {
  test('selectPassagesWithMMR handles empty or invalid inputs gracefully', () => {
    const { selectPassagesWithMMR } = mmrModule || {};
    assert.ok(selectPassagesWithMMR, 'selectPassagesWithMMR must be exported');

    const res1 = selectPassagesWithMMR([]);
    assert.strictEqual(res1.selected.length, 0);
    assert.strictEqual(res1.metrics.totalCandidates, 0);
    assert.strictEqual(res1.metrics.diversityScore, 1.0);

    const res2 = selectPassagesWithMMR(null);
    assert.strictEqual(res2.selected.length, 0);
  });

  test('Lambda balance: lambda=1.0 selects purely by relevance, lambda=0.5 penalizes redundancy', () => {
    const { selectPassagesWithMMR } = mmrModule || {};
    assert.ok(selectPassagesWithMMR);

    // Candidate 1: High relevance, Vector A
    // Candidate 2: Slightly lower relevance, Vector A (near identical to 1)
    // Candidate 3: Lower relevance, Vector B (orthogonal novelty)
    const candidates = [
      { id: 'c1', score: 0.95, vector: [1.0, 0.0, 0.0], content: 'Quantum error correction superconducting' },
      { id: 'c2', score: 0.90, vector: [0.98, 0.05, 0.0], content: 'Quantum error correction superconducting qubits' },
      { id: 'c3', score: 0.80, vector: [0.0, 1.0, 0.0], content: 'Trapped ion optical lattice quantum memory' }
    ];

    // Case A: Pure relevance (lambda = 1.0) -> picks c1 then c2
    const pureRel = selectPassagesWithMMR(candidates, {
      lambda: 1.0,
      maxPassages: 2,
      maxPerSource: 5,
      maxPerDomain: 5,
      domainDecay: 1.0,
      sourceDecay: 1.0
    });
    assert.strictEqual(pureRel.selected.length, 2);
    assert.strictEqual(pureRel.selected[0].id, 'c1');
    assert.strictEqual(pureRel.selected[1].id, 'c2');

    // Case B: Balanced MMR (lambda = 0.5) -> c2 is penalized for redundancy with c1; c3 is chosen instead!
    const balanced = selectPassagesWithMMR(candidates, {
      lambda: 0.5,
      maxPassages: 2,
      maxPerSource: 5,
      maxPerDomain: 5,
      domainDecay: 1.0,
      sourceDecay: 1.0
    });
    assert.strictEqual(balanced.selected.length, 2);
    assert.strictEqual(balanced.selected[0].id, 'c1');
    assert.strictEqual(balanced.selected[1].id, 'c3', 'Candidate 3 should be selected due to novelty');
    assert.ok(balanced.metrics.diversityScore > pureRel.metrics.diversityScore, 'Diversity score should be higher with c3');
  });

  test('Domain and Source Clustering Penalization', () => {
    const { selectPassagesWithMMR } = mmrModule || {};
    assert.ok(selectPassagesWithMMR);

    // Three candidates from domain 'nature.com' with high relevance
    // One candidate from domain 'arxiv.org' with slightly lower relevance
    const candidates = [
      { id: 'nat1', domain: 'nature.com', sourceId: 1, score: 0.95, vector: [1.0, 0.0], content: 'Nature Paper Part 1' },
      { id: 'nat2', domain: 'nature.com', sourceId: 2, score: 0.94, vector: [0.0, 1.0], content: 'Nature Paper Part 2' },
      { id: 'arx1', domain: 'arxiv.org', sourceId: 3, score: 0.90, vector: [0.0, 1.0], content: 'Arxiv Preprint' }
    ];

    // With aggressive domain decay (0.5), picking nat1 will penalize nat2, promoting arx1
    const result = selectPassagesWithMMR(candidates, {
      lambda: 0.9,
      maxPassages: 2,
      domainDecay: 0.5,
      sourceDecay: 1.0,
      maxPerDomain: 5
    });

    assert.strictEqual(result.selected.length, 2);
    assert.strictEqual(result.selected[0].id, 'nat1');
    assert.strictEqual(result.selected[1].id, 'arx1', 'Arxiv should be chosen second due to domain diversity');
    assert.strictEqual(result.metrics.uniqueDomains, 2);
  });

  test('Hard Caps: maxPerSource and maxPerDomain are strictly enforced', () => {
    const { selectPassagesWithMMR } = mmrModule || {};
    assert.ok(selectPassagesWithMMR);

    const candidates = [
      { id: 'c1', domain: 'wiki.org', sourceId: 1, score: 0.9, vector: [1, 0] },
      { id: 'c2', domain: 'wiki.org', sourceId: 1, score: 0.8, vector: [0, 1] },
      { id: 'c3', domain: 'wiki.org', sourceId: 1, score: 0.7, vector: [1, 1] },
      { id: 'c4', domain: 'mit.edu', sourceId: 2, score: 0.6, vector: [1, 0] }
    ];

    const result = selectPassagesWithMMR(candidates, {
      maxPassages: 4,
      maxPerSource: 1,
      maxPerDomain: 2
    });

    const source1Count = result.selected.filter(c => c.sourceId === 1).length;
    assert.strictEqual(source1Count, 1, 'Strictly 1 passage allowed from source 1');
    assert.strictEqual(result.selected.length, 2);
  });

  test('Lexical Token Jaccard Fallback for candidate similarity when vectors are absent', () => {
    const { selectPassagesWithMMR, computeCandidateSimilarity } = mmrModule || {};
    assert.ok(selectPassagesWithMMR);
    assert.ok(computeCandidateSimilarity);

    const candA = { id: 'a', score: 0.9, content: 'The artificial intelligence models generate accurate technical reports.' };
    const candB = { id: 'b', score: 0.85, content: 'The artificial intelligence models generate accurate summaries.' };
    const candC = { id: 'c', score: 0.75, content: 'Photosynthesis converts sunlight and water into glucose in plant cells.' };

    const simAB = computeCandidateSimilarity(candA, candB);
    const simAC = computeCandidateSimilarity(candA, candC);

    assert.ok(simAB > 0.5, `Expected high lexical overlap between A and B, got ${simAB}`);
    assert.strictEqual(simAC, 0, `Expected zero lexical overlap between A and C, got ${simAC}`);

    // Lexical MMR selects A and then C instead of redundant B
    const result = selectPassagesWithMMR([candA, candB, candC], {
      lambda: 0.5,
      maxPassages: 2
    });

    assert.strictEqual(result.selected[0].id, 'a');
    assert.strictEqual(result.selected[1].id, 'c', 'Candidate C should be chosen over redundant B via lexical Jaccard');
  });

  test('Arabic Lexical Redundancy Suppression', () => {
    const { selectPassagesWithMMR, computeCandidateSimilarity } = mmrModule || {};
    assert.ok(selectPassagesWithMMR);

    // Text 1 and Text 2 share normalized Arabic roots and concepts
    const candAr1 = { id: 'ar1', score: 0.95, content: 'تطبيقات الحوسبة الكمومية في معالجة البيانات وتشفير المعلومات.' };
    const candAr2 = { id: 'ar2', score: 0.90, content: 'استخدام الحواسيب الكمومية لمعالجة وتشفير البيانات والمعلومات.' };
    const candAr3 = { id: 'ar3', score: 0.80, content: 'تاريخ الحضارة الفرعونية وبناء الأهرامات في مصر القديمة.' };

    const simAr12 = computeCandidateSimilarity(candAr1, candAr2);
    const simAr13 = computeCandidateSimilarity(candAr1, candAr3);

    assert.ok(simAr12 >= 0.35, `Arabic duplicate passages must have high similarity, got ${simAr12}`);
    assert.strictEqual(simAr13, 0, 'Unrelated Arabic topics must have zero similarity');

    const result = selectPassagesWithMMR([candAr1, candAr2, candAr3], {
      lambda: 0.5,
      maxPassages: 2
    });

    assert.strictEqual(result.selected[0].id, 'ar1');
    assert.strictEqual(result.selected[1].id, 'ar3', 'Novel Egyptian topic chosen over redundant quantum paraphrase');
  });
});

describe('MMR Hybrid Retrieval Pipeline Integration', () => {
  test('rankSourcePassages executes MMR selection and reports diversityScore', async () => {
    const { rankSourcePassages, BaseEmbedding } = embeddingsModule || {};
    assert.ok(rankSourcePassages);

    class MockEmbedding extends BaseEmbedding {
      async embedText(texts) {
        return texts.map(t => {
          const lower = t.toLowerCase();
          if (lower.includes('superconductor') || lower.includes('qubit')) {
            return [0.95, 0.05, 0.0];
          }
          if (lower.includes('algorithm') || lower.includes('shor')) {
            return [0.05, 0.95, 0.0];
          }
          return [0.5, 0.5, 0.0];
        });
      }
    }

    const sources = [
      {
        url: 'https://site-a.com/superconducting-qubits',
        title: 'Superconducting Qubits Architecture',
        domain: 'site-a.com',
        content: 'Superconducting transmon qubits operate at millikelvin temperatures with josephson junctions for quantum coherence.'
      },
      {
        url: 'https://site-a.com/superconducting-qubits-repeat',
        title: 'Superconducting Qubits Repeated Facts',
        domain: 'site-a.com',
        content: 'Transmon qubits operate at millikelvin temperatures utilizing josephson junctions for quantum processing.'
      },
      {
        url: 'https://site-b.com/quantum-algorithms',
        title: 'Quantum Algorithms and Complexity',
        domain: 'site-b.com',
        content: 'Quantum algorithm development focuses on Shor factoring and Grover search accelerating algebraic operations.'
      }
    ];

    const model = new MockEmbedding({});
    const res = await rankSourcePassages(sources, ['quantum superconductor algorithm'], model, {
      maxTotalPassages: 2,
      mmrLambda: 0.6,
      maxPerSource: 1
    });

    assert.strictEqual(res.selectedChunks.length, 2);
    assert.ok(typeof res.metrics.diversityScore === 'number');
    assert.ok(res.metrics.diversityScore >= 0 && res.metrics.diversityScore <= 1.0);

    // Selected chunks should cover both site-a and site-b, avoiding the redundant site-a duplicate
    const domains = res.selectedChunks.map(c => c.domain);
    assert.ok(domains.includes('site-a.com'), 'Must include site-a');
    assert.ok(domains.includes('site-b.com'), 'Must include site-b');
  });
});
