import { LiveEvent } from './types';
import { LLMRequestOptions, LLMToolDefinition, ToolCallHandler } from './models';
import { SkillActivationManager } from './skills';

/**
 * The single tool-registration point for the Skills subsystem under the pi
 * agent core (ADR-0009, spec #66, ticket #04).
 *
 * Contract: the Skills subsystem reaches pi's tool-calling loop through exactly
 * ONE tool — `activate_skill` — produced from the SkillActivationManager's own
 * tool definition. Nothing else registers tools, so a future agent
 * self-extension can only ever land through this bridge and flow through the
 * sandboxed Skills pipeline (extensibility reserve, spec #66).
 */

/** Structural shape the bridge needs — satisfied by SkillActivationManager. */
export interface PiSkillsManagerLike {
  getToolDefinition(): LLMToolDefinition;
  handleActivateSkillToolCall(
    args: { name: string },
    emitEvent?: (event: LiveEvent) => void,
    options?: { language?: string }
  ): Promise<{
    success: boolean;
    name?: string;
    instructions?: string;
    error?: string;
    message?: string;
    [key: string]: unknown;
  }>;
}

export interface PiSkillsBridgeOptions {
  manager: PiSkillsManagerLike;
  emit?: (event: LiveEvent) => void;
  language?: string;
}

export interface PiSkillTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';

/**
 * Builds the single pi tool for the Skills subsystem from the manager's own
 * tool definition. Throws if the manager tries to register anything other
 * than `activate_skill` — the bridge is the only registration point.
 */
export function buildPiSkillTool(options: PiSkillsBridgeOptions): PiSkillTool {
  const definition: LLMToolDefinition = options.manager.getToolDefinition();
  if (definition.name !== ACTIVATE_SKILL_TOOL_NAME) {
    throw new Error(
      `[PiSkillsBridge] The Skills subsystem must register exactly one tool named '${ACTIVATE_SKILL_TOOL_NAME}'; got '${definition.name}'.`
    );
  }
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  };
}

/**
 * Creates the tool handler that dispatches `activate_skill` invocations to
 * the SkillActivationManager, forwarding the LiveEvent emitter and language.
 */
export function createPiSkillHandler(options: PiSkillsBridgeOptions): ToolCallHandler {
  return async (call) => {
    if (call.name !== ACTIVATE_SKILL_TOOL_NAME) {
      return { success: false, error: `Unsupported tool: ${call.name}` };
    }
    return await options.manager.handleActivateSkillToolCall(
      call.arguments as { name: string },
      options.emit,
      { language: options.language }
    );
  };
}

/** Convenience pair for wiring the Skills subsystem into a pi-backed loop. */
export function wireSkillsBridge(options: PiSkillsBridgeOptions): {
  tool: PiSkillTool;
  handler: ToolCallHandler;
} {
  return {
    tool: buildPiSkillTool(options),
    handler: createPiSkillHandler(options),
  };
}

/**
 * End-to-end helper: runs a pi-backed model request with the Skills bridge
 * attached (single `activate_skill` tool + dispatching handler). Used by the
 * research loops when they migrate onto the pi core (tickets 05/06).
 */
export async function generateWithSkills(
  request: LLMRequestOptions,
  bridge: PiSkillsBridgeOptions,
  adapterOptions?: { signal?: AbortSignal; overrideFactory?: (providerId: string) => Promise<unknown> }
): Promise<string> {
  const { PiAdapter } = await import('./piAdapter');
  const { tool, handler } = wireSkillsBridge(bridge);
  const tools = [...(request.tools || []), { name: tool.name, description: tool.description, parameters: tool.parameters } as LLMToolDefinition];
  return await PiAdapter.generate(
    { ...request, tools, toolHandler: handler },
    adapterOptions
  );
}