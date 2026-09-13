import { tokenizeBilingual } from './bm25';

/**
 * evidenceAuditor.ts — advisory Evidence Auditor (ADR-0010 decision 4,
 * ticket #91).
 *
 * Verifies that every important claim extracted from the synthesized report
 * maps to retrieved sources, producing structured verdicts. **Advisory by
 * default** (ADR-0010 decision 4): verdicts annotate admission and coverage
 * telemetry; gating admission is a settings flag flipped only after the
 * parity harness (#94) proves no coverage regression — so no admission path
 * consults these verdicts.
 *
 * Deterministic verification (no model calls): a claim's bilingual tokens
 * must be supported by the registered evidence — a claim is
 *  - `supported` when enough of its tokens appear across the evidence pool,
 *  - `partially_supported` when only some do,
 *  - `unsupported` otherwise.
 * The engine already trusts `CitationGroundingContract` for stripping
 * hallucinated citations; the auditor's orthogonal lens is *semantic-ish
 * support of claims*, bilingual via the same tokenizer the coverage audit
 * uses (Arabic normalization + light stemming), so verdicts align with
 * `auditEvidenceCoverage` semantics.
 */

/** How much of a claim's token mass the evidence must cover for each
 * verdict. Ratios chosen so routine summary sentences stay `supported`
 * while imports with no counterpart in the evidence surface. */
const SUPPORTED_THRESHOLD = 0.6;
const PARTIAL_THRESHOLD = 0.25;

/** Sentences below this token count are too short to be "important claims"
 * (greetings, transitions, headings). Bounded extraction output. */
const MIN_CLAIM_TOKENS = 4;
/** Hard cap on extracted claims (memory/time boundedness). */
const MAX_CLAIMS = 40;
/** Evidence boundedness: cap how many sources are audited and how much
 * text per source is tokenized, so a huge page collection cannot balloon
 * memory or block the Electron main process. */
const MAX_EVIDENCE_SOURCES = 24;
const MAX_EVIDENCE_CHARS_PER_SOURCE = 8000;

/** A single auditor verdict for one important claim. */
export interface ClaimVerdict {
  /** Index of the claim in the audit's claim list (stable order). */
  index: number;
  claim: string;
  verdict: 'supported' | 'partially_supported' | 'unsupported';
  /** Fraction [0,1] of the claim's tokens found in the evidence pool. */
  supportRatio: number;
  /** Best evidence passage index for this claim (advisory pointer for
   * consumers); -1 when no evidence has any overlap. */
  bestEvidenceIndex: number;
}

/** Structured audit outcome for one completed research run. */
export interface EvidenceAudit {
  verdicts: ClaimVerdict[];
  supported: number;
  partiallySupported: number;
  unsupported: number;
  /** Aggregate [0,1] support across all audited claims. */
  overallSupport: number;
  /** `advisory` today; `gating` arrives only with the post-#94 settings
   * flag (ADR-0010 decision 4). */
  mode: 'advisory' | 'gating';
  language: 'ar' | 'en';
}

export interface AuditOptions {
  language?: 'ar' | 'en';
  /** Escalation seam: advisory by default (ADR-0010 decision 4). */
  mode?: 'advisory' | 'gating';
}

/** Sentence splitting that keeps Arabic sentence boundaries (؟،، ؛ ! .) and
 * de-duplicates headings/blank lines. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extracts the report's important claims: substantive declarative sentences.
 * Deterministic and bounded (≤ MAX_CLAIMS).
 */
export function extractImportantClaims(report: string): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();
  for (const sentence of splitSentences(report)) {
    if (claims.length >= MAX_CLAIMS) break;
    const trimmed = sentence.trim();
    // Headings are never claims — detect them BEFORE any marker stripping,
    // so long headings like "## Executive Summary and Key Metrics" are not
    // audited as claim sentences.
    if (/^#{1,6}\s/.test(trimmed)) continue;
    // Strip only leading blockquote/list markers, not content characters.
    const bare = trimmed
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-+*]|\d+\.)\s+/, '')
      .trim();
    if (!bare || bare.length < 25) continue;
    const tokens = tokenizeBilingual(bare).filter((t) => t.length > 1);
    if (tokens.length < MIN_CLAIM_TOKENS) continue;
    const key = bare.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(bare);
  }
  return claims;
}

/**
 * Audits the report's important claims against the retrieved evidence.
 * Deterministic, offline, bilingual — no model calls.
 */
export function auditEvidenceClaims(
  report: string,
  sources: Array<{ content?: string; passage?: string; snippet?: string; url?: string }>,
  options: AuditOptions = {}
): EvidenceAudit {
  const claims = extractImportantClaims(report);
  // Evidence text pool: one bounded blob per source keeps `bestEvidenceIndex`
  // meaningful for consumers (pointer into the sources array). Sources and
  // per-source text are capped first (memory/time boundedness).
  const evidence = sources
    .slice(0, MAX_EVIDENCE_SOURCES)
    .map((s) =>
      [s.content, s.passage, s.snippet]
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .join('\n')
        .slice(0, MAX_EVIDENCE_CHARS_PER_SOURCE)
    );
  // Precompute each evidence blob's token set once (avoid quadratic
  // re-tokenization across claims).
  const evidenceTokenSets = evidence.map((text) => new Set(tokenizeBilingual(text)));

  const verdicts: ClaimVerdict[] = [];
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const claimTokens = [...new Set(tokenizeBilingual(claim).filter((t) => t.length > 1))];
    const total = claimTokens.length;
    let matched = 0;
    let bestEvidenceIndex = -1;
    let bestBlobMatches = 0;
    for (let j = 0; j < evidenceTokenSets.length; j++) {
      const blob = evidenceTokenSets[j];
      let blobMatches = 0;
      for (const token of claimTokens) {
        if (blob.has(token)) blobMatches += 1;
      }
      if (blobMatches > bestBlobMatches) {
        bestBlobMatches = blobMatches;
        bestEvidenceIndex = j;
      }
    }
    // A claim token counts as matched when ANY evidence blob contains it:
    // support is pooled across the whole evidence set (a claim synthesized
    // from two sources is still supported).
    for (const token of claimTokens) {
      if (evidenceTokenSets.some((blob) => blob.has(token))) matched += 1;
    }
    const supportRatio = total === 0 ? 1 : matched / total;
    const verdict: ClaimVerdict['verdict'] =
      supportRatio >= SUPPORTED_THRESHOLD
        ? 'supported'
        : supportRatio >= PARTIAL_THRESHOLD
          ? 'partially_supported'
          : 'unsupported';
    verdicts.push({ index: i, claim, verdict, supportRatio: Number(supportRatio.toFixed(3)), bestEvidenceIndex });
  }

  const supported = verdicts.filter((v) => v.verdict === 'supported').length;
  const partiallySupported = verdicts.filter((v) => v.verdict === 'partially_supported').length;
  const unsupported = verdicts.filter((v) => v.verdict === 'unsupported').length;
  // No audited claims = no measured support: report 0 (never a false 100%).
  const overallSupport =
    verdicts.length === 0
      ? 0
      : Number((verdicts.reduce((sum, v) => sum + v.supportRatio, 0) / verdicts.length).toFixed(3));

  return {
    verdicts,
    supported,
    partiallySupported,
    unsupported,
    overallSupport,
    mode: options.mode ?? 'advisory',
    language: options.language ?? 'en',
  };
}

/** Bilingual one-line summary of the audit outcome (Arabic uses the LENS
 * voice from BRAND.md — plain, no marketing flourish). */
export function formatAuditSummary(audit: EvidenceAudit): string {
  const total = audit.verdicts.length;
  const pct = Math.round(audit.overallSupport * 100);
  if (audit.language === 'ar') {
    return `تدقيق الأدلة (استشاري): تم دعم ${audit.supported} من ${total} ادعاءً مهمًا بأدلة مسترجعة (${audit.partiallySupported} جزئي، ${audit.unsupported} غير مدعوم)؛ نسبة الدعم ${pct}٪.`;
  }
  return `Evidence audit (advisory): ${audit.supported} of ${total} important claims supported by retrieved evidence (${audit.partiallySupported} partial, ${audit.unsupported} unsupported); overall support ${pct}%.`;
}

/** Bilingual markdown section appended to the report so the report itself
 * surfaces audit outcomes (ticket #91 acceptance criterion). Streamed as a
 * final report_chunk so streamed-vs-final report equality is preserved. */
export function buildAuditSection(audit: EvidenceAudit): string {
  const summary = formatAuditSummary(audit);
  if (audit.language === 'ar') {
    return ["", "", "---", "", "## تدقيق الأدلة", "", summary].join("\n");
  }
  return ["", "", "---", "", "## Evidence Audit", "", summary].join("\n");
}
