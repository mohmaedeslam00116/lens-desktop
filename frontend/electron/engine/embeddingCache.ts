/**
 * LENS Deep Research Engine — Local Disk LRU Embedding Cache & Versioned Space Index
 * Zero native dependencies (pure Node.js crypto, fs, path, os).
 *
 * Provides persistent disk caching for dense vector embeddings keyed by
 * SHA-256(provider + ":" + model + ":" + text) with embeddingSpaceVersion metadata
 * to prevent cross-model/dimension corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface CachedVectorEntry {
  hash: string;
  provider: string;
  model: string;
  dimensions: number;
  vector: number[];
  embeddingSpaceVersion: string;
  createdAt: number;
  lastAccessedAt: number;
  textLength: number;
}

export interface CacheIndexEntry {
  hash: string;
  provider: string;
  model: string;
  dimensions: number;
  embeddingSpaceVersion: string;
  createdAt: number;
  lastAccessedAt: number;
  filePath: string;
  fileSize: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  totalEntries: number;
  maxEntries: number;
  spaceVersions: string[];
  diskUsageBytes: number;
}

export interface EmbeddingCacheOptions {
  cacheDir?: string;
  maxEntries?: number;
  disabled?: boolean;
}

/**
 * Resolves the default cache directory cross-environment (Electron, CLI, Node tests).
 */
export function getDefaultCacheDir(): string {
  try {
    // Check if electron is available
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'lens_cache', 'embeddings');
    }
  } catch {
    // Fallback for Node test runner or standalone engine
  }

  const baseDir = process.env.LENS_CACHE_DIR || path.join(os.homedir(), '.lens', 'cache');
  return path.join(baseDir, 'embeddings');
}

export class EmbeddingCache {
  private cacheDir: string;
  private maxEntries: number;
  private disabled: boolean;
  private indexFile: string;
  private entriesDir: string;
  private index: Map<string, CacheIndexEntry> = new Map();
  private hits = 0;
  private misses = 0;
  private initialized = false;
  private isDirty = false;
  private flushTimeout: NodeJS.Timeout | null = null;

  constructor(options: EmbeddingCacheOptions = {}) {
    this.cacheDir = options.cacheDir || getDefaultCacheDir();
    this.maxEntries = Math.max(10, options.maxEntries || 5000);
    this.disabled = !!options.disabled;
    this.indexFile = path.join(this.cacheDir, 'index.json');
    this.entriesDir = path.join(this.cacheDir, 'entries');
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) return;
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      if (this.isDirty) {
        this.persistIndex();
      }
    }, 2000);
    if (this.flushTimeout.unref) {
      this.flushTimeout.unref();
    }
  }

  /**
   * Initializes the cache directory and reads the persistent manifest.
   */
  public async init(): Promise<void> {
    if (this.initialized || this.disabled) return;

    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      if (!fs.existsSync(this.entriesDir)) {
        fs.mkdirSync(this.entriesDir, { recursive: true });
      }

      if (fs.existsSync(this.indexFile)) {
        const raw = fs.readFileSync(this.indexFile, 'utf8');
        const parsed = JSON.parse(raw) as { entries: Record<string, CacheIndexEntry> };
        if (parsed && parsed.entries) {
          for (const [hash, entry] of Object.entries(parsed.entries)) {
            this.index.set(hash, entry);
          }
        }
      }
    } catch (err) {
      console.warn('[EmbeddingCache] Error initializing cache manifest, resetting index:', err);
      this.index.clear();
    }

    this.initialized = true;
  }

  /**
   * Computes the deterministic SHA-256 cache key.
   */
  public computeKey(provider: string, model: string, text: string): string {
    const cleanProvider = (provider || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();
    const payload = `${cleanProvider}:${cleanModel}:${text}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Computes the embedding space version identifier.
   */
  public getSpaceVersion(provider: string, model: string, dimensions: number): string {
    const cleanProvider = (provider || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();
    return `${cleanProvider}:${cleanModel}:${dimensions}`;
  }

  /**
   * Resolves the disk path for a cached hash.
   */
  private getEntryPath(hash: string): string {
    const prefix = hash.slice(0, 2);
    const subDir = path.join(this.entriesDir, prefix);
    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
    return path.join(subDir, `${hash}.json`);
  }

  /**
   * Retrieves a cached embedding vector if present and valid.
   * Validates expectedDimensions and embeddingSpaceVersion to handle model migrations.
   */
  public async get(
    provider: string,
    model: string,
    text: string,
    options: { expectedDimensions?: number; embeddingSpaceVersion?: string } = {}
  ): Promise<number[] | null> {
    if (this.disabled) return null;
    if (!this.initialized) await this.init();

    const hash = this.computeKey(provider, model, text);
    const indexEntry = this.index.get(hash);

    if (!indexEntry) {
      this.misses++;
      return null;
    }

    // Model dimension migration validation
    if (options.expectedDimensions && indexEntry.dimensions !== options.expectedDimensions) {
      this.misses++;
      return null;
    }

    if (options.embeddingSpaceVersion && indexEntry.embeddingSpaceVersion !== options.embeddingSpaceVersion) {
      this.misses++;
      return null;
    }

    try {
      const filePath = indexEntry.filePath || this.getEntryPath(hash);
      if (!fs.existsSync(filePath)) {
        this.index.delete(hash);
        this.misses++;
        return null;
      }

      const raw = await fs.promises.readFile(filePath, 'utf8');
      const entry = JSON.parse(raw) as CachedVectorEntry;

      if (!Array.isArray(entry.vector) || entry.vector.length === 0) {
        this.index.delete(hash);
        this.misses++;
        return null;
      }

      if (options.expectedDimensions && entry.dimensions !== options.expectedDimensions) {
        this.index.delete(hash);
        this.misses++;
        return null;
      }

      // Update access time
      const now = Date.now();
      indexEntry.lastAccessedAt = now;
      entry.lastAccessedAt = now;
      this.isDirty = true;
      this.scheduleFlush();
      this.hits++;

      return entry.vector;
    } catch (err) {
      this.index.delete(hash);
      this.misses++;
      return null;
    }
  }

  /**
   * Stores an embedding vector in the persistent cache.
   */
  public async set(
    provider: string,
    model: string,
    text: string,
    vector: number[],
    options: { embeddingSpaceVersion?: string } = {}
  ): Promise<void> {
    if (this.disabled || !Array.isArray(vector) || vector.length === 0) return;
    if (!this.initialized) await this.init();

    const cleanProvider = (provider || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();
    const hash = this.computeKey(cleanProvider, cleanModel, text);
    const dimensions = vector.length;
    const spaceVersion = options.embeddingSpaceVersion || this.getSpaceVersion(cleanProvider, cleanModel, dimensions);
    const now = Date.now();
    const filePath = this.getEntryPath(hash);

    const entry: CachedVectorEntry = {
      hash,
      provider: cleanProvider,
      model: cleanModel,
      dimensions,
      vector,
      embeddingSpaceVersion: spaceVersion,
      createdAt: now,
      lastAccessedAt: now,
      textLength: text.length
    };

    try {
      const data = JSON.stringify(entry);
      await fs.promises.writeFile(filePath, data, 'utf8');

      this.index.set(hash, {
        hash,
        provider: cleanProvider,
        model: cleanModel,
        dimensions,
        embeddingSpaceVersion: spaceVersion,
        createdAt: now,
        lastAccessedAt: now,
        filePath,
        fileSize: Buffer.byteLength(data)
      });

      if (this.index.size > this.maxEntries) {
        await this.evictLRU(Math.floor(this.maxEntries * 0.9));
      }

      this.persistIndex();
    } catch (err) {
      console.warn('[EmbeddingCache] Failed to write cache entry:', err);
    }
  }

  /**
   * Batch retrieval: splits a list of texts into hits and misses.
   */
  public async getBatch(
    provider: string,
    model: string,
    texts: string[],
    options: { expectedDimensions?: number; embeddingSpaceVersion?: string } = {}
  ): Promise<{
    hits: Map<number, number[]>;
    misses: { index: number; text: string }[];
  }> {
    const hits = new Map<number, number[]>();
    const misses: { index: number; text: string }[] = [];

    if (this.disabled) {
      texts.forEach((text, i) => misses.push({ index: i, text }));
      return { hits, misses };
    }

    if (!this.initialized) await this.init();

    const results = await Promise.all(
      texts.map(text => this.get(provider, model, text, options))
    );

    for (let i = 0; i < results.length; i++) {
      const vec = results[i];
      if (vec) {
        hits.set(i, vec);
      } else {
        misses.push({ index: i, text: texts[i] });
      }
    }

    return { hits, misses };
  }

  /**
   * Batch insertion of newly computed vectors.
   * Optimizes disk I/O by persisting the manifest once per batch.
   */
  public async setBatch(
    provider: string,
    model: string,
    items: { text: string; vector: number[] }[],
    options: { embeddingSpaceVersion?: string } = {}
  ): Promise<void> {
    if (this.disabled || items.length === 0) return;
    if (!this.initialized) await this.init();

    const cleanProvider = (provider || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();
    const now = Date.now();

    for (const item of items) {
      if (!Array.isArray(item.vector) || item.vector.length === 0) continue;
      const hash = this.computeKey(cleanProvider, cleanModel, item.text);
      const dimensions = item.vector.length;
      const spaceVersion = options.embeddingSpaceVersion || this.getSpaceVersion(cleanProvider, cleanModel, dimensions);
      const filePath = this.getEntryPath(hash);

      const entry: CachedVectorEntry = {
        hash,
        provider: cleanProvider,
        model: cleanModel,
        dimensions,
        vector: item.vector,
        embeddingSpaceVersion: spaceVersion,
        createdAt: now,
        lastAccessedAt: now,
        textLength: item.text.length
      };

      try {
        const data = JSON.stringify(entry);
        await fs.promises.writeFile(filePath, data, 'utf8');

        this.index.set(hash, {
          hash,
          provider: cleanProvider,
          model: cleanModel,
          dimensions,
          embeddingSpaceVersion: spaceVersion,
          createdAt: now,
          lastAccessedAt: now,
          filePath,
          fileSize: Buffer.byteLength(data)
        });
      } catch (err) {
        console.warn('[EmbeddingCache] Failed to write entry in batch:', err);
      }
    }

    if (this.index.size > this.maxEntries) {
      await this.evictLRU(Math.floor(this.maxEntries * 0.9));
    }

    this.persistIndex();
  }

  /**
   * Evicts least-recently-used entries until cache size <= targetCount.
   */
  public async evictLRU(targetCount?: number): Promise<number> {
    const target = targetCount ?? Math.floor(this.maxEntries * 0.9);
    if (this.index.size <= target) return 0;

    const sortedEntries = Array.from(this.index.values()).sort(
      (a, b) => a.lastAccessedAt - b.lastAccessedAt
    );

    const toRemoveCount = this.index.size - target;
    const toRemove = sortedEntries.slice(0, toRemoveCount);
    let evicted = 0;

    for (const entry of toRemove) {
      try {
        if (fs.existsSync(entry.filePath)) {
          fs.unlinkSync(entry.filePath);
        }
      } catch {
        // Ignore file removal errors
      }
      this.index.delete(entry.hash);
      evicted++;
    }

    this.persistIndex();
    return evicted;
  }

  /**
   * Clears cache entries, optionally filtered by provider and model.
   */
  public async clear(filter?: { provider?: string; model?: string }): Promise<void> {
    if (!this.initialized) await this.init();

    const cleanProvider = filter?.provider ? filter.provider.toLowerCase().trim() : null;
    const cleanModel = filter?.model ? filter.model.toLowerCase().trim() : null;

    for (const [hash, entry] of Array.from(this.index.entries())) {
      const matchProvider = !cleanProvider || entry.provider === cleanProvider;
      const matchModel = !cleanModel || entry.model === cleanModel;

      if (matchProvider && matchModel) {
        try {
          if (fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
          }
        } catch {
          // Ignore unlink error
        }
        this.index.delete(hash);
      }
    }

    this.hits = 0;
    this.misses = 0;
    this.persistIndex();
  }

  /**
   * Saves the manifest to index.json.
   */
  private persistIndex(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    try {
      const entriesObj: Record<string, CacheIndexEntry> = {};
      for (const [k, v] of this.index.entries()) {
        entriesObj[k] = v;
      }
      fs.writeFileSync(
        this.indexFile,
        JSON.stringify({ version: 1, entries: entriesObj }, null, 2),
        'utf8'
      );
      this.isDirty = false;
    } catch (err) {
      this.isDirty = true;
      this.scheduleFlush();
      console.warn('[EmbeddingCache] Failed to persist index.json:', err);
    }
  }

  /**
   * Returns telemetry stats for reporting and observability.
   */
  public getStats(): CacheStats {
    let diskUsageBytes = 0;
    const spaceVersions = new Set<string>();

    for (const entry of this.index.values()) {
      diskUsageBytes += entry.fileSize || 0;
      if (entry.embeddingSpaceVersion) {
        spaceVersions.add(entry.embeddingSpaceVersion);
      }
    }

    return {
      hits: this.hits,
      misses: this.misses,
      totalEntries: this.index.size,
      maxEntries: this.maxEntries,
      spaceVersions: Array.from(spaceVersions),
      diskUsageBytes
    };
  }
}

// Global default singleton instance
let defaultCacheInstance: EmbeddingCache | null = null;

export function getDefaultEmbeddingCache(): EmbeddingCache {
  if (!defaultCacheInstance) {
    defaultCacheInstance = new EmbeddingCache();
  }
  return defaultCacheInstance;
}
