// ESM bridge for the pi-coding-agent runtime inside the CommonJS-compiled
// engine (ADR-0014, ticket #140). The package is ESM-only (its exports map
// carries only the "import" condition), so the CJS engine cannot statically
// import the specifier; the seam loads this bridge via dynamic import() —
// the same pattern as piShim.mjs. dist-electron/ holds a copy (see
// build:electron).
//
// Only the session-hosting surface is re-exported: the construction seam,
// the session/session-manager/runtime factories, and the tool-definition
// helpers. Nothing else of the coding-agent layer is part of LENS's contract.
export {
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
  ModelRuntime,
  DefaultResourceLoader,
  defineTool,
} from '@earendil-works/pi-coding-agent';
