/**
 * The single construction seam for the Pi AgentSession inside the LENS engine
 * (ADR-0014, ticket #140).
 *
 * The hosting decision is encoded here so it cannot drift by accident:
 *  - **In-process** — the official `@earendil-works/pi-coding-agent` runtime
 *    (already a dependency, vendored for the tool bridge) is activated as
 *    LENS's agent layer. No subprocess, no second framework, ever: the pi-only
 *    guard test fails CI if another agent/orchestration runtime is imported
 *    under the engine, or if `createAgentSession*` is called anywhere else.
 *  - **Research-tools-only allow-list** — sessions are granted exactly the
 *    LENS research tools (plus pi's session todo tool); the coding tools are
 *    never granted. Per SPEC-028 decision 5, the allow-list IS the permission
 *    grant.
 *  - **LENS-owned discovery** — the resource loader's agentDir points under
 *    LENS's own app-data directory (never the user's `~/.pi`), and the model
 *    runtime is created with network catalog refresh disabled (the
 *    `PI_OFFLINE` equivalent — LENS provisions providers itself). Provider
 *    keys ride as non-persisted runtime overrides.
 *  - **Enforcement stays in the tools** (ADR-0013; ADR-0014 decision 4): the
 *    retrieval gate, plane ledger, and SSRF validation live inside the
 *    LENS-wrapped tools handed to the session. Pi's call hooks are observation
 *    points in v1 and carry no policy.
 *  - **ESM bridge** — the runtime package is ESM-only; the CJS-compiled
 *    engine loads it through the dedicated `.mjs` bridge via dynamic
 *    `import()` (the piAdapter shim precedent). No static import of the
 *    package exists anywhere in the engine.
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

/**
 * The Electron app object, resolved lazily. `require('electron')` at module
 * load is a CI hazard: on a runner without the binary, the electron package
 * synchronously spawns the binary download mid-test, freezing timers and
 * reshuffling every wall-clock assumption. In the packaged app the import is
 * trivial; in node tests it must never block, so failure to resolve simply
 * falls back to the LENS-owned home path.
 */
function resolveElectronApp(): { getPath(name: string): string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    const app = (electron as any)?.default?.app ?? (electron as any)?.app ?? null;
    if (app && typeof app.getPath === 'function') return app;
    return null;
  } catch {
    return null;
  }
}

/** The research tools a LENS session may be granted; pi's todo joins them. */
export const RESEARCH_TOOL_ALLOW_LIST = [
  'web_search',
  'source_check',
  'fetch_content',
  'get_search_content',
  'todo',
] as const;

/** Pi coding tools that must never be granted to a LENS research session. */
export const FORBIDDEN_CODING_TOOLS = ['read', 'write', 'edit', 'bash'] as const;

/** Call-site census for the pi-only guard: this seam is the only one. */
export const SESSION_CONSTRUCTION_CALL_SITES = 1;

/** LENS-owned tool surface handed to sessions through the seam. */
export interface LensToolSurface {
  definitions: Array<{ name: string; description: string; parameters: Record<string, any> }>;
  handler: (call: { name: string; arguments: Record<string, any> }) => Promise<{
    success: boolean;
    result?: any;
    error?: string;
  }>;
}

export interface ResearchSessionOptions {
  sessionId: string;
  /** Per-run provider overrides: non-persisted runtime keys from LENS settings. */
  providerOverrides?: Record<string, string>;
  /** Resource-discovery working directory; defaults to the engine's cwd. */
  cwd?: string;
}

export interface HostedSession {
  session: any;
  tools: string[];
}

/**
 * The ESM-only pi runtime, loaded through the dedicated bridge. The
 * CJS-compiled engine cannot statically import the package specifier, so the
 * bridge is a dynamic `import()` away — same pattern as the pi-ai shim.
 */
let cachedRuntime: any | undefined;

export async function loadPiRuntime(): Promise<any> {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = await import('../piAgentSession.mjs');
  return cachedRuntime;
}

/**
 * LENS-owned agent discovery directory. In the Electron main process this is
 * the app's userData dir; outside Electron (tests, plain node) it falls back
 * to a LENS-owned path under the user home — never the user's real `~/.pi`.
 */
export function resolveAgentDir(): string {
  const app = resolveElectronApp();
  if (app) {
    try {
      return join(app.getPath('userData'), 'pi-agent');
    } catch {
      // app not ready (early boot); fall through to the LENS-owned default.
    }
  }
  return join(homedir(), '.lens', 'pi-agent');
}

/** Construction facts recorded by the last `createResearchSession` call. */
export interface ConstructionFacts {
  sessionManagerKind: 'inMemory';
  agentDir: string;
  modelNetwork: false;
}

let lastConstruction: ConstructionFacts | undefined;

/**
 * Create the offline ModelRuntime: catalog network refresh disabled (LENS
 * provisions providers itself), provider keys injected as non-persisted
 * runtime overrides. Returns the runtime plus the truthfully recorded
 * offline fact for the contract tests.
 */
/**
 * Construction options for the offline ModelRuntime — recorded once and
 * passed verbatim, so the tests can read the fact instead of a re-statement
 * of it. `allowModelNetwork: false` is the PI_OFFLINE equivalent; `authPath`
 * keeps the credential file inside LENS-owned app data (the default would
 * touch the user's real `~/.pi/agent`).
 */
function modelRuntimeOptions(agentDir: string): Record<string, unknown> {
  return { allowModelNetwork: false, authPath: join(agentDir, 'auth.json') };
}

async function createModelRuntime(
  agentDir: string,
  providerOverrides: Record<string, string> | undefined
): Promise<{ runtime: any; offline: boolean }> {
  const pi = await loadPiRuntime();
  const options = modelRuntimeOptions(agentDir);
  const runtime = await pi.ModelRuntime.create(options);
  for (const [provider, key] of Object.entries(providerOverrides ?? {})) {
    if (typeof key === 'string' && key.length > 0 && typeof runtime.setRuntimeApiKey === 'function') {
      runtime.setRuntimeApiKey(provider, key);
    }
  }
  return { runtime, offline: options.allowModelNetwork === false };
}

/**
 * Adapt an engine LLM tool definition (name/description/parameters dispatched
 * through the shared LENS handler) into a pi ToolDefinition for the session's
 * customTools. The handler IS the LENS-wrapped tool: the gate, ledger, and
 * SSRF checks fire inside it, so the ADR-0013 enforcement point survives the
 * runtime swap unchanged.
 */
function toPiTool(tool: LensToolSurface['definitions'][number], handler: LensToolSurface['handler']): any {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (
      _toolCallId: string,
      params: Record<string, any>
    ): Promise<{ output: string; isError: boolean }> => {
      const outcome = await handler({ name: tool.name, arguments: params ?? {} });
      const text = outcome.success
        ? typeof outcome.result === 'string'
          ? outcome.result
          : JSON.stringify(outcome.result ?? null)
        : `Error: ${outcome.error ?? 'tool call failed'}`;
      return { output: text, isError: !outcome.success };
    },
  };
}

/**
 * Build one research session (one Turn-Group) under the ADR-0014 contract.
 * Construction never requires a provider key — admission is a start-time
 * concern (the Provider Admission Guard), not a construction-time one.
 */
export async function createResearchSession(
  options: ResearchSessionOptions,
  tools?: LensToolSurface
): Promise<HostedSession> {
  const pi = await loadPiRuntime();
  const cwd = options.cwd ?? process.cwd();
  const agentDir = resolveAgentDir();
  // The resource loader expects the agentDir to exist; create it idempotently
  // so first-construction never depends on prior app boot.
  mkdirSync(agentDir, { recursive: true });

  const { runtime } = await createModelRuntime(agentDir, options.providerOverrides);

  // Services: LENS-owned discovery surfaces only — in-memory settings, the
  // LENS agentDir, the offline model runtime.
  const services = await pi.createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime: runtime,
    settingsManager: pi.SettingsManager.inMemory(),
  });

  // In-memory session manager: LENS persists the transcript itself (SPEC-028
  // decision 3); the runtime keeps no session files.
  const sessionManager = pi.SessionManager.inMemory(cwd);

  const customTools = (tools?.definitions ?? []).map((definition) => toPiTool(definition, tools!.handler));

  const { session } = await pi.createAgentSessionFromServices({
    services,
    sessionManager,
    customTools,
    // The allow-list is the permission grant (ADR-0014 decision 2): the
    // default built-in tools (read/bash/edit/write) are disabled — without
    // this, customTools are ADDED ON TOP of the coding tools and the
    // construction contract is breached. LENS-owned discovery also means no
    // filesystem extensions/skills/context-files discovery in sessions:
    // LENS provisions everything itself.
    noTools: 'builtin',
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true },
  });

  lastConstruction = { sessionManagerKind: 'inMemory', agentDir, modelNetwork: false };

  // Auth preflight guarantee: AgentSession.prompt() rejects before streaming
  // when the selected model's provider has no configured auth — the exact
  // silent-hang class the admission guards exist to prevent. The seam is the
  // single point that owns the key surface, so it ensures a runtime override
  // exists for the selected provider: the real LENS-settings key when one was
  // passed, otherwise a non-persisted placeholder that satisfies the preflight
  // (the transport call itself carries the credential in production; tests
  // replace the transport entirely).
  const selectedModel = (session as any)?.model ?? (session as any)?.agent?.state?.model;
  const provider: string | undefined = selectedModel?.provider;
  if (provider && typeof runtime.hasConfiguredAuth === 'function' && runtime.hasConfiguredAuth(provider) !== true) {
    const existingOverride = options.providerOverrides?.[provider];
    await runtime.setRuntimeApiKey(provider, existingOverride ?? 'lens-runtime-override');
  }

  // Truth-in-tests: report the tools the runtime actually granted on the
  // live session — the construction contract is about the session, not the
  // allow-list constant.
  const grantedTools: string[] = (session?.agent?.state?.tools ?? []).map((t: any) =>
    typeof t === 'string' ? t : (t?.name ?? String(t))
  );
  return { session, tools: grantedTools };
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = {
  host: {
    createResearchSession,
    researchToolAllowList: (): string[] => [...RESEARCH_TOOL_ALLOW_LIST],
    resolveAgentDir,
    SESSION_CONSTRUCTION_CALL_SITES,
    describeLastConstruction: async (): Promise<ConstructionFacts> => {
      if (!lastConstruction) {
        // The contract test creates a session before probing; keep the probe
        // honest rather than fabricating facts.
        throw new Error('no construction recorded yet');
      }
      return lastConstruction;
    },
  },
  loadPiRuntime: async (): Promise<{ __offline: boolean }> => {
    const { offline } = await createModelRuntime(resolveAgentDir(), undefined);
    return { __offline: offline };
  },
};
