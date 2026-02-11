import { NextResponse } from "next/server"

import { sendTelegramMessage } from "@/lib/notifications/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const now = new Date().toISOString()
    const results = await sendTelegramMessage({
      text: `Nova integration test successful at ${now}`,
    })
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
