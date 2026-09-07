/**
 * LENS Deep Research Engine — Pure TypeScript BM25 Search Engine
 * Zero native dependencies, lightweight, production-grade IR indexing
 * with bilingual Arabic + English morphology, normalization, and stopword pruning.
 */

export interface BM25Config {
  k1?: number; // Term frequency saturation parameter (default: 1.2)
  b?: number;  // Document length normalization parameter (default: 0.75)
}

export interface BM25SearchResult<T = any> {
  id: string;
  score: number;
  metadata?: T;
}

// Arabic normalization and light-stemming utilities
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670]/g;
const ARABIC_TATWEEL_REGEX = /\u0640/g;

const ARABIC_STOPWORDS = new Set([
  'في', 'من', 'على', 'إلى', 'عن', 'مع', 'حتى', 'إذا', 'إن', 'أن', 'أو', 'ثم', 'بل',
  'لا', 'ما', 'لم', 'لن', 'ليس', 'ليست', 'كان', 'كانت', 'يكون', 'تكون', 'قد',
  'هذا', 'هذه', 'هذان', 'هاتان', 'هؤلاء', 'ذلك', 'تلك', 'أولئك',
  'الذي', 'التي', 'اللذان', 'اللتان', 'الذين', 'اللاتي', 'اللواتي', 'التي',
  'هو', 'هي', 'هما', 'هم', 'هن', 'أنت', 'أنتم', 'أنتما', 'أنتن', 'أنا', 'نحن',
  'كل', 'بعض', 'غير', 'نفس', 'بين', 'حول', 'تحت', 'فوق', 'أمام', 'خلف',
  'جدا', 'أيضا', 'فقط', 'لكن', 'بينما', 'حيث', 'كيف', 'ماذا', 'لماذا', 'متى', 'أين'
]);

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your',
  'yours', 'yourself', 'yourselves'
]);

/**
 * Normalizes Arabic text:
 * 1. Removes diacritics (tashkeel) and tatweel
 * 2. Normalizes Alef variants (إ, أ, آ, ٱ -> ا)
 * 3. Normalizes Taa Marbuta (ة -> ه)
 * 4. Normalizes Yaa variants (ى -> ي)
 */
export function normalizeArabic(text: string): string {
  if (!text) return '';
  return text
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(ARABIC_TATWEEL_REGEX, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/**
 * Light Arabic stemmer: strips common inflectional prefixes (ال, و, ف, ب, ك, ل)
 * if the remaining stem length meets minimum root length criteria.
 */
export function stemArabicWord(word: string): string {
  if (!word || word.length < 4) return word;

  let stem = word;

  // Strip compound conjunctions + definite article: وال، فال، بال، كال، لل
  if (stem.length >= 5) {
    if (stem.startsWith('وال') || stem.startsWith('فال') || stem.startsWith('بال') || stem.startsWith('كال')) {
      return stem.slice(3);
    }
    if (stem.startsWith('لل')) {
      return stem.slice(2);
    }
  }

  // Strip standard definite article: ال
  if (stem.length >= 4 && stem.startsWith('ال')) {
    stem = stem.slice(2);
  }

  // Strip single-letter prefixes (و, ف, ب) on longer words (>= 5 chars)
  if (stem.length >= 5 && (stem.startsWith('و') || stem.startsWith('ف') || stem.startsWith('ب'))) {
    stem = stem.slice(1);
  }

  return stem;
}

/**
 * Bilingual Tokenizer for Arabic and English:
 * - Extracts Unicode word tokens
 * - Applies language-specific normalization and light stemming
 * - Filters out grammatical stopwords and ultra-short punctuation
 */
export function tokenizeBilingual(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  // Match sequences of letters and digits across scripts (Arabic, Latin, digits)
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  if (!matches) return [];

  const tokens: string[] = [];

  for (const raw of matches) {
    const lower = raw.toLowerCase();

    // Check if token contains Arabic characters
    const isArabic = /[\u0600-\u06FF]/.test(lower);

    if (isArabic) {
      const normalized = normalizeArabic(lower);
      if (ARABIC_STOPWORDS.has(normalized)) continue;
      const stemmed = stemArabicWord(normalized);
      if (stemmed.length > 1) {
        tokens.push(stemmed);
      }
    } else {
      if (ENGLISH_STOPWORDS.has(lower)) continue;
      if (lower.length > 1 || /^\d+$/.test(lower)) {
        tokens.push(lower);
      }
    }
  }

  return tokens;
}

/**
 * In-Memory Okapi BM25 Index with Inverted Posting Lists
 */
export class BM25Index<T = any> {
  private k1: number;
  private b: number;

  // Inverted index: term -> Map<docId, termFrequency>
  private invertedIndex = new Map<string, Map<string, number>>();

  // Document lengths: docId -> length in tokens
  private docLengths = new Map<string, number>();

  // Document registry: docId -> { id, text, metadata }
  private documents = new Map<string, { id: string; text: string; metadata?: T }>();

  // Document frequency: term -> count of docs containing term
  private docFrequencies = new Map<string, number>();

  private totalDocLength = 0;

  constructor(config: BM25Config = {}) {
    this.k1 = typeof config.k1 === 'number' ? config.k1 : 1.2;
    this.b = typeof config.b === 'number' ? config.b : 0.75;
  }

  /**
   * Adds a single document to the index.
   */
  public addDocument(id: string, text: string, metadata?: T): void {
    if (!id || !text) return;

    // If document already exists, remove it first
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    const tokens = tokenizeBilingual(text);
    const docLen = tokens.length;

    this.documents.set(id, { id, text, metadata });
    this.docLengths.set(id, docLen);
    this.totalDocLength += docLen;

    // Calculate term frequencies for this document
    const termCounts = new Map<string, number>();
    for (const t of tokens) {
      termCounts.set(t, (termCounts.get(t) || 0) + 1);
    }

    for (const [term, tf] of termCounts.entries()) {
      let posting = this.invertedIndex.get(term);
      if (!posting) {
        posting = new Map<string, number>();
        this.invertedIndex.set(term, posting);
      }
      posting.set(id, tf);

      this.docFrequencies.set(term, (this.docFrequencies.get(term) || 0) + 1);
    }
  }

  /**
   * Adds multiple documents in bulk.
   */
  public addDocuments(docs: Array<{ id: string; text: string; metadata?: T }>): void {
    for (const doc of docs) {
      this.addDocument(doc.id, doc.text, doc.metadata);
    }
  }

  /**
   * Removes a document by ID.
   */
  public removeDocument(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) return;

    const docLen = this.docLengths.get(id) || 0;
    this.totalDocLength -= docLen;
    this.docLengths.delete(id);
    this.documents.delete(id);

    const tokens = tokenizeBilingual(existing.text);
    const uniqueTerms = new Set(tokens);

    for (const term of uniqueTerms) {
      const posting = this.invertedIndex.get(term);
      if (posting) {
        posting.delete(id);
        if (posting.size === 0) {
          this.invertedIndex.delete(term);
          this.docFrequencies.delete(term);
        } else {
          this.docFrequencies.set(term, posting.size);
        }
      }
    }
  }

  /**
   * Total number of documents indexed.
   */
  public get documentCount(): number {
    return this.documents.size;
  }

  /**
   * Average document length across the indexed collection.
   */
  public get avgDocLength(): number {
    return this.documents.size > 0 ? this.totalDocLength / this.documents.size : 0;
  }

  /**
   * Robertson-Spärck Jones Inverse Document Frequency (IDF) with smoothing.
   */
  public idf(term: string): number {
    const N = this.documents.size;
    const df = this.docFrequencies.get(term) || 0;
    // Standard Lucene/Okapi formula: ln(1 + (N - df + 0.5) / (df + 0.5))
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  /**
   * Scores all documents against a query string using Okapi BM25.
   */
  public search(query: string, topK?: number): Array<BM25SearchResult<T>> {
    if (!query || this.documents.size === 0) return [];

    const queryTokens = tokenizeBilingual(query);
    if (queryTokens.length === 0) return [];

    const N = this.documents.size;
    const avgdl = this.avgDocLength;
    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const posting = this.invertedIndex.get(term);
      if (!posting) continue;

      const termIdf = this.idf(term);
      if (termIdf <= 0) continue;

      for (const [docId, tf] of posting.entries()) {
        const docLen = this.docLengths.get(docId) || avgdl;
        // BM25 term weighting formula
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
        const termScore = termIdf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }

    if (scores.size === 0) return [];

    const results: Array<BM25SearchResult<T>> = [];
    for (const [docId, score] of scores.entries()) {
      const doc = this.documents.get(docId);
      if (doc) {
        results.push({
          id: docId,
          score,
          metadata: doc.metadata
        });
      }
    }

    // Sort by BM25 score descending
    results.sort((a, b) => b.score - a.score);

    return typeof topK === 'number' && topK > 0 ? results.slice(0, topK) : results;
  }
}
