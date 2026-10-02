import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getJitiLoader } from '../dist-electron/engine/piPackages.js';
import {
  searchViaExtension,
  resetSearchPlane,
} from '../dist-electron/engine/searchPlane.js';

/**
 * Track C — Pi owns the search mechanism (SPEC #155, ticket #158).
 *
 * Retrieval runs through the upgraded extension surface (`search()` with
 * provider/recency/domain selection), NOT direct per-provider modules: the
 * extension owns routing + fallback, LENS owns gate/ledger/dedupe/SSRF/
 * telemetry. DuckDuckGo is the last keyless fallback, never the default
 * engine. Keyed credentials resolve from the LENS agentDir
 * `web-search.json` under a scoped PI_CODING_AGENT_DIR — never the user's
 * real `~/.pi`.
 */

const realFetch = globalThis.fetch;
const realTavilyKey = process.env.TAVILY_API_KEY;

// Extension-tier isolation: the vendored graph resolves its config path once
// per process — point it at an empty dir up front so no test can read ambient
// operator config (~/.pi). LENS key provisioning travels per call (LENS
// web-search.json under the passed agentDir → env override), never through
// the extension file tier, so per-test temp dirs stay deterministic.
const EXTENSION_ISOLATION_DIR = mkdtempSync(join(tmpdir(), 'lens-trackc-ext-'));
process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;

/** One-result DDG HTML — satisfies the 0.35 parser's ≥1-parseable contract. */
const DDG_ONE_RESULT = `
<html><body>
<div class="result">
  <a class="result__a" href="https://fusion.example/tokamak">Tokamak benchmark</a>
  <a class="result__snippet" href="https://fusion.example/tokamak">Steady-state Q&gt;1 sustained.</a>
</div>
</body></html>`;

/** Minimal Tavily `/search` payload — 0.35 requires `raw_content` per hit. */
const TAVILY_ONE_RESULT = JSON.stringify({
  answer: 'provider-side draft (ignored by LENS)',
  results: [
    {
      url: 'https://tavily.example/deep',
      title: 'Tavily deep hit',
      raw_content: 'A provider-routed passage with dates 2026-10-02.',
    },
  ],
});

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), init);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSearchPlane();
  // The extension tier stays pointed at the isolation dir for the whole file
  // (its config path freezes at first load); only the key env is restored.
  process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;
  if (realTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = realTavilyKey;
});

describe('Extension search mechanism (Track C Pi truth)', () => {
  it('the vendored graph exposes the unified search() with provider/recency/domain selection', async () => {
    const loader = await getJitiLoader();
    assert.ok(loader, 'jiti loads the vendored graph');
    const mod = loader(join(process.cwd(), 'dist-electron', 'vendor', 'pi', 'web-access', 'gemini-search.ts'));
    assert.equal(typeof mod.search, 'function', 'unified search() entry exists');
    assert.equal(typeof mod.getConfiguredSearchRouting, 'function', 'routing is inspectable');
  });

  it('keyless DDG resolves through the extension chain with provider attribution', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-trackc-'));
    delete process.env.TAVILY_API_KEY;
    stubFetch(async () => new Response(DDG_ONE_RESULT, { status: 200 }));

    const out = await searchViaExtension('tokamak benchmarks', {
      provider: 'duckduckgo',
      numResults: 3,
      agentDir,
    });
    assert.equal(out.provider, 'duckduckgo', 'the resolving provider is reported, not assumed');
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].title, 'Tokamak benchmark');
    assert.equal(out.results[0].url, 'https://fusion.example/tokamak');
  });

  it('an explicit keyed provider without keys falls back instead of failing terminally', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-trackc-'));
    delete process.env.TAVILY_API_KEY;
    stubFetch(async () => new Response(DDG_ONE_RESULT, { status: 200 }));

    const out = await searchViaExtension('tokamak benchmarks', { provider: 'tavily', agentDir });
    assert.notEqual(out.provider, 'tavily', 'no key means the chain moves on — observed, not assumed');
    assert.ok(out.results.length > 0, 'the keyless fallback still serves evidence');
  });

  it('the LENS web-search.json key authorizes the call through per-call provisioning', async () => {
    // The durable copy lives in the LENS agentDir file; the plane reads it
    // fresh per call (config seam) and injects it via the serialized env
    // override — the extension file tier is never in the loop, so its
    // per-process config cache cannot serve stale keys.
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-trackc-'));
    writeFileSync(join(agentDir, 'web-search.json'), JSON.stringify({ tavilyApiKey: 'tvly-file-key' }), 'utf-8');
    delete process.env.TAVILY_API_KEY;
    const seen = [];
    stubFetch(async (url, init) => {
      seen.push({ url, auth: init?.headers?.Authorization ?? init?.headers?.authorization });
      if (url.includes('api.tavily.com')) {
        return new Response(TAVILY_ONE_RESULT, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(DDG_ONE_RESULT, { status: 200 });
    });

    const out = await searchViaExtension('tokamak benchmarks', { provider: 'tavily', agentDir });
    assert.equal(out.provider, 'tavily', 'the file key makes the provider eligible');
    assert.ok(
      seen.some((s) => s.url.includes('api.tavily.com') && s.auth === 'Bearer tvly-file-key'),
      `the file credential (not env, not ambient) authorizes the call — seen: ${JSON.stringify(seen)}`
    );
    assert.equal(out.results[0].title, 'Tavily deep hit');
  });

  it('recency/domain options pass through without breaking keyless resolution', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-trackc-'));
    stubFetch(async () => new Response(DDG_ONE_RESULT, { status: 200 }));

    const out = await searchViaExtension('tokamak benchmarks', {
      provider: 'duckduckgo',
      numResults: 3,
      recencyFilter: 'week',
      domainFilter: ['fusion.example'],
      agentDir,
    });
    assert.equal(out.results.length, 1, 'the domain-allowed hit survives the extension post-filter');
  });
});
