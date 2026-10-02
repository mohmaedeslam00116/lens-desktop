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
 *    `PI_OFFLINE` equivalent — LENS provisions providers itself). Chat auth
 *    resolves from Pi's file-backed `auth.json` under that directory (tracer
 *    P2); requests never carry keys.
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
  /** Pi provider id that drives this session (`google`, never LENS `gemini`). */
  provider?: string;
  /** Resource-discovery working directory; defaults to the engine's cwd. */
  cwd?: string;
  /**
   * Override the LENS-owned agent discovery directory. Production callers
   * never pass it — the app-data default holds. Test harnesses pass a
   * per-process temp dir so concurrent test workers never share (and contend
   * on) the runtime's credential file, which is environment-dependent.
   */
  agentDir?: string;
  /**
   * The requested model id (Settings' `model_name`, bare id or
   * `provider/id`). Resolved inside the requested Pi provider — a stale id
   * falls back to that provider's default rather than wandering to ambient
   * auth's pick. Absent = provider default.
   */
  modelName?: string;
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
  /** True when no provider was configured and the LENS offline placeholder was registered. */
  offlineFallback: boolean;
}

let lastConstruction: ConstructionFacts | undefined;

/**
 * Auth facts recorded by the last `createResearchSession` call: which
 * provider the selected model needs and where its key came from. Pi owns
 * auth (`auth.json` under the agent directory); requests never carry keys
 * (tracer P2), so there is no override surface left to report.
 */
export interface SessionAuthFacts {
  provider?: string;
  /** `existing` = Pi already holds auth for the provider (stored, environment,
   * or file-overlaid — including this run's persisted key);
   * `placeholder` = the preflight fake (no real key anywhere); `none` = no
   * provider selected / no runtime auth surface. Only `placeholder` (with no
   * stored key) and `none` are failure states. */
  keySource: 'placeholder' | 'existing' | 'none';
}

let lastAuth: SessionAuthFacts | undefined;

/**
 * Create the offline ModelRuntime: catalog network refresh disabled (LENS
 * provisions providers itself) with Pi file-backed auth (`auth.json` under
 * the agent directory). When the requested provider is `ollama`, the local
 * endpoint is probed and registered natively for this construction only
 * (transient until P4 persists it as a `models.json` overlay).
 */
/**
 * Construction options for the offline ModelRuntime — recorded once and
 * passed verbatim, so the tests can read the fact instead of a re-statement
 * of it. `allowModelNetwork: false` is the PI_OFFLINE equivalent; `authPath`
 * and `modelsPath` keep the credential file and the provider overlay inside
 * LENS-owned app data (the defaults would touch the user's real `~/.pi`).
 */
function modelRuntimeOptions(agentDir: string): Record<string, unknown> {
  return {
    allowModelNetwork: false,
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  };
}

async function createModelRuntime(agentDir: string): Promise<{ runtime: any; offline: boolean }> {
  const pi = await loadPiRuntime();
  const options = modelRuntimeOptions(agentDir);
  // Ollama resolves from the persisted `models.json` overlay (tracer P4) —
  // no per-construction endpoint, no transient registration.
  const runtime = await pi.ModelRuntime.create(options);
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
 * Zero-configured-provider construction guarantee (ADR-0014 amendment):
 * construction is provider-independent by contract — the packaged app
 * provisions its own providers, and a machine with none (a clean CI runner,
 * a fresh install before Settings) must still build a usable session.
 *
 * When the runtime has no configured provider AT ALL — no stored auth, no
 * environment keys, no models.json providers; the availability snapshot's
 * `configuredProviders` is exactly that union — the seam registers a
 * LENS-owned placeholder provider so `findInitialModel` resolves a model and
 * `prompt()` passes its auth preflight instead of throwing before the loop
 * ever starts. Real providers, when present, always win: the placeholder is
 * only ever registered into an empty snapshot.
 *
 * The placeholder can never complete a network call: a literal sentinel key
 * (never a `$ENV` reference, which would make it an environment probe) and
 * an unroutable discard-port loopback URL. With no usable provider the
 * admission guard (#119) remains the start-time authority — construction
 * only refuses to be a dead end.
 */
const LENS_OFFLINE_PROVIDER_ID = 'lens-offline';
const LENS_OFFLINE_SENTINEL_KEY = 'lens-offline-sentinel-not-a-credential';
const LENS_OFFLINE_MODEL = {
  id: 'lens-offline-1',
  name: 'LENS Offline Placeholder',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};

/**
 * Guarantee the runtime resolves a model at session construction: when no
 * provider is configured, register the LENS offline placeholder. Returns
 * whether the fallback fired (recorded as a construction fact for tests).
 */
function ensureUsableModel(runtime: any): boolean {
  const snapshot = typeof runtime?.getAvailableSnapshot === 'function' ? runtime.getAvailableSnapshot() : [];
  if (Array.isArray(snapshot) && snapshot.length > 0) return false;
  runtime.registerProvider(LENS_OFFLINE_PROVIDER_ID, {
    name: 'LENS Offline Placeholder',
    // Discard port: connection refusal is instant and requires no network.
    baseUrl: 'http://127.0.0.1:9/v1',
    // Literal sentinel — never "$ENV" (that form is resolved from the
    // environment; a literal is provably not a probe or a credential).
    apiKey: LENS_OFFLINE_SENTINEL_KEY,
    api: 'openai-completions',
    models: [LENS_OFFLINE_MODEL],
  });
  return true;
}

/**
 * Pin the session to the REQUESTED provider (and model) instead of letting
 * pi's model resolution wander. Unpinned resolution prefers ambient auth —
 * on a machine with stray provider keys it selects a foreign provider, on a
 * clean machine the offline placeholder — while the user's key sits on an
 * untranslated id. Either way every call fails and the run dies retrying.
 *
 * Returns the canonical model def, or undefined when there is nothing to pin
 * to (keyless construction keeps the legacy path: placeholder + preflight).
 */
function resolveRequestedModel(
  runtime: any,
  provider: string | undefined,
  modelName: string | undefined
): any | undefined {
  let models: Array<{ provider: string; id: string }> = [];
  try {
    const listed = typeof runtime?.getModels === 'function' ? runtime.getModels() : [];
    if (Array.isArray(listed)) models = listed;
  } catch {
    return undefined;
  }
  if (models.length === 0) return undefined;
  const wanted = (modelName ?? '').trim().toLowerCase();
  if (wanted) {
    // A bare id resolves inside the requested provider first (Pi ids only);
    // a `provider/id` pair resolves exactly. A stale id falls through to the
    // provider pin below — never to a foreign provider.
    const requested = (provider ?? '').trim().toLowerCase();
    const exact =
      models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === wanted) ??
      (requested
        ? models.find((m) => m.provider.toLowerCase() === requested && String(m.id).toLowerCase() === wanted)
        : undefined);
    if (exact) {
      try {
        return typeof runtime?.getModel === 'function'
          ? (runtime.getModel(exact.provider, exact.id) ?? exact)
          : exact;
      } catch {
        return exact;
      }
    }
  }
  const pinned = (provider ?? '').trim();
  if (!pinned) return undefined;
  const first = models.find((m) => m.provider === pinned);
  if (!first) return undefined;
  try {
    return typeof runtime?.getModel === 'function'
      ? (runtime.getModel(first.provider, first.id) ?? first)
      : first;
  } catch {
    return first;
  }
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
  const agentDir = options.agentDir ?? resolveAgentDir();
  // The resource loader expects the agentDir to exist; create it idempotently
  // so first-construction never depends on prior app boot.
  mkdirSync(agentDir, { recursive: true });

  const { runtime } = await createModelRuntime(agentDir);

  // Services: LENS-owned discovery surfaces only — the file-backed Pi
  // settings (defaults live in `settings.json` under the agent directory,
  // tracer P2), the LENS agentDir, the offline model runtime.
  const services = await pi.createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime: runtime,
    settingsManager: pi.SettingsManager.create(cwd, agentDir),
  });

  // Zero-configured-provider guarantee: AFTER the services' internal model
  // refresh (its snapshot is final here) and BEFORE session construction
  // (findInitialModel reads the snapshot synchronously). Keyless machines
  // get a usable model; configured machines keep theirs untouched.
  const offlineFallback = ensureUsableModel(runtime);

  // In-memory session manager: LENS persists the transcript itself (SPEC-028
  // decision 3); the runtime keeps no session files.
  const sessionManager = pi.SessionManager.inMemory(cwd);

  const customTools = (tools?.definitions ?? []).map((definition) => toPiTool(definition, tools!.handler));

  // Provider pinning: the REQUESTED Pi provider drives this session — the
  // requested model inside it when one was named, else that provider's
  // catalog default. Without a pin, pi's findInitialModel prefers ambient
  // auth and the session silently runs a foreign provider (or the offline
  // placeholder). Pi ids only (`google`, never LENS `gemini`).
  const pinnedModel = resolveRequestedModel(runtime, options.provider, options.modelName);

  const { session } = await pi.createAgentSessionFromServices({
    services,
    sessionManager,
    customTools,
    ...(pinnedModel ? { model: pinnedModel } : {}),
    // The allow-list is the permission grant (ADR-0014 decision 2): the
    // default built-in tools (read/bash/edit/write) are disabled — without
    // this, customTools are ADDED ON TOP of the coding tools and the
    // construction contract is breached. LENS-owned discovery also means no
    // filesystem extensions/skills/context-files discovery in sessions:
    // LENS provisions everything itself.
    noTools: 'builtin',
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true },
  });

  lastConstruction = { sessionManagerKind: 'inMemory', agentDir, modelNetwork: false, offlineFallback };

  // Auth preflight guarantee: AgentSession.prompt() rejects before streaming
  // when the selected model's provider has no configured auth — the exact
  // silent-hang class the admission guards exist to prevent. Pi owns auth
  // (`auth.json`); when nothing is configured the seam keeps the historical
  // non-persisted placeholder so construction itself never becomes a dead
  // end (the admission guard remains the start-time authority).
  const selectedModel = (session as any)?.model ?? (session as any)?.agent?.state?.model;
  const selectedProvider: string | undefined = selectedModel?.provider;
  if (selectedProvider && typeof runtime.hasConfiguredAuth === 'function' && runtime.hasConfiguredAuth(selectedProvider) !== true) {
    await runtime.setRuntimeApiKey(selectedProvider, 'lens-runtime-override');
    lastAuth = { provider: selectedProvider, keySource: 'placeholder' };
  } else if (selectedProvider) {
    lastAuth = { provider: selectedProvider, keySource: 'existing' };
  } else {
    lastAuth = { keySource: 'none' };
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
    describeLastAuth: async (): Promise<SessionAuthFacts> => {
      if (!lastAuth) {
        throw new Error('no auth recorded yet');
      }
      return lastAuth;
    },
  },
  loadPiRuntime: async (): Promise<{ __offline: boolean }> => {
    const { offline } = await createModelRuntime(resolveAgentDir());
    return { __offline: offline };
  },
};
