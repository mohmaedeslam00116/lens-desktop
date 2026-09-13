import { LLMToolDefinition, ToolCallHandler } from './models';
import { PackageTool, PackageToolOptions, loadPureTodoTool, loadVendoredPackageTools, toEngineTool, wrapPackageToolHandler } from './piPackages';

export interface ResearchPackageTools {
  /** Extra LLM tool definitions (web_search, source_check, fetch_content,
   *  get_search_content, todo) registered by the vendored packages. */
  tools: LLMToolDefinition[];
  /** Composed handler that dispatches package tool calls. */
  handler: ToolCallHandler;
}

/**
 * Per-session tool cache. Tools are session-bound — the package host stamps
 * `ctx.sessionId`/`ctx.cwd` onto each captured tool and the pure todo tool
 * closes over the session-scoped store — so a process-wide cache would leak
 * one session's state into another. Keyed by sessionId; evict on teardown.
 */
const cachedPackageTools = new Map<string, PackageTool[]>();

/**
 * Loads (per session) the vendored pi ecosystem tools and adapts them to
 * the engine tool contract.
 *
 *  - pi-web-access: 4 tools  (web_search, source_check, fetch_content,
 *    get_search_content) — full provider + extraction surface in-process.
 *  - rpiv-todo:      1 tool  (todo) — session-scoped task list with the
 *    snapshot-in-`details` persistence envelope.
 *  - pi-subagents: deferred (needs a pi-coding-agent host; sources vendored).
 */
export async function buildResearchPackageTools(
  options: PackageToolOptions & { refresh?: boolean },
  signal?: AbortSignal
): Promise<ResearchPackageTools> {
  const cached = cachedPackageTools.get(options.sessionId);
  if (cached && !options.refresh) {
    return {
      tools: cached.map(toEngineTool),
      handler: wrapPackageToolHandler(cached, undefined, { signal, timeoutMs: options.timeoutMs }),
    };
  }

  const loaded: PackageTool[] = [];
  const web = await loadVendoredPackageTools('web-access/index.ts', options, (ext, host) => {
    (ext as (h: unknown) => void)(host);
  });
  loaded.push(...web);

  // rpiv-todo via its PURE interface only: `todo.ts`/`index.ts` pull
  // `state/i18n-bridge.ts` whose top-level await jiti cannot transpile.
  const todo = await loadPureTodoTool(options);
  if (todo) loaded.push(todo);
  else console.warn('[piResearchTools] rpiv-todo unavailable — proceeding without the todo tool.');

  cachedPackageTools.set(options.sessionId, loaded);
  return {
    tools: loaded.map(toEngineTool),
    handler: wrapPackageToolHandler(loaded, undefined, { signal, timeoutMs: options.timeoutMs }),
  };
}

/** Convenience for tests: clear every session's cached tools. */
export function resetPackageToolCache(): void {
  cachedPackageTools.clear();
}

/** Evicts one session's cached tools — call on session teardown to keep the
 * per-session map memory-bounded. */
export function evictPackageToolCache(sessionId: string): void {
  cachedPackageTools.delete(sessionId);
}

export { wrapPackageToolHandler } from './piPackages';