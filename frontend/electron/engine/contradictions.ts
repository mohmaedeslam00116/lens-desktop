/**
 * contradictions.ts — LENS contradiction detection & callout seam (Track G, SPEC #155).
 *
 * Pure leaf module (no engine imports): metric-contradiction detection and
 * contradiction-callout formatting/parsing live here so lightweight
 * consumers (the evidence auditor, the renderer-adjacent program) never
 * drag the full synthesis graph — with its model/adapter imports — into
 * their typecheck program. `synthesis.ts` re-exports this surface for
 * backwards compatibility.
 */

/** An empirical contradiction claim between sources. */
export interface ContradictionClaim {
  sourceIndex: number;
  valueOrAssertion: string | number;
  domain?: string;
  context?: string;
}

export interface ContradictionCalloutOptions {
  topicOrMetric: string;
  claims: ContradictionClaim[];
  explanation?: string;
  language?: 'ar' | 'en';
}

export interface ExtractedContradiction {
  rawCallout: string;
  topicOrMetric: string;
  sourceIndices: number[];
  claims: Array<{ index?: number; text: string }>;
  explanation?: string;
}

export interface DetectedContradiction {
  topicOrMetric: string;
  sourceA: { index: number; value: number | string; snippet: string; domain: string };
  sourceB: { index: number; value: number | string; snippet: string; domain: string };
  suggestedExplanation: string;
}

/** Minimal excerpt shape contradiction detection reads (structural — the
 * synthesis `GroundedExcerpt` satisfies it without importing synthesis). */
export interface ContradictionExcerpt {
  index: number;
  text: string;
  sourceDomain: string;
}

/**
 * Helper to construct and format an explicit contradiction callout GFM alert.
 */
export function formatContradictionCallout(options: ContradictionCalloutOptions): string {
  const isAr = options.language === 'ar';
  const alertTitle = isAr
    ? `**تعارض في البيانات ومؤشرات القياس**: ${options.topicOrMetric}`
    : `**Contradiction Callout: Empirical Discrepancy in ${options.topicOrMetric}**`;

  const lines: string[] = [
    '> [!WARNING]',
    `> ${alertTitle}`
  ];

  for (const claim of options.claims) {
    const prefix = isAr ? 'المصدر' : 'Source';
    const domainStr = claim.domain ? ` (\`${claim.domain}\`)` : '';
    const contextStr = claim.context ? ` [${claim.context}]` : '';
    lines.push(`> - ${prefix} [${claim.sourceIndex}]${domainStr}: ${claim.valueOrAssertion}${contextStr}`);
  }

  if (options.explanation) {
    const label = isAr ? 'تحليل التباين والسبب الجذري' : 'Discrepancy Analysis';
    lines.push(`> *${label}*: ${options.explanation}`);
  }

  return lines.join('\n');
}

/**
 * Extracts and parses contradiction callout blocks from generated markdown text.
 */
export function extractContradictionCallouts(markdown: string): ExtractedContradiction[] {
  if (!markdown) return [];

  const results: ExtractedContradiction[] = [];
  // Match full GFM block from > [!WARNING] across all consecutive lines starting with >
  const warningRegex = />\s*\[!WARNING\][^\n]*(?:\n\s*>[^\n]*)*/gi;
  let match: RegExpExecArray | null;

  while ((match = warningRegex.exec(markdown)) !== null) {
    const rawCallout = match[0];
    const bodyLines = rawCallout.split('\n').map(l => l.replace(/^\s*>\s?/, ''));
    const body = bodyLines.join('\n');

    // Check if this warning is a contradiction or discrepancy callout
    const isContradiction = /contradiction|discrepancy|conflict|disagree|تعارض|تباين|اختلاف/i.test(body);
    if (!isContradiction) continue;

    // Extract title
    let topicOrMetric = 'Metric Discrepancy';
    const titleMatch = body.match(/\*\*([^*]+)\*\*/);
    if (titleMatch) {
      topicOrMetric = titleMatch[1].replace(/Contradiction Callout:?|Empirical Discrepancy in |تعارض في البيانات ومؤشرات القياس:?|تعارض في البيانات:?/i, '').trim();
    }

    // Extract source indices cited in this callout
    const sourceIndices: number[] = [];
    const bracketRegex = /\[(\d+)\]/g;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = bracketRegex.exec(body)) !== null) {
      const idx = parseInt(bMatch[1], 10);
      if (!sourceIndices.includes(idx)) sourceIndices.push(idx);
    }

    // Extract claims
    const claims: Array<{ index?: number; text: string }> = [];
    for (const line of bodyLines) {
      const claimMatch = line.match(/^-\s*(.*)/);
      if (claimMatch) {
        const text = claimMatch[1].trim();
        const idxMatch = text.match(/\[(\d+)\]/);
        claims.push({
          index: idxMatch ? parseInt(idxMatch[1], 10) : undefined,
          text
        });
      }
    }

    // Extract explanation
    let explanation: string | undefined = undefined;
    const expMatch = body.match(/\*(?:Discrepancy Analysis|تحليل التباين)[^*]*\*:?\s*([^\n]+)/i);
    if (expMatch) {
      explanation = expMatch[1].trim();
    }

    results.push({
      rawCallout,
      topicOrMetric,
      sourceIndices,
      claims,
      explanation
    });
  }

  return results;
}

/**
 * Heuristically detects potential numerical metric contradictions between admitted excerpts.
 */
export function detectMetricContradictions(excerpts: ContradictionExcerpt[]): DetectedContradiction[] {
  const contradictions: DetectedContradiction[] = [];
  if (excerpts.length < 2) return contradictions;

  // Patterns for metric keywords and associated numerical values
  const metricKeywords = [
    { key: 'throughput', regex: /(\d+(?:\.\d+)?)\s*(?:tokens\/sec|req\/sec|qps|rps)/i },
    { key: 'latency', regex: /(\d+(?:\.\d+)?)\s*(?:ms|milliseconds|µs|microseconds|s)/i },
    { key: 'accuracy', regex: /(\d+(?:\.\d+)?)\s*%/i },
    { key: 'error rate', regex: /(\d+(?:\.\d+)?)\s*%/i },
    { key: 'coherence time', regex: /(\d+(?:\.\d+)?)\s*(?:µs|microseconds|ms|ns)/i },
    { key: 'parameters', regex: /(\d+(?:\.\d+)?)\s*(?:billion|B|trillion|T|million|M)/i },
    { key: 'cost', regex: /\$\s*(\d+(?:\.\d+)?)\s*(?:M|million|k|B)?/i }
  ];

  for (const { key, regex } of metricKeywords) {
    const hits: Array<{ excerpt: ContradictionExcerpt; value: number; matchStr: string }> = [];

    for (const ex of excerpts) {
      if (new RegExp(key, 'i').test(ex.text)) {
        const m = ex.text.match(regex);
        if (m) {
          const val = parseFloat(m[1]);
          if (!isNaN(val)) {
            hits.push({ excerpt: ex, value: val, matchStr: m[0] });
          }
        }
      }
    }

    // Look for divergent pairs from different domains
    pairSearch:
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i];
        const b = hits[j];

        if (a.excerpt.sourceDomain !== b.excerpt.sourceDomain) {
          const maxVal = Math.max(a.value, b.value);
          const minVal = Math.min(a.value, b.value);
          // If values differ by > 20%
          if (maxVal > 0 && (maxVal - minVal) / maxVal >= 0.20) {
            contradictions.push({
              topicOrMetric: `${key.toUpperCase()} Metric Discrepancy (${a.matchStr} vs ${b.matchStr})`,
              sourceA: {
                index: a.excerpt.index,
                value: a.matchStr,
                snippet: a.excerpt.text.slice(0, 160),
                domain: a.excerpt.sourceDomain
              },
              sourceB: {
                index: b.excerpt.index,
                value: b.matchStr,
                snippet: b.excerpt.text.slice(0, 160),
                domain: b.excerpt.sourceDomain
              },
              suggestedExplanation: `Source [${a.excerpt.index}] (${a.excerpt.sourceDomain}) reports ${a.matchStr}, whereas Source [${b.excerpt.index}] (${b.excerpt.sourceDomain}) reports ${b.matchStr}. Difference likely stems from distinct testing regimes or workload configurations.`
            });
            break pairSearch; // One contradiction per metric keyword is sufficient
          }
        }
      }
    }
  }

  return contradictions;
}
