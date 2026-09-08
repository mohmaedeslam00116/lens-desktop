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
 * Parses a complete Server-Sent Events payload from a supported provider.
 * Keeping the parser independent of transport makes provider qualification
 * deterministic and lets callers consume streamed text and tool calls safely.
 */
export function parseProviderSseEvents(provider: string, payload: string): ParsedProviderSseEvents {
  const events: Array<{ event: string; data: string }> = [];
  let eventName = 'message';
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join('\n') });
    }
    eventName = 'message';
    dataLines = [];
  };

  for (const line of payload.replace(/\r\n/g, '\n').split('\n')) {
    if (!line) {
      flush();
    } else if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  flush();

  const text: string[] = [];
  const toolCalls: ParsedSseToolCall[] = [];
  const normalizedProvider = provider.toLowerCase().trim();

  for (const event of events) {
    if (event.data === '[DONE]') continue;

    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      continue;
    }

    if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
      for (const part of data.candidates?.[0]?.content?.parts || []) {
        if (part.text) text.push(part.text);
        if (part.functionCall?.name) {
          toolCalls.push({ name: part.functionCall.name, arguments: part.functionCall.args || {} });
        }
      }
      continue;
    }

    if (normalizedProvider === 'anthropic') {
      const block = data.content_block;
      if (block?.type === 'tool_use' && block.name) {
        toolCalls.push({ name: block.name, arguments: block.input || {} });
      }
      if (data.delta?.type === 'text_delta' && data.delta.text) {
        text.push(data.delta.text);
      }
      continue;
    }

    if (normalizedProvider === 'ollama') {
      const message = data.message || data;
      if (message.content || data.response) text.push(message.content || data.response);
      for (const call of message.tool_calls || []) {
        if (call.function?.name) {
          toolCalls.push({ name: call.function.name, arguments: call.function.arguments || {} });
        }
      }
      continue;
    }

    const delta = data.choices?.[0]?.delta || data.choices?.[0]?.message;
    if (delta?.content) text.push(delta.content);
    for (const call of delta?.tool_calls || []) {
      if (!call.function?.name) continue;
      let argumentsObject: Record<string, any> = {};
      try {
        argumentsObject = typeof call.function.arguments === 'string'
          ? JSON.parse(call.function.arguments)
          : call.function.arguments || {};
      } catch {
        continue;
      }
      toolCalls.push({ name: call.function.name, arguments: argumentsObject });
    }
  }

  return { text: text.join(''), toolCalls };
}

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

      // Quick ping query to verify API key
      const response = await this.generate({
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

  static formatProviderTools(provider: string, tools: LLMToolDefinition[]): any {
    const normalizedProvider = provider.toLowerCase().trim();
    if (!tools || tools.length === 0) return undefined;

    if (normalizedProvider === 'gemini' || normalizedProvider === 'google') {
      return [
        {
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ];
    }

    if (normalizedProvider === 'anthropic') {
      return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }

    // OpenAI and compatible (Groq, DeepSeek, OpenRouter, Mistral)
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  static async generate(options: LLMRequestOptions): Promise<string> {
    const provider = options.provider.toLowerCase().trim();

    if (provider === 'gemini' || provider === 'google') {
      return await this.generateGemini(options);
    } else if (provider === 'anthropic') {
      return await this.generateAnthropic(options);
    } else {
      return await this.generateOpenAICompatible(options);
    }
  }

  private static async generateGemini(options: LLMRequestOptions): Promise<string> {
    const model = options.model || 'gemini-2.0-flash';
    const key = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('Google Gemini API key is missing. Please add it in settings.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const systemMsg = options.messages.find(m => m.role === 'system')?.content;
    const contents = options.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const body: any = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.3
      }
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatProviderTools('gemini', options.tools);
    }

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg }]
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (HTTP ${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const funcCallPart = parts.find((p: any) => p.functionCall);

    if (funcCallPart && options.toolHandler) {
      const toolCallResult = await options.toolHandler({
        name: funcCallPart.functionCall.name,
        arguments: funcCallPart.functionCall.args || {}
      });

      const nextMessages: ChatMessage[] = [
        ...options.messages,
        {
          role: 'assistant',
          content: `Activated skill: ${funcCallPart.functionCall.args?.name || ''}`
        },
        {
          role: 'user',
          content: `Tool response for ${funcCallPart.functionCall.name}: ${JSON.stringify(toolCallResult)}`
        }
      ];

      return await this.generateGemini({
        ...options,
        messages: nextMessages
      });
    }

    const text = parts.map((p: any) => p.text || '').join('');

    if (options.onChunk && text) {
      options.onChunk(text);
    }

    return text;
  }

  private static async generateAnthropic(options: LLMRequestOptions): Promise<string> {
    const model = options.model || 'claude-3-7-sonnet-20250219';
    const key = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Anthropic API key is missing. Please add it in settings.');

    const systemMsg = options.messages.find(m => m.role === 'system')?.content;
    const messages = options.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const payload: any = {
      model,
      messages,
      system: systemMsg,
      max_tokens: 4096,
      temperature: options.temperature ?? 0.3
    };

    if (options.tools && options.tools.length > 0) {
      payload.tools = this.formatProviderTools('anthropic', options.tools);
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (HTTP ${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const toolUseBlock = data.content?.find((c: any) => c.type === 'tool_use');
    if (toolUseBlock && options.toolHandler) {
      const toolResult = await options.toolHandler({
        name: toolUseBlock.name,
        arguments: toolUseBlock.input || {}
      });

      const nextMessages: ChatMessage[] = [
        ...options.messages,
        {
          role: 'assistant',
          content: `Activated skill: ${toolUseBlock.input?.name || ''}`
        },
        {
          role: 'user',
          content: `Tool response for ${toolUseBlock.name}: ${JSON.stringify(toolResult)}`
        }
      ];

      return await this.generateAnthropic({
        ...options,
        messages: nextMessages
      });
    }

    const text = data.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') || '';
    if (options.onChunk && text) options.onChunk(text);
    return text;
  }

  private static async generateOpenAICompatible(options: LLMRequestOptions): Promise<string> {
    const provider = options.provider.toLowerCase().trim();

    let baseUrl = 'https://api.openai.com/v1';
    let apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    let defaultModel = 'gpt-4o';

    if (provider === 'groq') {
      baseUrl = 'https://api.groq.com/openai/v1';
      apiKey = options.apiKey || process.env.GROQ_API_KEY || '';
      defaultModel = 'llama-3.3-70b-versatile';
    } else if (provider === 'deepseek') {
      baseUrl = 'https://api.deepseek.com/v1';
      apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || '';
      defaultModel = 'deepseek-chat';
    } else if (provider === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api/v1';
      apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || '';
      defaultModel = 'meta-llama/llama-3.3-70b-instruct';
    } else if (provider === 'mistral') {
      baseUrl = 'https://api.mistral.ai/v1';
      apiKey = options.apiKey || process.env.MISTRAL_API_KEY || '';
      defaultModel = 'mistral-large-latest';
    } else if (provider === 'ollama') {
      baseUrl = `${(options.endpoint || 'http://localhost:11434').replace(/\/$/, '')}/v1`;
      apiKey = 'ollama';
      defaultModel = 'llama3.1:8b';
    }

    if (!apiKey && provider !== 'ollama') {
      throw new Error(`API key for ${provider} is missing. Please configure it in settings.`);
    }

    const model = options.model || defaultModel;

    const payload: any = {
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3
    };

    // Tool registration for tool-capable providers (excluding Ollama which runs pre-activated)
    if (options.tools && options.tools.length > 0 && provider !== 'ollama') {
      payload.tools = this.formatProviderTools(provider, options.tools);
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} API error (HTTP ${res.status}): ${errText}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0 && options.toolHandler) {
      const firstCall = toolCalls[0];
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = JSON.parse(firstCall.function?.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      const toolResult = await options.toolHandler({
        name: firstCall.function?.name,
        arguments: parsedArgs
      });

      const nextMessages: ChatMessage[] = [
        ...options.messages,
        {
          role: 'assistant',
          content: `Activated skill: ${parsedArgs?.name || ''}`
        },
        {
          role: 'user',
          content: `Tool response for ${firstCall.function?.name}: ${JSON.stringify(toolResult)}`
        }
      ];

      return await this.generateOpenAICompatible({
        ...options,
        messages: nextMessages
      });
    }

    const text = choice?.message?.content || '';
    if (options.onChunk && text) options.onChunk(text);
    return text;
  }
}
