/**
 * LENS Deep Research Engine — Reciprocal Rank Fusion (RRF)
 * Implementation of Cormack, Clarke & Büttcher (2009) Multi-System Rank Fusion.
 * Pure TypeScript, robust scoring, zero native dependencies.
 */

export interface RankedItem<T = any> {
  id: string;
  score?: number;
  metadata?: T;
}

export interface RankedList<T = any> {
  name: string;
  weight?: number;
  items: RankedItem<T>[];
}

export interface FusedResult<T = any> {
  id: string;
  score: number;
  ranks: Record<string, number>;
  rawScores: Record<string, number>;
  metadata?: T;
}

export interface RRFOptions {
  k?: number;     // Smoothing constant, default standard is 60
  topK?: number;  // Max results to retain in final output
}

/**
 * Merges multiple ranked lists into a single consensus ranking using Reciprocal Rank Fusion:
 * score(d) = SUM_{m in M} (weight_m / (k + rank_m(d)))
 * 
 * @param rankings Array of named ranked candidate lists
 * @param options Fusion parameters (smoothing k, topK)
 * @returns Sorted array of fused results with per-system rank transparency
 */
export function fuseRankings<T = any>(
  rankings: RankedList<T>[],
  options: RRFOptions = {}
): FusedResult<T>[] {
  const k = typeof options.k === 'number' && options.k > 0 ? options.k : 60;
  const topK = options.topK;

  if (!rankings || rankings.length === 0) {
    return [];
  }

  // Filter out empty lists
  const validRankings = rankings.filter(r => r && Array.isArray(r.items) && r.items.length > 0);
  if (validRankings.length === 0) {
    return [];
  }

  const itemMap = new Map<
    string,
    {
      id: string;
      fusedScore: number;
      ranks: Record<string, number>;
      rawScores: Record<string, number>;
      metadata?: T;
    }
  >();

  for (const list of validRankings) {
    const listName = list.name || 'unnamed';
    const weight = typeof list.weight === 'number' && list.weight > 0 ? list.weight : 1.0;

    list.items.forEach((item, index) => {
      const rank = index + 1; // 1-based rank
      const reciprocalScore = weight / (k + rank);

      let record = itemMap.get(item.id);
      if (!record) {
        record = {
          id: item.id,
          fusedScore: 0,
          ranks: {},
          rawScores: {},
          metadata: item.metadata
        };
        itemMap.set(item.id, record);
      } else if (!record.metadata && item.metadata) {
        record.metadata = item.metadata;
      }

      record.fusedScore += reciprocalScore;
      record.ranks[listName] = rank;
      if (typeof item.score === 'number') {
        record.rawScores[listName] = item.score;
      }
    });
  }

  const results: FusedResult<T>[] = Array.from(itemMap.values()).map(r => ({
    id: r.id,
    score: r.fusedScore,
    ranks: r.ranks,
    rawScores: r.rawScores,
    metadata: r.metadata
  }));

  // Sort descending by fused score
  results.sort((a, b) => b.score - a.score);

  return typeof topK === 'number' && topK > 0 ? results.slice(0, topK) : results;
}
