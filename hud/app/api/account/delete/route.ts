import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import path from "node:path"
import { rm } from "node:fs/promises"

import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { createCoinbaseStore } from "@/lib/coinbase/reporting"

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

async function pruneLocalUserArtifacts(workspaceRoot: string, userId: string): Promise<void> {
  const userContextId = normalizeUserContextId(userId)
  if (!userContextId) return
  const userContextPath = path.join(workspaceRoot, ".user", "user-context", userContextId)
  await rm(userContextPath, { recursive: true, force: true }).catch(() => {})
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

  const workspaceRoot = path.resolve(process.cwd(), "..")
  const userContextId = normalizeUserContextId(userId)

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

  // Local-only mode: Clean up local artifacts
  // In a local deployment, there's no centralized database to clean up
  // All data is stored locally on the user's device:
  // - Integration configs in .nova-data/
  // - User settings in browser localStorage
  // - Chat history in memory/localStorage
  // - Mission job runs in memory

  await pruneLocalUserArtifacts(workspaceRoot, userId)

  // Clean up integration configs
  try {
    const fs = await import("fs/promises")
    const configPath = path.join(process.cwd(), ".nova-data", `integrations-${userId}.json`)
    await fs.unlink(configPath).catch(() => {})
  } catch {
    // Ignore errors
  }

  return NextResponse.json({ ok: true })
}
