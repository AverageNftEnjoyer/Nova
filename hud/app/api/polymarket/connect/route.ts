import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { connectPolymarketIntegration, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.polymarketWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json()) as {
      walletAddress?: string
      signatureType?: 0 | 1 | 2
      liveTradingEnabled?: boolean
    }
    const config = await connectPolymarketIntegration({
      scope: { userId },
      walletAddress: String(body.walletAddress || ""),
      signatureType: body.signatureType,
      liveTradingEnabled: body.liveTradingEnabled === true,
    })
    return NextResponse.json({ ok: true, config })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
