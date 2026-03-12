import { NextResponse } from "next/server"

import { fetchPolymarketPrices, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseTokenIds(url: URL): string[] {
  const queryValue =
    url.searchParams.get("tokens")
    || url.searchParams.get("tokenIds")
    || url.searchParams.get("token_ids")
    || ""
  return [...new Set(
    String(queryValue)
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )].slice(0, 100)
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limitDecision = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const url = new URL(req.url)
    const tokenIds = parseTokenIds(url)
    if (tokenIds.length === 0) {
      return NextResponse.json({ ok: false, error: "tokens query parameter is required." }, { status: 400 })
    }
    const prices = await fetchPolymarketPrices(tokenIds)
    return NextResponse.json({ ok: true, prices })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
