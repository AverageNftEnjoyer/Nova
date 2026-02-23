import { NextResponse } from "next/server"

import { ensureRuntimeIntegrationsSnapshot } from "@/lib/integrations/runtime-snapshot"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  try {
    const ensured = await ensureRuntimeIntegrationsSnapshot(verified.user.id, verified)
    return NextResponse.json({ ok: true, userId: ensured.userId, cached: ensured.cached })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to ensure runtime integrations snapshot." },
      { status: 500 },
    )
  }
}
