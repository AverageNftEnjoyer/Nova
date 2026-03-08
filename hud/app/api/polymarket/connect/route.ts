import { NextResponse } from "next/server"

import { connectPolymarketIntegration, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.polymarketWrite)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const body = (await req.json().catch(() => ({}))) as {
      walletAddress?: string
      signatureType?: 0 | 1 | 2
      liveTradingEnabled?: boolean
    }
    const config = await connectPolymarketIntegration({
      verified,
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
