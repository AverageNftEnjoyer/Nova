export interface MemoryChunk {
  id: string;
  source: string;
  content: string;
  embedding: number[];
  contentHash: string;
  updatedAt: number;
}

export interface SearchResult {
  chunkId: string;
  source: string;
  content: string;
  score: number;
  vectorScore: number;
  bm25Score: number;
  updatedAt: number;
}

export type MemorySearchMode = "hybrid" | "fallback-local" | "fallback-lexical";

export interface MemorySearchDiagnostics {
  hasSearch: boolean;
  updatedAtMs: number;
  mode: MemorySearchMode;
  staleSourcesBefore: number;
  staleSourcesAfter: number;
  staleReindexAttempted: boolean;
  staleReindexCompleted: boolean;
  staleReindexTimedOut: boolean;
  fallbackUsed: boolean;
  fallbackReason?: "query-embedding-failed" | "index-embedding-failed" | "stale-index";
  indexFallbackUsed: boolean;
  latencyMs: number;
  resultCount: number;
}

export interface Chunk {
  id: string;
  source: string;
  content: string;
  startLine: number;
  endLine: number;
  heading?: string;
}
