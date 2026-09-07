import * as crypto from 'crypto';

/**
 * Standard URL tracking query parameters to strip during Level 1 canonicalization.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'source',
  'fbclid',
  'gclid',
  'msclkid',
  'twclid',
  '_ga',
  '_gl',
  'mc_cid',
  'mc_eid',
  'spjobid',
  'yclid',
  'igshid',
  'mkt_tok'
]);

/**
 * Level 1: Canonical URL Normalization
 *
 * Lowercases hostname and scheme, strips default ports (:80, :443), removes tracking
 * query parameters, removes fragments, normalizes trailing slashes, and sorts query parameters.
 */
export function normalizeCanonicalUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl.trim());

    // Normalize protocol and host to lowercase
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip default ports
    if ((parsed.protocol === 'http:' && parsed.port === '80') ||
        (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    // Strip fragment
    parsed.hash = '';

    // Filter tracking query params
    const keptParams: Array<[string, string]> = [];
    parsed.searchParams.forEach((val, key) => {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) {
        keptParams.push([key, val]);
      }
    });

    // Sort remaining query parameters deterministically by key, then value
    keptParams.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    // Reconstruct search string
    if (keptParams.length > 0) {
      const sp = new URLSearchParams();
      for (const [k, v] of keptParams) {
        sp.append(k, v);
      }
      parsed.search = sp.toString();
    } else {
      parsed.search = '';
    }

    // Normalize pathname: strip trailing slash unless path is strictly '/'
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    // Return original string if not a valid URL
    return rawUrl.trim();
  }
}

/**
 * Level 2: Exact Content Hashing (SHA-256)
 *
 * Normalizes text (lowercase, Unicode alphanumeric preservation across Arabic & English,
 * whitespace collapsing) and returns its SHA-256 hexadecimal digest.
 */
export function computeExactHash(text: string): string {
  if (!text) {
    return crypto.createHash('sha256').update('').digest('hex');
  }

  // Normalize text: lowercase, preserve letters & numbers across all alphabets, collapse whitespace
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Level 3: 64-bit SimHash Fingerprinting
 *
 * Generates a 64-bit SimHash representation for text content using character & word
 * n-grams and uniform cryptographic 64-bit projection with term-frequency weighting.
 */
export function computeSimHash64(text: string): bigint {
  if (!text || typeof text !== 'string') {
    return 0n;
  }

  // Tokenize text into word tokens across Latin, Arabic, and other alphabets
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return 0n;
  }

  // Build term frequency map
  const termFrequencies = new Map<string, number>();
  for (const word of words) {
    termFrequencies.set(word, (termFrequencies.get(word) || 0) + 1);
  }

  // 64-dimensional accumulator vector
  const accumulator = new Int32Array(64);

  for (const [token, freq] of termFrequencies.entries()) {
    // Generate uniform 64-bit hash for token using SHA-256 slice
    const tokenHashBuf = crypto.createHash('sha256').update(token).digest();
    const tokenHash = tokenHashBuf.readBigUInt64BE(0);
    const weight = Math.min(freq, 10); // Cap frequency weight to prevent single-word domination

    for (let b = 0; b < 64; b++) {
      const bitSet = (tokenHash & (1n << BigInt(b))) !== 0n;
      if (bitSet) {
        accumulator[b] += weight;
      } else {
        accumulator[b] -= weight;
      }
    }
  }

  // Form final 64-bit fingerprint
  let fingerprint = 0n;
  for (let b = 0; b < 64; b++) {
    if (accumulator[b] > 0) {
      fingerprint |= (1n << BigInt(b));
    }
  }

  return fingerprint;
}

/**
 * Calculates the Hamming distance (number of differing bits) between two 64-bit BigInts.
 */
export function hammingDistance64(hash1: bigint, hash2: bigint): number {
  let xorBits = hash1 ^ hash2;
  let dist = 0;

  while (xorBits > 0n) {
    dist += Number(xorBits & 1n);
    xorBits >>= 1n;
  }

  return dist;
}

/**
 * Checks whether two 64-bit fingerprints are near-duplicates within the specified threshold.
 * Standard threshold is <= 3 bits difference.
 */
export function isNearDuplicate(hash1: bigint, hash2: bigint, threshold: number = 3): boolean {
  return hammingDistance64(hash1, hash2) <= threshold;
}

export interface DeduplicationStats {
  totalChecked: number;
  urlDuplicates: number;
  exactContentDuplicates: number;
  nearDuplicates: number;
  admitted: number;
}

/**
 * Multi-Level Deduplication Engine
 *
 * Coordinates Level 1 (Canonical URL), Level 2 (Exact SHA-256), and Level 3 (64-bit SimHash)
 * deduplication checks across large-scale source ingestion runs.
 */
export class DeduplicationEngine {
  private seenCanonicalUrls = new Set<string>();
  private seenExactHashes = new Set<string>();
  private seenSimHashes: bigint[] = [];

  private stats: DeduplicationStats = {
    totalChecked: 0,
    urlDuplicates: 0,
    exactContentDuplicates: 0,
    nearDuplicates: 0,
    admitted: 0
  };

  /**
   * Checks whether a URL has already been admitted or seen in canonical form (Level 1).
   */
  public checkUrl(url: string): { isDuplicate: boolean; canonicalUrl: string; reason?: 'url_seen' } {
    this.stats.totalChecked++;
    const canonicalUrl = normalizeCanonicalUrl(url);
    if (this.seenCanonicalUrls.has(canonicalUrl)) {
      this.stats.urlDuplicates++;
      return { isDuplicate: true, canonicalUrl, reason: 'url_seen' };
    }
    return { isDuplicate: false, canonicalUrl };
  }

  /**
   * Atomically checks and claims a canonical URL prior to scraping.
   * If URL was already claimed or seen, returns { claimed: false, canonicalUrl }.
   * If fresh, registers it into seen set and returns { claimed: true, canonicalUrl }.
   */
  public claimUrl(url: string): { claimed: boolean; canonicalUrl: string } {
    this.stats.totalChecked++;
    const canonicalUrl = normalizeCanonicalUrl(url);
    if (this.seenCanonicalUrls.has(canonicalUrl)) {
      this.stats.urlDuplicates++;
      return { claimed: false, canonicalUrl };
    }
    this.seenCanonicalUrls.add(canonicalUrl);
    return { claimed: true, canonicalUrl };
  }

  /**
   * Releases a claimed URL if a fetch operation fails or aborts.
   */
  public releaseUrl(canonicalUrl: string): void {
    this.seenCanonicalUrls.delete(canonicalUrl);
  }

  /**
   * Checks whether content is an exact (Level 2) or near-duplicate (Level 3) of already admitted pages.
   */
  public checkContent(
    content: string
  ): {
    isDuplicate: boolean;
    reason?: 'exact_sha256' | 'simhash_near_duplicate';
    hammingDistance?: number;
  } {
    // Level 2: Exact SHA-256
    const exactHash = computeExactHash(content);
    if (this.seenExactHashes.has(exactHash)) {
      return {
        isDuplicate: true,
        reason: 'exact_sha256'
      };
    }

    // Level 3: SimHash Near-Duplicate
    const simHash = computeSimHash64(content);
    for (const existingFingerprint of this.seenSimHashes) {
      const distance = hammingDistance64(simHash, existingFingerprint);
      if (distance <= 3) {
        return {
          isDuplicate: true,
          reason: 'simhash_near_duplicate',
          hammingDistance: distance
        };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Admits content into deduplication indexes if unique, or updates duplicate statistics.
   */
  public admitContent(
    canonicalUrl: string,
    content: string
  ): {
    admitted: boolean;
    reason?: 'exact_sha256' | 'simhash_near_duplicate';
    hammingDistance?: number;
  } {
    const contentCheck = this.checkContent(content);
    if (contentCheck.isDuplicate) {
      if (contentCheck.reason === 'exact_sha256') {
        this.stats.exactContentDuplicates++;
      } else {
        this.stats.nearDuplicates++;
      }
      return {
        admitted: false,
        reason: contentCheck.reason,
        hammingDistance: contentCheck.hammingDistance
      };
    }

    this.seenCanonicalUrls.add(canonicalUrl);
    this.seenExactHashes.add(computeExactHash(content));
    this.seenSimHashes.push(computeSimHash64(content));
    this.stats.admitted++;

    return { admitted: true };
  }

  /**
   * Evaluates all 3 deduplication levels and admits the page if unique.
   */
  public admit(
    url: string,
    content: string
  ): {
    admitted: boolean;
    reason?: 'url_seen' | 'exact_sha256' | 'simhash_near_duplicate';
    canonicalUrl: string;
    hammingDistance?: number;
  } {
    this.stats.totalChecked++;

    // Level 1 check
    const canonicalUrl = normalizeCanonicalUrl(url);
    if (this.seenCanonicalUrls.has(canonicalUrl)) {
      this.stats.urlDuplicates++;
      return { admitted: false, reason: 'url_seen', canonicalUrl };
    }

    // Content checks (Level 2 & Level 3)
    const contentResult = this.admitContent(canonicalUrl, content);
    if (!contentResult.admitted) {
      // Keep canonical URL registered so repeated calls are pruned at Level 1
      this.seenCanonicalUrls.add(canonicalUrl);
      return {
        admitted: false,
        canonicalUrl,
        reason: contentResult.reason,
        hammingDistance: contentResult.hammingDistance
      };
    }

    return { admitted: true, canonicalUrl };
  }

  /**
   * Returns current deduplication telemetry.
   */
  public getStats(): DeduplicationStats {
    return { ...this.stats };
  }

  /**
   * Resets all state and counters.
   */
  public clear(): void {
    this.seenCanonicalUrls.clear();
    this.seenExactHashes.clear();
    this.seenSimHashes = [];
    this.stats = {
      totalChecked: 0,
      urlDuplicates: 0,
      exactContentDuplicates: 0,
      nearDuplicates: 0,
      admitted: 0
    };
  }
}
