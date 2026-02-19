import { NextResponse } from "next/server"
import path from "node:path"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient, requireSupabaseApiUser } from "@/lib/supabase/server"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env"

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

  const admin = createSupabaseAdminClient()
  const userId = verified.user.id
  const workspaceRoot = path.resolve(process.cwd(), "..")

  await admin.from("tool_runs").delete().eq("user_id", userId)
  await admin.from("thread_summaries").delete().eq("user_id", userId)
  await admin.from("messages").delete().eq("user_id", userId)
  await admin.from("memories").delete().eq("user_id", userId)
  await admin.from("threads").delete().eq("user_id", userId)

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message || "Failed to delete account." }, { status: 500 })
  }

  await pruneLocalUserArtifacts(workspaceRoot, userId)

  return NextResponse.json({ ok: true })
}
