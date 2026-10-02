import { LLMProvider } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export type ToolCallHandler = (call: {
  name: string;
  arguments: Record<string, any>;
}) => Promise<{
  success: boolean;
  result?: any;
  error?: string;
}>;

export interface LLMRequestOptions {
  provider: LLMProvider;
  model?: string;
  messages: ChatMessage[];
  /** Test-only override (faux providers); production resolves Pi stored auth. */
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  tools?: LLMToolDefinition[];
  toolHandler?: ToolCallHandler;
  onChunk?: (chunk: string) => void;
}

export interface ParsedSseToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ParsedProviderSseEvents {
  text: string;
  toolCalls: ParsedSseToolCall[];
}

/**
 * RETIRED (ticket #73): the hand-rolled per-provider SSE/tool-call parser.
 * Kept as a documented stub so legacy call-sites fail loudly instead of
 * silently. All generation now flows through the pi core via `modelGateway`.
 */
export function parseProviderSseEvents(provider: string, payload: string): ParsedProviderSseEvents {
  void provider;
  void payload;
  throw new Error('[models] parseProviderSseEvents retired: provider parsing now lives in the pi core (see modelGateway).');
}

export const MAX_TOOL_RECURSION_DEPTH = 5;

/**
 * RETIRED (tracer P2): the native per-provider catalog fetcher and connection
 * tester are deleted — chat providers, models, and auth resolve through the
 * Pi runtime (`piCatalog`/`piAuth`). The class survives as a namespace for
 * shared constants only; generation flows through `modelGateway` (pi core).
 */
export class ModelClient {}
