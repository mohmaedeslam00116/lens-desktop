/**
 * LENS Deep Research Engine — Maximal Marginal Relevance (MMR) & Source Diversity Scorer
 * Zero native C++ dependencies. Pure TypeScript IR diversification engine.
 *
 * Balances semantic relevance against inter-passage redundancy and penalizes
 * excessive domain and source document clustering.
 */

import { computeSimilarity } from './embeddings';
import { tokenizeBilingual } from './bm25';

export interface MMRCandidate<T = any> {
  id: string;
  score: number;             // Relevance score (RRF score, cosine sim, or BM25)
  vector?: number[];         // Dense embedding vector
  content?: string;          // Original passage text
  sourceId?: string | number;// Citation identifier (e.g. 1, 2, 3)
  domain?: string;           // Domain name (e.g. "arxiv.org", "wikipedia.org")
  credibilityScore?: number; // Domain authority / credibility multiplier (0.5 to 1.2)
  metadata?: T;              // Attached metadata (e.g. ChunkRecord)
}

export interface MMROptions {
  lambda?: number;           // Balance: 1.0 = pure relevance, 0.0 = pure novelty. Default: 0.7
  maxPassages?: number;      // Maximum passages to select. Default: 12
  maxPerSource?: number;     // Hard limit per source document. Default: 2
  maxPerDomain?: number;     // Hard limit per domain. Default: 3
  domainDecay?: number;      // Multiplier per selected chunk from same domain. Default: 0.75
  sourceDecay?: number;      // Multiplier per selected chunk from same source. Default: 0.70
  maxContextChars?: number;  // Character budget cap. Default: Infinity
  similarityFn?: (a: MMRCandidate, b: MMRCandidate) => number;
}

export interface MMRResult<T = any> {
  selected: MMRCandidate<T>[];
  metrics: {
    totalCandidates: number;
    selectedCount: number;
    diversityScore: number;  // 1 - mean pairwise similarity of selected passages (0 to 1)
    uniqueDomains: number;
    uniqueSources: number;
    meanPairwiseSim: number;
  };
}

/**
 * Computes Jaccard similarity between two token sets for lexical fallback.
 */
function computeTokenJaccard(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  const [smaller, larger] = tokensA.size < tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];

  for (const token of smaller) {
    if (larger.has(token)) {
      intersection++;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Computes pairwise similarity between two candidates.
 * Uses dense cosine similarity if vectors are present, otherwise falls back to token Jaccard similarity.
 */
export function computeCandidateSimilarity(
  a: MMRCandidate,
  b: MMRCandidate,
  tokenCache?: Map<string, Set<string>>
): number {
  if (a.id === b.id) return 1.0;

  // 1. Vector Cosine Similarity
  if (
    Array.isArray(a.vector) &&
    Array.isArray(b.vector) &&
    a.vector.length > 0 &&
    a.vector.length === b.vector.length
  ) {
    try {
      const cosSim = computeSimilarity(a.vector, b.vector);
      // Cosine can be [-1, 1]; for redundancy penalty, negative correlation is treated as 0 novelty penalty
      return Math.max(0, cosSim);
    } catch {
      // Fall through to lexical similarity
    }
  }

  // 2. Token Jaccard Similarity Fallback
  if (a.content && b.content) {
    let tokensA = tokenCache?.get(a.id);
    if (!tokensA) {
      tokensA = new Set(tokenizeBilingual(a.content));
      tokenCache?.set(a.id, tokensA);
    }

    let tokensB = tokenCache?.get(b.id);
    if (!tokensB) {
      tokensB = new Set(tokenizeBilingual(b.content));
      tokenCache?.set(b.id, tokensB);
    }

    return computeTokenJaccard(tokensA, tokensB);
  }

  return 0;
}

/**
 * Maximal Marginal Relevance (MMR) with Source & Domain Diversity Penalties.
 *
 * Selects an optimal subset S of passages from candidate pool C that maximizes:
 * MMR(d) = [ λ * Rel_norm(d) - (1 - λ) * max_{s in S} Sim(d, s) ] * DomainDecay * SourceDecay * Credibility
 */
export function selectPassagesWithMMR<T = any>(
  candidates: MMRCandidate<T>[],
  options: MMROptions = {}
): MMRResult<T> {
  if (!candidates || candidates.length === 0) {
    return {
      selected: [],
      metrics: {
        totalCandidates: 0,
        selectedCount: 0,
        diversityScore: 1.0,
        uniqueDomains: 0,
        uniqueSources: 0,
        meanPairwiseSim: 0
      }
    };
  }

  const lambda = typeof options.lambda === 'number' ? Math.max(0, Math.min(1, options.lambda)) : 0.7;
  const maxPassages = Math.max(1, options.maxPassages ?? 12);
  const maxPerSource = Math.max(1, options.maxPerSource ?? 2);
  const maxPerDomain = Math.max(1, options.maxPerDomain ?? 3);
  const domainDecay = Math.max(0.1, Math.min(1.0, options.domainDecay ?? 0.75));
  const sourceDecay = Math.max(0.1, Math.min(1.0, options.sourceDecay ?? 0.70));
  const maxContextChars = options.maxContextChars && options.maxContextChars > 0 ? options.maxContextChars : Infinity;

  // 1. Normalize relevance scores to [0, 1] to calibrate against cosine similarity
  // Scaling by maxScore preserves the proportional relevance ratios between candidates
  // rather than artificially flattening the candidate pool.
  let maxScore = 0;
  for (const c of candidates) {
    const s = Number.isFinite(c.score) ? c.score : 0;
    if (s > maxScore) maxScore = s;
  }

  const normalizedScores = new Map<string, number>();
  for (const c of candidates) {
    const s = Number.isFinite(c.score) ? c.score : 0;
    const norm = maxScore > 1e-9 ? Math.max(0, s / maxScore) : 1.0;
    normalizedScores.set(c.id, norm);
  }

  // Token cache for fast lexical Jaccard computations
  const tokenCache = new Map<string, Set<string>>();

  const calcSim = (a: MMRCandidate<T>, b: MMRCandidate<T>): number => {
    if (options.similarityFn) {
      return options.similarityFn(a, b);
    }
    return computeCandidateSimilarity(a, b, tokenCache);
  };

  const selected: MMRCandidate<T>[] = [];
  const remaining = new Set<MMRCandidate<T>>(candidates);
  const domainCounts = new Map<string, number>();
  const sourceCounts = new Map<string | number, number>();
  let currentChars = 0;

  // 2. Iterative Greedy MMR Selection
  while (remaining.size > 0 && selected.length < maxPassages) {
    let bestCandidate: MMRCandidate<T> | null = null;
    let bestScore = -Infinity;

    for (const candidate of remaining) {
      const srcId = candidate.sourceId !== undefined ? candidate.sourceId : candidate.id;
      const dom = (candidate.domain || '').toLowerCase().trim();

      // Check hard caps
      const srcCount = sourceCounts.get(srcId) || 0;
      if (srcCount >= maxPerSource) {
        continue;
      }

      if (dom) {
        const domCount = domainCounts.get(dom) || 0;
        if (domCount >= maxPerDomain) {
          continue;
        }
      }

      // Check context character limit
      const contentLength = candidate.content ? candidate.content.length : 0;
      if (currentChars + contentLength > maxContextChars && selected.length > 0) {
        continue;
      }

      // Relevance term
      const rel = normalizedScores.get(candidate.id) ?? 0;

      // Novelty / Redundancy term (maximum similarity to any already selected candidate)
      let maxSimToSelected = 0;
      if (selected.length > 0) {
        for (const sel of selected) {
          const sim = calcSim(candidate, sel);
          if (sim > maxSimToSelected) {
            maxSimToSelected = sim;
          }
        }
      }

      // Core MMR score
      const mmrCore = lambda * rel - (1 - lambda) * maxSimToSelected;

      // Source and domain diversity multipliers
      const domCount = dom ? (domainCounts.get(dom) || 0) : 0;
      const domMultiplier = Math.pow(domainDecay, domCount);
      const srcMultiplier = Math.pow(sourceDecay, srcCount);

      // Credibility score weighting (defaults to 1.0, clamped between 0.2 and 1.5)
      const rawCred = typeof candidate.credibilityScore === 'number' && Number.isFinite(candidate.credibilityScore)
        ? candidate.credibilityScore
        : 1.0;
      const credMultiplier = Math.max(0.2, Math.min(1.5, rawCred));

      // Effective selection score
      // Base score calibrated with (1 - lambda) offset to ensure positive weighting before decays
      const calibratedScore = (mmrCore + (1 - lambda)) * domMultiplier * srcMultiplier * credMultiplier;

      if (calibratedScore > bestScore) {
        bestScore = calibratedScore;
        bestCandidate = candidate;
      }
    }

    // If no candidate satisfies criteria, break out of loop
    if (!bestCandidate) {
      break;
    }

    selected.push(bestCandidate);
    remaining.delete(bestCandidate);

    // Update tracking structures
    const pickedSrcId = bestCandidate.sourceId !== undefined ? bestCandidate.sourceId : bestCandidate.id;
    sourceCounts.set(pickedSrcId, (sourceCounts.get(pickedSrcId) || 0) + 1);

    const pickedDom = (bestCandidate.domain || '').toLowerCase().trim();
    if (pickedDom) {
      domainCounts.set(pickedDom, (domainCounts.get(pickedDom) || 0) + 1);
    }

    if (bestCandidate.content) {
      currentChars += bestCandidate.content.length;
    }
  }

  // 3. Compute Diversity & Redundancy Metrics across selected set
  let meanPairwiseSim = 0;
  let pairCount = 0;

  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      meanPairwiseSim += calcSim(selected[i], selected[j]);
      pairCount++;
    }
  }

  if (pairCount > 0) {
    meanPairwiseSim = meanPairwiseSim / pairCount;
  }

  const diversityScore = Math.max(0, Math.min(1.0, 1.0 - meanPairwiseSim));
  const uniqueDomains = new Set(selected.map(s => (s.domain || '').toLowerCase().trim()).filter(Boolean)).size;
  const uniqueSources = new Set(selected.map(s => s.sourceId).filter(v => v !== undefined)).size;

  return {
    selected,
    metrics: {
      totalCandidates: candidates.length,
      selectedCount: selected.length,
      diversityScore: Number(diversityScore.toFixed(4)),
      meanPairwiseSim: Number(meanPairwiseSim.toFixed(4)),
      uniqueDomains,
      uniqueSources
    }
  };
}
