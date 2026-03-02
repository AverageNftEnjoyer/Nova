import crypto from "node:crypto";
import type Database from "better-sqlite3";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vec;
  return vec.map((value) => value / magnitude);
}

export function buildEmbeddingHash(provider: string, model: string, text: string): string {
  return crypto
    .createHash("sha256")
    .update(`${provider}:${model}:${text}`)
    .digest("hex")
    .slice(0, 16);
}

function serializeEmbedding(embedding: number[]): Buffer {
  return Buffer.from(JSON.stringify(embedding), "utf8");
}

function deserializeEmbedding(raw: Buffer | string): number[] {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((value) => Number(value) || 0);
}

export class LocalEmbeddings implements EmbeddingProvider {
  public async embed(text: string): Promise<number[]> {
    const hash = crypto.createHash("sha256").update(text).digest();
    const vector = Array.from({ length: 256 }, (_, i) => {
      const byte = hash[i % hash.length] ?? 0;
      return (byte / 255) * 2 - 1;
    });
    return normalize(vector);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly db: Database.Database;

  public constructor(params: { apiKey: string; model: string; db: Database.Database }) {
    this.apiKey = params.apiKey;
    this.model = params.model;
    this.db = params.db;
  }

  public async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result ?? [];
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error("OpenAI embedding API key is required for provider=openai.");
    }

    const results: number[][] = Array.from({ length: texts.length }, () => []);
    const misses: Array<{ index: number; hash: string; text: string }> = [];

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i] ?? "";
      const hash = buildEmbeddingHash("openai", this.model, text);
      const row = this.db
        .prepare("SELECT embedding FROM embedding_cache WHERE content_hash = ?")
        .get(hash) as { embedding: Buffer } | undefined;
      if (row?.embedding) {
        results[i] = deserializeEmbedding(row.embedding);
      } else {
        misses.push({ index: i, hash, text });
      }
    }

    if (misses.length === 0) {
      return results;
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: misses.map((item) => item.text),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenAI embeddings request failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const data = payload.data ?? [];
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, provider, model, updated_at) VALUES (?, ?, ?, ?, ?)",
    );

    for (let i = 0; i < misses.length; i += 1) {
      const miss = misses[i];
      if (!miss) continue;
      const embedding = normalize((data[i]?.embedding ?? []).map((value) => Number(value) || 0));
      results[miss.index] = embedding;
      insert.run(miss.hash, serializeEmbedding(embedding), "openai", this.model, Date.now());
    }

    return results;
  }
}

export function createEmbeddingProvider(params: {
  provider: "openai" | "local";
  model: string;
  apiKey: string;
  db: Database.Database;
}): EmbeddingProvider {
  if (params.provider === "local") {
    return new LocalEmbeddings();
  }
  return new OpenAIEmbeddings({ apiKey: params.apiKey, model: params.model, db: params.db });
}

export { deserializeEmbedding, serializeEmbedding };
