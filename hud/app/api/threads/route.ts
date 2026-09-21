import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { createThread, listThreadMessages, listThreads } from "../../../../src/session/sqlite-store/index.js"

export const runtime = "nodejs"
const DEFAULT_THREAD_TITLE = "Greetings Exchange"
const MAX_STORED_IMAGE_DATA_URL_CHARS = 180_000

type ApiMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  imageData?: string
  source?: "hud" | "agent" | "voice"
  sender?: string
  sessionConversationId?: string
  sessionKey?: string
  nlpCleanText?: string
  nlpConfidence?: number
  nlpCorrectionCount?: number
  nlpBypass?: boolean
  missionId?: string
  missionLabel?: string
  missionRunId?: string
  missionRunKey?: string
  missionAttempt?: number
  missionSource?: "scheduler" | "trigger"
  missionOutputChannel?: string
}

type ApiConversation = {
  id: string
  title: string
  pinned?: boolean
  archived?: boolean
  messages: ApiMessage[]
  createdAt: string
  updatedAt: string
}

function normalizeMessageFingerprintContent(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : undefined
}

export async function GET() {
  const { userId } = await requireLocalUser()

  let threads: ReturnType<typeof listThreads>
  let messages: ReturnType<typeof listThreadMessages>
  try {
    threads = listThreads(userId)
    messages = listThreadMessages(userId)
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load conversations." }, { status: 500 })
  }

  const grouped = new Map<string, ApiMessage[]>()
  const seenMessageIdsByThread = new Map<string, Set<string>>()
  const seenMessageFingerprintsByThread = new Map<string, Set<string>>()
  for (const row of messages) {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {}
    const metadataMessageId = typeof metadata.clientMessageId === "string" ? metadata.clientMessageId.trim() : ""
    const threadSeenIds = seenMessageIdsByThread.get(row.threadId) || new Set<string>()
    const threadSeenFingerprints = seenMessageFingerprintsByThread.get(row.threadId) || new Set<string>()
    const normalizedRowId = String(row.id || "").trim()
    if (metadataMessageId && threadSeenIds.has(metadataMessageId)) {
      // Older rows may contain the same client message stored multiple times.
      // Keep the first canonical row to avoid duplicate UI rendering.
      continue
    }
    const stableMessageId = metadataMessageId || normalizedRowId
    if (!stableMessageId || threadSeenIds.has(stableMessageId)) {
      continue
    }
    const normalizedRole = row.role === "assistant" ? "assistant" : "user"
    const normalizedCreatedAt = String(row.createdAt || "")
    const fingerprint = `${normalizedRole}|${normalizedCreatedAt}|${normalizeMessageFingerprintContent(String(row.content || ""))}`
    if (threadSeenFingerprints.has(fingerprint)) {
      continue
    }
    threadSeenIds.add(stableMessageId)
    threadSeenFingerprints.add(fingerprint)
    seenMessageIdsByThread.set(row.threadId, threadSeenIds)
    seenMessageFingerprintsByThread.set(row.threadId, threadSeenFingerprints)
    const imageData = typeof metadata.imageData === "string" ? metadata.imageData.trim() : ""
    const entry: ApiMessage = {
      id: stableMessageId,
      role: normalizedRole,
      content: String(row.content || ""),
      createdAt: normalizedCreatedAt,
      imageData:
        imageData.startsWith("data:image/") && imageData.length <= MAX_STORED_IMAGE_DATA_URL_CHARS ? imageData : undefined,
      source: (metadata.source === "hud" || metadata.source === "agent" || metadata.source === "voice") ? metadata.source : undefined,
      sender: optionalString(metadata.sender),
      sessionConversationId: optionalString(metadata.sessionConversationId),
      sessionKey: optionalString(metadata.sessionKey),
      nlpCleanText: optionalString(metadata.nlpCleanText),
      nlpConfidence: optionalFiniteNumber(metadata.nlpConfidence),
      nlpCorrectionCount: optionalFiniteNumber(metadata.nlpCorrectionCount),
      nlpBypass: metadata.nlpBypass === true ? true : undefined,
      missionId: optionalString(metadata.missionId),
      missionLabel: optionalString(metadata.missionLabel),
      missionRunId: optionalString(metadata.missionRunId),
      missionRunKey: optionalString(metadata.missionRunKey),
      missionAttempt: optionalFiniteNumber(metadata.missionAttempt),
      missionSource:
        metadata.missionSource === "scheduler" || metadata.missionSource === "trigger"
          ? metadata.missionSource
          : undefined,
      missionOutputChannel: optionalString(metadata.missionOutputChannel),
    }
    const list = grouped.get(row.threadId) || []
    list.push(entry)
    grouped.set(row.threadId, list)
  }

  const conversations: ApiConversation[] = threads.map((thread) => ({
    id: thread.id,
    title: thread.title || DEFAULT_THREAD_TITLE,
    pinned: thread.pinned,
    archived: thread.archived,
    messages: grouped.get(thread.id) || [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  }))

  return NextResponse.json({ ok: true, conversations })
}

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  const body = (await req.json().catch(() => ({}))) as { title?: string }
  const title = String(body.title || DEFAULT_THREAD_TITLE).trim() || DEFAULT_THREAD_TITLE

  let thread: ReturnType<typeof createThread>
  try {
    thread = createThread(userId, title)
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to create conversation." }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      id: thread.id,
      title: thread.title || DEFAULT_THREAD_TITLE,
      pinned: thread.pinned,
      archived: thread.archived,
      messages: [],
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    } satisfies ApiConversation,
  })
}
