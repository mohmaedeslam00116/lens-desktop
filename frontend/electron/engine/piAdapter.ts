import { ChatMessage, LLMRequestOptions, LLMToolDefinition, MAX_TOOL_RECURSION_DEPTH } from './models';
import { LLMProvider } from './types';

/**
 * Pi-backed implementation of the ModelClient request contract (`LLMRequestOptions`).
 *
 * Dormant behind the seam (ADR-0009, spec #66, ticket #68): nothing calls this yet —
 * agents still use `ModelClient` until the loops migrate in later tickets. The adapter:
 *  - registers a pi-ai provider per LENS provider id (native factories for the cloud
 *    providers; a custom OpenAI-compatible provider for Ollama),
 *  - streams token deltas through `onChunk`,
 *  - dispatches tool calls through `toolHandler` inside a depth-capped loop,
 *  - honors the `signal` abort at loop/stream boundaries.
 *
 * pi-ai is ESM-only while the engine compiles to CommonJS, so all pi imports are
 * dynamic `import()` calls (supported from Node 20+, and the upgraded runtime is
 * Electron 38 / Node 22.22).
 */

type PiModel = {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  cost: { input: number; output: number };
  contextWindow: number;
  maxTokens: number;
};

export interface PiAdapterOptions {
  /** Request-level signal honored at loop and stream boundaries. */
  signal?: AbortSignal;
  /**
   * Test seam: replace the per-provider builder. Receives the normalized LENS
   * provider id and returns a pi-ai Provider (e.g. the `fauxProvider()` handle
   * in tests). When absent, the default registry is used.
   */
  overrideFactory?: (providerId: string) => Promise<unknown>;
}

export const DEFAULT_PI_MODELS = {
  contextWindow: 128000,
  maxTokens: 8192,
};

const NATIVE_FACTORIES: Record<string, { module: string; factory: string }> = {
  gemini: { module: 'google', factory: 'googleProvider' },
  google: { module: 'google', factory: 'googleProvider' },
  openai: { module: 'openai', factory: 'openaiProvider' },
  anthropic: { module: 'anthropic', factory: 'anthropicProvider' },
  groq: { module: 'groq', factory: 'groqProvider' },
  deepseek: { module: 'deepseek', factory: 'deepseekProvider' },
  openrouter: { module: 'openrouter', factory: 'openrouterProvider' },
  mistral: { module: 'mistral', factory: 'mistralProvider' },
};

export const PI_PROVIDER_IDS: Record<string, string> = {
  gemini: 'google',
  google: 'google',
  openai: 'openai',
  anthropic: 'anthropic',
  groq: 'groq',
  deepseek: 'deepseek',
  openrouter: 'openrouter',
  mistral: 'mistral',
  ollama: 'ollama',
};

function normalizeProvider(provider: string): string {
  return (provider || '').toLowerCase().trim();
}

async function importPiAi(): Promise<any> {
  return await import('../piShim.mjs');
}

function apiModuleOf(shim: any): any {
  return {
    stream: shim.openAiCompletionsStream,
    streamSimple: shim.openAiCompletionsStreamSimple,
  };
}

function buildModel(modelId: string, providerId: string, api: string, baseUrl = ''): PiModel {
  return {
    id: modelId,
    name: modelId,
    api,
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: DEFAULT_PI_MODELS.contextWindow,
    maxTokens: DEFAULT_PI_MODELS.maxTokens,
  } as PiModel;
}

/** Custom OpenAI-compatible provider for Ollama and other local endpoints. */
export async function createOpenAiCompatibleProvider(
  providerId: string,
  endpoint?: string,
  apiKey?: string
): Promise<any> {
  const ai = await importPiAi();
  const base = (endpoint || (providerId === 'ollama' ? 'http://localhost:11434' : '') || '')
    .trim()
    .replace(/\/+$/, '');
  const baseUrl = base ? `${base}/v1` : '';
  return ai.createProvider({
    id: providerId,
    name: providerId === 'ollama' ? 'Ollama' : providerId,
    baseUrl,
    auth: apiKey ? { type: 'api_key', key: apiKey } : { type: 'api_key' },
    models: [],
    api: { 'openai-completions': apiModuleOf(ai) },
  });
}

async function buildProvider(
  providerId: string,
  opts: { apiKey?: string; endpoint?: string; overrideFactory?: PiAdapterOptions['overrideFactory'] }
): Promise<any> {
  if (opts.overrideFactory) {
    return await opts.overrideFactory(providerId);
  }
  const spec = NATIVE_FACTORIES[providerId];
  if (spec) {
    const shim = await importPiAi();
    const factory = shim[spec.factory];
    if (typeof factory !== 'function') {
      throw new Error(`[PiAdapter] pi shim exports no provider factory '${spec.factory}' for provider '${providerId}'`);
    }
    return factory();
  }
  if (providerId === 'ollama') {
    return await createOpenAiCompatibleProvider('ollama', opts.endpoint, opts.apiKey);
  }
  throw new Error(`[PiAdapter] Unsupported provider for pi-ai: '${providerId}'`);
}

function resolveModel(provider: any, requestedModel?: string): any {
  const list: Array<any> = typeof provider?.getModels === 'function' ? provider.getModels() || [] : [];
  if (requestedModel) {
    const found = list.find((m: any) => m.id === requestedModel);
    if (found) return found;
  } else if (list.length > 0) {
    return list[0];
  }
  const api = list[0]?.api || (provider?.id === 'ollama' ? 'openai-completions' : 'unknown');
  return buildModel(requestedModel || 'default', provider?.id || 'unknown', api, provider?.baseUrl || '');
}

function toPiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content, timestamp: Date.now() });
    } else {
      out.push({ role: 'user', content: m.content, timestamp: Date.now() });
    }
  }
  return out;
}

function toPiTools(tools: LLMToolDefinition[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

function textOf(message: any): string {
  const parts: string[] = [];
  for (const block of message?.content || []) {
    if (block?.type === 'text') parts.push(block.text || '');
  }
  return parts.join('');
}

function toolCallsOf(message: any): Array<{ id: string; name: string; arguments: Record<string, any> }> {
  const calls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];
  for (const block of message?.content || []) {
    if (block?.type === 'toolCall') {
      calls.push({ id: block.id || `${block.name}-${Date.now()}`, name: block.name, arguments: block.arguments || {} });
    }
  }
  return calls;
}

/** Maps a tool-handler result to the text returned to the model (success → result, failure → error). */
export function piToolResultText(result: { success: boolean; result?: any; error?: any }): string {
  const value = result.success ? result.result : result.error;
  if (value === undefined || value === null || value === '') {
    return result.success ? 'ok' : 'error';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function readStream(
  stream: any,
  onChunk?: (chunk: string) => void
): Promise<any> {
  let lastMessage: any = undefined;
  for await (const event of stream) {
    if (event?.type === 'text_delta' && typeof event.delta === 'string') {
      onChunk?.(event.delta);
    }
    if (event?.type === 'done') {
      lastMessage = event.message;
      break;
    }
    if (event?.type === 'error') {
      const detail = event.reason === 'aborted' ? 'aborted' : event.error?.errorMessage || 'pi-ai stream error';
      throw new Error(`[PiAdapter] stream ${event.reason}: ${detail}`);
    }
    if (event?.type === 'text_end' || event?.type === 'toolcall_end') {
      lastMessage = event.partial || lastMessage;
    }
  }
  return lastMessage;
}

export interface PiGenerateResult {
  text: string;
  toolCallCount: number;
  providerRequests: number;
}

/** Drive pi-ai `streamSimple` with a depth-capped tool loop, honoring `signal` at each boundary. */
export async function generateWithPi(
  options: LLMRequestOptions,
  adapterOptions?: PiAdapterOptions
): Promise<PiGenerateResult> {
  const signal = adapterOptions?.signal;
  const providerId = PI_PROVIDER_IDS[normalizeProvider(options.provider)] || normalizeProvider(options.provider);
  const modelName = options.model;
  const apiKey = options.apiKey;
  const endpoint = options.endpoint;

  const ai = await importPiAi();
  const models = ai.createModels();

  const provider = await buildProvider(providerId, {
    apiKey,
    endpoint,
    overrideFactory: adapterOptions?.overrideFactory,
  });
  models.setProvider(provider);

  const model = resolveModel(provider, modelName);
  if (signal?.aborted) {
    throw new Error('[PiAdapter] aborted before the first model request');
  }

  const context: Record<string, unknown> = {
    systemPrompt: options.messages.find((m) => m.role === 'system')?.content,
    messages: toPiMessages(options.messages),
  };
  const tools = toPiTools(options.tools || []);
  if (tools) context.tools = tools;

  let text = '';
  let depth = 0;
  let providerRequests = 0;
  let toolCallCount = 0;

  while (true) {
    if (signal?.aborted) {
      throw new Error('[PiAdapter] aborted mid-loop');
    }
    providerRequests++;
    const stream = models.streamSimple(model, context, {
      temperature: options.temperature ?? 0.3,
      ...(apiKey ? { apiKey } : {}),
      ...(signal ? { signal } : {}),
    });
    const message = await readStream(stream, options.onChunk);
    text += textOf(message);

    const calls = toolCallsOf(message);
    if (calls.length === 0 || !options.toolHandler) break;
    if (depth >= MAX_TOOL_RECURSION_DEPTH) {
      console.warn(`[PiAdapter] Max tool recursion depth (${MAX_TOOL_RECURSION_DEPTH}) reached; terminating tool loop.`);
      break;
    }
    depth++;
    toolCallCount += calls.length;
    context.messages = context.messages || [];
    (context.messages as Array<Record<string, unknown>>).push({
      role: 'assistant',
      content: message?.content || [{ type: 'text', text: textOf(message) }],
      timestamp: Date.now(),
    });
    for (const call of calls) {
      const result = await options.toolHandler({ name: call.name, arguments: call.arguments });
      (context.messages as Array<Record<string, unknown>>).push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: piToolResultText(result) }],
        isError: !result.success,
        timestamp: Date.now(),
      });
    }
  }

  return { text, toolCallCount, providerRequests };
}

/** The DORMANT adapter entry point: same shape as `ModelClient.generate`, implemented on pi-ai. */
export const PiAdapter = {
  async generate(options: LLMRequestOptions, adapterOptions?: PiAdapterOptions): Promise<string> {
    const outcome = await generateWithPi(options, adapterOptions);
    return outcome.text;
  },
};