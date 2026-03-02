import { NextResponse } from "next/server"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import {
  collectThreadCleanupHints,
  pruneThreadTranscripts,
} from "@/lib/server/thread-transcript-cleanup"
import { appendThreadDeleteAuditLog } from "@/lib/server/thread-delete-audit"

export const runtime = "nodejs"

// Serialize concurrent DELETEs for the same thread to prevent double-cleanup.
const _deleteInFlightByThreadId = new Map<string, Promise<void>>()

export async function PATCH(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

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
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const { threadId } = await context.params
  const normalizedThreadId = String(threadId || "").trim()

  // Deduplicate concurrent deletes for the same thread.
  const inflight = _deleteInFlightByThreadId.get(normalizedThreadId)
  if (inflight) {
    await inflight.catch(() => {})
    return NextResponse.json({ ok: true })
  }

  const workspaceRoot = resolveWorkspaceRoot()

  let deleteResult: { ok: boolean; transcriptCleanup?: { removedSessionEntries: number; removedTranscriptFiles: number }; transcriptCleanupError?: string; error?: string } = { ok: false }

  const doDelete = async (): Promise<void> => {
    const { data: messageMetadataRows } = await verified.client
      .from("messages")
      .select("metadata")
      .eq("thread_id", normalizedThreadId)
      .eq("user_id", verified.user.id)
      .limit(10_000)
    const threadMessageCount = Array.isArray(messageMetadataRows) ? messageMetadataRows.length : 0
    const cleanupHints = collectThreadCleanupHints(normalizedThreadId, messageMetadataRows ?? [])

    const { error } = await verified.client
      .from("threads")
      .delete()
      .eq("id", normalizedThreadId)
      .eq("user_id", verified.user.id)

    if (error) {
      await appendThreadDeleteAuditLog({
        workspaceRoot,
        threadId: normalizedThreadId,
        userContextId: verified.user.id,
        removedSessionEntries: 0,
        removedTranscriptFiles: 0,
        cleanupError: error.message || "Thread delete failed.",
        threadMessageCount,
      }).catch(() => {})
      deleteResult = { ok: false, error: error.message }
      return
    }

    let transcriptCleanup = { removedSessionEntries: 0, removedTranscriptFiles: 0 }
    let transcriptCleanupError = ""
    try {
      transcriptCleanup = await pruneThreadTranscripts(
        workspaceRoot,
        verified.user.id,
        normalizedThreadId,
        {
          sessionConversationIds: cleanupHints.sessionConversationIds,
          sessionKeys: cleanupHints.sessionKeys,
        },
      )
    } catch (err) {
      transcriptCleanupError = err instanceof Error ? err.message : "Transcript cleanup failed."
    }

    await appendThreadDeleteAuditLog({
      workspaceRoot,
      threadId: normalizedThreadId,
      userContextId: verified.user.id,
      removedSessionEntries: transcriptCleanup.removedSessionEntries,
      removedTranscriptFiles: transcriptCleanup.removedTranscriptFiles,
      cleanupError: transcriptCleanupError,
      threadMessageCount,
    }).catch(() => {})

    deleteResult = { ok: true, transcriptCleanup, ...(transcriptCleanupError ? { transcriptCleanupError } : {}) }
  }

  const op = doDelete().finally(() => {
    if (_deleteInFlightByThreadId.get(normalizedThreadId) === op) {
      _deleteInFlightByThreadId.delete(normalizedThreadId)
    }
  })
  _deleteInFlightByThreadId.set(normalizedThreadId, op)
  await op

  if (!deleteResult.ok) {
    return NextResponse.json({ ok: false, error: deleteResult.error }, { status: 500 })
  }
  return NextResponse.json(deleteResult)
}
