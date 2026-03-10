import { NextResponse } from "next/server"

import { fetchPolymarketPriceHistory, toPolymarketServerError, type PolymarketHistoryRange } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeRange(value: string): PolymarketHistoryRange {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "1h" || normalized === "6h" || normalized === "1d" || normalized === "1w" || normalized === "1m" || normalized === "all") {
    return normalized
  }
  return "1d"
}

export async function GET(req: Request, context: { params: Promise<{ tokenId: string }> }) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const params = await context.params
    const url = new URL(req.url)
    const range = normalizeRange(url.searchParams.get("range") || "1d")
    const points = await fetchPolymarketPriceHistory(params.tokenId, range)
    return NextResponse.json({ ok: true, tokenId: params.tokenId, range, points })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
