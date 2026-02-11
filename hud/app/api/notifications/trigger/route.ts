import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { sendTelegramMessage } from "@/lib/notifications/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const text = typeof body?.message === "string" ? body.message.trim() : ""

    if (!text) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const results = await sendTelegramMessage({
      text,
      chatIds: Array.isArray(body?.chatIds) ? body.chatIds.map((v: unknown) => String(v)) : undefined,
      parseMode: body?.parseMode,
      disableNotification: typeof body?.disableNotification === "boolean" ? body.disableNotification : undefined,
    })

    const ok = results.some((r) => r.ok)

    return NextResponse.json(
      {
        ok,
        results,
      },
      { status: ok ? 200 : 502 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send notification",
      },
      { status: 500 },
    )
  }
}
