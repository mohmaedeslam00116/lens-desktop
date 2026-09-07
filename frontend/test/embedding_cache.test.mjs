import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cacheModule = null;
let embeddingsModule = null;

try {
  const cachePath = pathToFileURL(path.resolve(__dirname, '../dist-electron/engine/embeddingCache.js')).href;
  cacheModule = await import(cachePath);
  const embeddingsPath = pathToFileURL(path.resolve(__dirname, '../dist-electron/engine/embeddings.js')).href;
  embeddingsModule = await import(embeddingsPath);
} catch (err) {
  console.warn('Could not load compiled electron engine modules for cache testing:', err);
}

describe('Local Disk LRU Embedding Cache & Versioned Space Index', () => {
  let tempCacheDir = '';

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cache-test-'));
  });

  afterEach(() => {
    try {
      if (tempCacheDir && fs.existsSync(tempCacheDir)) {
        fs.rmSync(tempCacheDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  test('Basic get and set with deterministic SHA-256 keying', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache, 'EmbeddingCache must be exported');

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const text = 'Quantum error correction with superconducting transmon circuits';
    const key = cache.computeKey('openai', 'text-embedding-3-small', text);
    assert.strictEqual(typeof key, 'string');
    assert.strictEqual(key.length, 64, 'SHA-256 hash must be 64 characters hex');

    // Initially a miss
    const missed = await cache.get('openai', 'text-embedding-3-small', text);
    assert.strictEqual(missed, null);

    // Set vector
    const vector = [0.15, 0.85, 0.42];
    await cache.set('openai', 'text-embedding-3-small', text, vector);

    // Now a hit
    const hit = await cache.get('openai', 'text-embedding-3-small', text);
    assert.deepStrictEqual(hit, vector);

    const stats = cache.getStats();
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 1);
    assert.strictEqual(stats.totalEntries, 1);
  });

  test('Namespace isolation across providers and models', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache);

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const text = 'Universal gate synthesis for topological quantum computers';
    await cache.set('openai', 'text-embedding-3-small', text, [0.1, 0.2]);

    // Same text, different provider -> miss
    const geminiMiss = await cache.get('gemini', 'text-embedding-004', text);
    assert.strictEqual(geminiMiss, null);

    // Same text, different model -> miss
    const largeModelMiss = await cache.get('openai', 'text-embedding-3-large', text);
    assert.strictEqual(largeModelMiss, null);

    // Original provider and model -> hit
    const openaiHit = await cache.get('openai', 'text-embedding-3-small', text);
    assert.deepStrictEqual(openaiHit, [0.1, 0.2]);
  });

  test('Batch getBatch and setBatch with partial hits', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache);

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const textA = 'Document chunk Alpha';
    const textB = 'Document chunk Beta';
    const textC = 'Document chunk Gamma';
    const textD = 'Document chunk Delta';

    // Pre-cache Alpha (index 0) and Gamma (index 2)
    await cache.setBatch('openai', 'model-1', [
      { text: textA, vector: [1, 0] },
      { text: textC, vector: [0, 1] }
    ]);

    const batchRes = await cache.getBatch('openai', 'model-1', [textA, textB, textC, textD]);

    assert.strictEqual(batchRes.hits.size, 2);
    assert.deepStrictEqual(batchRes.hits.get(0), [1, 0]);
    assert.deepStrictEqual(batchRes.hits.get(2), [0, 1]);

    assert.strictEqual(batchRes.misses.length, 2);
    assert.strictEqual(batchRes.misses[0].index, 1);
    assert.strictEqual(batchRes.misses[0].text, textB);
    assert.strictEqual(batchRes.misses[1].index, 3);
    assert.strictEqual(batchRes.misses[1].text, textD);
  });

  test('LRU Eviction keeps capacity bounded and purges oldest disk files', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache);

    // Max capacity: 10 entries (minimum clamped to 10)
    const cache = new EmbeddingCache({ cacheDir: tempCacheDir, maxEntries: 10 });
    await cache.init();

    // Insert 12 entries
    for (let i = 0; i < 12; i++) {
      await cache.set('openai', 'm1', `text_${i}`, [i, i * 2]);
    }

    const stats = cache.getStats();
    assert.ok(stats.totalEntries <= 10, `Expected entries <= 10, got ${stats.totalEntries}`);

    // Verify oldest items (text_0, text_1) were evicted
    const hitOldest = await cache.get('openai', 'm1', 'text_0');
    assert.strictEqual(hitOldest, null, 'Oldest item should have been evicted');

    // Newer items are still present
    const hitNewest = await cache.get('openai', 'm1', 'text_11');
    assert.deepStrictEqual(hitNewest, [11, 22]);
  });

  test('Disk persistence across instance restarts', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache);

    // Instance 1 writes
    const cache1 = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache1.init();
    await cache1.set('gemini', 'text-embedding-004', 'Persistent research memory', [0.77, 0.88, 0.99]);

    // Instance 2 reads from the same disk folder
    const cache2 = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache2.init();
    const loaded = await cache2.get('gemini', 'text-embedding-004', 'Persistent research memory');

    assert.deepStrictEqual(loaded, [0.77, 0.88, 0.99]);
  });

  test('Model dimension migration invalidates stale vector entries', async () => {
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(EmbeddingCache);

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const text = 'Dimensional space migration check';
    // Store 3-dim vector
    await cache.set('openai', 'custom-embed', text, [0.1, 0.2, 0.3]);

    // Requesting with expectedDimensions: 3 hits
    const hit3 = await cache.get('openai', 'custom-embed', text, { expectedDimensions: 3 });
    assert.deepStrictEqual(hit3, [0.1, 0.2, 0.3]);

    // Model migrates to 4-dim vector: requesting with expectedDimensions: 4 must treat as miss!
    const miss4 = await cache.get('openai', 'custom-embed', text, { expectedDimensions: 4 });
    assert.strictEqual(miss4, null, 'Dimension shift must be treated as cache miss');

    // Overwriting with new 4-dim vector updates space
    await cache.set('openai', 'custom-embed', text, [0.1, 0.2, 0.3, 0.4]);
    const hit4 = await cache.get('openai', 'custom-embed', text, { expectedDimensions: 4 });
    assert.deepStrictEqual(hit4, [0.1, 0.2, 0.3, 0.4]);
  });
});

describe('CachedEmbeddingWrapper & rankSourcePassages Integration', () => {
  let tempCacheDir = '';

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-cache-integ-'));
  });

  afterEach(() => {
    try {
      if (tempCacheDir && fs.existsSync(tempCacheDir)) {
        fs.rmSync(tempCacheDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test('CachedEmbeddingWrapper prevents redundant embedText API invocations', async () => {
    const { BaseEmbedding, CachedEmbeddingWrapper } = embeddingsModule || {};
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(BaseEmbedding);
    assert.ok(CachedEmbeddingWrapper);

    let networkCallCount = 0;
    let totalTextsEmbedded = 0;

    class CountingEmbeddingModel extends BaseEmbedding {
      constructor() {
        super({});
        this.provider = 'mock-provider';
        this.model = 'mock-model';
      }

      async embedText(texts) {
        networkCallCount++;
        totalTextsEmbedded += texts.length;
        return texts.map(() => [0.5, 0.5]);
      }
    }

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const rawModel = new CountingEmbeddingModel();
    const wrapped = new CachedEmbeddingWrapper(rawModel, cache);

    // Call 1: 2 items uncached -> network call for 2
    const v1 = await wrapped.embedText(['query 1', 'query 2']);
    assert.strictEqual(v1.length, 2);
    assert.strictEqual(networkCallCount, 1);
    assert.strictEqual(totalTextsEmbedded, 2);

    // Call 2: Exact same 2 items -> 0 network calls!
    const v2 = await wrapped.embedText(['query 1', 'query 2']);
    assert.strictEqual(v2.length, 2);
    assert.strictEqual(networkCallCount, 1, 'Network call count must not increase on cache hit');
    assert.strictEqual(totalTextsEmbedded, 2);

    // Call 3: 1 cached ('query 2') + 1 new ('query 3') -> network call ONLY for 'query 3'
    const v3 = await wrapped.embedText(['query 2', 'query 3']);
    assert.strictEqual(v3.length, 2);
    assert.strictEqual(networkCallCount, 2);
    assert.strictEqual(totalTextsEmbedded, 3, 'Only query 3 should have been fetched');
  });

  test('rankSourcePassages records cache hits and misses in metrics', async () => {
    const { rankSourcePassages, BaseEmbedding } = embeddingsModule || {};
    const { EmbeddingCache } = cacheModule || {};
    assert.ok(rankSourcePassages);

    class SimpleMockModel extends BaseEmbedding {
      constructor() {
        super({});
        this.provider = 'mock';
        this.model = 'v1';
      }
      async embedText(texts) {
        return texts.map(() => [0.7, 0.7]);
      }
    }

    const cache = new EmbeddingCache({ cacheDir: tempCacheDir });
    await cache.init();

    const sources = [
      {
        url: 'https://example.com/test',
        title: 'Cache Test Document',
        domain: 'example.com',
        content: 'Testing persistent embedding caching across consecutive research queries.'
      }
    ];

    const model = new SimpleMockModel();

    // First run: Cache Misses
    const run1 = await rankSourcePassages(sources, ['caching test'], model, {
      cache,
      maxTotalPassages: 2
    });

    assert.ok(run1.selectedChunks.length > 0);
    assert.ok(typeof run1.metrics.cacheMisses === 'number');
    assert.ok(run1.metrics.cacheMisses > 0, 'First run must register cache misses');

    // Second run: Identical query and content -> 100% Cache Hits!
    const run2 = await rankSourcePassages(sources, ['caching test'], model, {
      cache,
      maxTotalPassages: 2
    });

    assert.ok(run2.selectedChunks.length > 0);
    assert.ok(run2.metrics.cacheHits > 0, 'Second run must register cache hits');
    assert.strictEqual(run2.metrics.cacheMisses, 0, 'Second run must have 0 misses');
  });
});
