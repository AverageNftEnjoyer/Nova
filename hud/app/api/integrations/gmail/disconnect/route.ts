import { NextResponse } from "next/server"

import { disconnectGmail } from "@/lib/integrations/gmail"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as { accountId?: string }
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : ""
    await disconnectGmail(accountId || undefined, verified)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to disconnect Gmail." },
      { status: 500 },
    )
  }
}
