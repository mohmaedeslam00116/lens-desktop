import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Track B — thread search_provider into Agentic Search (SPEC #155, #157).
 *
 * Agentic Search never received the user's search setting: the tool surface
 * closed over `primarySearchPlane(query)` (DDG default), so the setting was
 * dead on arrival. These tests pin the threaded path:
 *  - the start-request normalizer carries `search_provider` (open id space,
 *    default explicit DDG per the Track C decision — deterministic, no
 *    ambient-key fan-out; explicit `auto` still selects the extension chain);
 *  - the tool surface forwards its configured provider into the search call;
 *  - a keyed selection without keys degrades through the real plane to the
 *    keyless chain (observed fallback, never terminal) — the ticket's e2e
 *    accept, proven without an LLM (stubbed transport, real plane modules).
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const realFetch = globalThis.fetch;
const realTavilyKey = process.env.TAVILY_API_KEY;

// Extension-tier isolation: point the vendored graph at an empty dir so no
// test reads ambient operator config. LENS key provisioning travels per call
// (config seam under the passed agentDir), never through the extension tier.
const EXTENSION_ISOLATION_DIR = mkdtempSync(join(tmpdir(), 'lens-trackb-ext-'));
process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;

const DDG_ONE_RESULT = `
<html><body>
<div class="result">
  <a class="result__a" href="https://fallback.example/tokamak">Tokamak benchmark</a>
  <a class="result__snippet" href="https://fallback.example/tokamak">Steady-state Q&gt;1 sustained.</a>
</div>
</body></html>`;

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.PI_CODING_AGENT_DIR = EXTENSION_ISOLATION_DIR;
  if (realTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = realTavilyKey;
});

describe('Agentic start request carries search_provider (Track B contract)', () => {
  it('defaults an absent provider to the explicit keyless chain', async () => {
    const { normalizeAgentStartRequest } = await importEngine('server.js');
    const out = normalizeAgentStartRequest({ question: 'q' });
    assert.equal(out.search_provider, 'duckduckgo');
  });

  it('trims and lowercases an explicit selection, preserving it verbatim otherwise', async () => {
    const { normalizeAgentStartRequest } = await importEngine('server.js');
    assert.equal(
      normalizeAgentStartRequest({ question: 'q', search_provider: '  Tavily ' }).search_provider,
      'tavily'
    );
    assert.equal(
      normalizeAgentStartRequest({ question: 'q', search_provider: 'auto' }).search_provider,
      'auto'
    );
    // Unknown ids pass through (the plane's closed map catches them into the
    // keyless chain with a warning) — never silently rewritten here.
    assert.equal(
      normalizeAgentStartRequest({ question: 'q', search_provider: 'qqq-unknown' }).search_provider,
      'qqq-unknown'
    );
    assert.equal(
      normalizeAgentStartRequest({ question: 'q', search_provider: '   ' }).search_provider,
      'duckduckgo'
    );
  });
});

describe('Agentic tool surface forwards its search provider (Track B threading)', () => {
  it('the web_search handler passes the configured provider into the search call', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-trackb-forward',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'tavily',
      search: async (query, provider) => {
        seen.push([query, provider]);
        return [{ url: 'https://forward.example/1', title: 'Forwarded', snippet: 'S' }];
      },
      fetchPage: async (url) => ({ url, title: url, text: 'body' }),
    });
    const outcome = await surface.handler({ name: 'web_search', arguments: { query: 'tokamak' } });
    assert.equal(outcome.success, true);
    assert.deepEqual(seen, [['tokamak', 'tavily']], 'the setting reaches the search call, not the DDG default');
  });

  it('a surface without a configured provider calls search unscoped (plane default holds)', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const seen = [];
    const surface = createAgenticToolSurface({
      sessionId: 's-trackb-unscoped',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 5,
      emit: () => {},
      search: async (query, provider) => {
        seen.push([query, provider]);
        return [];
      },
      fetchPage: async () => null,
    });
    await surface.handler({ name: 'web_search', arguments: { query: 'q' } });
    assert.deepEqual(seen, [['q', undefined]], 'no provider configured means no scoping argument');
  });

  it('keyed selection without keys degrades to the keyless chain through the real plane', async () => {
    const { createAgenticToolSurface } = await importEngine('agenticSearch.js');
    const { primarySearchPlane } = await importEngine('searchPlane.js');
    // Scoped temp dir: file provisioning reads here (empty — no keys), so a
    // real operator key file can never steer this test onto live Tavily.
    const agentDir = mkdtempSync(join(tmpdir(), 'lens-trackb-'));
    delete process.env.TAVILY_API_KEY;
    globalThis.fetch = (async () => new Response(DDG_ONE_RESULT, { status: 200 }));

    const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
    const surface = createAgenticToolSurface({
      sessionId: 's-trackb-fallback',
      state,
      maxFetches: 5,
      emit: () => {},
      searchProvider: 'tavily',
      // Production wiring: the surface search closes over the plane with the
      // forwarded provider — exactly what startAgenticSearchSession builds
      // (closure trusts only its param; the temp agentDir keeps file
      // provisioning keyless).
      search: async (query, provider) =>
        (await primarySearchPlane(query, provider ?? 'duckduckgo', undefined, 3, undefined, agentDir)).map((h) => ({
          url: h.url,
          title: h.title,
          snippet: h.snippet,
        })),
      fetchPage: async () => null,
    });
    const outcome = await surface.handler({ name: 'web_search', arguments: { query: 'tokamak benchmarks' } });
    assert.equal(outcome.success, true, 'fallback serves evidence instead of failing terminally');
    assert.match(String(outcome.result), /Tokamak benchmark/, 'the keyless chain served the query');
    assert.ok(
      state.sources.some((s) => s.url === 'https://fallback.example/tokamak'),
      'fallback hits admit as sources'
    );
  });
});
