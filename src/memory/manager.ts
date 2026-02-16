import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { MemoryConfig } from "../config/types.js";
import { chunkMarkdown } from "./chunker.js";
import { createEmbeddingProvider, deserializeEmbedding, serializeEmbedding } from "./embeddings.js";
import { hybridSearch } from "./hybrid.js";
import { ensureMemorySchema } from "./schema.js";
import type { MemoryChunk, SearchResult } from "./types.js";

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

export class MemoryIndexManager {
  private readonly config: MemoryConfig;
  private readonly db: Database.Database;
  private readonly provider;
  private readonly fileHashes = new Map<string, string>();
  private dirty = true;
  private syncPromise: Promise<void> | null = null;

  public constructor(config: MemoryConfig) {
    this.config = config;
    this.db = new Database(config.dbPath);
    ensureMemorySchema(this.db);
    this.provider = createEmbeddingProvider({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      apiKey: config.embeddingApiKey,
      db: this.db,
    });
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
    const embeddings = await this.provider.embedBatch(chunks.map((chunk) => chunk.content));

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
    this.dirty = false;
  }

  public async search(query: string, topK = this.config.topK): Promise<SearchResult[]> {
    const queryEmbedding = await this.provider.embed(query);
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

    return hybridSearch(query, queryEmbedding, chunks, {
      ...this.config,
      topK,
    });
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
}
