import type Database from "better-sqlite3";

export function ensureMemorySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      content_hash TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
