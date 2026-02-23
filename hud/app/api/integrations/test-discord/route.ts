import { NextResponse } from "next/server"

import { sendDiscordMessage } from "@/lib/notifications/discord"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified?.user?.id) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const now = new Date().toISOString()
    const results = await sendDiscordMessage({
      text: `Nova Discord integration test successful at ${now}`,
    }, verified)
    const redactedResults = results.map((result) => ({
      webhookId: result.webhookId,
      ok: result.ok,
      status: result.status,
      error: result.error,
      attempts: result.attempts,
      retryable: result.retryable,
    }))
    const ok = results.some((r) => r.ok)
    const firstFailure = results.find((r) => !r.ok)
    return NextResponse.json(
      {
        ok,
        results: redactedResults,
        error: ok ? undefined : firstFailure?.error || "Discord test failed",
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Discord test failed",
      },
      { status: 500 },
    )
  }
}
