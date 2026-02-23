import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

export interface CoinbaseReportHistoryRow {
  reportRunId: string
  userContextId: string
  reportType: string
  deliveredChannel: string
  deliveredAtMs: number
  createdAtMs: number
  reportHash: string
}

export interface CoinbaseSnapshotRow {
  snapshotId: string
  userContextId: string
  snapshotType: string
  fetchedAtMs: number
  freshnessMs: number
  source: string
  payload: unknown
}

export interface CoinbaseRetentionSettings {
  userContextId: string
  reportRetentionDays: number
  snapshotRetentionDays: number
  transactionRetentionDays: number
  updatedAtMs: number
}

export interface CoinbasePrivacySettings {
  userContextId: string
  showBalances: boolean
  showTransactions: boolean
  requireTransactionConsent: boolean
  transactionHistoryConsentGranted: boolean
  updatedAtMs: number
}

export interface CoinbaseStore {
  close(): void
  listReportHistory(userContextId: string, limit?: number): CoinbaseReportHistoryRow[]
  listSnapshots(userContextId: string, snapshotType?: "spot_price" | "portfolio" | "transactions", limit?: number): CoinbaseSnapshotRow[]
  getRetentionSettings(userContextId: string): CoinbaseRetentionSettings
  setRetentionSettings(input: {
    userContextId: string
    reportRetentionDays?: number
    snapshotRetentionDays?: number
    transactionRetentionDays?: number
  }): CoinbaseRetentionSettings
  pruneForUser(userContextId: string): { reportsDeleted: number; snapshotsDeleted: number }
  appendAuditLog(input: {
    userContextId: string
    eventType: string
    status: "ok" | "error"
    details?: Record<string, unknown>
  }): void
  getPrivacySettings(userContextId: string): CoinbasePrivacySettings
  setPrivacySettings(input: {
    userContextId: string
    showBalances?: boolean
    showTransactions?: boolean
    requireTransactionConsent?: boolean
    transactionHistoryConsentGranted?: boolean
  }): CoinbasePrivacySettings
  purgeUserData(userContextId: string): {
    snapshotsDeleted: number
    reportsDeleted: number
    oauthTokensDeleted: number
    idempotencyDeleted: number
    retentionDeleted: number
    privacyDeleted: number
  }
}

function escapeCsv(value: unknown): string {
  const raw = String(value ?? "")
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, "\"\"")}"`
}

async function resolveCoinbaseDistModulePath(): Promise<string> {
  const cwd = process.cwd()
  const candidates = [
    path.resolve(cwd, "..", "dist", "integrations", "coinbase", "index.js"),
    path.resolve(cwd, "dist", "integrations", "coinbase", "index.js"),
  ]
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // continue
    }
  }
  throw new Error("Coinbase runtime module not found in dist/. Run `npm run build:agent-core` first.")
}

async function loadCoinbaseRuntimeModule(): Promise<{
  CoinbaseDataStore: new (dbPath: string) => CoinbaseStore
  coinbaseDbPathForUserContext: (userContextId: string, workspaceRootInput?: string) => string
}> {
  const modulePath = await resolveCoinbaseDistModulePath()
  // Turbopack cannot statically resolve import(<expression>) in server chunks.
  const runtimeImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>
  const loaded = await runtimeImport(pathToFileURL(modulePath).href)
  return loaded as {
    CoinbaseDataStore: new (dbPath: string) => CoinbaseStore
    coinbaseDbPathForUserContext: (userContextId: string, workspaceRootInput?: string) => string
  }
}

export async function createCoinbaseStore(userContextId: string): Promise<CoinbaseStore> {
  const workspaceRoot = path.resolve(process.cwd(), "..")
  const runtime = await loadCoinbaseRuntimeModule()
  return new runtime.CoinbaseDataStore(runtime.coinbaseDbPathForUserContext(userContextId, workspaceRoot))
}

export function reportsToCsv(rows: CoinbaseReportHistoryRow[]): string {
  const header = [
    "reportRunId",
    "userContextId",
    "reportType",
    "deliveredChannel",
    "deliveredAtMs",
    "createdAtMs",
    "reportHash",
  ]
  const lines = [header.join(",")]
  for (const row of rows) {
    lines.push([
      escapeCsv(row.reportRunId),
      escapeCsv(row.userContextId),
      escapeCsv(row.reportType),
      escapeCsv(row.deliveredChannel),
      escapeCsv(row.deliveredAtMs),
      escapeCsv(row.createdAtMs),
      escapeCsv(row.reportHash),
    ].join(","))
  }
  return `${lines.join("\n")}\n`
}

export function transactionsToCsv(rows: CoinbaseSnapshotRow[]): string {
  const header = [
    "snapshotId",
    "userContextId",
    "snapshotType",
    "fetchedAtMs",
    "freshnessMs",
    "source",
    "payloadJson",
  ]
  const lines = [header.join(",")]
  for (const row of rows) {
    lines.push([
      escapeCsv(row.snapshotId),
      escapeCsv(row.userContextId),
      escapeCsv(row.snapshotType),
      escapeCsv(row.fetchedAtMs),
      escapeCsv(row.freshnessMs),
      escapeCsv(row.source),
      escapeCsv(JSON.stringify(row.payload ?? {})),
    ].join(","))
  }
  return `${lines.join("\n")}\n`
}
