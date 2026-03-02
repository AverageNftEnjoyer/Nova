import type { MemoryConfig } from "../../config/types/index.js";
import type { MemoryChunk, SearchResult } from "../types/index.js";
import { expandMemoryQuery, extractMemoryQueryKeywords } from "../query-expansion/index.js";

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(Boolean);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildBm25Scores(query: string, chunks: MemoryChunk[]): Map<string, number> {
  const expandedQuery = expandMemoryQuery(query);
  const terms = tokenize(expandedQuery);
  if (terms.length === 0 || chunks.length === 0) {
    return new Map();
  }

  const k1 = 1.2;
  const b = 0.75;
  const docs = chunks.map((chunk) => ({
    id: chunk.id,
    tokens: tokenize(chunk.content),
  }));
  const avgDocLen = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length;

  const docFreq = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const doc of docs) {
      if (doc.tokens.includes(term)) count += 1;
    }
    docFreq.set(term, count);
  }

  const scores = new Map<string, number>();
  for (const doc of docs) {
    const tf = new Map<string, number>();
    for (const token of doc.tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const term of terms) {
      const f = tf.get(term) ?? 0;
      if (f <= 0) continue;
      const n = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      const denom = f + k1 * (1 - b + b * (doc.tokens.length / Math.max(1, avgDocLen)));
      score += idf * ((f * (k1 + 1)) / Math.max(0.0001, denom));
    }
    scores.set(doc.id, score);
  }

  const maxScore = Math.max(0, ...scores.values());
  if (maxScore > 0) {
    for (const [id, score] of scores.entries()) {
      scores.set(id, score / maxScore);
    }
  }
  return scores;
}

function computeKeywordCoverageScore(query: string, content: string): number {
  const keywords = extractMemoryQueryKeywords(query);
  if (keywords.length === 0) return 0;
  const contentTokens = new Set(tokenize(content));
  if (contentTokens.size === 0) return 0;
  let matches = 0;
  for (const keyword of keywords) {
    if (contentTokens.has(keyword)) matches += 1;
  }
  return matches / Math.max(1, keywords.length);
}

function computePhraseBoost(query: string, content: string): number {
  const normalizedQuery = String(query || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedQuery.length < 8) return 0;
  const normalizedContent = String(content || "").toLowerCase().replace(/\s+/g, " ");
  return normalizedContent.includes(normalizedQuery) ? 0.2 : 0;
}

export function hybridSearch(
  query: string,
  queryEmbedding: number[],
  chunks: MemoryChunk[],
  config: MemoryConfig,
): SearchResult[] {
  if (chunks.length === 0) return [];
  const bm25 = buildBm25Scores(query, chunks);

  const merged = chunks.map((chunk) => {
    const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    const bm25Score = bm25.get(chunk.id) ?? 0;
    const keywordCoverage = computeKeywordCoverageScore(query, chunk.content);
    const phraseBoost = computePhraseBoost(query, chunk.content);
    const lexicalScore = Math.max(
      0,
      Math.min(1.25, bm25Score + keywordCoverage * 0.35 + phraseBoost),
    );
    const score =
      vectorScore * config.hybridVectorWeight +
      lexicalScore * config.hybridBm25Weight;
    return {
      chunkId: chunk.id,
      source: chunk.source,
      content: chunk.content,
      score,
      vectorScore,
      bm25Score: lexicalScore,
      updatedAt: chunk.updatedAt,
    } satisfies SearchResult;
  });

  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, config.topK));
}
