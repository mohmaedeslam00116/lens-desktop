/**
 * Re-export the shared Agentic Conversation projection from the engine's
 * PURE isomorphic module (ticket #144): one projection implementation — the
 * card renders exactly what the persisted transcript holds, and node tests
 * pin the same source through dist-electron. The module is deliberately IO-
 * free so the vite renderer bundle can import it (the evidenceShelf
 * precedent; the node-only store lives in the engine's agenticTranscript).
 */
export * from '../../electron/engine/agenticConversationProjection';
