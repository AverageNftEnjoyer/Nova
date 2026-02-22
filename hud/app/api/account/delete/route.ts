import { NextResponse } from "next/server"
import path from "node:path"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient, requireSupabaseApiUser } from "@/lib/supabase/server"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { createCoinbaseStore } from "@/lib/coinbase/reporting"

export const runtime = "nodejs"

async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = getSupabaseUrl()
  const anon = getSupabaseAnonKey()
  const verifier = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  return !error
}

function normalizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function pruneLegacySessionArtifacts(workspaceRoot: string, userContextId: string): Promise<void> {
  const sessionsPath = path.join(workspaceRoot, ".agent", "sessions.json")
  const legacyTranscriptsDir = path.join(workspaceRoot, ".agent", "transcripts")
  const keyPattern = new RegExp(`:hud:user:${escapeRegExp(userContextId)}:`, "i")

  const raw = await readFile(sessionsPath, "utf8").catch(() => "")
  if (!raw) return

  let parsed: Record<string, { sessionId?: unknown }> = {}
  try {
    const candidate = JSON.parse(raw) as Record<string, { sessionId?: unknown }>
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      parsed = candidate
    }
  } catch {
    return
  }

  const sessionIdsToDelete = new Set<string>()
  let changed = false
  for (const [sessionKey, entry] of Object.entries(parsed)) {
    if (!keyPattern.test(sessionKey)) continue
    const sessionId = String(entry?.sessionId || "").trim()
    if (sessionId) sessionIdsToDelete.add(sessionId)
    delete parsed[sessionKey]
    changed = true
  }

  if (changed) {
    await writeFile(sessionsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8").catch(() => {})
  }

  for (const sessionId of sessionIdsToDelete) {
    const filePath = path.join(legacyTranscriptsDir, `${sessionId}.jsonl`)
    await rm(filePath, { force: true }).catch(() => {})
  }

  const legacyEntries = await readdir(legacyTranscriptsDir, { withFileTypes: true }).catch(() => [])
  for (const entry of legacyEntries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue
    const filePath = path.join(legacyTranscriptsDir, entry.name)
    const transcript = await readFile(filePath, "utf8").catch(() => "")
    if (!transcript || !keyPattern.test(transcript)) continue
    await rm(filePath, { force: true }).catch(() => {})
  }
}

async function pruneLocalUserArtifacts(workspaceRoot: string, userId: string): Promise<void> {
  const userContextId = normalizeUserContextId(userId)
  if (!userContextId) return
  const userContextPath = path.join(workspaceRoot, ".agent", "user-context", userContextId)
  await rm(userContextPath, { recursive: true, force: true }).catch(() => {})
  await pruneLegacySessionArtifacts(workspaceRoot, userContextId)
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.accountDelete)
  if (!limit.allowed) return rateLimitExceededResponse(limit, "Too many delete-account attempts. Try again later.")

  const body = (await req.json().catch(() => ({}))) as { password?: string }
  const password = String(body.password || "").trim()
  if (!password) {
    return NextResponse.json({ ok: false, error: "Password is required." }, { status: 400 })
  }

  const email = String(verified.user.email || "").trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ ok: false, error: "Current account email is missing." }, { status: 400 })
  }

  const validPassword = await verifyPassword(email, password)
  if (!validPassword) {
    return NextResponse.json({ ok: false, error: "Invalid password confirmation." }, { status: 401 })
  }

  const userId = verified.user.id
  const workspaceRoot = path.resolve(process.cwd(), "..")
  const userClient = verified.client
  const userContextId = normalizeUserContextId(userId)

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

  const { error: toolRunsDeleteError } = await userClient.from("tool_runs").delete().eq("user_id", userId)
  if (toolRunsDeleteError) {
    return NextResponse.json({ ok: false, error: toolRunsDeleteError.message || "Failed to delete tool runs." }, { status: 500 })
  }
  const { error: threadSummariesDeleteError } = await userClient.from("thread_summaries").delete().eq("user_id", userId)
  if (threadSummariesDeleteError) {
    return NextResponse.json({ ok: false, error: threadSummariesDeleteError.message || "Failed to delete thread summaries." }, { status: 500 })
  }
  const { error: messagesDeleteError } = await userClient.from("messages").delete().eq("user_id", userId)
  if (messagesDeleteError) {
    return NextResponse.json({ ok: false, error: messagesDeleteError.message || "Failed to delete messages." }, { status: 500 })
  }
  const { error: memoriesDeleteError } = await userClient.from("memories").delete().eq("user_id", userId)
  if (memoriesDeleteError) {
    return NextResponse.json({ ok: false, error: memoriesDeleteError.message || "Failed to delete memories." }, { status: 500 })
  }
  const { error: threadsDeleteError } = await userClient.from("threads").delete().eq("user_id", userId)
  if (threadsDeleteError) {
    return NextResponse.json({ ok: false, error: threadsDeleteError.message || "Failed to delete threads." }, { status: 500 })
  }

  const admin = createSupabaseAdminClient()
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message || "Failed to delete account." }, { status: 500 })
  }

  await pruneLocalUserArtifacts(workspaceRoot, userId)

  return NextResponse.json({ ok: true })
}
