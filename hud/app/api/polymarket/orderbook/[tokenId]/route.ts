import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { fetchPolymarketOrderBook, toPolymarketServerError } from "@/lib/integrations/polymarket/server"
import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ tokenId: string }> }) {
  const { userId } = await requireLocalUser()

  const limitDecision = checkUserRateLimit(userId, RATE_LIMIT_POLICIES.polymarketRead)
  if (!limitDecision.allowed) return rateLimitExceededResponse(limitDecision)

  try {
    const { tokenId } = await params
    const book = await fetchPolymarketOrderBook(tokenId)
    return NextResponse.json({ ok: true, book })
  } catch (error) {
    const normalized = toPolymarketServerError(error)
    return NextResponse.json({ ok: false, code: normalized.code, error: normalized.message }, { status: normalized.status })
  }
}
