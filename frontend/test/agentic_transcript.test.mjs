import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Ticket #144 — Agentic Conversation, the fifth typed artifact (SPEC-028
 * Decision 2): the engine persists the turn-group transcript (plain-JSON
 * session messages) keyed to the ResearchSession when the run reaches a
 * terminal state, and the history path replays it byte-for-byte.
 *
 * The seam laws under test:
 *  - Capture happens at TERMINAL time, from the live session's own
 *    `state.messages` — plain JSON, no runtime objects.
 *  - Round-trip: what the run wrote is what the history path reads,
 *    byte-for-byte JSON.
 *  - Runtime session state reaches the UI ONLY through this persistence
 *    seam; a read for an unknown session returns undefined (visible
 *    emptiness), never fabricated content.
 */

const importEngine = async (name) =>
  await import(pathToFileURL(join(process.cwd(), 'dist-electron', 'engine', name)).href);

const {
  AgenticTranscriptStore,
  captureTranscriptAtTerminal,
  buildConversationProjection,
} = await importEngine('agenticTranscript.js');
const { runAgenticSearch, createAgenticToolSurface } = await importEngine('agenticSearch.js');
const host = (await importEngine('agentSessionHost.js')).__testSeams.host;
const { resetFetchLedger } = await importEngine('fetchLedger.js');

/** A minimal but real hosted session with a scripted, instantly-done transport. */
async function buildScriptedSession(sessionId, question, finalText = 'The scripted answer.') {
  const state = { sources: [], reportChunks: [], fetchesUsed: 0 };
  const surface = createAgenticToolSurface({
    sessionId,
    state,
    maxFetches: 5,
    emit: () => {},
    search: async () => [{ url: 'https://t144.example/1', title: 'Source one', snippet: 'S1' }],
    fetchPage: async (url) => ({ url, title: url, text: 'body' }),
  });
  const { session } = await host.createResearchSession(
    { sessionId, agentDir: mkdtempSync(join(tmpdir(), 'lens-agent-')) },
    surface
  );
  session.agent.streamFunction = async () => {
    const message = {
      role: 'assistant',
      api: 'scripted',
      provider: 'scripted',
      model: 'scripted-1',
      usage: { input: 1, output: 1, total: 2 },
      content: [{ type: 'text', text: finalText }],
      stopReason: 'stop',
    };
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', contentIndex: 0, delta: finalText, partial: message };
        yield { type: 'done', reason: 'stop', message };
      },
      async result() {
        return message;
      },
    };
  };
  return { session, state };
}

describe('AgenticTranscriptStore — LENS-side plain-JSON persistence', () => {
  it('round-trips byte-for-byte JSON: write at terminal, read from history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'What does the evidence say?' }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'The evidence says this.' }], timestamp: 2 },
    ];
    const written = store.write('s-rt', { question: 'What does the evidence say?', messages });
    const rawOnDisk = readFileSync(join(dir, 's-rt.json'), 'utf8');
    const readBack = store.read('s-rt');
    assert.deepEqual(readBack.turnGroups[0].messages, messages, 'the history path reads what the run wrote');
    assert.equal(JSON.stringify(readBack.turnGroups[0].messages), JSON.stringify(messages), 'byte-for-byte JSON equality');
    assert.equal(typeof rawOnDisk, 'string');
    assert.deepEqual(JSON.parse(rawOnDisk).turnGroups[0].messages, messages, 'the stored bytes parse to the same messages');
    assert.equal(written.turnGroups.length, 1, 'one terminal capture is one turn-group');
  });

  it('appends turn-groups across follow-ups, keyed to the session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    store.write('s-multi', {
      question: 'first?',
      messages: [{ role: 'user', content: 'first?' }],
    });
    store.write('s-multi', {
      question: 'follow-up?',
      messages: [{ role: 'user', content: 'first?' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'follow-up?' }],
    });
    const read = store.read('s-multi');
    assert.equal(read.turnGroups.length, 2, 'each turn-group capture appends one entry');
    assert.equal(read.turnGroups[0].question, 'first?');
    assert.equal(read.turnGroups[1].question, 'follow-up?');
  });

  it('reading an unknown or failed session returns undefined — visible emptiness, never fabrication', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    assert.equal(store.read('never-wrote'), undefined);
    assert.equal(store.read(''), undefined);
    assert.equal(store.read(undefined), undefined);
  });

  it('survives a corrupt on-disk record by degrading visibly, not throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    store.write('s-corrupt', { question: 'q', messages: [{ role: 'user', content: 'q' }] });
    // Corrupt the bytes behind the store's back.
    writeFileSync(join(dir, 's-corrupt.json'), '{not json at all');
    assert.equal(store.read('s-corrupt'), undefined, 'a corrupt record reads as absent — the UI degrades visibly');
  });
});

describe('AgenticTranscriptStore — atomic durability', () => {
  it('a crash mid-write cannot corrupt the session record: the replace is atomic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    store.write('s-atomic', { question: 'first?', messages: [{ role: 'user', content: 'first?' }] });
    const before = readFileSync(join(dir, 's-atomic.json'), 'utf8');
    // Simulate power loss DURING the store's next write: bytes flush
    // partially, then the process dies. If the store writes the target in
    // place, the record is torn — read() returns undefined and the NEXT
    // write rebuilds a fresh record, silently dropping every earlier
    // turn-group. With an atomic temp+rename replace, the committed record
    // survives byte-for-byte and the next append builds on the full history.
    const require = createRequire(import.meta.url);
    const fsModule = require('node:fs');
    const realWriteFileSync = fsModule.writeFileSync;
    fsModule.writeFileSync = function tornWrite(path, data, options) {
      realWriteFileSync.call(fsModule, path, '{"sessionId', options);
      throw Object.assign(new Error('simulated power loss mid-write'), { code: 'EPOWERLOSS' });
    };
    try {
      const torn = store.write('s-atomic', { question: 'lost?', messages: [{ role: 'user', content: 'lost?' }] });
      assert.equal(torn, undefined, 'the torn write degrades to undefined, never throws out of the store');
    } finally {
      fsModule.writeFileSync = realWriteFileSync;
    }
    assert.equal(store.read('s-atomic')?.turnGroups.length, 1, 'the committed record survives the crashed write');
    assert.equal(readFileSync(join(dir, 's-atomic.json'), 'utf8'), before, 'byte-for-byte survival');
    const after = store.write('s-atomic', { question: 'second?', messages: [{ role: 'user', content: 'second?' }] });
    assert.equal(after.turnGroups.length, 2, 'the next append builds on the full history, not a rebuilt record');
    assert.equal(store.read('s-atomic').turnGroups[0].question, 'first?');
  });

  it('the atomic replace leaves no debris: temp files are gone after a successful write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const store = new AgenticTranscriptStore(dir);
    store.write('s-clean', { question: 'q?', messages: [{ role: 'user', content: 'q?' }] });
    store.write('s-clean', { question: 'q2?', messages: [{ role: 'user', content: 'q2?' }] });
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'a completed rename leaves no temp residue in the store dir');
  });
});

describe('captureTranscriptAtTerminal — the terminal-time seam on the real runner', () => {
  it('captures the live session messages when the run reaches its terminal', async () => {
    const sessionId = 's-capture-finished';
    resetFetchLedger(sessionId);
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const QUESTION = 'What does the evidence say?';
    const { session, state } = await buildScriptedSession(sessionId, QUESTION);
    const run = runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: () => {},
      transcript: { store: new AgenticTranscriptStore(dir) },
    });
    const result = await run;
    assert.equal(result.terminal, 'finished');
    const read = new AgenticTranscriptStore(dir).read(sessionId);
    assert.ok(read, 'the terminal capture wrote a transcript');
    assert.equal(read.turnGroups.length, 1);
    const lastTurn = read.turnGroups[0];
    assert.equal(lastTurn.terminal, 'finished', 'the turn-group records its own terminal');
    const roles = lastTurn.messages.map((m) => m.role);
    assert.ok(roles.includes('user'), 'the user question is in the transcript');
    assert.ok(roles.includes('assistant'), 'the assistant answer is in the transcript');
    assert.equal(JSON.stringify(lastTurn.messages).includes('"function"'), false, 'no function handles leak into the JSON');
  });

  it('captures with evidence intact when the run is cancelled', async () => {
    const sessionId = 's-capture-cancelled';
    resetFetchLedger(sessionId);
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const { session, state } = await buildScriptedSession(sessionId, 'hang probe', 'never');
    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    session.agent.streamFunction = async () => {
      await held;
      return { async *[Symbol.asyncIterator]() {}, async result() { return { role: 'assistant', content: [], stopReason: 'aborted' }; } };
    };
    const run = runAgenticSearch(session, {
      sessionId,
      question: 'hang probe',
      state,
      emit: () => {},
      transcript: { store: new AgenticTranscriptStore(dir) },
    });
    await new Promise((r) => setTimeout(r, 30));
    // Cancel through the public route contract: registry abort + session abort.
    const { cancelAgenticSearch } = await importEngine('agenticSearch.js');
    assert.equal(cancelAgenticSearch(sessionId), true);
    release();
    const result = await run;
    assert.equal(result.terminal, 'cancelled');
    const read = new AgenticTranscriptStore(dir).read(sessionId);
    assert.ok(read, 'a cancelled run still persisted its transcript');
    assert.equal(read.turnGroups[0].terminal, 'cancelled');
  });

  it('the finished terminal event carries the projection of the SAME run — capture lands before emit', async () => {
    const sessionId = 's-proj-fresh';
    resetFetchLedger(sessionId);
    const QUESTION = 'What does the evidence say?';
    const { session, state } = await buildScriptedSession(sessionId, QUESTION, 'The evidence says this exactly once.');
    const dir = mkdtempSync(join(tmpdir(), 'lens-transcript-'));
    const seen = [];
    const result = await runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: (event) => seen.push(event),
      transcript: { store: new AgenticTranscriptStore(dir) },
    });
    assert.equal(result.terminal, 'finished');
    assert.ok(result.conversationProjection, 'the result carries the projection of THIS run');
    assert.equal(result.conversationProjection.turns.length, 1, 'the first finished run is already in the projection');
    const finished = seen.find((e) => e.type === 'finished');
    assert.ok(finished, 'a finished LiveEvent was emitted');
    assert.ok(finished.conversationProjection, 'the finished event carries a projection');
    assert.equal(finished.conversationProjection.turns.length, 1, 'not one turn-group behind: this run is projected');
    assert.equal(
      finished.conversationProjection.turns[0].entries.some((e) => e.kind === 'assistant' && e.text === 'The evidence says this exactly once.'),
      true,
      'the projected assistant text is THIS run, read from the persisted bytes'
    );
  });

  it('a capture failure never breaks the run — the terminal lands, persistence degrades', async () => {
    const sessionId = 's-capture-fail';
    resetFetchLedger(sessionId);
    const QUESTION = 'q?';
    const { session, state } = await buildScriptedSession(sessionId, QUESTION);
    const brokenStore = {
      write() {
        throw new Error('disk full');
      },
      read() {
        return undefined;
      },
    };
    const run = runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: () => {},
      transcript: { store: brokenStore },
    });
    const result = await run;
    assert.equal(result.terminal, 'finished', 'the run finishes even when persistence fails');
  });

  it('no transcript option → no capture, no crash (callers without persistence)', async () => {
    const sessionId = 's-capture-none';
    resetFetchLedger(sessionId);
    const QUESTION = 'q?';
    const { session, state } = await buildScriptedSession(sessionId, QUESTION);
    const result = await runAgenticSearch(session, {
      sessionId,
      question: QUESTION,
      state,
      emit: () => {},
    });
    assert.equal(result.terminal, 'finished');
  });
});

describe('buildConversationProjection — the artifact inspector projection', () => {
  it('projects only what the transcript holds: user, assistant, tool chips, terminal', () => {
    const record = {
      sessionId: 's-proj',
      turnGroups: [
        {
          question: 'What does the evidence say?',
          terminal: 'finished',
          capturedAt: 100,
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'What does the evidence say?' }], timestamp: 1 },
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'c1', name: 'web_search', arguments: { query: 'evidence' } },
                { type: 'text', text: 'The evidence says this.' },
              ],
              timestamp: 2,
            },
            { role: 'toolResult', content: 'result text', timestamp: 3 },
          ],
        },
      ],
    };
    const projection = buildConversationProjection(record);
    assert.equal(projection.sessionId, 's-proj');
    assert.equal(projection.turns.length, 1);
    const turn = projection.turns[0];
    assert.equal(turn.question, 'What does the evidence say?');
    assert.equal(turn.terminal, 'finished');
    const entries = turn.entries;
    assert.deepEqual(
      entries.map((e) => e.kind),
      ['user', 'tool_call', 'assistant', 'tool_result'],
      'the projection lists exactly what happened, in order'
    );
    assert.equal(entries.find((e) => e.kind === 'tool_call').toolName, 'web_search');
    assert.equal(entries.find((e) => e.kind === 'assistant').text, 'The evidence says this.');
  });

  it('degrades visibly on empty or failed persistence — nothing fabricated', () => {
    assert.equal(buildConversationProjection(undefined), null, 'failed persistence projects as absent');
    assert.equal(buildConversationProjection(null), null);
    const empty = buildConversationProjection({ sessionId: 's-empty', turnGroups: [] });
    assert.ok(empty, 'an empty record still projects');
    assert.deepEqual(empty.turns, [], 'with zero fabricated turns');
  });
});
