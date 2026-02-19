import { NextResponse } from "next/server"
import path from "node:path"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

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

function buildHudSessionKey(userContextId: string, threadId: string): string {
  return `agent:nova:hud:user:${userContextId}:dm:${threadId}`
}

async function pruneThreadTranscripts(workspaceRoot: string, userId: string, threadId: string): Promise<{
  removedSessionEntries: number
  removedTranscriptFiles: number
}> {
  const userContextId = normalizeUserContextId(userId)
  if (!userContextId || !threadId) return { removedSessionEntries: 0, removedTranscriptFiles: 0 }

  const userContextDir = path.join(workspaceRoot, ".agent", "user-context", userContextId)
  const sessionStorePath = path.join(userContextDir, "sessions.json")
  const scopedTranscriptDir = path.join(userContextDir, "transcripts")
  const legacyTranscriptDir = path.join(workspaceRoot, ".agent", "transcripts")
  const sessionKey = buildHudSessionKey(userContextId, threadId)

  let removedSessionEntries = 0
  let removedTranscriptFiles = 0
  const sessionIds = new Set<string>()

  const rawStore = await readFile(sessionStorePath, "utf8").catch(() => "")
  if (rawStore) {
    try {
      const parsed = JSON.parse(rawStore) as Record<string, { sessionId?: unknown }>
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entry = parsed[sessionKey]
        const sessionId = String(entry?.sessionId || "").trim()
        if (sessionId) sessionIds.add(sessionId)
        if (entry) {
          delete parsed[sessionKey]
          removedSessionEntries = 1
          await writeFile(sessionStorePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
        }
      }
    } catch {
      // Ignore malformed session store and continue with transcript scan.
    }
  }

  for (const sessionId of sessionIds) {
    const scopedPath = path.join(scopedTranscriptDir, `${sessionId}.jsonl`)
    const legacyPath = path.join(legacyTranscriptDir, `${sessionId}.jsonl`)
    const scopedExists = await readFile(scopedPath, "utf8").then(() => true).catch(() => false)
    if (scopedExists) {
      await rm(scopedPath, { force: true }).catch(() => {})
      removedTranscriptFiles += 1
    }
    const legacyExists = await readFile(legacyPath, "utf8").then(() => true).catch(() => false)
    if (legacyExists) {
      await rm(legacyPath, { force: true }).catch(() => {})
      removedTranscriptFiles += 1
    }
  }

  const scanAndPrune = async (dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue
      const filePath = path.join(dirPath, entry.name)
      const raw = await readFile(filePath, "utf8").catch(() => "")
      if (!raw || !raw.includes(sessionKey)) continue
      await rm(filePath, { force: true }).catch(() => {})
      removedTranscriptFiles += 1
    }
  }

  await scanAndPrune(scopedTranscriptDir)
  await scanAndPrune(legacyTranscriptDir)

  return { removedSessionEntries, removedTranscriptFiles }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    pinned?: boolean
    archived?: boolean
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === "string" && body.title.trim()) update.title = body.title.trim()
  if (typeof body.pinned === "boolean") update.pinned = body.pinned
  if (typeof body.archived === "boolean") update.archived = body.archived

  const { error } = await verified.client
    .from("threads")
    .update(update)
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized) return unauthorized
  if (!verified) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const workspaceRoot = path.resolve(process.cwd(), "..")
  const { error } = await verified.client
    .from("threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const transcriptCleanup = await pruneThreadTranscripts(
    workspaceRoot,
    verified.user.id,
    String(threadId || ""),
  ).catch(() => ({ removedSessionEntries: 0, removedTranscriptFiles: 0 }))

  return NextResponse.json({ ok: true, transcriptCleanup })
}
