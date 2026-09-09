import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  normalizeCanonicalUrl,
  computeExactHash,
  computeSimHash64,
  hammingDistance64,
  isNearDuplicate,
  DeduplicationEngine
} from '../dist-electron/engine/dedup.js';

import { BoundedScraperPool } from '../dist-electron/engine/scraperPool.js';

describe('Level 1: Canonical URL Normalization', () => {
  it('strips tracking parameters, fragments, and trailing slashes', () => {
    const rawUrl = 'https://example.com/research/paper/?utm_source=twitter&utm_medium=social&ref=newsletter&fbclid=IwAR2#conclusion';
    const canonical = normalizeCanonicalUrl(rawUrl);
    assert.equal(canonical, 'https://example.com/research/paper');
  });

  it('lowercases protocol and hostname, strips default ports, and sorts query parameters', () => {
    const rawUrl = 'HTTP://WWW.Nature.Com:80/articles/quantum-computing/?z=99&a=1&utm_campaign=spring&b=2';
    const canonical = normalizeCanonicalUrl(rawUrl);
    assert.equal(canonical, 'http://www.nature.com/articles/quantum-computing?a=1&b=2&z=99');
  });

  it('preserves valid semantic query parameters while stripping tracking tags', () => {
    const rawUrl = 'https://arxiv.org/abs/2401.12345?id=2401.12345&utm_content=promo&page=1';
    const canonical = normalizeCanonicalUrl(rawUrl);
    assert.equal(canonical, 'https://arxiv.org/abs/2401.12345?id=2401.12345&page=1');
  });

  it('handles malformed or non-http URLs safely', () => {
    assert.equal(normalizeCanonicalUrl('not-a-valid-url'), 'not-a-valid-url');
    assert.equal(normalizeCanonicalUrl(''), '');
  });
});

describe('Level 2: Exact Content Hashing (SHA-256)', () => {
  it('computes deterministic SHA-256 hash invariant to whitespace, casing, and punctuation differences', () => {
    const text1 = 'Superconducting qubits require dilution refrigerators operating at 15 millikelvin temperatures.';
    const text2 = '  superconducting   qubits require dilution refrigerators operating at 15 millikelvin temperatures! \n\n';
    
    const hash1 = computeExactHash(text1);
    const hash2 = computeExactHash(text2);

    assert.equal(hash1, hash2);
  });

  it('generates distinct hashes for semantically different content', () => {
    const text1 = 'Fault tolerant quantum computation with surface codes.';
    const text2 = 'Semiconductor extreme ultraviolet photolithography scanners.';

    assert.notEqual(computeExactHash(text1), computeExactHash(text2));
  });
});

describe('Level 3: 64-bit SimHash Near-Duplicate Detection', () => {
  it('computes 64-bit BigInt SimHash fingerprints and calculates Hamming distance', () => {
    const text = 'Silicon spin qubits demonstrate two-qubit gate fidelities exceeding 99.5 percent in 2025 experiments.';
    const fingerprint = computeSimHash64(text);

    assert.equal(typeof fingerprint, 'bigint');
    assert.equal(hammingDistance64(fingerprint, fingerprint), 0);
  });

  it('detects syndicated articles and near-duplicates with Hamming distance <= 3', () => {
    const baseArticle = `
      DeepMind has unveiled AlphaFold 3, capable of predicting the structure and interactions of all life molecules with unprecedented accuracy.
      The revolutionary model predicts proteins, DNA, RNA, ligands, and chemical modifications across complex cellular pathways.
      Structural biologists worldwide can now access these predictions for non-commercial research and accelerated drug discovery.
      Published in Nature, this breakthrough marks a monumental leap in computational biology, biomolecular modeling, and molecular medicine.
      The research team validated predictions against experimentally determined crystallographic structures from the Protein Data Bank, confirming superior performance across all major biomolecular classes and multimers.
    `.repeat(2);

    // Syndicated version with different ad blurb and timestamp
    const syndicatedVersion = baseArticle + ` Sponsored: Download the biotech investment report now. Updated at 14:30 GMT by Tech Staff.`;

    const fpBase = computeSimHash64(baseArticle);
    const fpSyndicated = computeSimHash64(syndicatedVersion);

    const distance = hammingDistance64(fpBase, fpSyndicated);
    assert.ok(distance <= 3, `Expected Hamming distance <= 3, got ${distance}`);
    assert.equal(isNearDuplicate(fpBase, fpSyndicated), true);
  });

  it('distinguishes completely different subjects with high Hamming distance', () => {
    const article1 = 'Quantum error correction utilizes Steane [[7,1,3]] codes to detect phase flip and bit flip errors in topological qubits.';
    const article2 = 'Central banks evaluate quantitative easing policies during periods of disinflation and sluggish GDP growth.';

    const fp1 = computeSimHash64(article1);
    const fp2 = computeSimHash64(article2);

    const distance = hammingDistance64(fp1, fp2);
    assert.ok(distance > 10, `Expected Hamming distance > 10 for different topics, got ${distance}`);
    assert.equal(isNearDuplicate(fp1, fp2), false);
  });

  it('supports Arabic near-duplicate detection with light morphological tolerance', () => {
    const arArticle1 = `
      أعلنت وكالة الفضاء الدولية اليوم رسمياً عن إطلاق مسبار علمي متطور لاستكشاف الكواكب الخارجية البعيدة والبحث عن علامات المياه الجوفية والأدلة الحيوية في المجموعة الشمسية بدقة غير مسبوقة بعد سنوات طويلة من الأبحاث والتجارب المعملية المكثفة بالتعاون مع الجامعات والمراكز المتخصصة في علوم الفلك والفضاء والفيزياء الفلكية التطبيقية.
      ويحتوي المسبار الجديد على أجهزة استشعار طيفية متقدمة وكاميرات عالية الدقة قادرة على اختراق الغلاف الجوي الكثيف وتحليل التركيب الكيميائي للتربة والصخور بدقة متناهية تفوق كافة المهمات الفضائية السابقة.
    `.repeat(2);

    const arArticle2 = arArticle1 + ` مصدر الخبر: وكالة رويترز للأنباء العالمية الشرق الأوسط.`;

    const fp1 = computeSimHash64(arArticle1);
    const fp2 = computeSimHash64(arArticle2);

    const distance = hammingDistance64(fp1, fp2);
    assert.ok(distance <= 3, `Expected Arabic Hamming distance <= 3, got ${distance}`);
    assert.equal(isNearDuplicate(fp1, fp2), true);
  });
});

describe('DeduplicationEngine 3-Level Coordination', () => {
  it('filters duplicate URLs at Level 1 before scraping via claimUrl', () => {
    const engine = new DeduplicationEngine();

    const claim1 = engine.claimUrl('https://example.com/page?utm_source=twitter');
    assert.equal(claim1.claimed, true);
    assert.equal(claim1.canonicalUrl, 'https://example.com/page');

    // Second check with different tracking params matches same canonical URL
    const claim2 = engine.claimUrl('https://example.com/page/?fbclid=xyz#top');
    assert.equal(claim2.claimed, false);
    assert.equal(claim2.canonicalUrl, 'https://example.com/page');

    const stats = engine.getStats();
    assert.equal(stats.urlDuplicates, 1);
  });

  it('filters exact SHA-256 duplicate content at Level 2 from different URLs', () => {
    const engine = new DeduplicationEngine();
    const content = 'Identical syndicated press release published across multiple news wires.';

    const page1 = engine.admit('https://news1.com/story', content);
    assert.equal(page1.admitted, true);

    const page2 = engine.admit('https://news2.com/wire', content);
    assert.equal(page2.admitted, false);
    assert.equal(page2.reason, 'exact_sha256');

    const stats = engine.getStats();
    assert.equal(stats.exactContentDuplicates, 1);
    assert.equal(stats.admitted, 1);
  });

  it('filters near-duplicate content at Level 3 via SimHash', () => {
    const engine = new DeduplicationEngine();
    const textA = `
      Comprehensive clinical trial results for monoclonal antibody therapeutics in Alzheimer disease phase 3 randomized multicenter trials.
      The therapeutic protocol demonstrated statistically significant reduction in amyloid beta plaques across patient cohorts evaluated at 18 months.
      Secondary cognitive endpoints confirmed stabilization of executive function and memory retention compared to the placebo control arm with acceptable safety profiles.
    `.repeat(3);
    const textB = textA + ` Click here to subscribe to the daily medical newsletter.`;

    const resA = engine.admit('https://med1.org/paper', textA);
    assert.equal(resA.admitted, true);

    const resB = engine.admit('https://med2.org/repost', textB);
    assert.equal(resB.admitted, false);
    assert.equal(resB.reason, 'simhash_near_duplicate');
    assert.ok(resB.hammingDistance <= 3);

    const stats = engine.getStats();
    assert.equal(stats.nearDuplicates, 1);
    assert.equal(stats.admitted, 1);
  });
});

describe('BoundedScraperPool Concurrency & Host Throttling', () => {
  it('strictly enforces C_global <= 10 and C_host <= 2 concurrency caps', async () => {
    let currentGlobal = 0;
    let maxGlobalObserved = 0;
    const currentPerHost = new Map();
    const maxPerHostObserved = new Map();

    const mockFetcher = async (url) => {
      const host = new URL(url).hostname;
      const idx = url.split('/').pop();

      // Track active in-flight
      currentGlobal++;
      maxGlobalObserved = Math.max(maxGlobalObserved, currentGlobal);

      const hostCount = (currentPerHost.get(host) || 0) + 1;
      currentPerHost.set(host, hostCount);
      maxPerHostObserved.set(host, Math.max(maxPerHostObserved.get(host) || 0, hostCount));

      // Simulate network latency (20-40ms)
      await new Promise(r => setTimeout(r, 25));

      currentGlobal--;
      currentPerHost.set(host, currentPerHost.get(host) - 1);

      return {
        url,
        title: `Page from ${host}`,
        domain: host,
        content: `Scientific report discussing topic ${host.replace(/\W/g, '')} document ${idx} ` + Array.from({length: 40}, (_, k) => `lex_${host.replace(/\W/g, '')}_${idx}_${k}`).join(' '),
        credibilityScore: 85
      };
    };

    const pool = new BoundedScraperPool({
      globalConcurrency: 10,
      hostConcurrency: 2,
      customFetcher: mockFetcher
    });

    // Generate 30 URLs distributed across 3 distinct hostnames (10 per host)
    const testUrls = [];
    const hosts = ['nature.com', 'arxiv.org', 'mit.edu'];
    for (const h of hosts) {
      for (let i = 1; i <= 10; i++) {
        testUrls.push(`https://${h}/article/${i}`);
      }
    }

    const results = await pool.scrapeAll(testUrls);

    assert.equal(results.length, 30);
    assert.ok(maxGlobalObserved <= 10, `Global concurrency exceeded cap: ${maxGlobalObserved} > 10`);
    for (const h of hosts) {
      const maxHost = maxPerHostObserved.get(h) || 0;
      assert.ok(maxHost <= 2, `Host concurrency exceeded cap for ${h}: ${maxHost} > 2`);
    }
  });

  it('handles HTTP 429 rate limits with exponential backoff and successful retry', async () => {
    let attempts = 0;

    const mockFetcher = async (url) => {
      attempts++;
      if (attempts < 3) {
        const error = new Error('HTTP 429 Too Many Requests');
        error.status = 429;
        throw error;
      }
      return {
        url,
        title: 'Rate-limited Target Recovered',
        domain: 'api.target.com',
        content: 'Factual article after retry backoff recovery.',
        credibilityScore: 90
      };
    };

    const pool = new BoundedScraperPool({
      maxRetries: 3,
      backoffBaseMs: 10,
      customFetcher: mockFetcher
    });

    const page = await pool.scrape('https://api.target.com/data');
    assert.ok(page);
    assert.equal(page.title, 'Rate-limited Target Recovered');
    assert.equal(attempts, 3);
  });

  it('detects PageScraper HTTP 429 fallback message and triggers backoff retry', async () => {
    let attempts = 0;

    const mockFetcher = async (url) => {
      attempts++;
      if (attempts === 1) {
        return {
          url,
          title: 'target.com',
          domain: 'target.com',
          content: 'Content unavailable from https://target.com (HTTP 429).',
          credibilityScore: 50
        };
      }
      return {
        url,
        title: 'Target Recovered',
        domain: 'target.com',
        content: 'Valid content recovered on attempt 2 after non-blocking backoff.',
        credibilityScore: 90
      };
    };

    const pool = new BoundedScraperPool({
      maxRetries: 2,
      backoffBaseMs: 10,
      customFetcher: mockFetcher
    });

    const page = await pool.scrape('https://target.com/page');
    assert.ok(page);
    assert.equal(page.title, 'Target Recovered');
    assert.equal(attempts, 2);
  });

  it('supports sub-second cancellation via AbortSignal', async () => {
    const controller = new AbortController();

    const mockFetcher = async (url, timeoutMs, signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Scrape aborted'));
        });
      });

      return {
        url,
        title: 'Cancelled Page',
        domain: 'cancel.com',
        content: 'Should not resolve',
        credibilityScore: 0
      };
    };

    const pool = new BoundedScraperPool({
      customFetcher: mockFetcher
    });

    const startTime = Date.now();
    const scrapePromise = pool.scrape('https://cancel.com/item', { signal: controller.signal });

    setTimeout(() => controller.abort(), 20);

    const result = await scrapePromise;
    const elapsed = Date.now() - startTime;

    assert.equal(result, null);
    assert.ok(elapsed < 200, `Expected cancellation in < 200ms, took ${elapsed}ms`);
  });

  it('cancels in-flight scrape promptly and returns null on local slow server', async () => {
    let requestStarted = false;
    let serverAborted = false;
    let onRequestStart;
    const requestStartedPromise = new Promise((resolve) => { onRequestStart = resolve; });
    let onServerAbort;
    const serverAbortedPromise = new Promise((resolve) => { onServerAbort = resolve; });

    const server = http.createServer((req, res) => {
      requestStarted = true;
      onRequestStart();
      req.on('close', () => {
        if (!res.writableEnded) {
          serverAborted = true;
          onServerAbort();
        }
      });
    });

    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const testUrl = `http://127.0.0.1:${port}/slow-page`;

      // Default fetcher without customFetcher forwards sig to PageScraper.scrape
      const pool = new BoundedScraperPool();
      const controller = new AbortController();

      const scrapePromise = pool.scrape(testUrl, { signal: controller.signal });

      // Wait for the request to start on the server with a bounded timeout
      await Promise.race([
        requestStartedPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request start timed out')), 3000)),
      ]);
      assert.equal(requestStarted, true);

      // Abort caller signal while request is in-flight
      controller.abort();

      // Prove the server connection is aborted promptly
      await Promise.race([
        serverAbortedPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Server abort timed out')), 3000)),
      ]);
      assert.equal(serverAborted, true);

      // Assert the pool returns no page
      const result = await scrapePromise;
      assert.equal(result, null);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('cancels in-flight scrape after headers arrive when body is stalled', async () => {
    let headersSent = false;
    let serverAborted = false;
    let onHeadersSent;
    const headersSentPromise = new Promise((resolve) => { onHeadersSent = resolve; });
    let onServerAbort;
    const serverAbortedPromise = new Promise((resolve) => { onServerAbort = resolve; });

    const server = http.createServer((req, res) => {
      // Send 200 OK headers immediately and start a chunk, but stall the body
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!DOCTYPE html><html><body><h1>Header Arrived</h1>');
      headersSent = true;
      onHeadersSent();

      req.on('close', () => {
        if (!res.writableEnded) {
          serverAborted = true;
          onServerAbort();
        }
      });
    });

    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const testUrl = `http://127.0.0.1:${port}/headers-then-stalled-body`;

      const pool = new BoundedScraperPool();
      const controller = new AbortController();

      const scrapePromise = pool.scrape(testUrl, { signal: controller.signal });

      // Wait until headers have been flushed to the client with a bounded timeout
      await Promise.race([
        headersSentPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Headers sent timed out')), 3000)),
      ]);
      assert.equal(headersSent, true);

      // Caller aborts during stalled body streaming
      controller.abort();

      // Prove server connection was aborted promptly
      await Promise.race([
        serverAbortedPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Server abort timed out')), 3000)),
      ]);
      assert.equal(serverAborted, true);

      // Assert the pool returns no page
      const result = await scrapePromise;
      assert.equal(result, null);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('200-Source Scale & Memory Bounds Verification', () => {
  it('ingests 200 sources with 3-level deduplication staying strictly under 10 MB RAM', async () => {
    const mockFetcher = async (url) => {
      const idx = parseInt(url.split('?')[0].split('/').pop(), 10);
      const host = new URL(url).hostname;

      // Introduce controlled duplicate scenarios:
      // 1. URLs 10 and 11 have exact duplicate content
      if (idx === 11) {
        return {
          url,
          title: 'Duplicate Page',
          domain: host,
          content: 'Identical syndicated release from page 10. Repeated text for exact duplicate verification.',
          credibilityScore: 70
        };
      }
      if (idx === 10) {
        return {
          url,
          title: 'Original Page',
          domain: host,
          content: 'Identical syndicated release from page 10. Repeated text for exact duplicate verification.',
          credibilityScore: 85
        };
      }

      // 2. URLs 20 and 21 have near-duplicate content
      const nearBase = `
        Comprehensive clinical trial results for monoclonal antibody therapeutics in Alzheimer disease phase 3 randomized multicenter trials.
        The therapeutic protocol demonstrated statistically significant reduction in amyloid beta plaques across patient cohorts evaluated at 18 months.
        Secondary cognitive endpoints confirmed stabilization of executive function and memory retention compared to the placebo control arm with acceptable safety profiles.
      `.repeat(3);

      if (idx === 20) {
        return {
          url,
          title: 'Original Near Duplicate',
          domain: host,
          content: nearBase,
          credibilityScore: 92
        };
      }
      if (idx === 21) {
        return {
          url,
          title: 'Near Duplicate Page',
          domain: host,
          content: nearBase + ' Click here to subscribe to the daily medical newsletter.',
          credibilityScore: 75
        };
      }

      // Standard unique sources (~3,000 characters of distinct lexical text)
      const words = [];
      for (let w = 0; w < 80; w++) {
        words.push(`doc${idx}`, `token${w}`, `vocab${(idx * 37 + w * 19) % 10000}`, `field${(idx + w) % 50}`);
      }
      const content = `Scientific research document ${idx} on ${host}. ` + words.join(' ');

      return {
        url,
        title: `Paper ${idx} on ${host}`,
        domain: host,
        content,
        credibilityScore: 80 + (idx % 15)
      };
    };

    const pool = new BoundedScraperPool({
      globalConcurrency: 10,
      hostConcurrency: 2,
      customFetcher: mockFetcher,
      maxCharsPerPage: 6000
    });

    // 200 URLs across 20 distinct domains, including Level 1 tracking URL duplicate
    const testUrls = [];
    for (let i = 1; i <= 200; i++) {
      const domainId = i % 20;
      if (i === 50) {
        // Level 1 duplicate: Paper 40 with tracking params and fragment
        testUrls.push(`https://domain0.edu/paper/40?utm_source=twitter&utm_medium=social&ref=feed#header`);
      } else {
        testUrls.push(`https://domain${domainId}.edu/paper/${i}`);
      }
    }

    const beforeMemory = process.memoryUsage().heapUsed;
    const results = await pool.scrapeAll(testUrls);
    const afterMemory = process.memoryUsage().heapUsed;

    const deltaBytes = Math.max(0, afterMemory - beforeMemory);
    const deltaMB = deltaBytes / (1024 * 1024);

    // Verify deduplication filtered out the duplicate pages across all 3 tiers
    assert.ok(results.length < 200, `Expected deduplication to filter duplicate items, got ${results.length}`);
    assert.ok(results.length >= 195, `Expected >= 195 unique pages admitted, got ${results.length}`);

    // Verify memory bounds: resident memory increase < 10 MB
    assert.ok(deltaMB < 10, `Memory footprint ${deltaMB.toFixed(2)} MB exceeded 10 MB limit`);

    // Verify stats from pool deduplicator verifying all 3 tiers at scale
    const stats = pool.getDeduplicationStats();
    assert.ok(stats.totalChecked >= 200);
    assert.ok(stats.urlDuplicates >= 1, `Expected >= 1 URL duplicate, got ${stats.urlDuplicates}`);
    assert.ok(stats.exactContentDuplicates >= 1, `Expected >= 1 exact duplicate, got ${stats.exactContentDuplicates}`);
    assert.ok(stats.nearDuplicates >= 1, `Expected >= 1 near duplicate, got ${stats.nearDuplicates}`);
    assert.ok(stats.admitted >= 195);
  });
});
