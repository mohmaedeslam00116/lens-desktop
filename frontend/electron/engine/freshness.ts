/**
 * freshness.ts — LENS freshness semantics (Track E, SPEC #155).
 *
 * Pi owns the search MECHANISM (provider transports, recency transports);
 * LENS owns the freshness POLICY: bilingual temporal-intent detection,
 * provider-side recency resolution, date-aware query variants, publishedAt
 * retention/normalization, stale-result penalization in ranking, and
 * claim-level temporal verification before citation.
 *
 * Pure module (no I/O, no imports): every export is a deterministic function
 * of its arguments, pinned by `test/freshness_semantics.test.mjs`. `now`
 * injects as a parameter so tests never depend on wall-clock time.
 */

export type RecencyFilter = 'day' | 'week' | 'month' | 'year';

/** Named bounds for the freshness policy (pinned by the Track E suite). */
export const FRESHNESS_BOUNDS = {
  /** Evidence this fresh (or fresher) keeps full weight under temporal intent. */
  freshWithinDays: 45,
  /** Evidence this fresh keeps near-full weight under temporal intent. */
  recentWithinDays: 120,
  /** Evidence older than this is STALE for temporal claims. */
  staleAfterDays: 180,
  /** Weight of aging (recent-but-not-stale) evidence under temporal intent. */
  agingWeight: 0.75,
  /** Weight of undated evidence under temporal intent (below fresh, above stale). */
  undatedTemporalWeight: 0.9,
  /** Weight of stale evidence under temporal intent. */
  staleTemporalWeight: 0.5,
  /** Timeless queries keep full weight for evidence this fresh. */
  timelessFreshDays: 365,
  /** Timeless queries keep near-full weight for evidence this fresh. */
  timelessAgingDays: 730,
  /** Weight floor for old evidence when the query is timeless. */
  timelessFloorWeight: 0.85,
  /** Cap on date-aware query variants per temporal query. */
  maxDateVariants: 3,
} as const;

export interface TemporalIntent {
  isTemporal: boolean;
  /** The marker(s) that fired, in query order (for telemetry/honesty notes). */
  matchedTerms: string[];
  /** Provider recency the intent suggests (undefined when not temporal). */
  suggestedRecency?: RecencyFilter;
}

interface Marker {
  term: string;
  recency: RecencyFilter;
}

/** English markers, most-urgent first (urgency wins on overlap). */
const EN_MARKERS: Marker[] = [
  { term: 'breaking', recency: 'day' },
  { term: 'today', recency: 'day' },
  { term: 'this week', recency: 'week' },
  { term: 'latest', recency: 'week' },
  { term: 'current', recency: 'week' },
  { term: 'this month', recency: 'month' },
  { term: 'new model', recency: 'month' },
  { term: 'new models', recency: 'month' },
  { term: 'new-model', recency: 'month' },
  { term: 'announcement', recency: 'month' },
  { term: 'announced', recency: 'month' },
  { term: 'recent', recency: 'month' },
  { term: 'recently', recency: 'month' },
  { term: 'update', recency: 'month' },
  { term: 'updates', recency: 'month' },
  { term: 'updated', recency: 'month' },
  { term: 'this year', recency: 'year' },
];

/** Arabic markers (substring match on the raw query — \b is ASCII-only). */
const AR_MARKERS: Marker[] = [
  { term: 'عاجل', recency: 'day' },
  { term: 'اليوم', recency: 'day' },
  { term: 'الآن', recency: 'day' },
  { term: 'هذا الأسبوع', recency: 'week' },
  { term: 'الأحدث', recency: 'week' },
  { term: 'أحدث', recency: 'week' },
  { term: 'الحالي', recency: 'week' },
  { term: 'الحالية', recency: 'week' },
  { term: 'آخر تطورات', recency: 'week' },
  { term: 'آخر المستجدات', recency: 'week' },
  { term: 'هذا الشهر', recency: 'month' },
  { term: 'إعلان', recency: 'month' },
  { term: 'جديد', recency: 'month' },
  { term: 'جديدة', recency: 'month' },
  { term: 'مستجدات', recency: 'month' },
  { term: 'مستجد', recency: 'month' },
  { term: 'تحديثات', recency: 'month' },
  { term: 'تحديث', recency: 'month' },
  { term: 'مؤخرا', recency: 'month' },
  { term: 'مؤخرًا', recency: 'month' },
  { term: 'هذا العام', recency: 'year' },
];

const YEAR_RE = /\b((?:19|20)\d{2})\b/;

const RECENCY_RANK: Record<RecencyFilter, number> = { day: 0, week: 1, month: 2, year: 3 };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects temporal (freshness-seeking) intent in an AR/EN query.
 * Most-urgent marker wins the suggestion (day > week > month > year);
 * an explicit 4-digit year anchors the year window.
 */
export function detectTemporalIntent(query: string): TemporalIntent {
  const text = typeof query === 'string' ? query : '';
  if (!text.trim()) return { isTemporal: false, matchedTerms: [] };
  const matched: Marker[] = [];
  const lower = text.toLowerCase();
  for (const m of EN_MARKERS) {
    const re = new RegExp(`\\b${escapeRegExp(m.term)}\\b`, 'i');
    if (re.test(lower)) matched.push(m);
  }
  for (const m of AR_MARKERS) {
    if (text.includes(m.term) && !matched.some((x) => x.term === m.term)) matched.push(m);
  }
  const yearMatch = YEAR_RE.exec(text);
  if (yearMatch) matched.push({ term: yearMatch[1], recency: 'year' });
  if (matched.length === 0) return { isTemporal: false, matchedTerms: [] };
  // Subsumption dedupe (Track E review): Arabic substring matching fires
  // nested markers (الأحدث⊃أحدث, مستجدات⊃مستجد) — a term subsumed by a
  // longer matched term carries no extra signal, so the longest wins and
  // telemetry/notes stay honest.
  const deduped = matched.filter(
    (m, i) => !matched.some((o, j) => j !== i && o.term !== m.term && o.term.includes(m.term))
  );
  const ranked = [...deduped].sort((a, b) => RECENCY_RANK[a.recency] - RECENCY_RANK[b.recency]);
  return {
    isTemporal: true,
    matchedTerms: ranked.map((m) => m.term),
    suggestedRecency: ranked[0].recency,
  };
}

/**
 * Resolves the provider-side recency for one query: an explicit caller
 * selection always wins (case-insensitive — 'Week' means 'week'); otherwise
 * the temporal intent suggests; timeless queries resolve to undefined —
 * never a silent default scope.
 *
 * Contract (Track E review): `explicit` must be a valid filter when
 * provided — user-facing layers validate first (the tool layer refuses
 * garbage loudly); an unrecognized string falls back to intent rather than
 * inventing scope, so programmatic callers must validate before passing
 * one through.
 */
export function resolveRecencyForQuery(
  query: string,
  explicit?: string
): RecencyFilter | undefined {
  const norm = typeof explicit === 'string' ? explicit.trim().toLowerCase() : '';
  if (norm === 'day' || norm === 'week' || norm === 'month' || norm === 'year') {
    return norm;
  }
  return detectTemporalIntent(query).suggestedRecency;
}

/**
 * Builds date-aware query variants for a temporal query: the base query
 * leads, then a current-year anchor, then a language-local "latest updates"
 * tail. Timeless queries stay single (no fan-out drift). Bounded to
 * FRESHNESS_BOUNDS.maxDateVariants; never duplicates a year already named.
 */
export function buildDateAwareVariants(query: string, now: Date | number = Date.now()): string[] {
  const base = typeof query === 'string' ? query.trim() : '';
  if (!base) return [];
  if (!detectTemporalIntent(base).isTemporal) return [base];
  const year = String(new Date(typeof now === 'number' ? now : now.getTime()).getUTCFullYear());
  const out = [base];
  const hasYear = YEAR_RE.test(base);
  if (!hasYear) out.push(`${base} ${year}`);
  const isArabic = /[\u0600-\u06FF]/.test(base);
  const tail = isArabic ? `${base} آخر التحديثات` : `${base} latest updates`;
  if (!out.includes(tail)) out.push(tail);
  return out.slice(0, FRESHNESS_BOUNDS.maxDateVariants);
}

/**
 * Normalizes a provider-supplied date to ISO, or undefined when the value
 * is missing/unparseable. LENS never invents dates — garbage stays absent.
 */
export function parsePublishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

const DAY_MS = 86400000;

/**
 * Freshness weight multiplier for ranking: fresh temporal evidence keeps
 * its weight, stale temporal evidence is penalized, undated sits between;
 * timeless queries penalize old evidence only mildly. Missing dates are
 * neutral (1.0) outside temporal intent — no penalty without a reason.
 */
export function freshnessMultiplier(
  publishedAt: string | undefined,
  nowMs: number = Date.now(),
  isTemporal = false
): number {
  const ms = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN;
  if (!Number.isFinite(ms)) {
    return isTemporal ? FRESHNESS_BOUNDS.undatedTemporalWeight : 1.0;
  }
  const ageDays = Math.max(0, (nowMs - ms) / DAY_MS);
  // THE stale boundary is FRESHNESS_BOUNDS.staleAfterDays everywhere (Track E
  // review): verifyTemporalGrounding flags past the same horizon the ranker
  // penalizes past — a kept excerpt is never simultaneously "flagged stale".
  if (isTemporal) {
    if (ageDays <= FRESHNESS_BOUNDS.freshWithinDays) return 1.0;
    if (ageDays <= FRESHNESS_BOUNDS.recentWithinDays) return 0.9;
    if (ageDays <= FRESHNESS_BOUNDS.staleAfterDays) return FRESHNESS_BOUNDS.agingWeight;
    return FRESHNESS_BOUNDS.staleTemporalWeight;
  }
  if (ageDays <= FRESHNESS_BOUNDS.timelessFreshDays) return 1.0;
  if (ageDays <= FRESHNESS_BOUNDS.timelessAgingDays) return 0.95;
  return FRESHNESS_BOUNDS.timelessFloorWeight;
}

export interface TemporalExcerpt {
  index: number;
  publishedAt?: string;
}

export interface TemporalGroundingFlag {
  /**
   * Sentence ordinal in the report (0-based). Named distinctly from
   * TemporalExcerpt.index (a 1-based citation id) — the two domains must
   * never be joined (Track E review).
   */
  sentenceIndex: number;
  claim: string;
  citedIndices: number[];
  reason: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Claim-level temporal verification (Track E): every freshness-seeking
 * sentence in the report must cite at least one fresh excerpt. Sentences
 * cited only to stale excerpts (or to nothing / undated-only) are flagged
 * for `source_check` verification before citation — the model re-checks,
 * the tool never silently passes them.
 */
export function verifyTemporalGrounding(
  report: string,
  excerpts: TemporalExcerpt[],
  nowMs: number = Date.now()
): TemporalGroundingFlag[] {
  if (!report || typeof report !== 'string') return [];
  const byIndex = new Map<number, TemporalExcerpt>();
  for (const e of excerpts ?? []) {
    if (e && Number.isInteger(e.index)) byIndex.set(e.index, e);
  }
  const flags: TemporalGroundingFlag[] = [];
  const sentences = splitSentences(report);
  sentences.forEach((sentence, i) => {
    if (!detectTemporalIntent(sentence).isTemporal) return;
    const cited = Array.from(new Set(
      Array.from(sentence.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]))
    )).filter((n) => Number.isInteger(n) && n > 0);
    if (cited.length === 0) {
      flags.push({
        sentenceIndex: i,
        claim: sentence,
        citedIndices: [],
        reason: 'temporal claim without citations — verify via source_check before citing.',
      });
      return;
    }
    const states = cited.map((n) => {
      const excerpt = byIndex.get(n);
      if (!excerpt || !excerpt.publishedAt) return 'undated' as const;
      const ageDays = Math.max(0, (nowMs - Date.parse(excerpt.publishedAt)) / DAY_MS);
      if (!Number.isFinite(ageDays)) return 'undated' as const;
      return ageDays <= FRESHNESS_BOUNDS.staleAfterDays ? 'fresh' as const : 'stale' as const;
    });
    if (states.every((s) => s === 'stale')) {
      flags.push({
        sentenceIndex: i,
        claim: sentence,
        citedIndices: cited,
        reason: `temporal claim cited only to stale excerpts (older than ${FRESHNESS_BOUNDS.staleAfterDays} days) — re-verify via source_check before citing.`,
      });
    } else if (states.every((s) => s !== 'fresh')) {
      flags.push({
        sentenceIndex: i,
        claim: sentence,
        citedIndices: cited,
        reason: 'temporal claim has no dated fresh backing — verify via source_check before citing.',
      });
    }
  });
  return flags;
}
