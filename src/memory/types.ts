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

export interface Chunk {
  id: string;
  source: string;
  content: string;
  startLine: number;
  endLine: number;
  heading?: string;
}
