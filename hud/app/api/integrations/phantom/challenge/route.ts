import { NextResponse } from "next/server"

import { issuePhantomChallenge, toPhantomServiceError } from "@/lib/integrations/phantom/service"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { walletAddress?: string; origin?: string }
    const result = await issuePhantomChallenge({
      verified,
      walletAddress: String(body.walletAddress || ""),
      origin: body.origin,
    })
    return NextResponse.json({ ok: true, challenge: result })
  } catch (error) {
    const normalized = toPhantomServiceError(error)
    return NextResponse.json(
      { ok: false, code: normalized.code, error: normalized.message },
      { status: normalized.status },
    )
  }
}
