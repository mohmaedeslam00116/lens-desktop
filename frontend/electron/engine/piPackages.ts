import * as fs from 'node:fs';
import * as path from 'node:path';
import { LLMToolDefinition, ToolCallHandler } from './models';

/**
 * piPackages.ts — in-process bridge that loads the vendored pi ecosystem
 * packages behind the engine's tool contract (LLMToolDefinition +
 * ToolCallHandler), running them inside the LENS Electron main process.
 *
 * Loader strategy (verified against the vendored sources):
 *  - pi-web-access → its `index.ts` extension registers four tools
 *    (web_search / source_check / fetch_content / get_search_content); the
 *    whole module graph loads through jiti (the packages have no `main`/
 *    `exports` entry, and Node refuses to type-strip under node_modules).
 *  - rpiv-todo     → loaded through its PURE interface only: the layered
 *    modules under `state/` + `tool/` (verbatim vendored) are imported
 *    directly and the `todo` tool is registered by the bridge itself.
 *    `todo.ts`/`index.ts` are skipped because their module graph pulls
 *    `state/i18n-bridge.ts`, whose top-level `await import(...)` cannot be
 *    expressed by jiti's synchronous CJS transpile.
 *  - pi-subagents  → DEFERRED: its index.ts top-level-await loader and the
 *    full foreground pipeline need a real pi-coding-agent extension host;
 *    sources are vendored and the pin is documented in
 *    docs/research/responsibility-mapping.md.
 *
 * Everything is session-scoped, lazy and resilient: a failing package logs
 * and degrades to the remaining tools — a third-party module misbehaving at
 * load time may never crash the engine.
 */

export interface PackageTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** pi's positional execute signature (toolCallId, params, signal,
   *  onUpdate, ctx). ctx is stamped per-tool by the host at registration. */
  execute: (
    callId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
    details?: Record<string, unknown>;
  }>;
}

export interface PackageToolOptions {
  /** Session id forwarded to `ctx.sessionManager.getSessionId()`. */
  sessionId: string;
  /** Working directory forwarded to `ctx.cwd`. */
  cwd?: string;
  /** Provider id + keys forwarded to the summary/model-bridge paths. */
  modelProvider?: string;
  apiKeys?: Record<string, string>;
  /** Per-tool deadline before the wrapper aborts the call (ms). */
  timeoutMs?: number;
  language?: 'ar' | 'en';
}

/**
 * Minimal headless pi extension host — the slice of the pi `ExtensionAPI`
 * that the vendored registration surfaces actually touch at runtime.
 */
export interface PackageHost {
  registerTool(tool: {
    name: string;
    label?: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: Record<string, unknown>;
    execute: PackageTool['execute'];
  }): void;
  registerCommand(name: string, def: { description: string; handler: (...args: unknown[]) => unknown }): void;
  registerShortcut(key: string, def: { description: string; handler: (...args: unknown[]) => unknown }): void;
  registerMessageRenderer(type: string, renderer: unknown): void;
  registerProvider?(name: string, opts: { baseUrl?: string }): void;
  registerModel?(model: unknown): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
events: { on(event: string, handler: unknown): void; emit(event: string, payload: unknown): void };
  sendMessage(msg: unknown, opts?: unknown): void;
  appendEntry(key: string, value: unknown): void;
  exec(cmd: string, args?: string[], opts?: unknown): Promise<unknown>;
  getActiveTools(): string[];
  ui: Record<string, (...args: unknown[]) => unknown>;
  /** LENS capture seam: every registered tool is pushed here. */
  captured: PackageTool[];
}

/** Seeds globals the vendored packages assume (pi's own loader does this).
 * NOTE: Node 20+ provides `AbortController`/`AbortSignal` natively, so no
 * compatibility shim is required on the Electron 44 / Node 24 runtime. */

let jitiLoaderPromise: Promise<((absPath: string) => unknown) | null> | undefined;

/** Lazily resolve the jiti loader (jiti is a direct engine dependency). */
export async function getJitiLoader(): Promise<((absPath: string) => unknown) | null> {
  if (jitiLoaderPromise) return jitiLoaderPromise;
  jitiLoaderPromise = (async () => {
    try {
      const jiti = await import('jiti');
      const create = jiti.default ?? jiti.createJiti;
      if (typeof create !== 'function') return null;
      return create(process.cwd()) ?? null;
    } catch (err) {
      console.warn(`[piPackages] jiti unavailable: ${String(err)}`);
      return null;
    }
  })();
  return jitiLoaderPromise;
}

const VENDOR_ROOT = path.join(__dirname, '..', 'vendor', 'pi');

/**
 * Loads a vendored package entry through jiti and invokes its default export
 * with the harness, returning the captured tools. Returns [] on any failure
 * so the bridge degrades loudly without crashing the engine.
 */
export async function loadVendoredPackageTools(
  entryRelPath: string,
  options: PackageToolOptions,
  runExtension: (ext: unknown, host: PackageHost) => void
): Promise<PackageTool[]> {
  const loader = await getJitiLoader();
  if (!loader) return [];
  const host = createPackageHost(options);
  try {
    const entryPath = path.join(VENDOR_ROOT, entryRelPath);
    if (!fs.existsSync(entryPath)) {
      console.warn(`[piPackages] vendored entry missing: ${entryPath} (run node scripts/vendor-pi-packages.mjs)`);
      return [];
    }
    const mod = loader(entryPath);
    const ext = (mod && typeof mod === 'object' && 'default' in (mod as object))
      ? (mod as { default?: unknown }).default
      : mod;
    if (ext && typeof ext === 'function') runExtension(ext as (...args: unknown[]) => unknown, host);
    if (host.captured.length === 0) {
      console.warn(`[piPackages] ${entryRelPath} loaded but registered no tools.`);
    }
    return host.captured;
  } catch (err) {
    console.warn(`[piPackages] failed to load ${entryRelPath}: ${String(err).slice(0, 600)}`);
    return [];
  }
}

/** Wraps a captured package tool into the engine's LLMToolDefinition. */
export function toEngineTool(t: PackageTool): LLMToolDefinition {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, any>,
  };
}

/**
 * Composes the engine-side handler for all captured package tools. A captured
 * tool's execute() returns pi's `{ content, isError, details }` envelope; the
 * handler normalizes it to the engine's `{ success, result, error }` shape.
 */
export function wrapPackageToolHandler(
  tools: PackageTool[],
  extra?: ToolCallHandler
): ToolCallHandler {
  const byName = new Map(tools.map((t) => [t.name, t] as const));
  return async (call) => {
    if (extra) {
      const r = await extra(call);
      if (r.success) return r;
    }
    const tool = byName.get(call.name);
    if (!tool) return { success: false, error: `Unsupported tool: ${call.name}` };
    const timeoutMs = 5 * 60 * 1000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.();
    try {
      // pi tools declare the positional signature
      // (toolCallId, params, signal, onUpdate, ctx) — forward the full shape,
      // with the session ctx stamped onto the tool at registration time.
      const ctx = (tool as { __lensCtx?: unknown }).__lensCtx;
      const env = await tool.execute('lens', call.arguments as Record<string, unknown>, ctrl.signal, undefined, ctx);
      const text = Array.isArray(env?.content)
        ? env.content.filter((c) => c).map((c) => c.text ?? '').join('\n')
        : '';
      return { success: !env?.isError, result: text || env?.details };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Loads the vendored rpiv-todo `todo` tool through its PURE interface: the
 * layered `state/` (store, reducer) and `tool/` (schema, envelope) modules
 * only — never `todo.ts`/`index.ts`, whose graph reaches `i18n-bridge.ts`'s
 * top-level await (untranspilable by jiti) and the TUI overlay respectively.
 * Session scoping uses the store's per-session Map keyed by `options.sessionId`.
 */
export async function loadPureTodoTool(options: PackageToolOptions): Promise<PackageTool | null> {
  const loader = await getJitiLoader();
  if (!loader) return null;
  const root = path.join(VENDOR_ROOT, 'rpiv-todo');
  try {
    const types = loader(path.join(root, 'tool', 'types.ts')) as Record<string, any>;
    const reducer = loader(path.join(root, 'state', 'state-reducer.ts')) as Record<string, any>;
    const store = loader(path.join(root, 'state', 'store.ts')) as Record<string, any>;
    const envelope = loader(path.join(root, 'tool', 'response-envelope.ts')) as Record<string, any>;
    if (!types?.TodoParamsSchema || typeof reducer?.applyTaskMutation !== 'function'
      || typeof store?.getState !== 'function' || typeof store?.commitState !== 'function'
      || typeof envelope?.buildToolResult !== 'function') {
      console.warn('[piPackages] rpiv-todo pure modules missing expected exports.');
      return null;
    }
    const sessionId = options.sessionId;
    const tool: PackageTool = {
      name: String(types.TOOL_NAME),
      // Verbatim from rpiv-todo/todo.ts registration — the LLM-facing copy.
      description:
        'Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.',
      parameters: types.TodoParamsSchema as Record<string, unknown>,
      async execute(_callId, params) {
        const result = reducer.applyTaskMutation(store.getState(sessionId), params.action, params);
        store.commitState(sessionId, result.state);
        return envelope.buildToolResult(params.action, params, result.state, result.op);
      },
    };
    return tool;
  } catch (err) {
    console.warn(`[piPackages] failed to load rpiv-todo pure modules: ${String(err).slice(0, 600)}`);
    return null;
  }
}

/** Creates the harness host capturing registered tools (see PackageHost). */
export function createPackageHost(options: PackageToolOptions): PackageHost {
  const captured: PackageTool[] = [];
  const sessionManager = { getSessionId: () => options.sessionId };
  // Any theme property the vendored tools read must be callable; a proxy keeps
  // the stub resilient to pi theme API additions.
  const theme = new Proxy({}, {
    get: () => (...args: unknown[]) => String(args[args.length - 1] ?? ''),
  });
  const ui: Record<string, any> = {
    notify: () => {}, select: () => Promise.resolve(null), setWidget: () => {},
    confirm: () => Promise.resolve(true),
    theme,
  };
  // Session ctx the vendored tools read at execute() time (pi ToolContext slice).
  const ctx = {
    model: undefined,
    modelRegistry: undefined,
    cwd: options.cwd ?? process.cwd(),
    isProjectTrusted: () => true,
    hasUI: false,
    ui,
    sessionManager,
  };
  const host: PackageHost = {
    captured,
    registerTool(tool) {
      // Stamp the session ctx onto each captured tool: the composed handler
      // forwards it as the 5th (ctx) argument of pi's execute() signature.
      (tool as unknown as { __lensCtx?: unknown }).__lensCtx = ctx;
      captured.push(tool as unknown as PackageTool);
    },
    registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
    registerProvider() {}, registerModel() {},
    on() {},
    events: { on() {}, emit() {} },
    sendMessage() {}, appendEntry() {}, exec: async () => '',
    getActiveTools: () => captured.map((t) => t.name),
    ui,
  };
  // Keep the ctx reachable for tool-time lookups by non-captured consumers.
  (host as unknown as { __contextOf: unknown }).__contextOf = ctx;
  return host;
}