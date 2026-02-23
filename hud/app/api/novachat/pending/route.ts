import { NextResponse } from "next/server"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import {
  loadPendingMessages,
  markMessagesConsumedForUser,
} from "@/lib/novachat/pending-messages"

export const runtime = "nodejs"

/**
 * GET: Fetch pending NovaChat messages for the authenticated user.
 */
export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.novachatPendingPoll)
  if (!limit.allowed) {
    return rateLimitExceededResponse(
      limit,
      "Nova is still processing queued mission output. Please retry after the provided cooldown.",
    )
  }

  try {
    const messages = await loadPendingMessages(verified.user.id)
    return NextResponse.json({ ok: true, messages })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load messages" },
      { status: 500 }
    )
  }
}

/**
 * POST: Mark messages as consumed after the chat UI has processed them.
 */
export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = await req.json()
    const messageIds = Array.isArray(body.messageIds)
      ? body.messageIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : []

    if (messageIds.length > 0) {
      await markMessagesConsumedForUser(verified.user.id, messageIds)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark messages" },
      { status: 500 }
    )
  }
}
