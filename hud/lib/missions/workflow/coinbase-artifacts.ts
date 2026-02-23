import "server-only"

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

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

const MAX_FILES_SCANNED = 8
const MAX_ENTRIES_RETURNED = 8
const MAX_CONTEXT_CHARS_DEFAULT = 12_000
const PRUNE_MAX_FILES = 24

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

function sanitizeScopeId(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 128)
}

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveArtifactDir(userContextId: string): string {
  return path.join(
    resolveWorkspaceRoot(),
    ".agent",
    "user-context",
    sanitizeUserContextId(userContextId),
    "missions",
    "coinbase-artifacts",
  )
}

function dayStamp(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function parseArtifactLine(line: string): CoinbaseStepArtifactRecord | null {
  try {
    const parsed = JSON.parse(line) as CoinbaseStepArtifactRecord
    if (!parsed || typeof parsed !== "object") return null
    const artifactRef = sanitizeScopeId(parsed.artifactRef)
    const userContextId = sanitizeUserContextId(parsed.userContextId)
    if (!artifactRef || !userContextId) return null
    return {
      ...parsed,
      artifactRef,
      userContextId,
      conversationId: sanitizeScopeId(parsed.conversationId),
      missionId: sanitizeScopeId(parsed.missionId),
      missionRunId: sanitizeScopeId(parsed.missionRunId),
      stepId: sanitizeScopeId(parsed.stepId),
      summary: String(parsed.summary || "").trim().slice(0, 4000),
      createdAt: String(parsed.createdAt || ""),
      createdAtMs: Number(parsed.createdAtMs || 0),
      ttlMs: Number(parsed.ttlMs || DEFAULT_TTL_MS),
      metadata: {
        ok: Boolean(parsed.metadata?.ok),
        retryCount: Number(parsed.metadata?.retryCount || 0),
        errorCode: parsed.metadata?.errorCode ? String(parsed.metadata.errorCode) : undefined,
        quoteCurrency: parsed.metadata?.quoteCurrency ? String(parsed.metadata.quoteCurrency) : undefined,
        assets: Array.isArray(parsed.metadata?.assets)
          ? parsed.metadata.assets.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
          : undefined,
      },
    }
  } catch {
    return null
  }
}

async function atomicAppendLine(filePath: string, line: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  let current = ""
  try {
    current = await readFile(filePath, "utf8")
  } catch {
    current = ""
  }
  const next = `${current}${line.endsWith("\n") ? line : `${line}\n`}`
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmpPath, next, "utf8")
  await rename(tmpPath, filePath)
}

async function pruneExpiredArtifactsForUser(userContextId: string, nowMs: number): Promise<void> {
  const dir = resolveArtifactDir(userContextId)
  let files: string[] = []
  try {
    files = (await readdir(dir))
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, PRUNE_MAX_FILES)
  } catch {
    return
  }
  for (const fileName of files) {
    const fullPath = path.join(dir, fileName)
    let body = ""
    try {
      body = await readFile(fullPath, "utf8")
    } catch {
      continue
    }
    const lines = body.split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) continue
    const kept: string[] = []
    for (const line of lines) {
      const parsed = parseArtifactLine(line)
      if (!parsed) continue
      const ttlMs = Math.max(0, Number(parsed.ttlMs || DEFAULT_TTL_MS))
      if (parsed.createdAtMs + ttlMs < nowMs) continue
      kept.push(JSON.stringify(parsed))
    }
    if (kept.length === lines.length) continue
    const tmpPath = `${fullPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
    await writeFile(tmpPath, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8")
    await rename(tmpPath, fullPath)
  }
}

export async function persistCoinbaseStepArtifact(input: PersistCoinbaseStepArtifactInput): Promise<{ artifactRef: string }> {
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
        ? input.metadata.assets.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
        : undefined,
    },
  }
  const filePath = path.join(resolveArtifactDir(userContextId), `${dayStamp(nowMs)}.jsonl`)
  await atomicAppendLine(filePath, JSON.stringify(record))
  // Best-effort retention enforcement; runs post-write and never blocks callers on error.
  await pruneExpiredArtifactsForUser(userContextId, nowMs).catch(() => {})
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
  const userContextId = sanitizeUserContextId(input.userContextId)
  if (!userContextId) return []
  const dir = resolveArtifactDir(userContextId)
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now()
  const ttlMs = Number.isFinite(Number(input.ttlMs)) && Number(input.ttlMs) > 0 ? Number(input.ttlMs) : DEFAULT_TTL_MS
  const limit = Math.max(1, Math.min(MAX_ENTRIES_RETURNED, Number(input.limit || 4)))
  const conversationId = sanitizeScopeId(input.conversationId)
  const missionId = sanitizeScopeId(input.missionId)
  let files: string[] = []
  try {
    files = (await readdir(dir))
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, MAX_FILES_SCANNED)
  } catch {
    return []
  }
  const out: CoinbaseStepArtifactRecord[] = []
  for (const fileName of files) {
    if (out.length >= limit) break
    const fullPath = path.join(dir, fileName)
    let body = ""
    try {
      body = await readFile(fullPath, "utf8")
    } catch {
      continue
    }
    const lines = body.split(/\r?\n/).filter(Boolean).reverse()
    for (const line of lines) {
      const parsed = parseArtifactLine(line)
      if (!parsed) continue
      if (parsed.userContextId !== userContextId) continue
      if (conversationId && parsed.conversationId && parsed.conversationId !== conversationId) continue
      if (missionId && parsed.missionId && parsed.missionId !== missionId) continue
      if (parsed.createdAtMs + Math.max(0, parsed.ttlMs || ttlMs) < nowMs) continue
      out.push(parsed)
      if (out.length >= limit) break
    }
  }
  return out
}

export function buildCoinbaseArtifactContextSnippet(input: {
  artifacts: CoinbaseStepArtifactRecord[]
  maxChars?: number
}): string {
  const maxChars = Math.max(800, Number(input.maxChars || MAX_CONTEXT_CHARS_DEFAULT))
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) return ""
  const lines: string[] = []
  for (const item of input.artifacts) {
    const header = `- [${item.artifactRef}] ${item.intent} @ ${item.createdAt}`
    const status = `  status=${item.metadata.ok ? "ok" : "error"} retryCount=${item.metadata.retryCount}${item.metadata.errorCode ? ` errorCode=${item.metadata.errorCode}` : ""}`
    const summary = `  summary=${String(item.summary || "").replace(/\s+/g, " ").trim()}`
    lines.push(header, status, summary)
  }
  const combined = lines.join("\n")
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...` : combined
}
