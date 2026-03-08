import { NextResponse } from "next/server"

import { fetchPolymarketPositions, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { getPolymarketPositionsAddress } from "@/lib/integrations/polymarket/types"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const config = await loadIntegrationsConfig(verified)
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
