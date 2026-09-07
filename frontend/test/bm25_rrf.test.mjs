/**
 * TDD Unit and Integration Tests for Pure TypeScript BM25 and RRF Fusion
 * Part of LENS Multi-Stage Hybrid Retrieval Pipeline (Ticket #4)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let bm25Module;
let rrfModule;
try {
  bm25Module = require('../dist-electron/engine/bm25.js');
  rrfModule = require('../dist-electron/engine/rrf.js');
} catch (e) {
  // If not yet compiled by tsc, load mockable pure JS implementation
  console.log('[Test Setup] dist-electron not yet built; please run build:electron');
}

describe('Bilingual Normalization & Morphology', () => {
  test('normalizeArabic strips diacritics, tatweel, and normalizes alef, taa marbuta, and yaa', () => {
    const { normalizeArabic } = bm25Module;
    assert.ok(normalizeArabic, 'normalizeArabic must be exported');

    // Diacritics (tashkeel)
    assert.strictEqual(normalizeArabic('الخَوارِزْمِيّةُ'), 'الخوارزميه');

    // Tatweel
    assert.strictEqual(normalizeArabic('خـــوارزمية'), 'خوارزميه');

    // Alef variants (إ, أ, آ, ٱ -> ا)
    assert.strictEqual(normalizeArabic('إبراهيم'), 'ابراهيم');
    assert.strictEqual(normalizeArabic('أحمد'), 'احمد');
    assert.strictEqual(normalizeArabic('آسيا'), 'اسيا');

    // Taa Marbuta (ة -> ه)
    assert.strictEqual(normalizeArabic('مكتبة'), 'مكتبه');

    // Yaa variants (ى -> ي)
    assert.strictEqual(normalizeArabic('مستشفى'), 'مستشفي');
  });

  test('stemArabicWord strips common clitics (ال, وال, فال, بال, لل) for stems >= 4 chars', () => {
    const { stemArabicWord } = bm25Module;
    assert.ok(stemArabicWord, 'stemArabicWord must be exported');

    // Definite article 'ال'
    assert.strictEqual(stemArabicWord('الخوارزميه'), 'خوارزميه');

    // Compound conjunction 'وال'
    assert.strictEqual(stemArabicWord('والحوسبه'), 'حوسبه');

    // Compound preposition 'بال'
    assert.strictEqual(stemArabicWord('بالذكاء'), 'ذكاء');

    // Compound 'لل'
    assert.strictEqual(stemArabicWord('للبيانات'), 'بيانات');

    // Preserves short words (< 4 chars)
    assert.strictEqual(stemArabicWord('اب'), 'اب');
    assert.strictEqual(stemArabicWord('يد'), 'يد');
  });

  test('tokenizeBilingual extracts and normalizes bilingual English and Arabic tokens without stopwords', () => {
    const { tokenizeBilingual } = bm25Module;
    assert.ok(tokenizeBilingual, 'tokenizeBilingual must be exported');

    // Arabic mixed with stopwords
    const arTokens = tokenizeBilingual('في هذا البحث ندرس الخوارزميات الكمية وتطبيقاتها');
    // 'في' and 'هذا' should be pruned as stopwords
    assert.ok(!arTokens.includes('في'));
    assert.ok(!arTokens.includes('هذا'));
    // Stems should be present
    assert.ok(arTokens.includes('بحث'));
    assert.ok(arTokens.includes('خوارزميات'));

    // English with punctuation and stopwords
    const enTokens = tokenizeBilingual('The State-of-the-Art in Quantum Computing (2026)!');
    assert.deepStrictEqual(enTokens, ['state', 'art', 'quantum', 'computing', '2026']);

    // Mixed bilingual text
    const mixed = tokenizeBilingual('نماذج LLM الحديثة مثل GPT-4 و Claude');
    assert.ok(mixed.includes('نماذج'));
    assert.ok(mixed.includes('llm'));
    assert.ok(mixed.includes('حديثه'));
    assert.ok(mixed.includes('gpt'));
    assert.ok(mixed.includes('4'));
    assert.ok(mixed.includes('claude'));
  });
});

describe('Pure TypeScript Okapi BM25 Index & Search', () => {
  test('BM25Index correctly indexes documents and computes Robertson-Spärck Jones IDF', () => {
    const { BM25Index } = bm25Module;
    const index = new BM25Index();

    index.addDocument('doc1', 'Quantum computing uses qubits for matrix operations');
    index.addDocument('doc2', 'Solid state battery chemistry enables high energy density');
    index.addDocument('doc3', 'Quantum algorithms solve optimization problems faster than classical computers');

    assert.strictEqual(index.documentCount, 3);
    assert.ok(index.avgDocLength > 0);

    // Term occurring in 2 docs ('quantum') should have lower IDF than term in 1 doc ('battery')
    const idfQuantum = index.idf('quantum');
    const idfBattery = index.idf('battery');
    assert.ok(idfBattery > idfQuantum, `IDF of rare term 'battery' (${idfBattery}) must be higher than 'quantum' (${idfQuantum})`);
  });

  test('BM25 search returns relevant documents ranked by Okapi score', () => {
    const { BM25Index } = bm25Module;
    const index = new BM25Index();

    index.addDocument('quantum_1', 'Falcon-X 128-qubit quantum processor with 99.9% two-qubit gate fidelity.');
    index.addDocument('battery_1', 'Solid-state silicon-anode battery delivers 520 Wh/kg with fast charging.');
    index.addDocument('pqc_1', 'Post-quantum cryptography standards include FIPS 203 ML-KEM key encapsulation.');

    // Search for battery
    const resultsBattery = index.search('battery 520 Wh/kg silicon anode');
    assert.ok(resultsBattery.length > 0);
    assert.strictEqual(resultsBattery[0].id, 'battery_1');
    assert.ok(resultsBattery[0].score > 0);

    // Search for quantum
    const resultsQuantum = index.search('Falcon-X quantum processor qubits');
    assert.ok(resultsQuantum.length > 0);
    assert.strictEqual(resultsQuantum[0].id, 'quantum_1');

    // Search in Arabic
    index.addDocument('ar_crypto', 'معايير التشفير ما بعد الكم تتضمن خوارزميات التغليف والمفاتيح العامة');
    index.addDocument('ar_solar', 'توليد الطاقة الشمسية باستخدام خلايا البيروفسكايت عالية الكفاءة');

    const resultsAr = index.search('خوارزميات التشفير ما بعد الكم');
    assert.ok(resultsAr.length > 0);
    assert.strictEqual(resultsAr[0].id, 'ar_crypto');
  });

  test('BM25 term frequency saturation: k1 dampens infinite repetitions', () => {
    const { BM25Index } = bm25Module;
    const index = new BM25Index({ k1: 1.2, b: 0 }); // disable length normalization to isolate tf

    // Doc A has 1 mention, Doc B has 2 mentions, Doc C has 20 mentions
    index.addDocument('docA', 'semiconductor');
    index.addDocument('docB', 'semiconductor semiconductor');
    index.addDocument('docC', 'semiconductor '.repeat(20));

    const res = index.search('semiconductor');
    const scoreA = res.find(r => r.id === 'docA').score;
    const scoreB = res.find(r => r.id === 'docB').score;
    const scoreC = res.find(r => r.id === 'docC').score;

    assert.ok(scoreB > scoreA, 'Doc with 2 mentions should score higher than 1 mention');
    assert.ok(scoreC > scoreB, 'Doc with 20 mentions should score higher than 2 mentions');

    // With k1=1.2, 20 mentions should NOT be 10x the score of 2 mentions (saturation curve)
    const ratio = scoreC / scoreB;
    assert.ok(ratio < 2.5, `Score growth should saturate: ratio is ${ratio}, expected < 2.5`);
  });

  test('BM25 document length normalization: parameter b penalizes bloated documents', () => {
    const { BM25Index } = bm25Module;
    const index = new BM25Index({ k1: 1.2, b: 0.75 });

    // Short concise document vs heavily padded document with same target mention
    index.addDocument('concise', 'Graphene supercapacitors provide ultra-high power density.');
    index.addDocument('bloated', 'Graphene supercapacitors. ' + 'Random unrelated filler text about culinary recipes and baking techniques. '.repeat(15));

    const res = index.search('graphene supercapacitors');
    assert.strictEqual(res[0].id, 'concise', 'Concise relevant document must score higher than bloated document with filler');
  });
});

describe('Reciprocal Rank Fusion (RRF) Engine', () => {
  test('fuseRankings combines multiple candidate lists with standard k=60 smoothing', () => {
    const { fuseRankings } = rrfModule;
    assert.ok(fuseRankings, 'fuseRankings must be exported');

    // System 1 (Dense Vector Ranking)
    const denseList = {
      name: 'dense',
      weight: 1.0,
      items: [
        { id: 'doc_A', score: 0.95 },
        { id: 'doc_B', score: 0.88 },
        { id: 'doc_C', score: 0.75 }
      ]
    };

    // System 2 (BM25 Lexical Ranking)
    const bm25List = {
      name: 'bm25',
      weight: 0.8,
      items: [
        { id: 'doc_B', score: 14.2 }, // Rank 1 in BM25
        { id: 'doc_A', score: 11.5 }, // Rank 2 in BM25
        { id: 'doc_D', score: 8.0 }   // Rank 3 in BM25
      ]
    };

    const fused = fuseRankings([denseList, bm25List], { k: 60 });

    assert.strictEqual(fused.length, 4);

    // doc_A score: 1.0 / (60 + 1) + 0.8 / (60 + 2) = 1/61 + 0.8/62 = 0.016393 + 0.012903 = 0.029296
    // doc_B score: 1.0 / (60 + 2) + 0.8 / (60 + 1) = 1/62 + 0.8/61 = 0.016129 + 0.013114 = 0.029243
    // Both doc_A and doc_B are top-2 consensus items
    const topIds = fused.slice(0, 2).map(f => f.id);
    assert.ok(topIds.includes('doc_A'));
    assert.ok(topIds.includes('doc_B'));

    // Verify per-system rank and rawScore transparency
    const docA = fused.find(f => f.id === 'doc_A');
    assert.strictEqual(docA.ranks.dense, 1);
    assert.strictEqual(docA.ranks.bm25, 2);
    assert.strictEqual(docA.rawScores.dense, 0.95);
    assert.strictEqual(docA.rawScores.bm25, 11.5);
  });

  test('fuseRankings handles disjoint candidate sets and respects topK limit', () => {
    const { fuseRankings } = rrfModule;

    const list1 = {
      name: 'l1',
      items: [{ id: '1' }, { id: '2' }, { id: '3' }]
    };
    const list2 = {
      name: 'l2',
      items: [{ id: '4' }, { id: '5' }]
    };

    const fusedTop2 = fuseRankings([list1, list2], { topK: 2 });
    assert.strictEqual(fusedTop2.length, 2);
    assert.ok(fusedTop2[0].score >= fusedTop2[1].score);
  });
});

describe('Hybrid Search Pipeline Integration (BM25 + Dense + RRF)', () => {
  test('rankSourcePassages executes BM25+Dense RRF and reports hybridMode in metrics', async () => {
    const embeddingsModule = require('../dist-electron/engine/embeddings.js');
    const { rankSourcePassages, BaseEmbedding } = embeddingsModule;

    class MockEmbedder extends BaseEmbedding {
      async embedText(texts) {
        // Return simple 3-dim mock vectors
        return texts.map(() => [0.577, 0.577, 0.577]);
      }
    }

    const sources = [
      {
        url: 'https://example.com/source1',
        title: 'Solid State Batteries',
        domain: 'example.com',
        content: 'Solid state batteries use solid electrolytes instead of liquid. They achieve higher energy density of 500 Wh/kg.'
      },
      {
        url: 'https://example.org/source2',
        title: 'Quantum Processors',
        domain: 'example.org',
        content: 'Superconducting quantum circuits operate at millikelvin temperatures. Qubit coherence time is critical.'
      }
    ];

    const result = await rankSourcePassages(sources, ['solid state batteries 500 Wh/kg'], new MockEmbedder(), {
      maxTotalPassages: 4,
      maxPerSource: 2
    });

    assert.strictEqual(result.metrics.hybridMode, true);
    assert.ok(result.selectedChunks.length > 0);
    assert.strictEqual(result.selectedChunks[0].citationId, 1);
    assert.ok(result.selectedChunks[0].score > 0);
  });

  test('fallbackEvidence uses BM25 when queries are passed to select relevant excerpts', () => {
    const embeddingsModule = require('../dist-electron/engine/embeddings.js');
    const { fallbackEvidence } = embeddingsModule;

    const sources = [
      {
        url: 'https://example.com/test',
        title: 'Technical Specification',
        domain: 'example.com',
        content: 'Unrelated intro paragraph that discusses history and general background for 1000 characters. '.repeat(5) +
                 '\nCRITICAL SPEC: The exact throughput limit is 12,500 operations per second under peak load.\n' +
                 'Additional suffix text here.'
      }
    ];

    const evidence = fallbackEvidence(sources, ['throughput limit 12,500 operations']);
    assert.ok(evidence.includes('12,500 operations per second'), 'BM25 fallback must extract the passage containing target query terms');
  });
});

