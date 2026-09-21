import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"
import crypto from "node:crypto"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { upsertThreadMessages } from "../../../../../../src/session/sqlite-store/index.js"

export const runtime = "nodejs"
const MAX_STORED_IMAGE_DATA_URL_CHARS = 180_000

type IncomingMessage = {
  id?: string
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

function stableUuidFromSeed(seed: string): string {
  const base = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32).split("")
  base[12] = "4"
  const variantNibble = Number.parseInt(base[16] || "0", 16)
  base[16] = ((variantNibble & 0x3) | 0x8).toString(16)
  return `${base.slice(0, 8).join("")}-${base.slice(8, 12).join("")}-${base.slice(12, 16).join("")}-${base.slice(16, 20).join("")}-${base.slice(20, 32).join("")}`
}

function buildStableMessageRowId(threadId: string, userId: string, message: IncomingMessage, index: number): string {
  const clientMessageId = typeof message.id === "string" ? message.id.trim() : ""
  if (clientMessageId) {
    return stableUuidFromSeed(`thread:${threadId}:user:${userId}:client:${clientMessageId}`)
  }
  const fallbackSeed = [
    `thread:${threadId}`,
    `user:${userId}`,
    `idx:${index}`,
    `role:${message.role === "assistant" ? "assistant" : "user"}`,
    `created:${String(message.createdAt || "")}`,
    `content:${String(message.content || "")}`,
  ].join("|")
  return stableUuidFromSeed(fallbackSeed)
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.threadMessagesWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const { threadId } = await context.params

  const body = (await req.json().catch(() => ({}))) as { messages?: IncomingMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const rows = messages.map((m, index) => ({
      id: buildStableMessageRowId(threadId, userId, m, index),
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
      metadata: {
        clientMessageId:
          typeof m.id === "string" && m.id.trim()
            ? m.id.trim()
            : null,
        source: m.source || null,
        sender: m.sender || null,
        sessionConversationId:
          typeof m.sessionConversationId === "string" && m.sessionConversationId.trim()
            ? m.sessionConversationId.trim()
            : null,
        sessionKey: typeof m.sessionKey === "string" && m.sessionKey.trim() ? m.sessionKey.trim() : null,
        nlpCleanText: typeof m.nlpCleanText === "string" ? m.nlpCleanText : null,
        nlpConfidence: Number.isFinite(Number(m.nlpConfidence)) ? Number(m.nlpConfidence) : null,
        nlpCorrectionCount: Number.isFinite(Number(m.nlpCorrectionCount)) ? Number(m.nlpCorrectionCount) : null,
        nlpBypass: m.nlpBypass === true ? true : null,
        missionId: typeof m.missionId === "string" && m.missionId.trim() ? m.missionId.trim() : null,
        missionLabel: typeof m.missionLabel === "string" && m.missionLabel.trim() ? m.missionLabel.trim() : null,
        missionRunId: typeof m.missionRunId === "string" && m.missionRunId.trim() ? m.missionRunId.trim() : null,
        missionRunKey: typeof m.missionRunKey === "string" && m.missionRunKey.trim() ? m.missionRunKey.trim() : null,
        missionAttempt: Number.isFinite(Number(m.missionAttempt)) ? Number(m.missionAttempt) : null,
        missionSource: m.missionSource === "scheduler" || m.missionSource === "trigger" ? m.missionSource : null,
        missionOutputChannel:
          typeof m.missionOutputChannel === "string" && m.missionOutputChannel.trim()
            ? m.missionOutputChannel.trim()
            : null,
        imageData:
          typeof m.imageData === "string"
            && m.imageData.trim().startsWith("data:image/")
            && m.imageData.trim().length <= MAX_STORED_IMAGE_DATA_URL_CHARS
            ? m.imageData.trim()
            : null,
      },
      createdAt: String(m.createdAt || new Date().toISOString()),
    }))
  try {
    const written = upsertThreadMessages(userId, threadId, rows)
    if (written === null) {
      return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 })
    }
    return NextResponse.json({ ok: true, threadId, written })
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to save messages." }, { status: 500 })
  }
}
