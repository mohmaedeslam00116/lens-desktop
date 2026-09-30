import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildConversationProjection } from '../dist-electron/engine/agenticTranscript.js';

/**
 * Ticket #144 — the renderer side of the Agentic Conversation (the fifth
 * typed artifact): the history rail gains the conversation entry and the
 * inspector renders the persisted projection — never fabricated. Follows
 * the repo's UI-contract test pattern (source assertions pinning the wiring,
 * pure-function tests pinning the projection rules).
 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

describe('Agentic Conversation — projection rules (engine-provided, shared with UI)', () => {
  it('projects tool calls as chips with real names and real args', () => {
    const record = {
      sessionId: 's-ui',
      turnGroups: [
        {
          question: 'q?',
          terminal: 'finished',
          capturedAt: 1,
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'q?' }] },
            {
              role: 'assistant',
              content: [
                { type: 'toolCall', id: 'c1', name: 'web_search', arguments: { query: 'evidence on lenses' } },
                { type: 'text', text: 'Answer text.' },
              ],
            },
          ],
        },
      ],
    };
    const projection = buildConversationProjection(record);
    const entries = projection.turns[0].entries;
    const chip = entries.find((e) => e.kind === 'tool_call');
    assert.equal(chip.toolName, 'web_search');
    assert.deepEqual(chip.args, { query: 'evidence on lenses' });
  });

  it('an absent projection stays absent — the card renders the emptiness honestly', () => {
    assert.equal(buildConversationProjection(undefined), null);
    assert.equal(buildConversationProjection(null), null);
  });
});

describe('AgenticConversation card — renderer contract', () => {
  it('the card component exists and renders only projected entries', async () => {
    const source = await read('../src/components/vane/AgenticConversation.tsx');
    assert.match(source, /buildConversationProjection/, 'the card consumes the engine projection');
    assert.match(source, /AgenticConversationProjection/, 'the card types against the engine projection');
    assert.match(source, /turns\.length === 0/, 'an empty conversation renders its visible-empty state');
    assert.match(source, /tool_call/, 'tool calls render as chips');
  });

  it('the card is bilingual per BRAND/DESIGN voice', async () => {
    const source = await read('../src/components/vane/AgenticConversation.tsx');
    assert.match(source, /language === 'ar'|isArabic/, 'the card carries the bilingual rule');
  });

  it('the inspector mounts the card through the persisted projection, not runtime state', async () => {
    const workspace = await read('../src/components/vane/AgentWorkspace.tsx');
    assert.match(workspace, /AgenticConversation/, 'the inspector mounts the conversation card');
    // The isolation law: runtime session state reaches the UI only through
    // the persistence seam — the card takes the projection, never a session.
    // Comment mentions are fine; only real code references are a breach.
    const card = await read('../src/components/vane/AgenticConversation.tsx');
    const codeOnly = card
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    assert.doesNotMatch(codeOnly, /AgentSession|session\.subscribe/, 'no runtime session objects reach the card');
  });

  it('the renderer consumes the engine projection through the shared re-export', async () => {
    const reexport = await read('../src/utils/agenticConversation.ts');
    assert.match(
      reexport,
      /export \* from '\.\.\/\.\.\/electron\/engine\/agenticConversationProjection'/,
      'one projection implementation serves engine tests and the card (evidenceShelf precedent)'
    );
    // The vite boundary: the re-export must point at the IO-free module —
    // the node-only store (fs/path) can never enter the renderer bundle.
    assert.doesNotMatch(reexport, /agenticTranscript'/, 'no node-IO module in the renderer import path');
  });

  it('a non-finite capturedAt cannot crash the workspace render — the guard holds', async () => {
    const source = await read('../src/components/vane/AgenticConversation.tsx');
    assert.match(source, /Number\.isFinite\(turn\.capturedAt\)/, 'the timestamp render is guarded against non-finite capturedAt');
    // The code path (not a comment) must actually call through the guard.
    const codeOnly = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    assert.doesNotMatch(codeOnly, /new Date\(turn\.capturedAt\)\.toISOString\(\)/, 'no unguarded toISOString() on capturedAt');
  });

  it('App wires the history rail: the replay surface reads the persisted projection by session id', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /agentic-conversations/, 'App persists the agentic projection alongside its history entries');
    assert.match(app, /AgenticConversation|conversationProjection/, 'App hands the projection to the replay surface');
  });
});
