import * as cheerio from 'cheerio';

export interface ScrapedPage {
  url: string;
  title: string;
  domain: string;
  content: string;
  credibilityScore: number;
}

export function calculateCredibilityScore(url: string): number {
  try {
    const domain = new URL(url).hostname.toLowerCase().replace('www.', '');

    const highTrust = [
      'arxiv.org', 'nature.com', 'sciencedirect.com', 'ieee.org', 'acm.org',
      'github.com', 'mit.edu', 'stanford.edu', 'harvard.edu', 'nih.gov',
      'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'bbc.com',
      'openai.com', 'anthropic.com', 'deepmind.google', 'huggingface.co',
      'wikipedia.org', 'stackoverflow.com', 'developer.mozilla.org'
    ];

    if (highTrust.some(d => domain.includes(d))) return 95;
    if (domain.endsWith('.gov') || domain.endsWith('.edu')) return 96;
    if (domain.endsWith('.org')) return 88;
    if (domain.endsWith('.ai') || domain.endsWith('.io')) return 84;
    return 80;
  } catch {
    return 75;
  }
}

export class PageScraper {
  static async scrape(url: string, timeoutMs = 8000, signal?: AbortSignal): Promise<ScrapedPage> {
    let domain = '';
    try {
      domain = new URL(url).hostname.replace('www.', '');
    } catch {
      domain = url;
    }

    const credibilityScore = calculateCredibilityScore(url);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const onCallerAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', onCallerAbort, { once: true });
        }
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
          if (res.status === 429 || res.status === 503) {
            return {
              url,
              title: domain,
              domain,
              content: `Content unavailable from ${url} (HTTP ${res.status}).`,
              credibilityScore
            };
          }
          throw new Error(`HTTP ${res.status}: Content unavailable from ${url}`);
        }

        const MAX_SCRAPE_BYTES = 2 * 1024 * 1024; // 2 MB safe maximum scrape size
        const contentLengthStr = res.headers.get('content-length');
        if (contentLengthStr && parseInt(contentLengthStr, 10) > MAX_SCRAPE_BYTES) {
          throw new Error(`Content length exceeds maximum limit of ${MAX_SCRAPE_BYTES} bytes`);
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
              if (totalBytes > MAX_SCRAPE_BYTES) {
                try { await reader.cancel(); } catch {}
                throw new Error(`Stream exceeded maximum size limit of ${MAX_SCRAPE_BYTES} bytes`);
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
          html = new TextDecoder('utf-8').decode(merged);
        } else {
          html = await res.text();
        }
      } finally {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener('abort', onCallerAbort);
        }
      }

      const $ = cheerio.load(html);

      // Strip non-content and noise elements
      $('script, style, noscript, iframe, svg, nav, footer, header, form, aside, .advertisement, .ad, .cookie-banner').remove();

      const title = $('h1').first().text().trim() || $('title').text().trim() || domain;

      // Extract main readable content
      let content = '';
      const articleEl = $('article, main, [role="main"], .post-content, .article-body, #content');
      if (articleEl.length > 0) {
        content = articleEl.first().text();
      } else {
        const paragraphs = $('p, h2, h3, li')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(t => t.length > 20);
        content = paragraphs.join('\n\n');
      }

      // Clean excessive whitespace
      content = content.replace(/\r\n/g, '\n').replace(/\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

      // Fallback if still too short
      if (!content || content.length < 80) {
        content = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);
      }

      // Cap content length to ~6000 characters
      if (content.length > 6000) {
        content = content.slice(0, 6000) + '... [content trimmed]';
      }

      return {
        url,
        title: title || domain,
        domain,
        content: content || `Extracted summary from ${domain}`,
        credibilityScore
      };
    } catch (err: any) {
      throw new Error(`Failed to scrape ${url}: ${err.message || 'Request timed out'}`);
    }
  }
}
