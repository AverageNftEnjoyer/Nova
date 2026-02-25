import crypto from "node:crypto"
import path from "node:path"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"

const PENDING_TTL_MS = 120000
const RESULT_TTL_MS = 5 * 60 * 1000
const DATA_FILE_NAME = "mission-build-idempotency.json"
const LOCK_FILE_NAME = "mission-build-idempotency.lock"

function sanitizeScopePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120)
}

function normalizePrompt(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 1200)
}

function computeDeterministicFingerprint(input) {
  const seed = JSON.stringify({
    userContextId: sanitizeScopePart(input.userContextId),
    prompt: normalizePrompt(input.prompt),
    deploy: input.deploy !== false,
    timezone: String(input.timezone || "").trim(),
    enabled: input.enabled !== false,
  })
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveWorkspaceRoot() {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveUserContextRoot() {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context")
}

function resolveScopedDataFile(userContextId) {
  return path.join(resolveUserContextRoot(), sanitizeScopePart(userContextId), DATA_FILE_NAME)
}

function resolveScopedLockFile(userContextId) {
  return path.join(resolveUserContextRoot(), sanitizeScopePart(userContextId), LOCK_FILE_NAME)
}

async function ensureDataFile(userContextId) {
  const file = resolveScopedDataFile(userContextId)
  await mkdir(path.dirname(file), { recursive: true })
  try {
    await readFile(file, "utf8")
  } catch {
    await writeFile(file, "[]", "utf8")
  }
}

async function acquireLock(lockFile, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await mkdir(path.dirname(lockFile), { recursive: true })
      await writeFile(lockFile, `${process.pid}`, { encoding: "utf8", flag: "wx" })
      return async () => {
        try {
          await unlink(lockFile)
        } catch {
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || !String(error.code || "").includes("EEXIST")) throw error
      await sleep(30)
    }
  }
  throw new Error("Failed to acquire mission idempotency lock.")
}

async function withLockedStore(userContextId, action) {
  const scopedUserId = sanitizeScopePart(userContextId)
  if (!scopedUserId) throw new Error("Missing user context id for mission idempotency.")
  await ensureDataFile(scopedUserId)
  const file = resolveScopedDataFile(scopedUserId)
  const lockFile = resolveScopedLockFile(scopedUserId)
  const release = await acquireLock(lockFile)
  try {
    const raw = await readFile(file, "utf8").catch(() => "[]")
    const parsed = JSON.parse(raw)
    const rows = Array.isArray(parsed) ? parsed : []
    const result = await action(rows, scopedUserId)
    if (Array.isArray(result)) {
      await writeFile(file, JSON.stringify(result, null, 2), "utf8")
      return undefined
    }
    if (result && Array.isArray(result.nextRows)) {
      await writeFile(file, JSON.stringify(result.nextRows, null, 2), "utf8")
      return result.value
    }
    return result
  } finally {
    await release()
  }
}

function pruneExpiredRows(rows, nowMs) {
  return rows.filter((entry) => Number(entry?.expiresAt || 0) > nowMs)
}

export function resolveMissionBuildIdempotencyKey(input) {
  const userScope = sanitizeScopePart(input.userContextId)
  // Always use the server-computed fingerprint — never trust client-provided keys,
  // as they could be reused across different prompts to cause dedup collisions.
  const fingerprint = computeDeterministicFingerprint(input)
  return `mission-build:${userScope}:${fingerprint}`
}

export async function reserveMissionBuildRequest(input) {
  const nowMs = Date.now()
  const key = resolveMissionBuildIdempotencyKey(input)
  const userContextId = sanitizeScopePart(input.userContextId)
  return await withLockedStore(userContextId, (rows) => {
    const nextRows = pruneExpiredRows(rows, nowMs)
    const existing = nextRows.find((entry) => String(entry?.key || "") === key)
    if (!existing) {
      nextRows.push({
        key,
        status: "pending",
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: nowMs + PENDING_TTL_MS,
        result: null,
        error: "",
      })
      return {
        nextRows,
        value: {
          status: "started",
          key,
        },
      }
    }
    if (existing.status === "pending") {
      return {
        nextRows,
        value: {
          status: "pending",
          key,
          retryAfterMs: Math.max(250, Math.min(4000, Number(existing.expiresAt || nowMs) - nowMs)),
        },
      }
    }
    if (existing.status === "completed" && existing.result) {
      return {
        nextRows,
        value: {
          status: "completed",
          key,
          result: existing.result,
        },
      }
    }
    return {
      nextRows,
      value: {
        status: "failed",
        key,
        error: String(existing.error || "Mission build previously failed."),
      },
    }
  })
}

export async function finalizeMissionBuildRequest(input) {
  const nowMs = Date.now()
  const scopedUser = String(input.userContextId || "").trim()
  if (!scopedUser || !String(input.key || "").trim()) return
  await withLockedStore(scopedUser, (rows) => {
    const nextRows = pruneExpiredRows(rows, nowMs)
    const index = nextRows.findIndex((entry) => String(entry?.key || "") === String(input.key || ""))
    if (index === -1) return { nextRows, value: undefined }
    nextRows[index] = {
      ...nextRows[index],
      status: input.ok ? "completed" : "failed",
      updatedAt: nowMs,
      expiresAt: nowMs + RESULT_TTL_MS,
      result: input.ok ? input.result : null,
      error: input.ok ? "" : String(input.error || "Mission build failed."),
    }
    return { nextRows, value: undefined }
  })
}
