import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { fetchPolymarketPositions, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { getPolymarketPositionsAddress } from "@/lib/integrations/polymarket/types"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const config = await loadIntegrationsConfig({ userId })
    const address = getPolymarketPositionsAddress(config.polymarket)
    const positions = address ? await fetchPolymarketPositions(address) : []
    return NextResponse.json({
      ok: true,
      connected: config.polymarket.connected,
      address,
      positions,
    })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
