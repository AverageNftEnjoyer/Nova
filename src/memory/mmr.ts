import type { SearchResult } from "./types.js";

export interface MmrOptions {
  enabled?: boolean;
  lambda?: number;
  sourcePenaltyWeight?: number;
  maxPerSourceSoft?: number;
}

function tokenize(text: string): Set<string> {
  const tokens = String(text || "").toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let intersection = 0;

  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function maxSimilarityToSelected(
  candidate: SearchResult,
  selected: SearchResult[],
  tokenCache: Map<string, Set<string>>,
): number {
  if (selected.length === 0) return 0;
  const candidateKey = `${candidate.chunkId}`;
  const candidateTokens = tokenCache.get(candidateKey) ?? tokenize(candidate.content);
  tokenCache.set(candidateKey, candidateTokens);

  let maxSimilarity = 0;
  for (const item of selected) {
    const itemKey = `${item.chunkId}`;
    const itemTokens = tokenCache.get(itemKey) ?? tokenize(item.content);
    tokenCache.set(itemKey, itemTokens);
    const similarity = jaccardSimilarity(candidateTokens, itemTokens);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }

  return maxSimilarity;
}

export function applyMmrRerank(
  results: SearchResult[],
  options: MmrOptions = {},
): SearchResult[] {
  const enabled = options.enabled ?? true;
  const lambda = Math.max(0, Math.min(1, Number(options.lambda ?? 0.72)));
  const sourcePenaltyWeight = Math.max(0, Math.min(0.5, Number(options.sourcePenaltyWeight ?? 0.12)));
  const maxPerSourceSoft = Math.max(1, Math.trunc(Number(options.maxPerSourceSoft ?? 2)));
  if (!enabled || results.length <= 1) return [...results];

  const maxScore = Math.max(...results.map((result) => result.score));
  const minScore = Math.min(...results.map((result) => result.score));
  const scoreRange = maxScore - minScore;
  const normalizeScore = (score: number): number =>
    scoreRange === 0 ? 1 : (score - minScore) / scoreRange;

  const selected: SearchResult[] = [];
  const remaining = new Set(results);
  const tokenCache = new Map<string, Set<string>>();

  while (remaining.size > 0) {
    let best: SearchResult | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of remaining) {
      const relevance = normalizeScore(candidate.score);
      const diversityPenalty = maxSimilarityToSelected(candidate, selected, tokenCache);
      const sameSourceCount = selected.reduce((count, item) => (
        item.source === candidate.source ? count + 1 : count
      ), 0);
      const sourcePenalty =
        sameSourceCount > 0
          ? sourcePenaltyWeight * sameSourceCount +
            (sameSourceCount >= maxPerSourceSoft ? sourcePenaltyWeight * 0.75 : 0)
          : 0;
      const mmrScore = lambda * relevance - (1 - lambda) * diversityPenalty - sourcePenalty;
      if (
        mmrScore > bestScore ||
        (mmrScore === bestScore && candidate.score > (best?.score ?? Number.NEGATIVE_INFINITY))
      ) {
        best = candidate;
        bestScore = mmrScore;
      }
    }

    if (!best) break;
    selected.push(best);
    remaining.delete(best);
  }

  return selected;
}
