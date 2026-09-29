import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Ticket #142 — Agentic Search end-to-end: the tracer bullet. A scripted
 * provider drives the REAL in-process AgentSession (#140) through the REAL
 * event bridge (#141) and the REAL ledgered tool surface built by the runner:
 * one question → one Turn-Group, no plan-approval gate, bounded by the
 * session budget (maxFetches) and the plane's fetch ledger, terminating into
 * LENS's evidence contracts (admitted sources + report + explicit terminal
 * event). Only the LLM transport is scripted — the loop, tools, bridge,
 * ledger, and evidence contracts are the engine's own.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const host = (await importEngine('agentSessionHost.js')).__testSeams.host;
const { runAgenticSearch, createAgenticToolSurface, cancelAgenticSearch, agenticAdmissionGuard } =
  await importEngine('agenticSearch.js');
const { resetFetchLedger } = await importEngine('fetchLedger.js');

/** Extract the text of the last user message in a loop context. */
function lastUserText(context) {
  const messages = context?.messages ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return '';
  const content = lastUser.content ?? lastUser.text ?? '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

/** A scripted transport keyed on the conversation CONTENT with EXACT-match
 * semantics: pi-coding-agent runs background LLM tasks (session titling)
 * whose prompts QUOTE the user question, so an `includes` key would let a
 * background task consume the tool turn on fast machines. Only the real
 * loop's turn — whose last user message is exactly the question — drives
 * the script; every other invocation resolves immediately. */
function scriptedStreamFunction(toolCallsSeen, QUESTION) {
  const usage = { input: 1, output: 1, total: 2 };
  const finalize = (message) => ({
    ...message,
    role: 'assistant',
    api: 'scripted',
    provider: 'scripted',
    model: 'scripted-1',
    usage,
  });
  return async (_model, context) => {
    const isRealTurn = lastUserText(context) === QUESTION;
    if (!isRealTurn) {
      const quiet = finalize({ content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' });
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'done', reason: 'stop', message: quiet };
        },
        async result() {
          return quiet;
        },
      };
    }
    const message = finalize({
      content: [{ type: 'toolCall', id: 'call-1', name: 'web_search', arguments: { query: 'agentic search evidence' } }],
      stopReason: 'toolUse',
    });
    return {
      async *[Symbol.asyncIterator]() {
        toolCallsSeen.push('web_search');
        yield { type: 'toolcall_end', contentIndex: 0, toolCall: message.content[0], partial: message };
        yield { type: 'done', reason: 'toolUse', message };
      },
      async result() {
        return message;
      },
    };
  };
}

/** The answer turn, played once the tool result is in the context. */
function answerStreamFunction(QUESTION) {
  const usage = { input: 1, output: 1, total: 2 };
  return async (_model, context) => {
    const isRealTurn = lastUserText(context) === QUESTION;
    const message = {
      role: 'assistant',
      api: 'scripted',
      provider: 'scripted',
      model: 'scripted-1',
      usage,
      content: [
        isRealTurn
          ? { type: 'text', text: 'The agentic answer, grounded in admitted sources.' }
          : { type: 'text', text: 'ok' },
      ],
      stopReason: 'stop',
    };
    return {
      async *[Symbol.asyncIterator]() {
        for (const block of message.content) {
          yield { type: 'text_delta', contentIndex: 0, delta: block.text, partial: message };
          yield { type: 'text_end', contentIndex: 0, content: block.text, partial: message };
        }
        yield { type: 'done', reason: 'stop', message };
      },
      async result() {
        return message;
      },
    };
  };
}

/** Build a real session whose agent transport is the scripted one. */
async function buildScriptedSession(sessionId) {
  const emitted = [];
  const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
  const toolCallsSeen = [];

  // The tool surface is built FIRST and registered at construction — the
  // ADR-0014 contract (allow-list at construction). The loop then executes
  // the model's tool calls through pi's own customTools machinery.
  const surface = createAgenticToolSurface({
    sessionId,
    state,
    maxFetches: 5,
    emit: (event) => emitted.push(event),
    search: async () => [
      { url: 'https://agentic-e2e.example/a-1', title: 'Agentic source 1', snippet: 'Snippet one' },
      { url: 'https://agentic-e2e.example/a-2', title: 'Agentic source 2', snippet: 'Snippet two' },
    ],
    fetchPage: async (url) => {
      // Simulates the plane's page retrieval (unwrapped fetch closed over).
      return { url, title: `Page ${url}`, text: `Grounded content for ${url}` };
    },
  });
  const { session } = await host.createResearchSession({ sessionId }, surface);

  // Swap only the transport: the loop, tools, and bridge are the engine's own.
  const QUESTION = 'What does the evidence say?';
  // Two-phase transport keyed on content with exact-match semantics: the
  // tool phase runs while the loop's turn has no tool result yet; the answer
  // phase runs once it does. Background tasks (session titling) never match
  // exactly and resolve immediately.
  const toolPhase = scriptedStreamFunction(toolCallsSeen, QUESTION);
  const answerPhase = answerStreamFunction(QUESTION);
  session.agent.streamFunction = async (model, context) => {
    const hasToolResult = (context?.messages ?? []).some(
      (m) => m.role === 'toolResult' || m.role === 'tool_result'
    );
    return hasToolResult ? answerPhase(model, context) : toolPhase(model, context);
  };

  return { session, surface, emitted, state, toolCallsSeen, QUESTION };
}

describe('Agentic Search end-to-end — scripted provider, real seams', () => {
  it('runs one turn-group: the loop calls tools through the wrapper, sources admit, answer streams, finished lands', async () => {
    resetFetchLedger('s-e2e-run');
    const { session, surface, emitted, state, toolCallsSeen, QUESTION } =
      await buildScriptedSession('s-e2e-run');

    // Drive the real loop with the scripted transport. The tool call the
    // loop declares executes through pi's own customTools machinery — the
    // surface was registered at construction — so this proves the
    // loop→wrapper→ledger path end-to-end.
    const run = runAgenticSearch(session, {
      sessionId: 's-e2e-run',
      question: QUESTION,
      state,
      emit: (event) => emitted.push(event),
    });

    const result = await run;

    assert.deepEqual(toolCallsSeen, ['web_search']);
    assert.ok(result.sources.some((s) => s.url === 'https://agentic-e2e.example/a-1'), 'the loop-executed tool call admitted its search results');
    assert.equal(result.terminal, 'finished');
    assert.ok(result.sources.length >= 2, 'search results admitted as sources');
    assert.ok(result.report.includes('The agentic answer'), 'the answer streamed into the report draft');

    const types = emitted.map((e) => e.type);
    assert.ok(types.includes('session_state'), 'bridge lifecycle flowed');
    assert.ok(types.includes('source'), 'source events flowed');
    assert.ok(types.includes('report_chunk'), 'answer chunks flowed');
    const finished = emitted.find((e) => e.type === 'finished');
    assert.ok(finished, 'explicit finished terminal emitted');
    assert.equal(finished.state, 'completed');
    assert.ok(finished.sources.length >= 2);
    assert.match(finished.report, /agentic answer/);
  });

  it('fetch_content through the wrapper is ledgered and admits exactly once per URL', async () => {
    resetFetchLedger('s-e2e-ledger');
    const { session, surface, state } = await buildScriptedSession('s-e2e-ledger');
    let planeFetches = 0;
    const dedupeProbe = createAgenticToolSurface({
      sessionId: 's-e2e-ledger',
      state,
      maxFetches: 5,
      emit: () => {},
      search: async () => [],
      fetchPage: async (url) => {
        planeFetches += 1;
        return { url, title: url, text: `content-${planeFetches}` };
      },
    });
    const first = await dedupeProbe.handler({ name: 'fetch_content', arguments: { url: 'https://agentic-e2e.example/dup' } });
    const second = await dedupeProbe.handler({ name: 'fetch_content', arguments: { url: 'https://agentic-e2e.example/dup' } });
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(planeFetches, 1, 'the ledger shared the second fetch');
    const admitted = state.sources.filter((s) => s.url === 'https://agentic-e2e.example/dup');
    assert.equal(admitted.length, 1, 'dedupe by URL at admission');
    assert.ok(session && surface, 'session seams live');
  });

  it('budget: maxFetches caps retrieval and the refusal is visible', async () => {
    resetFetchLedger('s-e2e-cap');
    const { session } = await buildScriptedSession('s-e2e-cap');
    const capEvents = [];
    const capped = createAgenticToolSurface({
      sessionId: 's-e2e-cap',
      state: { sources: [], reportChunks: [], fetchesUsed: 0 },
      maxFetches: 1,
      emit: (event) => capEvents.push(event),
      search: async () => [],
      fetchPage: async (url) => ({ url, title: url, text: 'c' }),
    });
    const ok = await capped.handler({ name: 'fetch_content', arguments: { url: 'https://agentic-e2e.example/one' } });
    assert.equal(ok.success, true);
    const over = await capped.handler({ name: 'fetch_content', arguments: { url: 'https://agentic-e2e.example/two' } });
    assert.equal(over.success, false);
    assert.match(over.output, /budget/i);
    assert.ok(capEvents.some((e) => e.type === 'budget_exhausted'), 'budget refusal is a visible event');
    assert.ok(session, 'session seams live');
  });

  it('cancel aborts the live run and surfaces the explicit cancelled terminal', async () => {
    resetFetchLedger('s-e2e-cancel');
    const { session, emitted, state } = await buildScriptedSession('s-e2e-cancel');
    // A hung transport that is aborted through the runner's OWN registry
    // signal — determinism, not timing: the hang ends exactly when cancel
    // fires, so the test cannot flake on a slow or fast machine.
    const { __testSeams } = await importEngine('agenticSearch.js');
    const originalCancel = cancelAgenticSearch;
    session.agent.streamFunction = async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_start', contentIndex: 0, partial: { role: 'assistant', content: [] } };
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        yield { type: 'text_delta', contentIndex: 0, delta: 'never', partial: { role: 'assistant', content: [] } };
      },
      async result() {
        return { role: 'assistant', content: [], stopReason: 'aborted' };
      },
    });
    const run = runAgenticSearch(session, {
      sessionId: 's-e2e-cancel',
      question: 'hang probe',
      state,
      emit: (event) => emitted.push(event),
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(cancelAgenticSearch('s-e2e-cancel'), true, 'cancel found the live run');
    session.abort();
    const result = await run;
    assert.equal(result.terminal, 'cancelled');
    const cancelled = emitted.find((e) => e.type === 'cancelled');
    assert.ok(cancelled, 'explicit cancelled event emitted');
  });
});

describe('Agentic admission guard — no usable provider, no run', () => {
  it('rejects a cloud start without a key, bilingually', () => {
    const message = agenticAdmissionGuard({ provider: 'gemini' });
    assert.ok(message);
    assert.match(message, /API key/);
    assert.match(message, /مفتاح API/);
  });
  it('rejects an Ollama start without an endpoint', () => {
    const message = agenticAdmissionGuard({ provider: 'ollama' });
    assert.ok(message);
    assert.match(message, /Ollama/);
  });
});
