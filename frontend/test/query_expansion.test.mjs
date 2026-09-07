import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  expandQueryBilingual,
  detectQueryLanguage,
  stemAndNormalizeArabicPhrase
} from '../dist-electron/engine/queryExpansion.js';

import { BM25Index } from '../dist-electron/engine/bm25.js';
import { rankSourcePassages, fallbackEvidence } from '../dist-electron/engine/embeddings.js';

describe('Cross-Lingual Query Expansion Core', () => {
  it('detectQueryLanguage identifies Arabic, English, and Mixed queries correctly', () => {
    assert.equal(detectQueryLanguage('خوارزمية شور في التشفير الكمومي'), 'ar');
    assert.equal(detectQueryLanguage('Quantum error correction in superconducting qubits'), 'en');
    assert.equal(detectQueryLanguage('تطبيقات نماذج LLM مع تقنية RAG في البحث العلمي'), 'mixed');
    assert.equal(detectQueryLanguage(''), 'en');
  });

  it('stemAndNormalizeArabicPhrase strips clitics and normalizes across variants', () => {
    const stemmed1 = stemAndNormalizeArabicPhrase('الحوسبة الكمومية');
    const stemmed2 = stemAndNormalizeArabicPhrase('حوسبة كمومية');
    assert.equal(stemmed1, stemmed2, 'Definite article "ال" should be stemmed so both match identically');

    const stemmedAI = stemAndNormalizeArabicPhrase('والذكاء الاصطناعي');
    assert.ok(stemmedAI.includes('ذكاء'));
    assert.ok(stemmedAI.includes('اصطناعي'));
  });

  it('Expands Arabic technical queries with English terminology and acronyms regardless of definite articles', () => {
    // Uses queries with definite articles ('الحوسبة الكمومية', 'الكوانتم')
    const query = 'الحوسبة الكمومية وتشفير ما بعد الكوانتم';
    const expanded = expandQueryBilingual(query);

    assert.equal(expanded.detectedLanguage, 'ar');
    assert.ok(expanded.originalTokens.length > 0);

    const terms = expanded.allTerms.map(t => t.term);
    // Should include English translations of 'حوسبة كمومية'
    assert.ok(terms.includes('quantum'), 'Should contain "quantum"');
    assert.ok(terms.includes('computing') || terms.includes('computation'), 'Should contain "computing"');
    // Should include English translations of 'تشفير ما بعد الكوانتم'
    assert.ok(terms.includes('post'), 'Should contain "post"');
    assert.ok(terms.includes('cryptography'), 'Should contain "cryptography"');
    assert.ok(terms.includes('pqc'), 'Should contain acronym "pqc"');

    // Original terms should have weight 1.0
    const arOriginal = expanded.allTerms.find(t => t.term.includes('كموم') || t.term.includes('حوسب'));
    assert.ok(arOriginal);
    assert.equal(arOriginal.weight, 1.0);

    // Expanded terms should have calibrated weight
    const quantumTerm = expanded.allTerms.find(t => t.term === 'quantum');
    assert.ok(quantumTerm);
    assert.ok(quantumTerm.weight < 1.0 && quantumTerm.weight >= 0.2);
  });

  it('Expands English technical queries with Arabic terminology', () => {
    const query = 'retrieval augmented generation architectures';
    const expanded = expandQueryBilingual(query);

    assert.equal(expanded.detectedLanguage, 'en');
    const terms = expanded.allTerms.map(t => t.term);

    assert.ok(terms.includes('retrieval'));
    assert.ok(terms.includes('augmented'));
    assert.ok(terms.includes('generation'));

    // Should include Arabic translations: توليد / معزز / استرجاع
    const hasArabicMatch = terms.some(t => /[\u0600-\u06FF]/.test(t));
    assert.ok(hasArabicMatch, 'Should contain Arabic expanded terms');
    assert.ok(terms.includes('rag'), 'Should include acronym rag');
  });

  it('Word boundary protection prevents substring collisions (e.g. "ai" inside "blockchain" or "training")', () => {
    const query = 'blockchain technology and model training without failure';
    const expanded = expandQueryBilingual(query);
    const terms = expanded.allTerms.map(t => t.term);

    // Should NOT inject artificial intelligence / ذكاء اصطناعي simply because 'ai' is in 'blockchain' or 'training'
    assert.ok(!terms.includes('ذكاء'), 'Must not false-positive match "ذكاء" from "ai" substring inside words');
    assert.ok(!terms.includes('اصطناعي'), 'Must not false-positive match "اصطناعي" from substring');
  });

  it('Expands technical acronyms bidirectionally (RAG, LLM, PQC, QEC)', () => {
    // English acronym query
    const ragQuery = expandQueryBilingual('Evaluating RAG benchmarks on question answering');
    const ragTerms = ragQuery.allTerms.map(t => t.term);
    assert.ok(ragTerms.includes('rag'));
    assert.ok(ragTerms.includes('retrieval'));
    assert.ok(ragTerms.includes('augmented'));
    assert.ok(ragTerms.includes('generation'));

    // Arabic query with conceptual description expanding to acronym
    const qecQuery = expandQueryBilingual('تطوير تصحيح الاخطاء الكمومية للدارات الفائقة');
    const qecTerms = qecQuery.allTerms.map(t => t.term);
    assert.ok(qecTerms.includes('qec'), 'Should expand to QEC acronym');
    assert.ok(qecTerms.includes('quantum'));
    assert.ok(qecTerms.includes('error'));
    assert.ok(qecTerms.includes('correction'));
  });

  it('Loanword bridge maps phonetic loanwords accurately (كوانتم, ترانزمون, كيوبت)', () => {
    const query = 'كوانتم و ترانزمون في كيوبتات السيليكون';
    const expanded = expandQueryBilingual(query);
    const terms = expanded.allTerms.map(t => t.term);

    assert.ok(terms.includes('quantum'), 'كوانتم should expand to quantum');
    assert.ok(terms.includes('transmon'), 'ترانزمون should expand to transmon');
    assert.ok(terms.includes('qubit') || terms.includes('qubits'), 'كيوبتات should expand to qubit(s)');
  });
});

describe('BM25 Weighted Scoring & Search with Query Expansion', () => {
  it('searchWeighted scores documents proportionally to term weights', () => {
    const index = new BM25Index();
    index.addDocument('doc1', 'Quantum computing utilizes superconducting transmon qubits for entanglement.');
    index.addDocument('doc2', 'Classical computing relies on silicon transistors and binary logic gates.');

    // Unweighted search
    const unweighted = index.searchWeighted([
      { term: 'quantum', weight: 1.0 },
      { term: 'qubits', weight: 1.0 }
    ]);

    // Weighted search with lower weight on 'qubits'
    const weighted = index.searchWeighted([
      { term: 'quantum', weight: 1.0 },
      { term: 'qubits', weight: 0.2 }
    ]);

    assert.ok(unweighted.length > 0 && weighted.length > 0);
    assert.equal(unweighted[0].id, 'doc1');
    assert.equal(weighted[0].id, 'doc1');
    assert.ok(weighted[0].score < unweighted[0].score, 'Lower term weight should yield lower composite BM25 score');
  });

  it('Cross-Lingual Retrieval Scenario 1: Arabic Query retrieves English-Only Documents', () => {
    const index = new BM25Index();
    index.addDocument(
      'en_quantum',
      'Fault-tolerant quantum computing architectures and surface codes for superconducting qubits.'
    );
    index.addDocument(
      'en_vision',
      'Deep convolutional neural networks for real-time autonomous vehicle perception and detection.'
    );
    index.addDocument(
      'en_macro',
      'Global macroeconomic trends in post-pandemic fiscal policy and interest rate adjustments.'
    );

    const arabicQuery = 'الحوسبة الكمومية وتصحيح الخطأ الكمومي في الكيوبتات';

    // Raw unexpanded search matches 0 English documents
    const rawMatches = index.search(arabicQuery);
    assert.equal(rawMatches.length, 0, 'Pure unexpanded BM25 should match 0 English documents');

    // Expanded query search
    const expanded = expandQueryBilingual(arabicQuery);
    const expandedMatches = index.searchWeighted(expanded.allTerms);

    assert.ok(expandedMatches.length > 0, 'Expanded query must retrieve documents cross-lingually');
    assert.equal(expandedMatches[0].id, 'en_quantum', 'Must rank quantum computing paper as #1');
    assert.ok(expandedMatches[0].score > 0);
  });

  it('Cross-Lingual Retrieval Scenario 2: English Query retrieves Arabic-Only Documents', () => {
    const index = new BM25Index();
    index.addDocument(
      'ar_rag',
      'تطبيقات التوليد المعزز بالاسترجاع والذكاء الاصطناعي في محركات البحث وقواعد البيانات المعرفية.'
    );
    index.addDocument(
      'ar_space',
      'استكشاف الفضاء والبعثات المأهولة إلى كوكب المريخ ودراسة العينات الصخرية.'
    );
    index.addDocument(
      'ar_history',
      'تاريخ الفلسفة اليونانية القديمة وتأثيرها على فلاسفة العصر الإسلامي الوسيط.'
    );

    const englishQuery = 'retrieval augmented generation in search engines';

    // Unexpanded matches
    const unexpanded = index.search(englishQuery);
    assert.equal(unexpanded.length, 0, 'Pure unexpanded BM25 should match 0 Arabic documents');

    // Expanded query search
    const expanded = expandQueryBilingual(englishQuery);
    const matches = index.searchWeighted(expanded.allTerms);

    assert.ok(matches.length > 0, 'Cross-lingual retrieval must find Arabic document');
    assert.equal(matches[0].id, 'ar_rag', 'Must rank RAG Arabic document as #1');
  });
});

describe('Pipeline Integration: rankSourcePassages & fallbackEvidence with Query Expansion', () => {
  // Mock 768-dim vector embedding generator
  function mockVector(seed = 1) {
    const v = new Array(768).fill(0);
    v[0] = Math.cos(seed);
    v[1] = Math.sin(seed);
    return v;
  }

  const mockEmbeddingClient = {
    model: 'text-embedding-004',
    dimensions: 768,
    async embedText(texts) {
      const arr = Array.isArray(texts) ? texts : [texts];
      return arr.map(t => mockVector(t.length));
    }
  };

  it('rankSourcePassages reports query expansion telemetry in metrics', async () => {
    const sources = [
      {
        url: 'https://arxiv.org/abs/2301.0001',
        title: 'Recent Advances in Post-Quantum Cryptography',
        domain: 'arxiv.org',
        content: 'Post-quantum cryptography focuses on cryptographic algorithms secure against quantum attacks.'
      },
      {
        url: 'https://nature.com/articles/bio-01',
        title: 'Marine Ecosystem Dynamics',
        domain: 'nature.com',
        content: 'Coral reef ecosystems are highly vulnerable to ocean acidification and warming seawater.'
      }
    ];

    const result = await rankSourcePassages(
      sources,
      ['تشفير ما بعد الكوانتم والخوارزميات المقاومة للحوسبة الكمومية'],
      mockEmbeddingClient,
      {
        disableCache: true
      }
    );

    assert.ok(result.metrics);
    assert.ok(result.metrics.queryExpansion, 'Should include queryExpansion telemetry in metrics');
    assert.equal(result.metrics.queryExpansion.detectedLanguage, 'ar');
    assert.ok(result.metrics.queryExpansion.originalTokensCount > 0);
    assert.ok(result.metrics.queryExpansion.expandedTermsCount > 0);
    assert.ok(result.evidenceText.includes('Post-Quantum Cryptography'));
  });

  it('fallbackEvidence retrieves relevant passages cross-lingually when embeddings are absent', () => {
    const sources = [
      {
        url: 'https://quantum-computing.ibm.com/overview',
        title: 'Superconducting Qubits and Quantum Processors',
        domain: 'ibm.com',
        content: 'IBM superconducting quantum processors utilize transmon architecture to preserve coherence times.'
      },
      {
        url: 'https://gardening.org/soil-prep',
        title: 'Organic Soil Preparation and Composting',
        domain: 'gardening.org',
        content: 'Preparing nutrient-rich organic soil requires composting vegetable waste and balancing nitrogen levels.'
      }
    ];

    const arabicQuery = 'حوسبة كمومية في ترانزمون وكيوبتات';
    const evidence = fallbackEvidence(sources, [arabicQuery]);

    assert.ok(evidence.includes('Superconducting Qubits and Quantum Processors'));
    assert.ok(evidence.includes('transmon architecture'));
  });
});
