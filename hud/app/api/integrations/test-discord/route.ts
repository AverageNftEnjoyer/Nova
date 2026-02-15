import { NextResponse } from "next/server"

import { sendDiscordMessage } from "@/lib/notifications/discord"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const now = new Date().toISOString()
    const results = await sendDiscordMessage({
      text: `Nova Discord integration test successful at ${now}`,
    })
    const ok = results.some((r) => r.ok)
    const firstFailure = results.find((r) => !r.ok)
    return NextResponse.json(
      {
        ok,
        results,
        error: ok ? undefined : firstFailure?.error || "Discord test failed",
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Discord test failed",
      },
      { status: 500 },
    )
  }
}
