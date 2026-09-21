import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { resolveWorkspaceRoot } from "@/lib/workspace/root"
import {
  collectThreadCleanupHints,
  pruneThreadTranscripts,
} from "@/lib/server/thread-transcript-cleanup"
import { appendThreadDeleteAuditLog } from "@/lib/server/thread-delete-audit"
import {
  deleteThread,
  listThreadMessageMetadata,
  patchThread,
} from "../../../../../src/session/sqlite-store/index.js"

export const runtime = "nodejs"

// Serialize concurrent DELETEs for the same thread to prevent double-cleanup.
const _deleteInFlightByThreadId = new Map<string, Promise<void>>()

export async function PATCH(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { userId } = await requireLocalUser()

  const { threadId } = await context.params
  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    pinned?: boolean
    archived?: boolean
  }
  try {
    const exists = patchThread(userId, threadId, body)
    if (!exists) return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update thread." }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { userId } = await requireLocalUser()

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
    let messageMetadataRows: ReturnType<typeof listThreadMessageMetadata>
    try {
      messageMetadataRows = listThreadMessageMetadata(userId, normalizedThreadId, 10_000)
    } catch {
      messageMetadataRows = []
    }
    const threadMessageCount = messageMetadataRows.length
    const cleanupHints = collectThreadCleanupHints(normalizedThreadId, messageMetadataRows)
    let deleted = false
    try {
      deleted = deleteThread(userId, normalizedThreadId)
    } catch {
      await appendThreadDeleteAuditLog({
        workspaceRoot,
        threadId: normalizedThreadId,
        userContextId: userId,
        removedSessionEntries: 0,
        removedTranscriptFiles: 0,
        cleanupError: "Thread delete failed.",
        threadMessageCount,
      }).catch(() => {})
      deleteResult = { ok: false, error: "Thread delete failed." }
      return
    }
    if (!deleted) {
      deleteResult = { ok: true, transcriptCleanup: { removedSessionEntries: 0, removedTranscriptFiles: 0 } }
      return
    }

    let transcriptCleanup = { removedSessionEntries: 0, removedTranscriptFiles: 0 }
    let transcriptCleanupError = ""
    try {
      transcriptCleanup = await pruneThreadTranscripts(
        workspaceRoot,
        userId,
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
      userContextId: userId,
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
