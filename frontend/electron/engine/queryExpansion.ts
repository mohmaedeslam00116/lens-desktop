/**
 * LENS Deep Research Engine — Cross-Lingual Query Expansion
 * Pure TypeScript bidirectional Arabic <-> English terminology extraction,
 * technical acronym resolution, phonetic transliteration, and weighted token expansion
 * for BM25 lexical retrieval across multilingual document collections.
 */

import { normalizeArabic, stemArabicWord, tokenizeBilingual } from './bm25';

export interface ExpansionOptions {
  dictWeight?: number;       // Base weight for dictionary translations (default: 0.6)
  acronymWeight?: number;    // Weight for acronym expansions (default: 0.6)
  translitWeight?: number;   // Weight for phonetic loanword transliterations (default: 0.4)
  originalWeight?: number;   // Weight for original query terms (default: 1.0)
  enableTransliteration?: boolean; // Enable phonetic loanword matching (default: true)
  enableAcronyms?: boolean;        // Enable acronym resolution (default: true)
  maxExpansionsPerTerm?: number;   // Max cross-lingual terms generated per source term (default: 3)
}

export interface ExpandedTerm {
  term: string;
  weight: number;
  source: 'original' | 'dictionary' | 'acronym' | 'transliteration';
}

export interface QueryExpansionTelemetry {
  detectedLanguage: 'ar' | 'en' | 'mixed';
  originalTokensCount: number;
  expandedTermsCount: number;
}

export interface ExpandedQuery {
  originalQuery: string;
  detectedLanguage: 'ar' | 'en' | 'mixed';
  originalTokens: string[];
  expandedTerms: ExpandedTerm[];
  allTerms: ExpandedTerm[];
  fullLexicalQuery: string;
  telemetry: QueryExpansionTelemetry;
}

// ---------------------------------------------------------------------------
// 1. Curated Bidirectional Technical & Scientific Terminology Dictionary
// ---------------------------------------------------------------------------

interface DictEntry {
  ar: string[];
  en: string[];
}

const TECHNICAL_ENTRIES: DictEntry[] = [
  // Artificial Intelligence & Machine Learning
  { ar: ['ذكاء اصطناعي'], en: ['artificial intelligence', 'ai'] },
  { ar: ['تعلم الالة', 'تعلم الاله', 'تعلم الآلة'], en: ['machine learning', 'ml'] },
  { ar: ['تعلم عميق'], en: ['deep learning', 'dl'] },
  { ar: ['شبكات عصبية', 'شبكة عصبية'], en: ['neural networks', 'neural network'] },
  { ar: ['شبكات عصبية التفافية'], en: ['convolutional neural networks', 'cnn'] },
  { ar: ['شبكات عصبية تكرارية'], en: ['recurrent neural networks', 'rnn'] },
  { ar: ['شبكات توليدية تعارضية'], en: ['generative adversarial networks', 'gan'] },
  { ar: ['نماذج لغوية كبيرة', 'نموذج لغوي كبير'], en: ['large language models', 'large language model', 'llm'] },
  { ar: ['توليد معزز بالاسترجاع', 'التوليد المعزز بالاسترجاع', 'التوليد الموجه بالاسترجاع', 'توليد موجه بالاسترجاع'], en: ['retrieval augmented generation', 'rag'] },
  { ar: ['معالجة اللغات الطبيعية'], en: ['natural language processing', 'nlp'] },
  { ar: ['محولات', 'محول', 'ترانسفورمر'], en: ['transformers', 'transformer'] },
  { ar: ['انتباه ذاتي', 'اهتمام ذاتي'], en: ['self attention'] },
  { ar: ['تعلم بالتعزيز', 'التعلم التعزيزي'], en: ['reinforcement learning', 'rl'] },
  { ar: ['رؤية حاسوبية'], en: ['computer vision', 'cv'] },
  { ar: ['تضمينات', 'تضمين', 'متجهات'], en: ['embeddings', 'embedding', 'vectors'] },
  { ar: ['استرجاع المعلومات'], en: ['information retrieval', 'ir'] },
  { ar: ['ضبط دقيق', 'الضبط الدقيق'], en: ['fine tuning'] },
  { ar: ['هندسة التوجيه', 'هندسة المطالبات'], en: ['prompt engineering'] },
  { ar: ['انحدار التدرج'], en: ['gradient descent'] },

  // Quantum Computing & Physics
  { ar: ['حوسبة كمومية', 'حوسبة كمية'], en: ['quantum computing', 'quantum computation'] },
  { ar: ['بت كمومي', 'كيوبت', 'كيوبتات'], en: ['qubit', 'quantum bit', 'qubits'] },
  { ar: ['تشابك كمومي'], en: ['quantum entanglement'] },
  { ar: ['تراكب كمومي'], en: ['quantum superposition'] },
  { ar: ['تصحيح الخطا الكمومي', 'تصحيح الاخطاء الكمومية', 'تصحيح خطأ كمومي', 'تصحيح الخطأ الكمومي'], en: ['quantum error correction', 'qec'] },
  { ar: ['حوسبة فائقة التوصيل'], en: ['superconducting computing', 'superconducting circuits'] },
  { ar: ['ترانزمون', 'ترانسمون'], en: ['transmon'] },
  { ar: ['خوارزمية شور', 'خوارزميه شور'], en: ['shor algorithm', 'shors algorithm'] },
  { ar: ['خوارزمية غروفر', 'خوارزميه غروفر'], en: ['grover algorithm'] },
  { ar: ['بوابات كمومية', 'بوابة كمومية'], en: ['quantum gates', 'quantum gate'] },
  { ar: ['محاكاة كمومية'], en: ['quantum simulation'] },
  { ar: ['تفوق كمومي'], en: ['quantum supremacy'] },

  // Cybersecurity, Cryptography & Systems
  { ar: ['تشفير ما بعد الكوانتم', 'تشفير ما بعد الكم', 'تشفير بعد كمومي'], en: ['post quantum cryptography', 'pqc'] },
  { ar: ['امن سيبراني', 'امن المعلومات'], en: ['cybersecurity', 'information security'] },
  { ar: ['تشفير متماثل'], en: ['symmetric encryption'] },
  { ar: ['تشفير متجانس', 'تشفير شكلي'], en: ['homomorphic encryption'] },
  { ar: ['تشفير غير متماثل'], en: ['asymmetric encryption', 'public key encryption'] },
  { ar: ['براهين المعرفة الصفرية', 'برهان المعرفة الصفرية'], en: ['zero knowledge proofs', 'zero knowledge proof', 'zkp'] },
  { ar: ['سلسلة الكتل', 'بلوكتشين'], en: ['blockchain'] },
  { ar: ['عقود ذكية'], en: ['smart contracts', 'smart contract'] },
  { ar: ['قواعد بيانات', 'قاعدة بيانات'], en: ['databases', 'database'] },
  { ar: ['حوسبة سحابية'], en: ['cloud computing'] },
  { ar: ['انظمة موزعة', 'نظام موزع'], en: ['distributed systems', 'distributed system'] },
  { ar: ['خوارزمية', 'خوارزميات'], en: ['algorithm', 'algorithms'] },
  { ar: ['بنية البيانات', 'هياكل البيانات'], en: ['data structures', 'data structure'] },
  { ar: ['واجهة برمجة التطبيقات'], en: ['application programming interface', 'api'] },

  // Medicine, Biology & Genetics
  { ar: ['تسلسل الحمض النووي'], en: ['dna sequencing'] },
  { ar: ['حمض نووي'], en: ['dna', 'nucleic acid'] },
  { ar: ['تعديل جيني', 'تعديل الجينات'], en: ['gene editing', 'genome editing', 'crispr'] },
  { ar: ['علم الاوبئة'], en: ['epidemiology'] },
  { ar: ['التصوير بالرنين المغناطيسي', 'رنين مغناطيسي'], en: ['magnetic resonance imaging', 'mri'] },
  { ar: ['تصوير مقطعي'], en: ['computed tomography', 'ct scan'] },
  { ar: ['لقاح', 'لقاحات'], en: ['vaccine', 'vaccines'] },
  { ar: ['تعبير جيني'], en: ['gene expression'] },
  { ar: ['تفاعل البوليميراز المتسلسل'], en: ['polymerase chain reaction', 'pcr'] },
  { ar: ['مستقبلات بروتينية'], en: ['protein receptors'] },
  { ar: ['طي البروتين'], en: ['protein folding'] },

  // Mathematics & Statistics
  { ar: ['توزيع احتمالي'], en: ['probability distribution'] },
  { ar: ['تحليل احصائي'], en: ['statistical analysis'] },
  { ar: ['جبر خطي'], en: ['linear algebra'] },
  { ar: ['انحدار لوجستي'], en: ['logistic regression'] },
  { ar: ['انحدار خطي'], en: ['linear regression'] },
  { ar: ['تحسين عددي'], en: ['numerical optimization'] }
];

/**
 * Normalizes and stems an Arabic phrase into consecutive normalized root tokens
 * so definite articles ('ال') and inflections don't block dictionary matching.
 */
export function stemAndNormalizeArabicPhrase(phrase: string): string {
  if (!phrase) return '';
  const norm = normalizeArabic(phrase.toLowerCase());
  return norm
    .split(/\s+/)
    .map((w) => stemArabicWord(w))
    .filter(Boolean)
    .join(' ');
}

// Pre-indexed lookup structures: key -> list of translation token sets
const ARABIC_TO_ENGLISH_MAP = new Map<string, string[][]>();
const ENGLISH_TO_ARABIC_MAP = new Map<string, string[][]>();

TECHNICAL_ENTRIES.forEach((entry) => {
  const normArPhrases = entry.ar.map((p) => stemAndNormalizeArabicPhrase(p));
  const normEnPhrases = entry.en.map((p) => p.toLowerCase().trim());

  // Arabic -> English
  normArPhrases.forEach((stemmedAr) => {
    if (!stemmedAr) return;
    const existing = ARABIC_TO_ENGLISH_MAP.get(stemmedAr) || [];
    normEnPhrases.forEach((enPhrase) => {
      const tokens = tokenizeBilingual(enPhrase);
      if (tokens.length > 0) existing.push(tokens);
    });
    ARABIC_TO_ENGLISH_MAP.set(stemmedAr, existing);
  });

  // English -> Arabic
  normEnPhrases.forEach((enPhrase) => {
    const existing = ENGLISH_TO_ARABIC_MAP.get(enPhrase) || [];
    normArPhrases.forEach((arPhrase) => {
      const tokens = tokenizeBilingual(arPhrase);
      if (tokens.length > 0) existing.push(tokens);
    });
    ENGLISH_TO_ARABIC_MAP.set(enPhrase, existing);
  });
});

// ---------------------------------------------------------------------------
// 2. Technical Acronym & Abbreviation Resolver
// ---------------------------------------------------------------------------

interface AcronymDef {
  fullEn: string;
  fullAr: string;
}

const TECHNICAL_ACRONYMS: Record<string, AcronymDef> = {
  rag: { fullEn: 'retrieval augmented generation', fullAr: 'توليد معزز بالاسترجاع' },
  llm: { fullEn: 'large language model', fullAr: 'نموذج لغوي كبير' },
  pqc: { fullEn: 'post quantum cryptography', fullAr: 'تشفير ما بعد الكوانتم' },
  qec: { fullEn: 'quantum error correction', fullAr: 'تصحيح الاخطاء الكمومية' },
  cnn: { fullEn: 'convolutional neural network', fullAr: 'شبكات عصبية التفافية' },
  rnn: { fullEn: 'recurrent neural network', fullAr: 'شبكات عصبية تكرارية' },
  gan: { fullEn: 'generative adversarial network', fullAr: 'شبكات توليدية تعارضية' },
  nlp: { fullEn: 'natural language processing', fullAr: 'معالجة اللغات الطبيعية' },
  rl: { fullEn: 'reinforcement learning', fullAr: 'التعلم بالتعزيز' },
  cv: { fullEn: 'computer vision', fullAr: 'رؤية حاسوبية' },
  bert: { fullEn: 'bidirectional encoder representations transformers', fullAr: 'محولات بيرت' },
  gpt: { fullEn: 'generative pre trained transformer', fullAr: 'محولات توليدية مدربة مسبقا' },
  svm: { fullEn: 'support vector machine', fullAr: 'الات دعم المتجهات' },
  mri: { fullEn: 'magnetic resonance imaging', fullAr: 'التصوير بالرنين المغناطيسي' },
  pcr: { fullEn: 'polymerase chain reaction', fullAr: 'تفاعل البوليميراز المتسلسل' },
  dna: { fullEn: 'deoxyribonucleic acid', fullAr: 'حمض نووي' },
  rna: { fullEn: 'ribonucleic acid', fullAr: 'حمض ريبي نووي' },
  crispr: { fullEn: 'clustered regularly interspaced short palindromic repeats', fullAr: 'تعديل جيني كريسبر' },
  api: { fullEn: 'application programming interface', fullAr: 'واجهة برمجة التطبيقات' },
  cpu: { fullEn: 'central processing unit', fullAr: 'وحدة المعالجة المركزية' },
  gpu: { fullEn: 'graphics processing unit', fullAr: 'وحدة معالجة الرسوميات' },
  tpu: { fullEn: 'tensor processing unit', fullAr: 'وحدة معالجة الموترات' },
  iot: { fullEn: 'internet of things', fullAr: 'انترنت الاشياء' }
};

// ---------------------------------------------------------------------------
// 3. Phonetic Loanword & Transliteration Bridge
// ---------------------------------------------------------------------------

const LOANWORD_TRANSLITERATIONS: Record<string, string> = {
  كوانتم: 'quantum',
  كوانتوم: 'quantum',
  كيوبت: 'qubit',
  كيوبتات: 'qubits',
  ترانزمون: 'transmon',
  ترانسمون: 'transmon',
  شور: 'shor',
  غروفر: 'grover',
  بلوكتشين: 'blockchain',
  ترانسفورمر: 'transformer',
  ترانسفورمرز: 'transformers',
  بايثون: 'python',
  تنسرفلو: 'tensorflow',
  بايتورش: 'pytorch',
  بيرت: 'bert',
  خوارزمية: 'algorithm',
  خوارزميات: 'algorithms',
  كلاسيكي: 'classical',
  ديجيتال: 'digital',
  انتروبيا: 'entropy',
  بوليميراز: 'polymerase',
  كريسبر: 'crispr',
  ترانزستور: 'transistor'
};

// Reverse loanword mapping (English -> Arabic)
const REVERSE_LOANWORD_MAP = new Map<string, string>();
Object.entries(LOANWORD_TRANSLITERATIONS).forEach(([ar, en]) => {
  const normAr = normalizeArabic(ar);
  REVERSE_LOANWORD_MAP.set(en.toLowerCase(), normAr);
});

// ---------------------------------------------------------------------------
// 4. Matching Helpers with Word Boundary & Morphological Protection
// ---------------------------------------------------------------------------

/**
 * Checks whether an English term or phrase occurs in query as distinct word(s),
 * preventing short acronyms ('ai', 'ml', 'dl') from erroneously matching inside
 * words like 'blockchain', 'training', or 'failure'.
 */
function matchesEnglishPhrase(queryLower: string, phraseLower: string): boolean {
  if (!queryLower || !phraseLower) return false;
  const escaped = phraseLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  return regex.test(queryLower);
}

/**
 * Checks whether an Arabic stemmed phrase matches a sequence of tokens in the stemmed query.
 */
function matchesStemmedArabic(queryTokens: string[], phraseTokens: string[]): boolean {
  if (phraseTokens.length === 0 || phraseTokens.length > queryTokens.length) return false;

  for (let i = 0; i <= queryTokens.length - phraseTokens.length; i++) {
    let match = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (queryTokens[i + j] !== phraseTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Query Language Detection
// ---------------------------------------------------------------------------

export function detectQueryLanguage(query: string): 'ar' | 'en' | 'mixed' {
  if (!query) return 'en';
  const hasArabic = /[\u0600-\u06FF]/.test(query);
  const hasLatin = /[a-zA-Z]/.test(query);

  if (hasArabic && hasLatin) return 'mixed';
  if (hasArabic) return 'ar';
  return 'en';
}

// ---------------------------------------------------------------------------
// 6. Main Cross-Lingual Query Expansion Engine
// ---------------------------------------------------------------------------

/**
 * Expands technical queries across Arabic and English:
 * 1. Tokenizes original query with language-specific normalization and stopword removal.
 * 2. Matches multi-word domain phrases with morphological stemming and word-boundary safety.
 * 3. Resolves technical acronyms (e.g. RAG, LLM, PQC, QEC) bidirectionally.
 * 4. Bridges curated technical loanwords across Arabic and Latin scripts.
 * 5. Scales multi-token expansion weights so multi-word translations don't overpower primary query terms.
 * 6. Emits structured weighted tokens and telemetry for BM25 weighted search.
 */
export function expandQueryBilingual(
  query: string,
  options: ExpansionOptions = {}
): ExpandedQuery {
  const dictWeight = typeof options.dictWeight === 'number' ? options.dictWeight : 0.6;
  const acronymWeight = typeof options.acronymWeight === 'number' ? options.acronymWeight : 0.6;
  const translitWeight = typeof options.translitWeight === 'number' ? options.translitWeight : 0.4;
  const originalWeight = typeof options.originalWeight === 'number' ? options.originalWeight : 1.0;
  const enableTranslit = options.enableTransliteration !== false;
  const enableAcronyms = options.enableAcronyms !== false;
  const maxExpansionsPerTerm = options.maxExpansionsPerTerm || 3;

  const detectedLanguage = detectQueryLanguage(query);
  const originalTokens = tokenizeBilingual(query);

  const termWeightMap = new Map<string, { weight: number; source: ExpandedTerm['source'] }>();

  // Register original tokens with primary weight (1.0)
  originalTokens.forEach((tok) => {
    termWeightMap.set(tok, { weight: originalWeight, source: 'original' });
  });

  const expandedTerms: ExpandedTerm[] = [];

  const addExpansion = (term: string, weight: number, source: ExpandedTerm['source']) => {
    if (!term || term.length < 2) return;
    const existing = termWeightMap.get(term);
    if (existing) {
      if (weight > existing.weight) {
        existing.weight = weight;
        existing.source = source;
      }
    } else {
      const record = { weight, source };
      termWeightMap.set(term, record);
      expandedTerms.push({
        term,
        get weight() { return record.weight; },
        get source() { return record.source; },
      } as ExpandedTerm);
    }
  };

  /**
   * Adds tokens from an expanded phrase, scaling the per-token weight by 1/sqrt(M)
   * so that long multi-word expansions do not aggregate to overpower primary query terms.
   */
  const addTokenPhrase = (phraseTokens: string[], baseWeight: number, source: ExpandedTerm['source']) => {
    if (!phraseTokens || phraseTokens.length === 0) return;
    const scaledWeight = baseWeight / Math.sqrt(Math.max(1, phraseTokens.length));
    phraseTokens.forEach((tok) => {
      addExpansion(tok, scaledWeight, source);
    });
  };

  // --- Step A: Multi-Word & Unigram Dictionary Matching ---
  const stemmedQueryArTokens = stemAndNormalizeArabicPhrase(query).split(/\s+/).filter(Boolean);
  const queryLowerEn = query.toLowerCase();

  // 1. Search Arabic Dictionary Phrases (morphologically stemmed sequence matching)
  for (const [stemmedArPhrase, enTokenLists] of ARABIC_TO_ENGLISH_MAP.entries()) {
    const phraseTokens = stemmedArPhrase.split(/\s+/).filter(Boolean);
    if (matchesStemmedArabic(stemmedQueryArTokens, phraseTokens)) {
      enTokenLists.slice(0, maxExpansionsPerTerm).forEach((tokens) => {
        addTokenPhrase(tokens, dictWeight, 'dictionary');
      });
    }
  }

  // 2. Search English Dictionary Phrases (word-boundary safe matching)
  for (const [enPhrase, arTokenLists] of ENGLISH_TO_ARABIC_MAP.entries()) {
    if (matchesEnglishPhrase(queryLowerEn, enPhrase)) {
      arTokenLists.slice(0, maxExpansionsPerTerm).forEach((tokens) => {
        addTokenPhrase(tokens, dictWeight, 'dictionary');
      });
    }
  }

  // --- Step B: Technical Acronyms Resolution ---
  if (enableAcronyms) {
    // Check Latin acronyms with word boundaries
    Object.entries(TECHNICAL_ACRONYMS).forEach(([acronym, def]) => {
      if (matchesEnglishPhrase(queryLowerEn, acronym)) {
        addTokenPhrase(tokenizeBilingual(def.fullEn), acronymWeight, 'acronym');
        addTokenPhrase(tokenizeBilingual(def.fullAr), acronymWeight, 'acronym');
      }

      // If full English phrase is present, add acronym and Arabic equivalent
      if (matchesEnglishPhrase(queryLowerEn, def.fullEn.toLowerCase())) {
        addExpansion(acronym, acronymWeight, 'acronym');
        addTokenPhrase(tokenizeBilingual(def.fullAr), acronymWeight, 'acronym');
      }

      // If Arabic phrase is present, add acronym and English full phrase
      const stemmedDefArTokens = stemAndNormalizeArabicPhrase(def.fullAr).split(/\s+/).filter(Boolean);
      if (matchesStemmedArabic(stemmedQueryArTokens, stemmedDefArTokens)) {
        addExpansion(acronym, acronymWeight, 'acronym');
        addTokenPhrase(tokenizeBilingual(def.fullEn), acronymWeight, 'acronym');
      }
    });
  }

  // --- Step C: Phonetic Loanwords Bridge ---
  if (enableTranslit) {
    // 1. Check known loanwords in Arabic
    for (const [arLoan, enWord] of Object.entries(LOANWORD_TRANSLITERATIONS)) {
      const stemmedLoanTokens = stemAndNormalizeArabicPhrase(arLoan).split(/\s+/).filter(Boolean);
      if (matchesStemmedArabic(stemmedQueryArTokens, stemmedLoanTokens)) {
        const enTokens = tokenizeBilingual(enWord);
        addTokenPhrase(enTokens, translitWeight, 'transliteration');
      }
    }

    // 2. Check known loanwords in English
    for (const [enWord, normArLoan] of REVERSE_LOANWORD_MAP.entries()) {
      if (matchesEnglishPhrase(queryLowerEn, enWord)) {
        const arTokens = tokenizeBilingual(normArLoan);
        addTokenPhrase(arTokens, translitWeight, 'transliteration');
      }
    }
  }

  // --- Step D: Construct Aggregate Output ---
  const allTerms: ExpandedTerm[] = Array.from(termWeightMap.entries()).map(([term, data]) => ({
    term,
    weight: Number(data.weight.toFixed(3)),
    source: data.source
  }));

  const fullLexicalQuery = allTerms.map((t) => t.term).join(' ');

  const telemetry: QueryExpansionTelemetry = {
    detectedLanguage,
    originalTokensCount: originalTokens.length,
    expandedTermsCount: expandedTerms.length
  };

  return {
    originalQuery: query,
    detectedLanguage,
    originalTokens,
    expandedTerms,
    allTerms,
    fullLexicalQuery,
    telemetry
  };
}
