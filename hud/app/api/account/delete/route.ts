import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import path from "node:path"
import { rm } from "node:fs/promises"

import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { createCoinbaseStore } from "@/lib/coinbase/reporting"
import { getDb, purgeLocalUserData, resolveDataDir } from "../../../../../src/db/index.js"
import { deleteWorktree } from "@/lib/git/worktree-manager"

export const runtime = "nodejs"

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

async function pruneLocalUserArtifacts(dataDir: string, userId: string): Promise<void> {
  const userContextId = normalizeUserContextId(userId)
  if (!userContextId) return
  const userContextPath = path.join(dataDir, "user-context", userContextId)
  const taskAttachmentsPath = path.join(dataDir, "agent-task-files", userContextId)
  await Promise.all([
    rm(userContextPath, { recursive: true, force: true }).catch(() => {}),
    rm(taskAttachmentsPath, { recursive: true, force: true }).catch(() => {}),
  ])
}

async function revokeAndCleanAgentTasks(userId: string): Promise<void> {
  const db = getDb()
  const rows = db.prepare(
    "SELECT id FROM agent_tasks WHERE user_id = ?",
  ).all(userId) as Array<{ id: string }>
  if (rows.length === 0) return

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE agent_tasks
     SET status = 'cancelled',
         deleted_at = COALESCE(deleted_at, ?),
         completed_at = COALESCE(completed_at, ?),
         updated_at = ?
     WHERE user_id = ?`,
  ).run(now, now, now, userId)

  const releaseExpiredLeases = (): void => {
    const current = new Date().toISOString()
    db.prepare(
      `UPDATE agent_tasks
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE user_id = ?
         AND lease_owner IS NOT NULL
         AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    ).run(current, userId, current)
  }
  const activeLeaseCount = (): number => {
    releaseExpiredLeases()
    const current = new Date().toISOString()
    const row = db.prepare(
      `SELECT COUNT(*) AS count FROM agent_tasks
       WHERE user_id = ? AND lease_owner IS NOT NULL AND lease_expires_at >= ?`,
    ).get(userId, current) as { count?: number } | undefined
    return Number(row?.count || 0)
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (activeLeaseCount() === 0) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (activeLeaseCount() > 0) throw new Error("Agent Tasks did not stop before account deletion.")

  for (const row of rows) {
    await deleteWorktree(row.id, undefined, true)
  }
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.accountDelete)
  if (!limit.allowed) return rateLimitExceededResponse(limit, "Too many delete-account attempts. Try again later.")

  const body = (await req.json()) as { password?: string }
  const password = String(body.password || "").trim()

  // For local-only mode, just verify a password was provided
  if (!password) {
    return NextResponse.json({ ok: false, error: "Password is required." }, { status: 400 })
  }

  const userContextId = normalizeUserContextId(userId)
  const dataDir = resolveDataDir()

  // Clean up Coinbase data
  if (userContextId) {
    const store = await createCoinbaseStore(userContextId)
    try {
      const purged = store.purgeUserData(userContextId)
      store.appendAuditLog({
        userContextId,
        eventType: "coinbase.account_delete.secure_delete",
        status: "ok",
        details: purged,
      })
    } finally {
      store.close()
    }
  }

  if (userContextId) {
    try {
      await revokeAndCleanAgentTasks(userContextId)
    } catch (error) {
      console.error(`[AccountDelete] Failed to stop Agent Tasks: ${String(error instanceof Error ? error.message : error)}`)
      return NextResponse.json(
        { ok: false, error: "Could not safely stop active Agent Tasks. Try again." },
        { status: 503 },
      )
    }
    purgeLocalUserData(userContextId)
  }
  await pruneLocalUserArtifacts(dataDir, userId)

  return NextResponse.json({ ok: true })
}
