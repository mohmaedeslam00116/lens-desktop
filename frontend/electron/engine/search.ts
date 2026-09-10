import { SearchResultItem } from './types';
import * as cheerio from 'cheerio';

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
   * Searches web using requested provider with automatic DuckDuckGo fallback.
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
        console.warn('[MultiSearch] Tavily failed, falling back to DuckDuckGo:', err);
      }
    } else if ((provider === 'serper' || provider === 'google') && keys.serper) {
      try {
        const results = await this.searchSerper(cleanQuery, keys.serper, maxResults, signal);
        if (results.length > 0) return results;
      } catch (err) {
        if (signal?.aborted) throw err;
        console.warn('[MultiSearch] Serper failed, falling back to DuckDuckGo:', err);
      }
    }

    // Default & reliable fallback: DuckDuckGo HTML search
    return await this.searchDuckDuckGo(cleanQuery, maxResults, signal);
  }

  /**
   * DuckDuckGo free search without API keys.
   */
  static async searchDuckDuckGo(
    query: string,
    maxResults = 8,
    signal?: AbortSignal,
    endpoint = 'https://html.duckduckgo.com/html/'
  ): Promise<SearchResultItem[]> {
    if (signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    let timedOut = false;
    try {
      const url = `${endpoint.includes('?') ? endpoint + '&' : endpoint + '?'}q=${encodeURIComponent(query)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 9000);

      const onCallerAbort = () => controller.abort();
      if (signal) {
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }

      let html = '';
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
          }
        });

        if (!res.ok) {
          throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
        }

        html = await res.text();
      } finally {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', onCallerAbort);
        }
      }

      const $ = cheerio.load(html);
      const results: SearchResultItem[] = [];

      $('.result').each((_, el) => {
        if (results.length >= maxResults) return;

        const titleEl = $(el).find('.result__a');
        const snippetEl = $(el).find('.result__snippet');

        let href = titleEl.attr('href') || '';
        // Decode DDG redirect URL (/l/?uddg=...)
        if (href.includes('uddg=')) {
          try {
            const parsedUrl = new URL(href, 'https://duckduckgo.com');
            const uddg = parsedUrl.searchParams.get('uddg');
            if (uddg) href = decodeURIComponent(uddg);
          } catch {
            // keep raw href
          }
        }

        // Exclude ads and non-http links
        if (!href.startsWith('http')) return;
        if (href.includes('duckduckgo.com/y.js')) return;

        const title = titleEl.text().trim();
        const snippet = snippetEl.text().trim();

        if (title && href) {
          results.push({ title, url: href, snippet });
        }
      });

      if (results.length > 0) return results;

      // Secondary fallback: DuckDuckGo Instant Answer API
      return await this.searchDuckDuckGoInstantApi(query, maxResults, signal);
    } catch (err: any) {
      if (signal?.aborted) throw err;
      if (!timedOut && (err?.name === 'AbortError' || err?.message?.includes('aborted'))) throw err;
      console.warn('[MultiSearch] DuckDuckGo HTML scraping error:', err);
      return await this.searchDuckDuckGoInstantApi(query, maxResults, signal);
    }
  }

  /**
   * DuckDuckGo Instant Answer JSON API fallback
   */
  static async searchDuckDuckGoInstantApi(query: string, maxResults = 8, signal?: AbortSignal, timeoutMs = 6000): Promise<SearchResultItem[]> {
    if (signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onCallerAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(apiUrl, { signal: controller.signal });
      if (!res.ok) return [];

      const data = await res.json() as any;
      const results: SearchResultItem[] = [];

      if (data.AbstractURL && data.AbstractText) {
        results.push({
          title: data.Heading || query,
          url: data.AbstractURL,
          snippet: data.AbstractText
        });
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (results.length >= maxResults) break;
          if (topic.FirstURL && topic.Text) {
            results.push({
              title: topic.Text.split(' - ')[0] || query,
              url: topic.FirstURL,
              snippet: topic.Text
            });
          }
        }
      }

      return results;
    } catch (err: any) {
      if (signal?.aborted) throw err;
      return [];
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Tavily Search API
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          max_results: maxResults,
          include_answer: false
        })
      });

      if (!res.ok) {
        throw new Error(`Tavily API responded with status ${res.status}`);
      }

      const data = await readBoundedJson(res);
      return (data.results || []).map((r: any) => ({
        title: r.title || query,
        url: r.url,
        snippet: r.content || ''
      }));
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * Serper Google Search API
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query, num: maxResults })
      });

      if (!res.ok) {
        throw new Error(`Serper API responded with status ${res.status}`);
      }

      const data = await readBoundedJson(res);
      return (data.organic || []).map((r: any) => ({
        title: r.title || query,
        url: r.link,
        snippet: r.snippet || ''
      }));
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }
}
