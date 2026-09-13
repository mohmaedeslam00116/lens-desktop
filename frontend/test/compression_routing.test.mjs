import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { proxyPrefixUrl, applyProxyToModel } from '../dist-electron/engine/piAdapter.js';
import { routeCompression, disposeCompression } from '../dist-electron/engine/compressionRouting.js';
import { disposeBillion, getBillionHandle } from '../dist-electron/engine/billionContext.js';
import { ResearcherAgent } from '../dist-electron/engine/researcherAgent.js';
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

const REPORT = '# Compression Report\n\nLong-context findings synthesized.';

const approvedPlan = {
  id: 'plan-92', version: 2, objective: 'Fusion energy',
  milestones: [
    { id: 'm1', query: 'fusion energy basics', rationale: 'core', status: 'pending' },
  ],
  suggestedSkills: [], status: 'approved',
};

const baseRequest = (overrides = {}) => ({
  query: 'Fusion energy', report_type: 'quick', language: 'en', llm_provider: 'openai',
  model_name: 'test-model', api_keys: { openai: 'test-key' }, search_provider: 'duckduckgo',
  embedding_enabled: false, plan: approvedPlan, agency_mode: true, ...overrides,
});

/** Test-local stub child binary: a tiny HTTP server speaking the bili
 * contract (health endpoint + URL-prefix proxying), spawned via the
 * supervisor's process.execPath seam. Exercises the REAL supervisor. */
function stubBinaryScript(port, healthy) {
  return `
const http = require('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/__bili/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: ${healthy ? 'true' : 'false'}, upstream: 'stub' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{}');
});
server.listen(${port}, '127.0.0.1', () => console.log('stub up'));
`;
}

/** Allocates an available loopback port (free-port race avoidance). */
async function freePort() {
  const net = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Runs a stub proxy child through the real supervisor by overriding the
 * binary path with an inline node script file. */
async function withStubProxy({ healthy = true, port } = {}) {
  // Isolate the supervisor's process-wide singleton between tests.
  await disposeBillion();
  port = port ?? (await freePort());
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(await path.join(os.tmpdir(), 'bili-stub-'));
  const bin = await path.join(dir, 'stub-bili.cjs');
  await fs.writeFile(bin, stubBinaryScript(port, healthy), 'utf8');    return {
      binary: bin,
      port,
      dir,
      async cleanup() {
        await disposeBillion();
        await fs.rm(dir, { recursive: true, force: true });
      },
    };
}

describe('Proxy URL-prefix routing (pi adapter)', () => {
  it('rewrites upstream base URLs through the proxy with the upstream preserved in the path', () => {
    assert.equal(
      proxyPrefixUrl('http://127.0.0.1:8787', 'https://api.openai.com/v1'),
      'http://127.0.0.1:8787/bili/api.openai.com/v1'
    );
    assert.equal(
      proxyPrefixUrl('http://127.0.0.1:8787', 'https://generativelanguage.googleapis.com/v1beta'),
      'http://127.0.0.1:8787/bili/generativelanguage.googleapis.com/v1beta'
    );
  });

  it('is idempotent for already-proxied URLs and passes empty upstreams through', () => {
    const once = proxyPrefixUrl('http://127.0.0.1:8787', 'https://api.openai.com/v1');
    assert.equal(proxyPrefixUrl('http://127.0.0.1:8787', once), once);
    assert.equal(proxyPrefixUrl('http://127.0.0.1:8787', ''), '');
    assert.equal(applyProxyToModel({ baseUrl: '', id: 'm' }, 'http://127.0.0.1:8787').baseUrl, '');
  });

  it('applyProxyToModel leaves models untouched when no proxy is configured', () => {
    const model = { id: 'm', baseUrl: 'https://api.openai.com/v1' };
    assert.equal(applyProxyToModel(model, undefined), model);
  });
});

describe('Compression routing (supervisor seam, stub binary — no real network)', () => {
  afterEach(async () => {
    await disposeBillion();
  });

  it('flag off: no proxy, no notices, no child started', async () => {
    const result = await routeCompression({ enabled: false });
    assert.equal(result.proxyBaseUrl, null);
    assert.deepEqual(result.notices, []);
    assert.equal(result.ownsProxy, false);
  });

  it('healthy stub proxy: routing returns the proxy base URL', async () => {
    // Free ports per test: a just-killed listener's socket can linger
    // briefly, and fixed ports can be occupied by other processes.
    const stub = await withStubProxy();
    try {
      const result = await routeCompression({ enabled: true, binary: stub.binary, port: stub.port, healthTimeoutMs: 4000 });
      assert.equal(result.proxyBaseUrl, `http://127.0.0.1:${stub.port}`);
      assert.deepEqual(result.notices, []);
      assert.equal(result.ownsProxy, true);
    } finally {
      await stub.cleanup();
    }
  });

  it('unhealthy proxy: degrades to uncompressed with a telemetry notice', async () => {
    const stub = await withStubProxy({ healthy: false });
    try {
      const result = await routeCompression({ enabled: true, binary: stub.binary, port: stub.port, healthTimeoutMs: 2500 });
      assert.equal(result.proxyBaseUrl, null);
      assert.equal(result.notices.length, 1);
      assert.match(result.notices[0], /without compression/i);
      assert.equal(result.ownsProxy, false);
    } finally {
      await stub.cleanup();
    }
  });

  it('missing binary: degrades to uncompressed with a notice and never throws', async () => {
    const result = await routeCompression({ enabled: true, binary: '/nonexistent/bili-stub-xyz.cjs', healthTimeoutMs: 1500 });
    assert.equal(result.proxyBaseUrl, null);
    assert.ok(result.notices.length >= 1);
  });
});

describe('Researcher compression integration (offline, stubbed seams)', () => {
  afterEach(() => {
    resetActiveCore();
    globalThis.fetch = realFetch;
  });

  it('researcher without a proxy lease runs uncompressed (no notices, no child)', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('DONE')]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const researcher = new ResearcherAgent('s-92-off', () => {}, {
      researcherId: 'researcher_s-92-off_1', facetIndex: 0, facet: 'f', facetCount: 1,
      milestoneId: 'm1', milestoneTitle: 'f', toolPackages: true,
      searchFn: async () => [],
      packageToolsFactory: async () => ({ tools: [], handler: async () => ({ success: true, result: 'ok' }) }),
    });
    const result = await researcher.run({ query: 'Q', embedding_enabled: false });
    assert.ok(result, 'uncompressed run completes');
    assert.equal(getBillionHandle(), null, 'no proxy child was started');
  });

  it('researcher consumes the parent-leased proxy URL; the lease owner reaps it', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage('DONE')]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const stub = await withStubProxy();
    try {
      const routing = await routeCompression({ enabled: true, binary: stub.binary, port: stub.port, healthTimeoutMs: 4000 });
      assert.equal(routing.ownsProxy, true);
      const researcher = new ResearcherAgent('s-92-on', () => {}, {
        researcherId: 'researcher_s-92-on_1', facetIndex: 0, facet: 'f', facetCount: 1,
        milestoneId: 'm1', milestoneTitle: 'f', toolPackages: true,
        proxyBaseUrl: routing.proxyBaseUrl,
        compressionNotices: routing.notices,
        searchFn: async () => [],
        packageToolsFactory: async () => ({ tools: [], handler: async () => ({ success: true, result: 'ok' }) }),
      });
      const result = await researcher.run({ query: 'Q', embedding_enabled: false });
      assert.ok(result, 'proxied run completes');
      assert.ok(getBillionHandle(), 'proxy child alive during the leased run');
    } finally {
      await disposeBillion();
      await (await import('node:fs/promises')).rm(stub.dir, { recursive: true, force: true });
    }
  });
});

describe('Parent passes compression_mode to researchers (offline e2e)', () => {
  afterEach(() => {
    resetActiveCore();
    globalThis.fetch = realFetch;
  });

  it('compression_mode=true runs the agency flow end-to-end; researcher receives the flag', async () => {
    stubFetchEmpty();
    const ai = await pi();
    const faux = ai.fauxProvider({ models: [{ id: 'test-model' }] });
    faux.setResponses([ai.fauxAssistantMessage(REPORT)]);
    setActiveCore('pi', { overrideFactory: async () => faux.provider });

    const emitted = [];
    const flagsSeen = [];
    const parent = new ParentResearchAgent('s-92-parent', (e) => emitted.push(e), undefined,
      (sessionId, emit, options) => {
        // The researcher must receive the leased proxy URL (compression on).
        flagsSeen.push(options.proxyBaseUrl !== undefined);
        // Offline researcher: no search hits, no tool loop — the lease
        // pass-through is the contract under test.
        return new ResearcherAgent(sessionId, emit, {
          ...options,
          toolPackages: false,
          searchFn: async () => [],
        });
      });
    await parent.run(baseRequest({ researcher_mode: true, compression_mode: true }));
    assert.deepEqual(flagsSeen, [true]);
    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'run completes');
    // The parent released the compression lease after the fan-out.
    assert.equal(getBillionHandle(), null, 'proxy child reaped after the run');
  });
});
