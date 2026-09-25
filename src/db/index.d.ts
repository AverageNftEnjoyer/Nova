import type BetterSqlite3 from "better-sqlite3"

export type Database = BetterSqlite3.Database
export type TxMode = "deferred" | "immediate" | "exclusive"

export interface Migration {
  version: number
  name: string
  /** Empty string (and no `run`) = no-op stub. */
  sql: string
  /**
   * Optional synchronous data step, run after `sql` on the same connection inside the migration's BEGIN IMMEDIATE
   * transaction and tracked by the same meta marker. A throw rolls the whole migration back.
   */
  run?: (db: Database) => void
}

export const DB_FILENAME: "nova.db"
export const LATEST_VERSION: number

/** NOVA_DATA_DIR -> (NOVA_PACKAGED=1 ? %APPDATA%/Nova : <workspaceRoot>/.user). Created if missing. */
export function resolveDataDir(): string
export function resolveWorkspaceRoot(startDir?: string): string

/** Singleton per process (globalThis.__novaDb). Opens <dataDir>/nova.db, applies pragmas, migrates once. */
export function getDb(): Database
export function closeDb(): void
export function openDbAt(filePath: string, opts?: { readonly?: boolean; skipMigrations?: boolean }): Database
/** `migrations` is injectable for tests; defaults to the shipped list. */
export function runMigrations(db: Database, migrations?: readonly Migration[]): { from: number; to: number }

/** Synchronous transaction on the singleton. Default "immediate". Nested calls join via savepoints. */
export function tx<T>(fn: (db: Database) => T, mode?: TxMode): T
/** Same as tx() on an explicit connection (tests, importer). */
export function txOn<T>(db: Database, fn: (db: Database) => T, mode?: TxMode): T

/** UTC ISO-8601; lexicographically comparable. */
export function nowIso(): string

/** kv_state escape hatch. Values must never contain plaintext secrets (nv1: ciphertext only). userId is mandatory. */
export function kvGet(userId: string, namespace: string, key: string): unknown | null
export function kvSet(userId: string, namespace: string, key: string, value: unknown): void
export function kvDelete(userId: string, namespace: string, key: string): boolean
export function kvList(userId: string, namespace: string): { key: string; value: unknown; updatedAt: string }[]

/** Permanently delete every nova.db row scoped to one local user. */
export function purgeLocalUserData(userId: string): Record<string, number>
