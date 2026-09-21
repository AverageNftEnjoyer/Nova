import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { sendSlackMessage } from "@/lib/notifications/slack"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()
  const limit = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const now = new Date().toISOString()
    const results = await sendSlackMessage({
      text: `Nova Slack integration test successful at ${now}`,
    })
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
        error: ok ? undefined : firstFailure?.error || "Slack test failed",
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Slack test failed",
      },
      { status: 500 },
    )
  }
}
