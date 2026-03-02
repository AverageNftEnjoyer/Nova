import { NextResponse } from "next/server"
import crypto from "node:crypto"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"

type IncomingMessage = {
  id?: string
  role: "user" | "assistant"
  content: string
  createdAt: string
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
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.threadMessagesWrite)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  const { threadId } = await context.params
  const body = (await req.json().catch(() => ({}))) as { messages?: IncomingMessage[] }
  const messages = Array.isArray(body.messages) ? body.messages : []

  const { data: thread, error: threadError } = await verified.client
    .from("threads")
    .select("id")
    .eq("id", threadId)
    .eq("user_id", verified.user.id)
    .single()

  if (threadError || !thread) {
    return NextResponse.json({ ok: false, error: "Thread not found." }, { status: 404 })
  }

  if (messages.length > 0) {
    const rows = messages.map((m, index) => ({
      id: buildStableMessageRowId(threadId, verified.user.id, m, index),
      thread_id: threadId,
      user_id: verified.user.id,
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
      },
      created_at: String(m.createdAt || new Date().toISOString()),
    }))
    const { error: upsertError } = await verified.client
      .from("messages")
      .upsert(rows, { onConflict: "id" })
    if (upsertError) {
      return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 })
    }
  }

  await verified.client
    .from("threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", verified.user.id)

  return NextResponse.json({ ok: true })
}
