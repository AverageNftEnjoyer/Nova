import { NextResponse } from "next/server"
import path from "node:path"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import {
  collectThreadCleanupHints,
  pruneThreadTranscripts,
} from "@/lib/server/thread-transcript-cleanup"

export const runtime = "nodejs"

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  if (path.basename(cwd).toLowerCase() === "hud") return path.resolve(cwd, "..")
  return cwd
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
  const normalizedThreadId = String(threadId || "").trim()
  const workspaceRoot = resolveWorkspaceRoot()

  const { data: messageMetadataRows } = await verified.client
    .from("messages")
    .select("metadata")
    .eq("thread_id", normalizedThreadId)
    .eq("user_id", verified.user.id)
  const cleanupHints = collectThreadCleanupHints(normalizedThreadId, messageMetadataRows ?? [])

  const { error } = await verified.client
    .from("threads")
    .delete()
    .eq("id", normalizedThreadId)
    .eq("user_id", verified.user.id)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const transcriptCleanup = await pruneThreadTranscripts(
    workspaceRoot,
    verified.user.id,
    normalizedThreadId,
    {
      sessionConversationIds: cleanupHints.sessionConversationIds,
      sessionKeys: cleanupHints.sessionKeys,
    },
  ).catch(() => ({ removedSessionEntries: 0, removedTranscriptFiles: 0 }))

  return NextResponse.json({ ok: true, transcriptCleanup })
}
