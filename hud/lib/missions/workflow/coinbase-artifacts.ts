import "server-only"

import crypto from "node:crypto"
import {
  insertArtifactRecord,
  listArtifactRecords,
  pruneExpiredArtifactRecords,
  sanitizeUserContextId,
} from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"

export interface CoinbaseStepArtifactRecord {
  artifactRef: string
  userContextId: string
  conversationId: string
  missionId: string
  missionRunId: string
  stepId: string
  intent: "status" | "price" | "portfolio" | "transactions" | "report"
  createdAt: string
  createdAtMs: number
  ttlMs: number
  summary: string
  output: unknown
  metadata: {
    ok: boolean
    retryCount: number
    errorCode?: string
    quoteCurrency?: string
    assets?: string[]
  }
}

export interface PersistCoinbaseStepArtifactInput {
  userContextId: string
  conversationId: string
  missionId: string
  missionRunId: string
  stepId: string
  intent: CoinbaseStepArtifactRecord["intent"]
  summary: string
  output: unknown
  metadata: CoinbaseStepArtifactRecord["metadata"]
}

const DEFAULT_TTL_MS = (() => {
  const parsed = Number.parseInt(process.env.NOVA_COINBASE_STEP_ARTIFACT_TTL_MS || "", 10)
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 3 * 24 * 60 * 60 * 1000
})()
const MAX_ENTRIES_RETURNED = 8
const MAX_CONTEXT_CHARS_DEFAULT = 12_000

function sanitizeScopeId(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128)
}

function normalizeRecord(record: CoinbaseStepArtifactRecord): CoinbaseStepArtifactRecord | null {
  const artifactRef = sanitizeScopeId(record?.artifactRef)
  const userContextId = sanitizeUserContextId(record?.userContextId)
  if (!artifactRef || !userContextId) return null
  return {
    ...record,
    artifactRef,
    userContextId,
    conversationId: sanitizeScopeId(record.conversationId),
    missionId: sanitizeScopeId(record.missionId),
    missionRunId: sanitizeScopeId(record.missionRunId),
    stepId: sanitizeScopeId(record.stepId),
    summary: String(record.summary || "").trim().slice(0, 4000),
    createdAtMs: Number(record.createdAtMs || 0),
    ttlMs: Number(record.ttlMs || DEFAULT_TTL_MS),
    metadata: {
      ok: Boolean(record.metadata?.ok),
      retryCount: Number(record.metadata?.retryCount || 0),
      errorCode: record.metadata?.errorCode ? String(record.metadata.errorCode) : undefined,
      quoteCurrency: record.metadata?.quoteCurrency ? String(record.metadata.quoteCurrency) : undefined,
      assets: Array.isArray(record.metadata?.assets)
        ? record.metadata.assets.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 12)
        : undefined,
    },
  }
}

export async function persistCoinbaseStepArtifact(
  input: PersistCoinbaseStepArtifactInput,
): Promise<{ artifactRef: string }> {
  const userContextId = sanitizeUserContextId(input.userContextId)
  if (!userContextId) throw new Error("Missing userContextId for Coinbase artifact persistence.")
  const nowMs = Date.now()
  const record: CoinbaseStepArtifactRecord = {
    artifactRef: `cbwf_${nowMs}_${crypto.randomBytes(4).toString("hex")}`,
    userContextId,
    conversationId: sanitizeScopeId(input.conversationId) || "mission",
    missionId: sanitizeScopeId(input.missionId) || "mission",
    missionRunId: sanitizeScopeId(input.missionRunId) || "run",
    stepId: sanitizeScopeId(input.stepId) || "step",
    intent: input.intent,
    createdAt: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    ttlMs: DEFAULT_TTL_MS,
    summary: String(input.summary || "").trim().slice(0, 4000),
    output: input.output,
    metadata: {
      ok: Boolean(input.metadata.ok),
      retryCount: Math.max(0, Number(input.metadata.retryCount || 0)),
      errorCode: input.metadata.errorCode ? String(input.metadata.errorCode).trim() : undefined,
      quoteCurrency: input.metadata.quoteCurrency ? String(input.metadata.quoteCurrency).trim() : undefined,
      assets: Array.isArray(input.metadata.assets)
        ? input.metadata.assets.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 12)
        : undefined,
    },
  }
  insertArtifactRecord(record)
  pruneExpiredArtifactRecords(userContextId, nowMs)
  return { artifactRef: record.artifactRef }
}

export async function loadRecentCoinbaseStepArtifacts(input: {
  userContextId: string
  conversationId?: string
  missionId?: string
  nowMs?: number
  limit?: number
  ttlMs?: number
}): Promise<CoinbaseStepArtifactRecord[]> {
  const uid = sanitizeUserContextId(input.userContextId)
  if (!uid) return []
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now()
  const fallbackTtl = Number(input.ttlMs) > 0 ? Number(input.ttlMs) : DEFAULT_TTL_MS
  const limit = Math.max(1, Math.min(MAX_ENTRIES_RETURNED, Number(input.limit || 4)))
  const conversationId = sanitizeScopeId(input.conversationId)
  const missionId = sanitizeScopeId(input.missionId)
  return (listArtifactRecords(uid, 1000) as CoinbaseStepArtifactRecord[])
    .map(normalizeRecord)
    .filter((record): record is CoinbaseStepArtifactRecord => record !== null)
    .filter((record) => !conversationId || record.conversationId === conversationId)
    .filter((record) => !missionId || record.missionId === missionId)
    .filter((record) => record.createdAtMs + Math.max(0, record.ttlMs || fallbackTtl) >= nowMs)
    .slice(0, limit)
}

export function buildCoinbaseArtifactContextSnippet(input: {
  artifacts: CoinbaseStepArtifactRecord[]
  maxChars?: number
}): string {
  const maxChars = Math.max(800, Number(input.maxChars || MAX_CONTEXT_CHARS_DEFAULT))
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) return ""
  const lines: string[] = []
  for (const item of input.artifacts) {
    lines.push(
      `- [${item.artifactRef}] ${item.intent} @ ${item.createdAt}`,
      `  status=${item.metadata.ok ? "ok" : "error"} retryCount=${item.metadata.retryCount}${item.metadata.errorCode ? ` errorCode=${item.metadata.errorCode}` : ""}`,
      `  summary=${String(item.summary || "").replace(/\s+/g, " ").trim()}`,
    )
  }
  const combined = lines.join("\n")
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...` : combined
}
