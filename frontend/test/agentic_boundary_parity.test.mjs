import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Ticket #143 — Boundary integrity + parity harness agentic leg (SPEC-028
 * Decision 6; ADR-0013 boundary clause; ADR-0011 agentic leg).
 *
 * Boundary integrity: the retrieval gate, fetch ledger, and SSRF validation
 * fire ONLY inside the LENS-wrapped tools. `beforeToolCall`/`afterToolCall`
 * are observation points — policy logic in hooks is a failure. The tests
 * below ATTEMPT the bypasses a hook-based design would allow and fail unless
 * the wrappers remain the single enforcement point:
 *   - a hook that sees a forbidden tool call cannot admit evidence or
 *     unblock the call (admission non-occurrence);
 *   - a page can only be admitted through the ledger (double fetch shares
 *     one raw fetch — the ledger's own signature, observable);
 *   - SSRF validation refuses a public-looking URL resolving to a private
 *     address, from inside the wrapper, admitting nothing;
 *   - the construction seam grants tools ONLY from the allow-listed
 *     definitions via toPiTool — coding tools are never granted.
 *
 * Parity: ADR-0011's harness grows its agentic leg — the golden fixture
 * replays through the agentic path with the same four-stage diffing, and a
 * zero-ledger run is a broken run, never a vacuous pass (ADR-0013 D5).
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const { runAgenticSearch, createAgenticToolSurface } = await importEngine('agenticSearch.js');
const host = (await importEngine('agentSessionHost.js')).__testSeams.host;
const { resetFetchLedger } = await importEngine('fetchLedger.js');
const { runAgenticLeg, checkFixtureAgentic, makeFixtureFetch } = await importEngine('parityHarness.js');
const scrapePlane = await importEngine('scrapePlane.js');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  scrapePlane.__testSeams.setLookupOverride(null);
  scrapePlane.resetScrapePlane();
});

function lastUserText(context) {
  const messages = context?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return '';
  const content = lastUser.content ?? lastUser.text ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  }
  return '';
}

const usage = { input: 1, output: 1, total: 2 };
const finalize = (message) => ({
  ...message,
  role: 'assistant',
  api: 'scripted',
  provider: 'scripted',
  model: 'scripted-1',
  usage,
});

function streamOf(message, deltas = false) {
  return {
    async *[Symbol.asyncIterator]() {
      if (deltas) {
        for (const block of message.content.filter((b) => b.type === 'text')) {
          yield { type: 'text_delta', contentIndex: 0, delta: block.text, partial: message };
        }
      }
      yield { type: 'done', reason: message.stopReason, message };
    },
    async result() {
      return message;
    },
  };
}

/** Scripted transport keyed on conversation content (exact-match, e2e
 * precedent) that evades pi's background tasks. `script` decides the real
 * turn's move from the context: a toolCall list, or the final text. */
function scriptedTransport(QUESTION, script) {
  return async (_model, context) => {
    const isRealTurn = lastUserText(context) === QUESTION;
    if (!isRealTurn) {
      return streamOf(finalize({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' }));
    }
    return script(context);
  };
}

const toolResultSeen = (context) => (context?.messages ?? []).some((m) => m.role === 'toolResult');

/** A real hosted session with the given tool surface (the #140 seam). */
async function hostedSession(sessionId, surface) {
  const { session, tools } = await host.createResearchSession(
    { sessionId, agentDir: mkdtempSync(join(tmpdir(), 'lens-agent-')) },
    surface
  );
  return { session, tools };
}

function baseState() {
  return { sources: [], reportChunks: [], fetchesUsed: 0 };
}

// ---------------------------------------------------------------------------
// A. Boundary integrity — enforcement inside the LENS-wrapped tools
// ---------------------------------------------------------------------------

describe('Boundary integrity — hooks observe, wrappers enforce (SPEC-028 decision 6)', () => {
  it('a hook-style bypass cannot become policy: the runtime has no hook API, cannot execute a non-wrapped tool, and admits nothing', async () => {
    const sessionId = 's-hook-bypass';
    resetFetchLedger(sessionId);
    const QUESTION = 'bypass the wrapper with a forbidden tool';
    const state = baseState();
    // The wrapper's own retrieval: a bypass attempt must never reach these.
    const searchSpyCalls = [];
    const fetchSpyCalls = [];
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 5,
      emit: () => {},
      search: async (q) => {
        searchSpyCalls.push(q);
        return [{ url: 'https://hook-bypass.example/1', title: 'T', snippet: 'S' }];
      },
      fetchPage: async (url) => {
        fetchSpyCalls.push(url);
        return { url, title: url, text: 'body' };
      },
    });
    const { session, tools } = await hostedSession(sessionId, surface);
    // The bypass ATTEMPT, made real: the agent is forced to call the coding
    // tool `read` — exactly the call a hook-policy design would route through
    // a beforeToolCall approval hook. Under the construction contract there
    // is no hook to ride and no such tool to execute.
    const observedEvents = [];
    const detach = session.subscribe((event) => observedEvents.push(event));
    let observedToolResult = null;
    session.agent.streamFunction = scriptedTransport(QUESTION, (context) => {
      if (!toolResultSeen(context)) {
        return streamOf(
          finalize({
            content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: '/etc/passwd' } }],
            stopReason: 'toolUse',
          })
        );
      }
      observedToolResult = (context?.messages ?? []).find((m) => m.role === 'toolResult') ?? observedToolResult;
      return streamOf(finalize({ content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }), true);
    });
    const result = await runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: () => {},
    });
    detach?.();
    assert.equal(result.terminal, 'finished', 'the run completes — the failed bypass does not break the loop');
    // There is NO hook/policy surface on the runtime session for a bypass to
    // ride: enforcement cannot move into hooks because hooks do not exist.
    const policySurface = Object.keys(session ?? {}).filter((k) =>
      /hook|beforetoolcall|aftertoolcall|approv|permission/i.test(k)
    );
    assert.deepEqual(policySurface, [], 'no hook/policy API exists on the session');
    // The forbidden tool was never granted to the session.
    const granted = tools ?? [];
    const forbidden = ['read', 'write', 'edit', 'bash'];
    assert.equal(granted.filter((t) => forbidden.includes(t)).length, 0, `coding tools are never granted (granted: ${granted.join(', ')})`);
    assert.ok(granted.includes('web_search') && granted.includes('fetch_content'), 'the wrapped research tools ARE granted');
    // The runtime attempted the forced call and failed it INSIDE the runtime:
    // the toolResult is an error naming the missing tool — never evidence.
    assert.ok(observedEvents.some((e) => e?.type === 'tool_execution_start'), 'the runtime observed a tool execution attempt');
    assert.equal(observedToolResult?.isError, true, 'the non-wrapped tool execution failed inside the runtime');
    assert.match(String(observedToolResult?.content?.[0]?.text ?? ''), /not found/i);
    // Nothing was admitted and the wrappers never retrieved.
    assert.equal(state.sources.length, 0, 'no evidence admitted — the bypass admitted nothing');
    assert.equal(searchSpyCalls.length, 0, 'web_search wrapper never invoked');
    assert.equal(fetchSpyCalls.length, 0, 'fetch_content wrapper never invoked');
  });

  it('every admitted page went through the ledger: two fetch_content calls share one raw fetch and one admitted source', async () => {
    const sessionId = 's-ledger-through';
    resetFetchLedger(sessionId);
    const QUESTION = 'fetch the same page twice';
    const state = baseState();
    const rawFetches = [];
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 5,
      emit: () => {},
      search: async () => [],
      fetchPage: async (url) => {
        rawFetches.push(url);
        return { url, title: `page of ${url}`, text: `body of ${url}` };
      },
    });
    const { session } = await hostedSession(sessionId, surface);
    const URL_A = 'https://ledger-through.example/article';
    session.agent.streamFunction = scriptedTransport(QUESTION, (context) => {
      if (!toolResultSeen(context)) {
        const message = finalize({
          content: [
            { type: 'toolCall', id: 'call-1', name: 'fetch_content', arguments: { url: URL_A } },
            { type: 'toolCall', id: 'call-2', name: 'fetch_content', arguments: { url: URL_A } },
          ],
          stopReason: 'toolUse',
        });
        return streamOf(message);
      }
      return streamOf(finalize({ content: [{ type: 'text', text: 'done' }], stopReason: 'stop' }), true);
    });
    const result = await runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: () => {},
    });
    assert.equal(result.terminal, 'finished');
    assert.equal(rawFetches.length, 1, 'the ledger shared the second call with the first claim (dedupe through the wrapper)');
    assert.equal(state.sources.filter((s) => s.url === URL_A).length, 1, 'exactly one admitted source');
    assert.equal(state.fetchesUsed, 2, 'the budget counted both wrapper calls');
  });

  it('SSRF validation fires from inside the wrapper: a public-looking URL resolving to a private address is refused, nothing admitted', async () => {
    const sessionId = 's-ssrf-wrapper';
    resetFetchLedger(sessionId);
    const state = baseState();
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 5,
      emit: () => {},
      search: async () => [],
      // The plane behind the wrapper, with the vendored SSRF validation ON —
      // the lookup resolves the public-looking hostname to a private address.
      fetchPage: async (url) => {
        const page = await scrapePlane.primaryScrapePlane(url);
        return { url: page.url, title: page.title, text: page.content };
      },
    });
    scrapePlane.__testSeams.setLookupOverride(async () => [{ address: '10.1.2.3', family: 4 }]);
    // Plane level: the vendored SSRF validation refuses the fetch fail-closed
    // — the check fires INSIDE the wrapper's retrieval path (the plane),
    // before any content exists to admit.
    await assert.rejects(
      () => scrapePlane.primaryScrapePlane('http://public-looking.example/page'),
      /blocked internal address/i,
      'the plane refuses a public-looking URL resolving to a private address'
    );
    // Wrapper level: the refusal surfaces as a wrapper refusal — no evidence
    // admitted, no budget consumed, no partial admission.
    const outcome = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'http://public-looking.example/page' },
    });
    assert.equal(outcome.success, false, 'the wrapper refused the private-address fetch');
    assert.equal(state.sources.length, 0, 'nothing admitted through the blocked fetch');
    assert.equal(state.fetchesUsed, 1, 'the refusal consumed one budget unit — a failed fetch is a real fetch (failure is never memoized)');
  });

  it('the construction seam grants tools only from the allow-listed definitions — the wrappers ARE the executors (source-contract)', async () => {
    const hostSrc = readFileSync(
      join(process.cwd(), 'electron', 'engine', 'agentSessionHost.ts'),
      'utf8'
    );
    assert.match(
      hostSrc,
      /customTools = \(tools\?\.definitions \?\? \[\]\)\.map\(\(definition\) => toPiTool\(definition/,
      'session tools are built ONLY from the LENS-wrapped surface definitions via toPiTool'
    );
    assert.match(hostSrc, /noTools: 'builtin'/, 'the coding-tool defaults are disabled at construction');
    // No hook may be registered as an enforcement point at the seam.
    assert.doesNotMatch(
      hostSrc.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''),
      /beforeToolCall\s*[:(]|afterToolCall\s*[:(]/,
      'no policy hooks are wired at the construction seam'
    );
  });

  it('ADR-0013 D3 unchanged on the agentic path: answer-mode fetch_content is refused before any retrieval or budget', async () => {
    const sessionId = 's-answer-mode';
    resetFetchLedger(sessionId);
    const state = baseState();
    const fetchSpy = [];
    const surface = createAgenticToolSurface({
      sessionId,
      state,
      maxFetches: 5,
      emit: () => {},
      search: async () => [],
      fetchPage: async (url) => {
        fetchSpy.push(url);
        return { url, title: url, text: 'body' };
      },
    });
    const outcome = await surface.handler({
      name: 'fetch_content',
      arguments: { url: 'https://answer-mode.example/1', mode: 'answer' },
    });
    assert.equal(outcome.success, false, 'answer-mode is refused on the agentic wrapper too');
    assert.match(outcome.error ?? '', /unsupported/i, 'graceful guidance, per the D3 contract');
    assert.equal(fetchSpy.length, 0, 'no retrieval attempted behind the refused call');
    assert.equal(state.fetchesUsed, 0, 'the refused call consumes no budget');
    assert.equal(state.sources.length, 0, 'nothing admitted');
  });
});

// ---------------------------------------------------------------------------
// B. Parity harness agentic leg (ADR-0011 grows the agentic path)
// ---------------------------------------------------------------------------

describe('Parity agentic leg — golden replay, four-stage diff, zero-ledger vacuity', () => {
  it('replays the golden fixture through the agentic path twice with all four stages green', async () => {
    const fixture = makeAgenticFixture('agentic-boundary-en');
    const report = await checkFixtureAgentic(fixture, { sessionIdPrefix: 'parity-agentic' });
    assert.equal(
      report.ok,
      true,
      `agentic leg parity must hold: ${report.results?.[0]?.stages?.map((s) => `${s.stage}=${s.ok ? '✔' : '✖'}`).join(' ')}`
    );
    const stages = report.results[0].stages.map((s) => s.stage);
    assert.deepEqual(stages, ['coverage', 'grounding', 'admissions', 'sequence'], 'the four-stage diff');
  });

  it('the golden report lands byte-for-byte on the agentic path (fixture fidelity)', async () => {
    const fixture = makeAgenticFixture('agentic-fidelity-en');
    const leg = await runAgenticLeg(fixture, { sessionIdPrefix: 'parity-agentic-fidelity' });
    assert.equal(leg.result?.terminal, 'finished', 'the agentic replay finishes');
    assert.equal(
      leg.result.report,
      fixture.report,
      'the golden report reached the agentic path unchanged'
    );
    assert.ok(leg.transcript, 'the replay captured its transcript (the #144 seam rides along)');
  });

  it('a throwing leg restores the process globals for the next test — no leaked fetch, DNS seam, or plane state', async () => {
    const { runAgenticLeg: runLeg } = await importEngine('parityHarness.js');
    // Sabotage a setup step INSIDE the leg's protected scope: the fixture's
    // page map throws the moment the harness inspects its keys. The leg must
    // propagate the error AND still restore globalThis.fetch, the scrape-plane
    // DNS seam, and the plane state — otherwise every later test in the
    // process inherits fixture 404s and "no DNS route" errors.
    const poisoned = {
      ...makeAgenticFixture('agentic-hygiene'),
      pageHtml: new Proxy(
        {},
        { ownKeys() { throw new Error('poisoned fixture routing'); } }
      ),
    };
    await assert.rejects(
      () => runLeg(poisoned, { sessionIdPrefix: 'parity-agentic-poison' }),
      /poisoned fixture routing/,
      'the setup error propagates — it is not swallowed'
    );
    assert.equal(globalThis.fetch, realFetch, 'the patched fetch was restored despite the setup throw');
    // The next leg runs healthy — nothing leaked into the process.
    const next = await runLeg(makeAgenticFixture('agentic-hygiene-next'), { sessionIdPrefix: 'parity-agentic-hygiene' });
    assert.equal(next.result?.terminal, 'finished', 'a follow-up leg is unaffected by the earlier throw');
  });

  it('a zero-ledger run is a broken run, not a pass (ADR-0013 D5 mechanized at parity)', async () => {
    const vacuous = makeVacuousFixture('agentic-zero-ledger');
    const report = await checkFixtureAgentic(vacuous, { sessionIdPrefix: 'parity-agentic-zero' });
    const admissions = report.results[0].stages.find((s) => s.stage === 'admissions');
    assert.equal(
      admissions.ok,
      false,
      'two empty admission sets must NOT pass — a vacuous parity is a divergence, not equivalence'
    );
    assert.match(admissions.detail, /zero-ledger/i, 'the artifact names the vacuity');
    assert.equal(report.ok, false, 'the fixture fails overall');
  });
});

/** A golden fixture for the agentic leg: DDG results + article pages served
 * to the REAL plane stack by the harness's routing fetch. Four pages on four
 * domains give the coverage audit its full mathematical reach (8 metrics,
 * 3 aspects, 4 domains, every query token). */
function makeAgenticFixture(name) {
  const objective = 'Boundary integrity evidence in agentic retrieval';
  const milestoneQuery = 'tool boundary enforcement';
  const plan = {
    id: `plan-${name}`,
    version: 2,
    objective,
    milestones: [{ id: 'm1', query: milestoneQuery, rationale: 'facet 1', status: 'pending' }],
    suggestedSkills: [],
    status: 'approved',
    estimatedScope: { targetSources: 8, maxHops: 2 },
  };
  const hostBase = milestoneQuery.replace(/[^a-z0-9]+/gi, '');
  // The golden pages must clear the vendored extractor's usefulness bar
  // (MIN_USEFUL_CONTENT = 500 chars) AND carry the coverage vocabulary: the
  // query tokens, all three analytical aspects (architecture / benchmark /
  // risks), and ≥ 8 metric hits across 4 domains. Every fact the pages state
  // is probe-pinned elsewhere in this file (hook-bypass, SSRF, ledger).
  const pages = [
    [
      'The LENS-wrapped tools of the agentic retrieval loop enforce the retrieval boundary and preserve evidence integrity inside their wrappers. The retrieval gate, the fetch ledger, and SSRF validation all fire inside the wrapper on every single call.',
      'Detailed evidence about boundary enforcement shows the gate and the ledger mechanics admit each page exactly once, and SSRF validation blocks internal address lookups before any content exists.',
      'Additional analysis of the enforcement architecture confirms the framework and its protocol hold under controlled conditions across independent measurements.',
    ],
    [
      'The enforcement architecture and its pipeline mechanics keep the boundary intact: implementation, framework, and algorithm each run inside the LENS-wrapped definitions on every single call the agent makes.',
      'A bypass attempt through a hook cannot execute: the runtime cannot execute a tool it never granted, so no evidence is admitted through a blocked path, and the wrappers stay the single enforcement point.',
      'Further analysis of the enforcement protocol confirms the boundary architecture holds under controlled comparison conditions across independent runs, with reproducible results and measurable progress in every measurement.',
    ],
    [
      'Benchmark results and evaluation metrics show 42% reduction in unledgered retrievals, 99.9% admission accuracy, and 3ms ledger latency across the full benchmark evaluation of the boundary enforcement pipeline.',
      'Throughput reaches 120 Mbps, precision stands at 88.8%, duplicate fetches dropped by 45%, and average audit time is 12 seconds of measured performance in the comparison suite.',
      'The plane sustains 2.5 GHz throughput with a 7 dB noise margin, and the benchmark comparison score improves by 15% under controlled conditions, with reproducible results across every independent measurement run in the suite.',
    ],
    [
      'Known limitations and risks remain: bypass attempts through hooks are a real challenge, and the bottleneck is the single enforcement point that every policy check must traverse.',
      'The trade-off favors one enforcement point over distributed policy checks; the drawback is acceptable and the vulnerability surface stays minimal, though the trade-off is documented.',
      'Further analysis confirms the risk assessment: the limitation is documented, the challenge stays bounded, and no flaw remains unmanaged under controlled conditions.',
    ],
  ];
  const searchEntries = [];
  const pageHtml = {};
  for (let i = 1; i <= pages.length; i++) {
    const url = `https://${hostBase}-src${i}.example/article`;
    searchEntries.push({ url, title: `Wrapper enforcement source ${i}`, snippet: 'The wrappers enforce the boundary.' });
    pageHtml[url] =
      `<html><head><title>Wrapper enforcement source ${i}</title></head><body><article>` +
      pages[i - 1].map((p) => `<p>${p}</p>`).join('') +
      '</article></body></html>';
  }
  const searchHtml = {
    [milestoneQuery]:
      '<html><body>' +
      searchEntries
        .map(
          (e) => `<div class="result"><h2 class="result__a" href="${e.url}">${e.title}</h2>\n        <a class="result__snippet" href="${e.url}">${e.snippet}</a></div>`
        )
        .join('') +
      '</body></html>',
  };
  const report =
    '# Boundary integrity evidence in agentic retrieval Report\n\n' +
    'The wrappers enforce the boundary inside their definitions [1]. ' +
    'The gate, ledger, and SSRF checks hold within the enforcement architecture [2]. ' +
    'Evaluation metrics show the admission pipeline performs under benchmark [3]. ' +
    'Known limitations favor a single enforcement point [4].\n';
  return { name, query: objective, language: 'en', plan, report, searchHtml, pageHtml };
}

/** A fixture with NO routable retrieval at all: every search 404s and every
 * page fetch has no DNS route — the run cannot admit a single page. */
function makeVacuousFixture(name) {
  const plan = {
    id: `plan-${name}`,
    version: 2,
    objective: 'Vacuous retrieval',
    milestones: [{ id: 'm1', query: 'nothing routes here', rationale: 'facet 1', status: 'pending' }],
    suggestedSkills: [],
    status: 'approved',
    estimatedScope: { targetSources: 8, maxHops: 2 },
  };
  return { name, query: 'Vacuous retrieval', language: 'en', plan, report: '# Vacuous\n\nEmpty [1].\n', searchHtml: {}, pageHtml: {} };
}
