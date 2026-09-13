import { LLMToolDefinition, ToolCallHandler } from './models';
import { PackageTool, PackageToolOptions, loadPureTodoTool, loadVendoredPackageTools, toEngineTool, wrapPackageToolHandler } from './piPackages';

export interface ResearchPackageTools {
  /** Extra LLM tool definitions (web_search, source_check, fetch_content,
   *  get_search_content, todo) registered by the vendored packages. */
  tools: LLMToolDefinition[];
  /** Composed handler that dispatches package tool calls. */
  handler: ToolCallHandler;
}

let cachedPackageTools: PackageTool[] | undefined;

/**
 * Loads (once per process) the vendored pi ecosystem tools and adapts them to
 * the engine tool contract.
 *
 *  - pi-web-access: 4 tools  (web_search, source_check, fetch_content,
 *    get_search_content) — full provider + extraction surface in-process.
 *  - rpiv-todo:      1 tool  (todo) — session-scoped task list with the
 *    snapshot-in-`details` persistence envelope.
 *  - pi-subagents: deferred (needs a pi-coding-agent host; sources vendored).
 */
export async function buildResearchPackageTools(
  options: PackageToolOptions & { refresh?: boolean }
): Promise<ResearchPackageTools> {
  if (cachedPackageTools && !options.refresh) {
    return { tools: cachedPackageTools.map(toEngineTool), handler: wrapPackageToolHandler(cachedPackageTools) };
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

  cachedPackageTools = loaded;
  return { tools: loaded.map(toEngineTool), handler: wrapPackageToolHandler(loaded) };
}

/** Convenience for tests: clear the process-wide cache. */
export function resetPackageToolCache(): void {
  cachedPackageTools = undefined;
}

export { wrapPackageToolHandler } from './piPackages';