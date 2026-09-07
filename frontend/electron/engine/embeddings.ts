/**
 * LENS Deep Research Engine — Embedding Model System
 * Adapted from reference implementation (vane-temp BaseEmbedding and UploadStore)
 * for Electron + React TypeScript architecture.
 */

import { BM25Index, tokenizeBilingual, normalizeArabic, stemArabicWord } from './bm25';
import { fuseRankings } from './rrf';
import { chunkStructuredDocument, parseMarkdownSections, parseHtmlSections, ContextualChunk } from './chunker';
import { selectPassagesWithMMR, MMRCandidate, MMROptions, MMRResult } from './mmr';

export { BM25Index, tokenizeBilingual, normalizeArabic, stemArabicWord };
export { fuseRankings };
export { chunkStructuredDocument, parseMarkdownSections, parseHtmlSections };
export { selectPassagesWithMMR };

export type EmbeddingProvider = 'gemini' | 'openai' | 'ollama' | 'none';

export interface EmbeddingConfig {
  enabled?: boolean;
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
}

export interface ChunkRecord {
  id: string;
  sourceIndex: number;
  citationId: number;
  url: string;
  title: string;
  domain: string;
  content: string;
  chunkIndex: number;
  score?: number;
  denseScore?: number;
  bm25Score?: number;
  enrichedContent?: string;
  sectionPath?: string[];
  contextHeader?: string;
  vector?: number[];
}

export interface ModelOption {
  id: string;
  name: string;
  context?: string;
  tags?: string[];
  recommended?: boolean;
}

/**
 * Validates array of vectors for dimension consistency and finite values.
 */
export function validateVectors(
  vectors: number[][],
  expectedCount: number
): { valid: boolean; dimensions: number; error?: string } {
  if (!Array.isArray(vectors)) {
    return { valid: false, dimensions: 0, error: 'Output vectors must be an array' };
  }
  if (vectors.length !== expectedCount) {
    return {
      valid: false,
      dimensions: 0,
      error: `Expected ${expectedCount} vectors, received ${vectors.length}`
    };
  }
  if (vectors.length === 0) {
    return { valid: true, dimensions: 0 };
  }

  const dim = vectors[0]?.length || 0;
  if (dim === 0) {
    return { valid: false, dimensions: 0, error: 'Vector dimensions must be greater than zero' };
  }

  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    if (!Array.isArray(vec)) {
      return { valid: false, dimensions: 0, error: `Vector at index ${i} is not an array` };
    }
    if (vec.length !== dim) {
      return {
        valid: false,
        dimensions: dim,
        error: `Vector dimension mismatch at index ${i}: expected ${dim}, got ${vec.length}`
      };
    }
    for (let j = 0; j < vec.length; j++) {
      if (typeof vec[j] !== 'number' || !Number.isFinite(vec[j])) {
        return {
          valid: false,
          dimensions: dim,
          error: `Non-finite number found in vector ${i} at dimension ${j}: ${vec[j]}`
        };
      }
    }
  }

  return { valid: true, dimensions: dim };
}

/**
 * Computes cosine similarity between two numeric vectors.
 * Adapted from reference vane-temp computeSimilarity with strict finite validation.
 */
export function computeSimilarity(x: number[], y: number[]): number {
  if (!Array.isArray(x) || !Array.isArray(y)) {
    throw new Error('Vectors must be valid arrays');
  }
  if (x.length !== y.length) {
    throw new Error(`Vector length mismatch: ${x.length} vs ${y.length}`);
  }
  if (x.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error(`Non-finite value encountered in similarity calculation at index ${i}`);
    }
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) {
    return 0;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0 || !Number.isFinite(denom)) {
    return 0;
  }

  const sim = dotProduct / denom;
  return Math.max(-1, Math.min(1, sim));
}

/**
 * Splits text into bounded, readable passages with overlapping boundaries.
 */
export function chunkText(
  text: string,
  options: { maxChunkSize?: number; chunkOverlap?: number } = {}
): string[] {
  const maxChunkSize = Math.max(150, Math.min(2000, options.maxChunkSize || 650));
  const chunkOverlap = Math.max(0, Math.min(Math.floor(maxChunkSize / 2), options.chunkOverlap ?? 80));

  if (!text || !text.trim()) {
    return [];
  }

  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= maxChunkSize) {
    return [clean];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + maxChunkSize;

    if (endIndex >= clean.length) {
      const remaining = clean.slice(startIndex).trim();
      if (remaining.length > 40) {
        chunks.push(remaining);
      }
      break;
    }

    // Try finding natural paragraph break first
    let splitPoint = -1;
    const windowText = clean.slice(startIndex, endIndex);

    const paraBreak = windowText.lastIndexOf('\n\n');
    if (paraBreak > maxChunkSize * 0.4) {
      splitPoint = startIndex + paraBreak + 2;
    } else {
      // Try sentence boundary (. , ! , ? , ؟)
      const lastSentence = windowText.lastIndexOf('. ');
      const lastQuestion = windowText.lastIndexOf('? ');
      const lastArabicQuestion = windowText.lastIndexOf('؟ ');
      const bestSentence = Math.max(lastSentence, lastQuestion, lastArabicQuestion);

      if (bestSentence > maxChunkSize * 0.4) {
        splitPoint = startIndex + bestSentence + 2;
      } else {
        // Fallback to space
        const lastSpace = windowText.lastIndexOf(' ');
        if (lastSpace > maxChunkSize * 0.3) {
          splitPoint = startIndex + lastSpace + 1;
        } else {
          splitPoint = endIndex;
        }
      }
    }

    const chunk = clean.slice(startIndex, splitPoint).trim();
    if (chunk.length > 40) {
      chunks.push(chunk);
    }

    startIndex = Math.max(splitPoint - chunkOverlap, startIndex + 1);
  }

  return chunks;
}

/**
 * Base Embedding class adapted from vane-temp BaseEmbedding.
 */
export abstract class BaseEmbedding<CONFIG = any> {
  constructor(protected config: CONFIG) {}
  abstract embedText(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/**
 * OpenAI Embedding Adapter
 */
export class OpenAIEmbedding extends BaseEmbedding<{
  apiKey: string;
  model: string;
  baseURL?: string;
  timeoutMs?: number;
  batchSize?: number;
}> {
  async embedText(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('OpenAI API key is missing for embedding retrieval');
    }

    const model = (this.config.model || 'text-embedding-3-small').trim();
    const baseUrl = (this.config.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const batchSize = Math.max(1, Math.min(64, this.config.batchSize || 32));
    const timeoutMs = this.config.timeoutMs || 12000;

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: batch
        }),
        signal: combinedSignal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`OpenAI embedding failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      if (!data?.data || !Array.isArray(data.data)) {
        throw new Error('Malformed response from OpenAI embedding endpoint: missing data array');
      }

      // Ensure embeddings are ordered by index
      const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const batchVectors = sorted.map(item => item.embedding);

      const validation = validateVectors(batchVectors, batch.length);
      if (!validation.valid) {
        throw new Error(`OpenAI vector validation failed: ${validation.error}`);
      }

      allEmbeddings.push(...batchVectors);
    }

    return allEmbeddings;
  }
}

/**
 * Gemini Embedding Adapter
 * Supports Google Generative Language batchEmbedContents.
 */
export class GeminiEmbedding extends BaseEmbedding<{
  apiKey: string;
  model: string;
  endpoint?: string;
  timeoutMs?: number;
  batchSize?: number;
}> {
  async embedText(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = (this.config.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('Google Gemini API key is missing for embedding retrieval');
    }

    let model = (this.config.model || 'text-embedding-004').trim();
    model = model.replace(/^models\//, '');
    const batchSize = Math.max(1, Math.min(32, this.config.batchSize || 16));
    const timeoutMs = this.config.timeoutMs || 12000;

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;
      const payload = {
        requests: batch.map(text => ({
          model: `models/${model}`,
          content: { parts: [{ text }] }
        }))
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combinedSignal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Gemini embedding API error (HTTP ${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      if (!data?.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error('Malformed response from Gemini embedding endpoint: missing embeddings array');
      }

      const batchVectors = data.embeddings.map((e: any) => e.values);
      const validation = validateVectors(batchVectors, batch.length);
      if (!validation.valid) {
        throw new Error(`Gemini vector validation failed: ${validation.error}`);
      }

      allEmbeddings.push(...batchVectors);
    }

    return allEmbeddings;
  }
}

/**
 * Ollama Embedding Adapter
 * Supports local Ollama /api/embed endpoint with fallback to /api/embeddings.
 */
export class OllamaEmbedding extends BaseEmbedding<{
  model: string;
  endpoint?: string;
  timeoutMs?: number;
  batchSize?: number;
}> {
  async embedText(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];

    const endpoint = (this.config.endpoint || 'http://localhost:11434').replace(/\/$/, '');
    const model = (this.config.model || 'nomic-embed-text').trim();
    const batchSize = Math.max(1, Math.min(32, this.config.batchSize || 16));
    const timeoutMs = this.config.timeoutMs || 15000;

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      let success = false;

      // First attempt modern /api/embed
      try {
        const res = await fetch(`${endpoint}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            input: batch
          }),
          signal: combinedSignal
        });

        if (res.ok) {
          const data = await res.json() as any;
          if (Array.isArray(data.embeddings)) {
            const validation = validateVectors(data.embeddings, batch.length);
            if (!validation.valid) {
              throw new Error(`Ollama vector validation failed: ${validation.error}`);
            }
            allEmbeddings.push(...data.embeddings);
            success = true;
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError' || combinedSignal.aborted) {
          throw e;
        }
      }

      if (success) continue;

      // Legacy fallback: /api/embeddings (single item prompt)
      const fallbackBatchVectors: number[][] = [];
      for (const text of batch) {
        const singleRes = await fetch(`${endpoint}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: text
          }),
          signal: combinedSignal
        });

        if (!singleRes.ok) {
          const errText = await singleRes.text().catch(() => '');
          throw new Error(`Ollama embedding error (HTTP ${singleRes.status}): ${errText.slice(0, 200)}`);
        }

        const singleData = await singleRes.json() as any;
        if (!Array.isArray(singleData.embedding)) {
          throw new Error('Malformed response from Ollama /api/embeddings: missing embedding vector');
        }
        fallbackBatchVectors.push(singleData.embedding);
      }

      const validation = validateVectors(fallbackBatchVectors, batch.length);
      if (!validation.valid) {
        throw new Error(`Ollama fallback vector validation failed: ${validation.error}`);
      }

      allEmbeddings.push(...fallbackBatchVectors);
    }

    return allEmbeddings;
  }
}

/**
 * Creates an embedding model instance according to provider configuration.
 */
export function createEmbeddingModel(config: EmbeddingConfig): BaseEmbedding {
  const provider = (config.provider || 'none').toLowerCase().trim();

  switch (provider) {
    case 'gemini':
      return new GeminiEmbedding({
        apiKey: config.apiKey || '',
        model: config.model || 'text-embedding-004',
        endpoint: config.endpoint,
        timeoutMs: config.timeoutMs
      });
    case 'openai':
      return new OpenAIEmbedding({
        apiKey: config.apiKey || '',
        model: config.model || 'text-embedding-3-small',
        baseURL: config.endpoint,
        timeoutMs: config.timeoutMs
      });
    case 'ollama':
      return new OllamaEmbedding({
        model: config.model || 'nomic-embed-text',
        endpoint: config.endpoint || 'http://localhost:11434',
        timeoutMs: config.timeoutMs
      });
    default:
      throw new Error(`Unsupported or unconfigured embedding provider: ${provider}`);
  }
}

/**
 * Dynamic discovery for embedding models.
 * Filters exclusively for embedding-capable models and guarantees no chat models are included.
 */
export async function fetchEmbeddingModels(
  provider: string,
  apiKey?: string,
  endpoint?: string
): Promise<ModelOption[]> {
  const norm = (provider || '').toLowerCase().trim();

  // 1. Ollama (local)
  if (norm === 'ollama') {
    try {
      const url = `${(endpoint || 'http://localhost:11434').replace(/\/$/, '')}/api/tags`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return getDefaultEmbeddingModels('ollama');

      const data = await res.json() as any;
      const allModels = (data.models || []) as Array<{ name: string; size?: number }>;

      const embeddingList = allModels.filter(m => {
        const name = m.name.toLowerCase();
        return (
          name.includes('embed') ||
          name.includes('bge') ||
          name.includes('minilm') ||
          name.includes('arctic') ||
          name.includes('mxbai')
        );
      });

      if (embeddingList.length === 0) {
        return getDefaultEmbeddingModels('ollama');
      }

      return embeddingList.map(m => ({
        id: m.name,
        name: m.name,
        context: m.size ? `${(m.size / (1024 * 1024)).toFixed(0)} MB` : 'Local Vector Model',
        tags: ['Local', 'Ollama', 'Embedding'],
        recommended: m.name.includes('nomic') || m.name.includes('mxbai')
      }));
    } catch {
      return getDefaultEmbeddingModels('ollama');
    }
  }

  // Cloud providers require API key
  if (!apiKey || !apiKey.trim()) {
    return getDefaultEmbeddingModels(norm);
  }

  const key = apiKey.trim();

  // 2. Google Gemini
  if (norm === 'gemini' || norm === 'google') {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return getDefaultEmbeddingModels('gemini');

      const data = await res.json() as any;
      const discovered: ModelOption[] = [];

      for (const m of (data.models || [])) {
        const id = (m.name || '').replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];

        const isEmbedding = methods.includes('embedContent') || id.includes('embedding');
        if (!isEmbedding || id.includes('flash') || id.includes('pro') || id.includes('ultra')) {
          continue;
        }

        discovered.push({
          id,
          name: m.displayName || id,
          context: m.outputTokenLimit ? `${m.outputTokenLimit} dimensions` : '768 / 1536 dims',
          tags: ['Gemini', 'Vector Embedding'],
          recommended: id === 'text-embedding-004'
        });
      }

      return discovered.length > 0 ? discovered : getDefaultEmbeddingModels('gemini');
    } catch {
      return getDefaultEmbeddingModels('gemini');
    }
  }

  // 3. OpenAI
  if (norm === 'openai') {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return getDefaultEmbeddingModels('openai');

      const data = await res.json() as any;
      const discovered: ModelOption[] = [];

      for (const m of (data.data || [])) {
        const id = (m.id || '').toLowerCase();
        if (!id.includes('embedding')) continue;
        if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) continue;

        discovered.push({
          id: m.id,
          name: m.id,
          context: id.includes('large') ? '3072 dims' : '1536 dims',
          tags: ['OpenAI', 'Vector Embedding'],
          recommended: m.id === 'text-embedding-3-small'
        });
      }

      return discovered.length > 0 ? discovered : getDefaultEmbeddingModels('openai');
    } catch {
      return getDefaultEmbeddingModels('openai');
    }
  }

  return [];
}

/**
 * Sensible default embedding model catalog when API discovery is offline or not yet keyed.
 */
export function getDefaultEmbeddingModels(provider: string): ModelOption[] {
  const norm = provider.toLowerCase().trim();
  if (norm === 'gemini' || norm === 'google') {
    return [
      { id: 'text-embedding-004', name: 'text-embedding-004', context: '768 dimensions', tags: ['Recommended', 'Gemini'], recommended: true }
    ];
  }
  if (norm === 'openai') {
    return [
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', context: '1536 dimensions', tags: ['Fast', 'Low Cost'], recommended: true },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', context: '3072 dimensions', tags: ['High Precision'], recommended: false },
      { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', context: '1536 dimensions', tags: ['Legacy'], recommended: false }
    ];
  }
  if (norm === 'ollama') {
    return [
      { id: 'nomic-embed-text', name: 'nomic-embed-text:latest', context: 'Local 768 dims', tags: ['Local', 'Fast'], recommended: true },
      { id: 'mxbai-embed-large', name: 'mxbai-embed-large:latest', context: 'Local 1024 dims', tags: ['Local', 'Quality'], recommended: false },
      { id: 'all-minilm', name: 'all-minilm:latest', context: 'Local 384 dims', tags: ['Ultra Lightweight'], recommended: false }
    ];
  }
  return [];
}

/**
 * Standard excerpt fallback preserving exact original LENS behavior.
 * When queries are provided, uses BM25 to rank passages across sources
 * instead of raw slice(0, 2000), while strictly preserving citation ID format.
 */
export function fallbackEvidence(
  sources: Array<{ url: string; title: string; domain: string; content: string }>,
  queries?: string[]
): string {
  if (queries && Array.isArray(queries) && queries.length > 0) {
    try {
      const cleanQueries = queries.filter(q => q && q.trim());
      if (cleanQueries.length > 0) {
        const bm25 = new BM25Index<{ title: string; domain: string; url: string; citationId: number; content: string }>();
        const allChunks: Array<{ id: string; citationId: number; title: string; domain: string; url: string; content: string }> = [];

        sources.forEach((s, srcIdx) => {
          const citationId = srcIdx + 1;
          const structuredChunks = chunkStructuredDocument(s.content, {
            defaultTitle: s.title,
            sourceIndex: srcIdx,
            citationId,
            maxChunkSize: 650,
            chunkOverlap: 80
          });
          structuredChunks.forEach((sc) => {
            const chunkObj = { id: sc.id, citationId, title: s.title, domain: s.domain, url: s.url, content: sc.content };
            allChunks.push(chunkObj);
            bm25.addDocument(sc.id, sc.enrichedContent, chunkObj);
          });
        });

        const searchResults = bm25.search(cleanQueries.join(' '));
        if (searchResults.length > 0) {
          const bySource = new Map<number, string>();
          for (const res of searchResults) {
            if (res.metadata && !bySource.has(res.metadata.citationId)) {
              bySource.set(res.metadata.citationId, res.metadata.content);
            }
          }

          return sources.map((s, idx) => {
            const citationId = idx + 1;
            const excerpt = bySource.get(citationId) || s.content.slice(0, 2000);
            return `[${citationId}] SOURCE: ${s.title} (${s.domain}) - URL: ${s.url}\nEXCERPT:\n${excerpt}\n---`;
          }).join('\n\n');
        }
      }
    } catch {
      // Fall through to standard slice(0, 2000)
    }
  }

  return sources.map((s, idx) => {
    const citationId = idx + 1;
    return `[${citationId}] SOURCE: ${s.title} (${s.domain}) - URL: ${s.url}\nEXCERPT:\n${s.content.slice(0, 2000)}\n---`;
  }).join('\n\n');
}

/**
 * Semantic Passage Ranking Pipeline
 */
export async function rankSourcePassages(
  sources: Array<{ url: string; title: string; domain: string; content: string; credibilityScore?: number }>,
  queries: string[],
  embeddingModel: BaseEmbedding,
  options: {
    maxTotalPassages?: number;
    maxPerSource?: number;
    maxContextChars?: number;
    signal?: AbortSignal;
    denseWeight?: number;
    bm25Weight?: number;
    rrfK?: number;
    disableBM25?: boolean;
    mmrLambda?: number;
    maxPerDomain?: number;
    domainDecay?: number;
    sourceDecay?: number;
    disableMMR?: boolean;
  } = {}
): Promise<{
  evidenceText: string;
  selectedChunks: ChunkRecord[];
  metrics: {
    totalChunks: number;
    vectorDimensions: number;
    sourcesCovered: number;
    averageScore: number;
    hybridMode?: boolean;
    diversityScore?: number;
  };
}> {
  if (!sources || sources.length === 0) {
    return {
      evidenceText: 'No external evidence retrieved.',
      selectedChunks: [],
      metrics: { totalChunks: 0, vectorDimensions: 0, sourcesCovered: 0, averageScore: 0 }
    };
  }

  const maxTotalPassages = Math.max(1, Math.min(32, options.maxTotalPassages || 14));
  const maxPerSource = Math.max(1, Math.min(4, options.maxPerSource || 2));
  const maxContextChars = Math.max(4000, Math.min(20000, options.maxContextChars || 11000));

  // 1. Chunk all sources with structure awareness and contextual enrichment
  const allChunks: ChunkRecord[] = [];

  sources.forEach((s, srcIdx) => {
    const citationId = srcIdx + 1;
    const structuredChunks = chunkStructuredDocument(s.content, {
      defaultTitle: s.title,
      sourceIndex: srcIdx,
      citationId,
      maxChunkSize: 650,
      chunkOverlap: 80
    });

    if (structuredChunks.length > 0) {
      structuredChunks.forEach((sc) => {
        allChunks.push({
          id: sc.id,
          sourceIndex: srcIdx,
          citationId,
          url: s.url,
          title: s.title,
          domain: s.domain,
          content: sc.content,
          chunkIndex: sc.chunkIndex,
          enrichedContent: sc.enrichedContent,
          sectionPath: sc.sectionPath,
          contextHeader: sc.contextHeader
        });
      });
    } else {
      const textChunks = chunkText(s.content, { maxChunkSize: 650, chunkOverlap: 80 });
      textChunks.forEach((text, chunkIdx) => {
        allChunks.push({
          id: `chunk_${citationId}_${chunkIdx}`,
          sourceIndex: srcIdx,
          citationId,
          url: s.url,
          title: s.title,
          domain: s.domain,
          content: text,
          chunkIndex: chunkIdx,
          enrichedContent: `[${s.title}]\n${text}`
        });
      });
    }
  });

  if (allChunks.length === 0) {
    return {
      evidenceText: fallbackEvidence(sources),
      selectedChunks: [],
      metrics: { totalChunks: 0, vectorDimensions: 0, sourcesCovered: 0, averageScore: 0 }
    };
  }

  // Bound maximum chunks to embed in one research turn to protect API quotas/latency
  const cappedChunks = allChunks.slice(0, 96);

  // 2. Embed queries
  const cleanQueries = queries.filter(q => q && q.trim()).slice(0, 4);
  if (cleanQueries.length === 0) {
    cleanQueries.push('comprehensive overview');
  }

  const queryVectors = await embeddingModel.embedText(cleanQueries, options.signal);
  const qValidation = validateVectors(queryVectors, cleanQueries.length);
  if (!qValidation.valid) {
    throw new Error(`Query embedding validation failed: ${qValidation.error}`);
  }

  // 3. Embed chunk passages using enrichedContent for maximum semantic context
  const chunkTexts = cappedChunks.map(c => c.enrichedContent || `${c.title}\n${c.content}`);
  const chunkVectors = await embeddingModel.embedText(chunkTexts, options.signal);
  const cValidation = validateVectors(chunkVectors, chunkTexts.length);
  if (!cValidation.valid) {
    throw new Error(`Document chunk embedding validation failed: ${cValidation.error}`);
  }

  if (qValidation.dimensions !== cValidation.dimensions) {
    throw new Error(
      `Dimension mismatch between query vectors (${qValidation.dimensions}) and chunk vectors (${cValidation.dimensions})`
    );
  }

  // 4. Compute similarity scores
  cappedChunks.forEach((chunk, idx) => {
    const chunkVec = chunkVectors[idx];
    chunk.vector = chunkVec;
    let maxSim = -1;

    for (let qIdx = 0; qIdx < queryVectors.length; qIdx++) {
      const qVec = queryVectors[qIdx];
      const weight = qIdx === 0 ? 1.15 : 1.0;
      const sim = computeSimilarity(qVec, chunkVec) * weight;
      if (sim > maxSim) {
        maxSim = sim;
      }
    }

    chunk.denseScore = maxSim;
    chunk.score = maxSim;
  });

  // 5. Hybrid Search: BM25 Lexical Indexing & Reciprocal Rank Fusion (RRF)
  let isHybrid = false;
  if (!options.disableBM25) {
    try {
      const bm25 = new BM25Index<ChunkRecord>();
      cappedChunks.forEach(c => {
        bm25.addDocument(c.id, c.enrichedContent || `${c.title} ${c.content}`, c);
      });

      const bm25Query = cleanQueries.join(' ');
      const bm25Results = bm25.search(bm25Query);
      const bm25ScoreMap = new Map(bm25Results.map(r => [r.id, r.score]));

      cappedChunks.forEach(c => {
        c.bm25Score = bm25ScoreMap.get(c.id) || 0;
      });

      const denseRanked = [...cappedChunks]
        .map(c => ({ id: c.id, score: c.denseScore ?? 0, metadata: c }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      const bm25Ranked = bm25Results.map(r => ({ id: r.id, score: r.score, metadata: r.metadata }));

      const fused = fuseRankings<ChunkRecord>([
        {
          name: 'dense',
          weight: typeof options.denseWeight === 'number' ? options.denseWeight : 1.0,
          items: denseRanked
        },
        {
          name: 'bm25',
          weight: typeof options.bm25Weight === 'number' ? options.bm25Weight : 0.8,
          items: bm25Ranked
        }
      ], { k: options.rrfK || 60 });

      const fusedMap = new Map(fused.map(f => [f.id, f.score]));
      cappedChunks.forEach(chunk => {
        chunk.score = fusedMap.get(chunk.id) ?? chunk.denseScore ?? 0;
      });
      isHybrid = true;
    } catch (bm25Err) {
      console.warn('[HybridSearch] BM25 fusion skipped, falling back to dense similarity:', bm25Err);
    }
  }

  // 6. Source Diversity & Passage Selection (MMR)
  let selectedChunks: ChunkRecord[] = [];
  let diversityScore = 1.0;

  if (options.disableMMR) {
    const chunksBySource = new Map<number, ChunkRecord[]>();
    cappedChunks.forEach(chunk => {
      if (!chunksBySource.has(chunk.citationId)) {
        chunksBySource.set(chunk.citationId, []);
      }
      chunksBySource.get(chunk.citationId)!.push(chunk);
    });

    for (const [, list] of chunksBySource.entries()) {
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    let currentChars = 0;
    const sourceCitationIds = Array.from(chunksBySource.keys()).sort((a, b) => {
      const topA = chunksBySource.get(a)?.[0]?.score ?? 0;
      const topB = chunksBySource.get(b)?.[0]?.score ?? 0;
      return topB - topA;
    });

    for (const citId of sourceCitationIds) {
      if (selectedChunks.length >= maxTotalPassages) break;
      const topChunk = chunksBySource.get(citId)?.[0];
      if (topChunk) {
        if (currentChars + topChunk.content.length <= maxContextChars) {
          selectedChunks.push(topChunk);
          currentChars += topChunk.content.length;
        }
      }
    }

    const remainingChunks: ChunkRecord[] = [];
    for (const [citId, list] of chunksBySource.entries()) {
      const alreadyPicked = selectedChunks.filter(c => c.citationId === citId).length;
      const eligible = list.slice(alreadyPicked, maxPerSource);
      remainingChunks.push(...eligible);
    }

    remainingChunks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    for (const chunk of remainingChunks) {
      if (selectedChunks.length >= maxTotalPassages) break;
      if (currentChars + chunk.content.length > maxContextChars) continue;
      selectedChunks.push(chunk);
      currentChars += chunk.content.length;
    }
  } else {
    const mmrCandidates: MMRCandidate<ChunkRecord>[] = cappedChunks.map((chunk, idx) => ({
      id: chunk.id,
      score: chunk.score ?? 0,
      vector: chunk.vector || chunkVectors[idx],
      content: chunk.content,
      sourceId: chunk.citationId,
      domain: chunk.domain,
      credibilityScore: sources[chunk.sourceIndex]?.credibilityScore,
      metadata: chunk
    }));

    const mmrResult = selectPassagesWithMMR<ChunkRecord>(mmrCandidates, {
      lambda: typeof options.mmrLambda === 'number' ? options.mmrLambda : 0.7,
      maxPassages: maxTotalPassages,
      maxPerSource: maxPerSource,
      maxPerDomain: options.maxPerDomain ?? 3,
      domainDecay: options.domainDecay ?? 0.75,
      sourceDecay: options.sourceDecay ?? 0.70,
      maxContextChars: maxContextChars
    });

    selectedChunks = mmrResult.selected.map(s => s.metadata!);
    diversityScore = mmrResult.metrics.diversityScore;
  }

  // Sort selected chunks by citationId then chunkIndex for sequential citation presentation
  selectedChunks.sort((a, b) => {
    if (a.citationId !== b.citationId) {
      return a.citationId - b.citationId;
    }
    return a.chunkIndex - b.chunkIndex;
  });

  // 7. Build final evidence text formatted with citations
  const evidenceBlocks: string[] = [];
  const selectedBySource = new Map<number, ChunkRecord[]>();
  selectedChunks.forEach(c => {
    if (!selectedBySource.has(c.citationId)) {
      selectedBySource.set(c.citationId, []);
    }
    selectedBySource.get(c.citationId)!.push(c);
  });

  for (const [citId, chunkList] of selectedBySource.entries()) {
    const first = chunkList[0];
    const excerptsText = chunkList.map((c, i) => {
      const displayScore = typeof c.denseScore === 'number' ? c.denseScore : (c.score ?? 0);
      return `[Passage ${i + 1} | Relevance: ${(displayScore * 100).toFixed(0)}%]:\n${c.content}`;
    }).join('\n\n');
    evidenceBlocks.push(`[${citId}] SOURCE: ${first.title} (${first.domain}) - URL: ${first.url}\nEXCERPTS:\n${excerptsText}\n---`);
  }

  // For any sources that had no chunk selected due to size limits, append concise fallback excerpt
  sources.forEach((s, idx) => {
    const citId = idx + 1;
    if (!selectedBySource.has(citId)) {
      evidenceBlocks.push(`[${citId}] SOURCE: ${s.title} (${s.domain}) - URL: ${s.url}\nEXCERPT:\n${s.content.slice(0, 500)}\n---`);
    }
  });

  const avgScore = selectedChunks.length > 0
    ? selectedChunks.reduce((sum, c) => sum + (c.denseScore ?? c.score ?? 0), 0) / selectedChunks.length
    : 0;

  return {
    evidenceText: evidenceBlocks.join('\n\n'),
    selectedChunks,
    metrics: {
      totalChunks: cappedChunks.length,
      vectorDimensions: qValidation.dimensions,
      sourcesCovered: selectedBySource.size,
      averageScore: Number(avgScore.toFixed(3)),
      hybridMode: isHybrid,
      diversityScore
    }
  };
}
