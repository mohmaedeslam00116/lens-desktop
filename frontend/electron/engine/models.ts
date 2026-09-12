import { LLMProvider, ModelOption } from './types';

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

export class ModelClient {
  /**
   * Fetches models dynamically from the provider's live API using the provided API key.
   * If no API key is provided (for cloud providers), returns an empty array.
   */
  static async fetchDynamicModels(
    provider: string,
    apiKey?: string,
    endpoint?: string
  ): Promise<ModelOption[]> {
    const normalizedProvider = provider.toLowerCase().trim();

    // 1. Ollama (local)
    if (normalizedProvider === 'ollama') {
      try {
        const url = `${(endpoint || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return [];
        const data = await res.json() as any;
        return (data.models || []).map((m: any) => ({
          id: m.name,
          name: m.name,
          context: m.size ? `${(m.size / (1024 * 1024 * 1024)).toFixed(1)} GB` : 'Local',
          tags: ['Local', 'Private', 'Ollama'],
          recommended: m.name.includes('llama3') || m.name.includes('deepseek')
        }));
      } catch {
        return [];
      }
    }

    // 2. Strict requirement: If no API key provided, return empty array!
    if (!apiKey || !apiKey.trim()) {
      return [];
    }

    const key = apiKey.trim();

    // 3. Google Gemini
    if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return [];
        const data = await res.json() as any;
        const models: ModelOption[] = [];
        for (const m of (data.models || [])) {
          if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
            continue;
          }
          const id = m.name.replace(/^models\//, '');
          if (id.includes('embedding') || id.includes('aqa')) continue;

          const context = m.inputTokenLimit 
            ? `${m.inputTokenLimit >= 1000000 ? `${(m.inputTokenLimit / 1000000).toFixed(0)}M` : `${(m.inputTokenLimit / 1000).toFixed(0)}k`} tokens` 
            : undefined;

          const tags: string[] = [];
          if (id.includes('flash')) tags.push('Speed');
          if (id.includes('pro')) tags.push('Deep Reasoning');
          if (id.includes('thinking')) tags.push('Chain-of-Thought');
          if (id.includes('exp')) tags.push('Experimental');

          models.push({
            id,
            name: m.displayName || id,
            context,
            tags: tags.length > 0 ? tags : ['Multimodal'],
            recommended: id === 'gemini-2.0-flash' || id === 'gemini-1.5-pro'
          });
        }
        return models.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      } catch (err) {
        console.warn('Failed to fetch Gemini models dynamically:', err);
        return [];
      }
    }

    // 4. OpenAI
    if (normalizedProvider === 'openai') {
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        const models: ModelOption[] = [];
        for (const m of (data.data || [])) {
          const id = m.id;
          if (!id.startsWith('gpt-') && !id.startsWith('o1') && !id.startsWith('o3') && !id.startsWith('chatgpt-')) {
            continue;
          }
          if (id.includes('audio') || id.includes('realtime') || id.includes('transcribe') || id.includes('embedding')) continue;

          const tags: string[] = [];
          if (id.includes('mini')) tags.push('Fast');
          if (id.startsWith('o1') || id.startsWith('o3')) tags.push('Reasoning');
          if (id.includes('4o')) tags.push('Multimodal');

          models.push({
            id,
            name: id,
            context: id.includes('o1') ? '200k tokens' : '128k tokens',
            tags: tags.length > 0 ? tags : ['General'],
            recommended: id === 'gpt-4o' || id === 'gpt-4o-mini' || id === 'o3-mini'
          });
        }
        return models.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      } catch (err) {
        console.warn('Failed to fetch OpenAI models dynamically:', err);
        return [];
      }
    }

    // 5. Groq
    if (normalizedProvider === 'groq') {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        const models: ModelOption[] = [];
        for (const m of (data.data || [])) {
          const id = m.id;
          if (id.includes('whisper')) continue;
          models.push({
            id,
            name: id,
            context: m.context_window ? `${(m.context_window / 1000).toFixed(0)}k tokens` : '128k tokens',
            tags: ['Groq LPU', '300+ t/s'],
            recommended: id.includes('llama-3.3-70b') || id.includes('deepseek-r1')
          });
        }
        return models.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      } catch (err) {
        console.warn('Failed to fetch Groq models dynamically:', err);
        return [];
      }
    }

    // 6. DeepSeek
    if (normalizedProvider === 'deepseek') {
      try {
        const res = await fetch('https://api.deepseek.com/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data.data) && data.data.length > 0) {
            return data.data.map((m: any) => ({
              id: m.id,
              name: m.id === 'deepseek-chat' ? 'DeepSeek-V3 (deepseek-chat)' : m.id === 'deepseek-reasoner' ? 'DeepSeek-R1 (deepseek-reasoner)' : m.id,
              context: '64k tokens',
              tags: m.id.includes('reasoner') ? ['Chain-of-Thought', 'Deep Logic'] : ['High Intelligence', 'Low Cost'],
              recommended: true
            }));
          }
        }
      } catch {
        // Fallback
      }
      return [
        { id: 'deepseek-chat', name: 'DeepSeek-V3 (deepseek-chat)', context: '64k tokens', tags: ['High Intelligence', 'Low Cost'], recommended: true },
        { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (deepseek-reasoner)', context: '64k tokens', tags: ['Chain-of-Thought', 'Deep Logic'], recommended: false }
      ];
    }

    // 7. OpenRouter
    if (normalizedProvider === 'openrouter') {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        return (data.data || []).slice(0, 100).map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          context: m.context_length ? `${(m.context_length / 1000).toFixed(0)}k tokens` : undefined,
          tags: [m.id.split('/')[0] || 'OpenRouter'],
          recommended: m.id.includes('llama-3.3-70b') || m.id.includes('deepseek-r1') || m.id.includes('claude-3.7')
        })).sort((a: any, b: any) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      } catch {
        return [];
      }
    }

    // 8. Mistral
    if (normalizedProvider === 'mistral') {
      try {
        const res = await fetch('https://api.mistral.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const data = await res.json() as any;
        return (data.data || []).filter((m: any) => !m.id.includes('embed')).map((m: any) => ({
          id: m.id,
          name: m.id,
          context: m.max_context_length ? `${(m.max_context_length / 1000).toFixed(0)}k tokens` : '128k tokens',
          tags: ['Mistral AI'],
          recommended: m.id.includes('large')
        })).sort((a: any, b: any) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      } catch {
        return [];
      }
    }

    // 9. Anthropic
    if (normalizedProvider === 'anthropic') {
      try {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data.data) && data.data.length > 0) {
            return data.data.map((m: any) => ({
              id: m.id,
              name: m.display_name || m.id,
              context: '200k tokens',
              tags: ['Anthropic', 'Analytical'],
              recommended: m.id.includes('sonnet')
            }));
          }
        }
      } catch {
        // Fallback for valid Anthropic key
      }
      return [
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)', context: '200,000 tokens', tags: ['Hybrid Reasoning', 'Synthesis'], recommended: true },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', context: '200,000 tokens', tags: ['Analytical', 'Top Tier'], recommended: false },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', context: '200,000 tokens', tags: ['Ultra Fast', 'Lightweight'], recommended: false },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', context: '200,000 tokens', tags: ['Deep Nuance'], recommended: false },
      ];
    }

    return [];
  }

  static async testConnection(
    provider: string,
    apiKey?: string,
    endpoint?: string,
    modelName?: string
  ): Promise<{ success: boolean; latency_ms: number; message?: string; error?: string }> {
    const startTime = Date.now();
    const norm = provider.toLowerCase().trim();

    try {
      if (norm === 'ollama') {
        const url = `${(endpoint || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Ollama server returned HTTP ${res.status}`);
        const data = await res.json() as any;
        const count = data.models?.length || 0;
        return {
          success: true,
          latency_ms: Date.now() - startTime,
          message: `Connected successfully to local Ollama server (${count} models detected).`
        };
      }

      if (!apiKey && norm !== 'ollama') {
        return {
          success: false,
          latency_ms: 0,
          error: `API key is required for ${provider}. Please enter a valid key in settings.`
        };
      }

      // Quick ping query to verify API key — routed through the AgentCore
      // gateway so the legacy hand-rolled client stays retired (ticket #73).
      const { generate } = await import('./modelGateway');
      const response = await generate({
        provider: norm as LLMProvider,
        model: modelName || (norm === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini'),
        apiKey,
        endpoint,
        messages: [{ role: 'user', content: 'Say OK' }],
        temperature: 0.1
      });

      if (!response) throw new Error('Received empty response from provider.');

      return {
        success: true,
        latency_ms: Date.now() - startTime,
        message: `Successfully validated ${provider} API key.`
      };
    } catch (err: any) {
      return {
        success: false,
        latency_ms: Date.now() - startTime,
        error: err.message || `Failed to connect to ${provider}.`
      };
    }
  }

}