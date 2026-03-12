import { NextResponse } from "next/server"

import { disconnectPhantomBinding, toPhantomServiceError } from "@/lib/integrations/phantom/service"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const body = (await req.json()) as { reason?: string }
    const result = await disconnectPhantomBinding({
      verified,
      reason:
        body.reason === "user_disconnect" ||
        body.reason === "wallet_changed" ||
        body.reason === "session_revoked" ||
        body.reason === "verification_reset"
          ? body.reason
          : "unknown",
    })
    return NextResponse.json({ ok: true, wallet: result })
  } catch (error) {
    const normalized = toPhantomServiceError(error)
    return NextResponse.json(
      { ok: false, code: normalized.code, error: normalized.message },
      { status: normalized.status },
    )
  }
}
