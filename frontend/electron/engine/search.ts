import { SearchResultItem } from './types';

async function readBoundedJson<T = any>(res: Response, maxBytes = 2 * 1024 * 1024): Promise<T> {
  const contentLengthStr = res.headers.get('content-length');
  if (contentLengthStr && parseInt(contentLengthStr, 10) > maxBytes) {
    try { await res.body?.cancel(); } catch {}
    throw new Error(`Response body exceeds maximum size limit of ${maxBytes} bytes`);
  }

  if (res.body && typeof (res.body as any).getReader === 'function') {
    const reader = (res.body as any).getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error(`Response stream exceeded maximum size limit of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8').decode(merged);
    return JSON.parse(text);
  }

  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`Response text exceeds maximum size limit of ${maxBytes} bytes`);
  }
  return JSON.parse(text);
}

export class MultiSearchProvider {
  /**
   * Native keyed-provider search path (ADR-0013 contract state, ticket #110).
   *
   * The native DuckDuckGo HTML implementation retired at the ADR-0013
   * contract step: the vendored pi-web-access plane (searchPlane.ts) is the
   * only keyless search path, with native fallback routed through this
   * canonical seam entry. Remaining here: the keyed providers (Tavily /
   * Serper), which stay until the config seam (#112) provisions them through
   * pi-web-access's `web-search.json` — then they retire too.
   *
 * Keyed provider fails or is unkeyed → the keyless primary plane serves
 * the query (graceful degradation, native semantic). The plane's own
 * failure fallback never re-enters `search()`, so no plane↔native cycle
 * exists.
   */
  static async search(
    query: string,
    provider: 'duckduckgo' | 'tavily' | 'serper' | 'google' = 'duckduckgo',
    apiKeys?: Record<string, string>,
    maxResults = 8,
    signal?: AbortSignal
  ): Promise<SearchResultItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    if (signal?.aborted) return [];

    const keys = apiKeys || {};

    if (provider === 'tavily' && keys.tavily) {
      try {
        const results = await this.searchTavily(cleanQuery, keys.tavily, maxResults, signal);
        if (results.length > 0) return results;
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[MultiSearch] Tavily failed, falling back to the primary plane:', err);
      }
    } else if ((provider === 'serper' || provider === 'google') && keys.serper) {
      try {
        const results = await this.searchSerper(cleanQuery, keys.serper, maxResults, signal);
        if (results.length > 0) return results;
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[MultiSearch] Serper failed, falling back to the primary plane:', err);
      }
    }

    // Keyless fallback: the vendored pi-web-access primary plane.
    const { primarySearchPlane } = await import('./searchPlane');
    return primarySearchPlane(cleanQuery, 'duckduckgo', apiKeys, maxResults, signal);
  }

  /**
   * Keyed provider: Tavily search (retires at the #112 config seam).
   */
  static async searchTavily(query: string, apiKey: string, maxResults = 8, signal?: AbortSignal): Promise<SearchResultItem[]> {
    if (signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const onCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Tavily returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }

      const data = await readBoundedJson<{ results?: Array<{ title?: string; url?: string; content?: string }> }>(res);
      const results: SearchResultItem[] = [];
      for (const r of data.results || []) {
        if (!r.url) continue;
        results.push({
          title: r.title || r.url,
          url: r.url,
          snippet: r.content || '',
        });
      }
      return results;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * Keyed provider: Serper (Google) search (retires at the #112 config seam).
   */
  static async searchSerper(query: string, apiKey: string, maxResults = 8, signal?: AbortSignal): Promise<SearchResultItem[]> {
    if (signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const onCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: maxResults }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Serper returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }

      const data = await readBoundedJson<{ organic?: Array<{ title?: string; link?: string; snippet?: string }> }>(res);
      const results: SearchResultItem[] = [];
      for (const r of data.organic || []) {
        if (!r.link) continue;
        results.push({
          title: r.title || r.link,
          url: r.link,
          snippet: r.snippet || '',
        });
      }
      return results;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }
}
