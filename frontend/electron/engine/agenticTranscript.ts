/**
 * Agentic transcript persistence — the node-only half (ticket #144; SPEC-028
 * Decision 2): the LENS-side plain-JSON store. One JSON file per session
 * under a LENS-owned directory (userData in the app; a test dir in the
 * harness), so records are individually inspectable and corruption is
 * contained. The pure domain (types, plain-JSON normalization, the
 * conversation projection) lives in `agenticConversationProjection.ts` —
 * isomorphic, imported by the renderer bundle directly.
 */

import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { TranscriptRecord, TranscriptTurnGroup } from './agenticConversationProjection';

export {
  toPlainJson,
  captureTranscriptAtTerminal,
  buildConversationProjection,
  type TranscriptTurnGroup,
  type TranscriptRecord,
  type AgenticConversationProjection,
} from './agenticConversationProjection';

/**
 * The LENS-side plain-JSON transcript store. Terminal-time captures append
 * one immutable turn-group entry per run; history replay reads the same
 * bytes back, byte-for-byte.
 */
export class AgenticTranscriptStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private pathFor(sessionId: string): string {
    // Session ids are engine-generated; the sanitizer keeps the file inside
    // the store dir regardless (defense against path traversal at the seam).
    const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    return join(this.dir, `${safe || 'session'}.json`);
  }

  /**
   * Append one turn-group capture for the session (called at terminal time).
   * Messages are JSON-normalized before writing: a value that cannot round-
   * trip is stringified, never dropped silently.
   */
  write(sessionId: string, turn: Omit<TranscriptTurnGroup, 'capturedAt'> & { capturedAt?: number }): TranscriptRecord | undefined {
    try {
      const record = this.read(sessionId) ?? { sessionId, version: 1 as const, turnGroups: [] };
      const entry: TranscriptTurnGroup = {
        question: String(turn.question ?? ''),
        terminal: turn.terminal,
        capturedAt: typeof turn.capturedAt === 'number' ? turn.capturedAt : Date.now(),
        messages: normalizeMessages(turn.messages ?? []),
      };
      record.turnGroups.push(entry);
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.pathFor(sessionId), JSON.stringify(record));
      return record;
    } catch {
      // Persistence failure degrades visibly (read returns undefined / stale);
      // it never breaks the run — the caller owns that law too.
      return undefined;
    }
  }

  /** Read the record back for history replay; undefined when absent or corrupt. */
  read(sessionId: string | undefined): TranscriptRecord | undefined {
    if (!sessionId) return undefined;
    try {
      const raw = readFileSync(this.pathFor(sessionId), 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.sessionId !== sessionId || !Array.isArray(parsed.turnGroups)) {
        return undefined;
      }
      return parsed as TranscriptRecord;
    } catch {
      return undefined;
    }
  }
}

import { toPlainJson } from './agenticConversationProjection';

function normalizeMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return toPlainJson(messages) as Array<Record<string, unknown>>;
}
