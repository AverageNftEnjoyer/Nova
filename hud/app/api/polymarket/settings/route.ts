import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { toPolymarketServerError, updatePolymarketTradingPreference } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  const { userId } = await requireLocalUser()

  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.polymarketWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json()) as { liveTradingEnabled?: boolean }
    const config = await updatePolymarketTradingPreference({
      scope: { userId },
      liveTradingEnabled: body.liveTradingEnabled === true,
    })
    return NextResponse.json({ ok: true, config })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
