import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { MemoryConfig } from "../../config/types/index.js";
import { chunkMarkdown } from "../chunker/index.js";
import {
  LocalEmbeddings,
  createEmbeddingProvider,
  deserializeEmbedding,
  serializeEmbedding,
  type EmbeddingProvider,
} from "../embeddings/index.js";
import { hybridSearch } from "../hybrid/index.js";
import { applyMmrRerank } from "../mmr/index.js";
import { expandMemoryQuery } from "../query-expansion/index.js";
import { ensureMemorySchema } from "../schema/index.js";
import { applyTemporalDecayToSearchResults } from "../temporal-decay/index.js";
import type { MemoryChunk, MemorySearchDiagnostics, SearchResult } from "../types/index.js";

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class MemoryIndexManager {
  private readonly config: MemoryConfig;
  private readonly db: Database.Database;
  private readonly provider: EmbeddingProvider;
  private readonly fallbackProvider: EmbeddingProvider;
  private readonly fileHashes = new Map<string, string>();
  private readonly staleReindexBudgetMs: number;
  private readonly staleScanTtlMs: number;
  private dirty = true;
  private syncPromise: Promise<void> | null = null;
  private staleReindexPromise: Promise<void> | null = null;
  private staleScanCache: { atMs: number; sources: string[] } = { atMs: 0, sources: [] };
  private indexFallbackCount = 0;
  private lastSearchDiagnosticsById = new Map<string, MemorySearchDiagnostics>();
  private lastSearchDiagnostics: MemorySearchDiagnostics = {
    hasSearch: false,
    updatedAtMs: 0,
    mode: "hybrid",
    staleSourcesBefore: 0,
    staleSourcesAfter: 0,
    staleReindexAttempted: false,
    staleReindexCompleted: false,
    staleReindexTimedOut: false,
    fallbackUsed: false,
    indexFallbackUsed: false,
    latencyMs: 0,
    resultCount: 0,
  };

  public constructor(
    config: MemoryConfig,
    deps?: {
      provider?: EmbeddingProvider;
      fallbackProvider?: EmbeddingProvider;
      staleReindexBudgetMs?: number;
      staleScanTtlMs?: number;
    },
  ) {
    this.config = config;
    this.db = new Database(config.dbPath);
    ensureMemorySchema(this.db);
    this.provider =
      deps?.provider ??
      createEmbeddingProvider({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      apiKey: config.embeddingApiKey,
      db: this.db,
    });
    this.fallbackProvider = deps?.fallbackProvider ?? new LocalEmbeddings();
    this.staleReindexBudgetMs = Math.max(
      0,
      Number(deps?.staleReindexBudgetMs ?? envNumber("NOVA_MEMORY_STALE_REINDEX_BUDGET_MS", 250)),
    );
    this.staleScanTtlMs = Math.max(0, Number(deps?.staleScanTtlMs ?? envNumber("NOVA_MEMORY_STALE_SCAN_TTL_MS", 5000)));
  }

  private emitDegradedEvent(event: {
    phase: "index" | "search";
    reason: "query-embedding-failed" | "index-embedding-failed" | "stale-index";
    mode: "fallback-local" | "fallback-lexical";
    detail: string;
  }): void {
    console.warn(
      `[Memory][degraded] phase=${event.phase} reason=${event.reason} mode=${event.mode} detail=${event.detail}`,
    );
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: boolean; value?: T }> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return { timedOut: false, value: await promise };
    }
    let timer: NodeJS.Timeout | null = null;
    try {
      const result = await Promise.race([
        promise.then((value) => ({ timedOut: false, value })),
        new Promise<{ timedOut: true }>((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
        }),
      ]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private getDistinctSources(): Array<{ source: string; updated_at: number }> {
    return this.db
      .prepare("SELECT source, MAX(updated_at) AS updated_at FROM chunks GROUP BY source")
      .all() as Array<{ source: string; updated_at: number }>;
  }

  private async getStaleSources(force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && this.staleScanTtlMs > 0 && now - this.staleScanCache.atMs <= this.staleScanTtlMs) {
      return [...this.staleScanCache.sources];
    }
    const sources = this.getDistinctSources();
    const stale: string[] = [];
    for (const row of sources) {
      if (!row?.source) continue;
      try {
        const stats = await fs.stat(row.source);
        if (Number(stats.mtimeMs) > Number(row.updated_at || 0) + 1000) {
          stale.push(row.source);
        }
      } catch {
        stale.push(row.source);
      }
    }
    this.staleScanCache = { atMs: now, sources: stale };
    return stale;
  }

  private async embedBatchWithFallback(texts: string[]): Promise<{ vectors: number[][]; mode: "hybrid" | "fallback-local" }> {
    try {
      return { vectors: await this.provider.embedBatch(texts), mode: "hybrid" };
    } catch (error) {
      this.indexFallbackCount += 1;
      this.emitDegradedEvent({
        phase: "index",
        reason: "index-embedding-failed",
        mode: "fallback-local",
        detail: error instanceof Error ? error.name : "unknown_error",
      });
      return {
        vectors: await this.fallbackProvider.embedBatch(texts),
        mode: "fallback-local",
      };
    }
  }

  private async embedQueryWithFallback(query: string): Promise<{
    embedding: number[];
    mode: "hybrid" | "fallback-local" | "fallback-lexical";
    fallbackReason?: "query-embedding-failed";
  }> {
    try {
      return {
        embedding: await this.provider.embed(query),
        mode: "hybrid",
      };
    } catch (error) {
      try {
        this.emitDegradedEvent({
          phase: "search",
          reason: "query-embedding-failed",
          mode: "fallback-local",
          detail: error instanceof Error ? error.name : "unknown_error",
        });
        return {
          embedding: await this.fallbackProvider.embed(query),
          mode: "fallback-local",
          fallbackReason: "query-embedding-failed",
        };
      } catch {
        this.emitDegradedEvent({
          phase: "search",
          reason: "query-embedding-failed",
          mode: "fallback-lexical",
          detail: "all_embedding_providers_failed",
        });
        return {
          embedding: [],
          mode: "fallback-lexical",
          fallbackReason: "query-embedding-failed",
        };
      }
    }
  }

  public async indexDirectory(dir: string): Promise<void> {
    const absDir = path.resolve(dir);
    const files = await walkMarkdownFiles(absDir);
    for (const filePath of files) {
      await this.indexFile(filePath);
    }
    this.dirty = false;
  }

  public async indexFile(filePath: string): Promise<void> {
    const absPath = path.resolve(filePath);
    const content = await fs.readFile(absPath, "utf8");
    const fileHash = hashText(content);
    if (this.fileHashes.get(absPath) === fileHash) {
      return;
    }

    const chunks = chunkMarkdown(content, absPath, this.config.chunkSize, this.config.chunkOverlap);
    const { vectors: embeddings } = await this.embedBatchWithFallback(chunks.map((chunk) => chunk.content));

    const removeStmt = this.db.prepare("DELETE FROM chunks WHERE source = ?");
    const insertStmt = this.db.prepare(
      "INSERT OR REPLACE INTO chunks (id, source, content, embedding, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );

    const transaction = this.db.transaction(() => {
      removeStmt.run(absPath);
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (!chunk) continue;
        const embedding = embeddings[i] ?? [];
        insertStmt.run(
          chunk.id,
          absPath,
          chunk.content,
          serializeEmbedding(embedding),
          hashText(chunk.content),
          Date.now(),
        );
      }
    });
    transaction();

    this.fileHashes.set(absPath, fileHash);
    this.staleScanCache = { atMs: 0, sources: [] };
    this.dirty = false;
  }

  private async ensureStaleReindex(staleSources: string[]): Promise<{ attempted: boolean; completed: boolean; timedOut: boolean }> {
    if (!Array.isArray(staleSources) || staleSources.length === 0) {
      return { attempted: false, completed: false, timedOut: false };
    }
    if (!this.staleReindexPromise) {
      this.staleReindexPromise = (async () => {
        for (const source of staleSources) {
          await this.indexFile(source);
        }
      })().finally(() => {
        this.staleReindexPromise = null;
      });
    }
    const reindexResult = await this.withTimeout(this.staleReindexPromise, this.staleReindexBudgetMs);
    return {
      attempted: true,
      completed: reindexResult.timedOut === false,
      timedOut: reindexResult.timedOut === true,
    };
  }

  public async searchWithDiagnostics(
    query: string,
    topK = this.config.topK,
    searchId?: string,
  ): Promise<{ results: SearchResult[]; diagnostics: MemorySearchDiagnostics; searchId: string }> {
    const startedAt = Date.now();
    const indexFallbackCountAtStart = this.indexFallbackCount;
    const expandedQuery = expandMemoryQuery(query);
    const staleSourcesBefore = await this.getStaleSources();
    let staleReindexAttempted = false;
    let staleReindexCompleted = false;
    let staleReindexTimedOut = false;
    if (staleSourcesBefore.length > 0) {
      this.emitDegradedEvent({
        phase: "search",
        reason: "stale-index",
        mode: "fallback-lexical",
        detail: `sources=${staleSourcesBefore.length}`,
      });
      const reindexState = await this.ensureStaleReindex(staleSourcesBefore);
      staleReindexAttempted = reindexState.attempted;
      staleReindexCompleted = reindexState.completed;
      staleReindexTimedOut = reindexState.timedOut;
    }
    const staleSourcesAfter = await this.getStaleSources(staleReindexAttempted && staleReindexCompleted);
    const queryEmbeddingResult = await this.embedQueryWithFallback(expandedQuery);
    const rows = this.db
      .prepare("SELECT id, source, content, embedding, content_hash, updated_at FROM chunks")
      .all() as Array<{
      id: string;
      source: string;
      content: string;
      embedding: Buffer;
      content_hash: string;
      updated_at: number;
    }>;

    const chunks: MemoryChunk[] = rows.map((row) => ({
      id: row.id,
      source: row.source,
      content: row.content,
      embedding: deserializeEmbedding(row.embedding),
      contentHash: row.content_hash,
      updatedAt: row.updated_at,
    }));

    const requestedTopK = Math.max(1, Number(topK || this.config.topK || 1));
    const candidateTopK = Math.max(requestedTopK, requestedTopK * 4);
    const effectiveConfig =
      queryEmbeddingResult.mode === "fallback-lexical"
        ? {
            ...this.config,
            hybridVectorWeight: 0,
            hybridBm25Weight: 1,
            topK: candidateTopK,
          }
        : {
            ...this.config,
            topK: candidateTopK,
          };

    const merged = hybridSearch(query, queryEmbeddingResult.embedding, chunks, effectiveConfig);

    const decayed = applyTemporalDecayToSearchResults(merged, {
      enabled: true,
      query,
      halfLifeDays: envNumber("NOVA_MEMORY_DECAY_HALF_LIFE_DAYS", 45),
      temporalHalfLifeDays: envNumber("NOVA_MEMORY_DECAY_TEMPORAL_HALF_LIFE_DAYS", 21),
      evergreenHalfLifeDays: envNumber("NOVA_MEMORY_DECAY_EVERGREEN_HALF_LIFE_DAYS", 180),
      minMultiplier: envNumber("NOVA_MEMORY_DECAY_MIN_MULTIPLIER", 0.35),
    });
    const reranked = applyMmrRerank(decayed, {
      enabled: true,
      lambda: envNumber("NOVA_MEMORY_MMR_LAMBDA", 0.72),
      sourcePenaltyWeight: envNumber("NOVA_MEMORY_MMR_SOURCE_PENALTY", 0.12),
      maxPerSourceSoft: envNumber("NOVA_MEMORY_MMR_MAX_PER_SOURCE_SOFT", 2),
    });

    const sliced = reranked.slice(0, requestedTopK);
    const diag: MemorySearchDiagnostics = {
      hasSearch: true,
      updatedAtMs: Date.now(),
      mode: queryEmbeddingResult.mode,
      staleSourcesBefore: staleSourcesBefore.length,
      staleSourcesAfter: staleSourcesAfter.length,
      staleReindexAttempted,
      staleReindexCompleted,
      staleReindexTimedOut,
      fallbackUsed: queryEmbeddingResult.mode !== "hybrid" || staleSourcesAfter.length > 0 || this.indexFallbackCount > indexFallbackCountAtStart,
      ...(queryEmbeddingResult.fallbackReason || staleSourcesAfter.length > 0
        ? {
            fallbackReason: queryEmbeddingResult.fallbackReason ?? (staleSourcesAfter.length > 0 ? "stale-index" : "index-embedding-failed"),
          }
        : {}),
      indexFallbackUsed: this.indexFallbackCount > indexFallbackCountAtStart,
      latencyMs: Date.now() - startedAt,
      resultCount: sliced.length,
    };
    this.lastSearchDiagnostics = { ...diag };
    const resolvedSearchId = String(searchId || crypto.randomUUID());
    this.lastSearchDiagnosticsById.set(resolvedSearchId, { ...diag });
    if (this.lastSearchDiagnosticsById.size > 50) {
      const oldest = this.lastSearchDiagnosticsById.keys().next().value;
      if (oldest) this.lastSearchDiagnosticsById.delete(oldest);
    }
    return { results: sliced, diagnostics: diag, searchId: resolvedSearchId };
  }

  public async search(query: string, topK = this.config.topK): Promise<SearchResult[]> {
    const outcome = await this.searchWithDiagnostics(query, topK);
    return outcome.results;
  }

  public async sync(): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = (async () => {
      for (const sourceDir of this.config.sourceDirs) {
        await this.indexDirectory(sourceDir);
      }
      this.dirty = false;
    })();

    try {
      await this.syncPromise;
    } finally {
      this.syncPromise = null;
    }
  }

  public warmSession(): void {
    if (!this.config.syncOnSessionStart || !this.dirty || this.syncPromise) {
      return;
    }
    void this.sync().catch(() => {
      this.dirty = true;
    });
  }

  public async getSourceContentByChunkId(chunkId: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT source FROM chunks WHERE id = ?")
      .get(chunkId) as { source: string } | undefined;
    if (!row?.source) return null;
    try {
      return await fs.readFile(row.source, "utf8");
    } catch {
      return null;
    }
  }

  public getLastSearchDiagnostics(): MemorySearchDiagnostics {
    return { ...this.lastSearchDiagnostics };
  }

  public getSearchDiagnostics(searchId: string): MemorySearchDiagnostics | null {
    const key = String(searchId || "").trim();
    if (!key) return null;
    const found = this.lastSearchDiagnosticsById.get(key);
    return found ? { ...found } : null;
  }
}
