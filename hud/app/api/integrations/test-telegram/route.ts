import { NextResponse } from "next/server"

import { sendTelegramMessage } from "@/lib/notifications/telegram"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const now = new Date().toISOString()
    const results = await sendTelegramMessage({
      text: `Nova integration test successful at ${now}`,
    }, verified)
    const ok = results.some((r) => r.ok)
    const firstFailure = results.find((r) => !r.ok)
    return NextResponse.json(
      {
        ok,
        results,
        error: ok ? undefined : firstFailure?.error || "Telegram test failed",
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Telegram test failed",
      },
      { status: 500 },
    )
  }
}
