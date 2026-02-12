import { NextResponse } from "next/server"

import { ensureNotificationSchedulerStarted } from "@/lib/notifications/scheduler"
import { dispatchNotification } from "@/lib/notifications/dispatcher"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  ensureNotificationSchedulerStarted()

  try {
    const body = await req.json()
    const text = typeof body?.message === "string" ? body.message.trim() : ""
    const integration = typeof body?.integration === "string" ? body.integration.trim().toLowerCase() : ""

    if (!text) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    if (integration !== "telegram" && integration !== "discord") {
      return NextResponse.json({ error: "integration must be either 'telegram' or 'discord'" }, { status: 400 })
    }

    const results = await dispatchNotification({
      integration,
      text,
      targets: Array.isArray(body?.chatIds) ? body.chatIds.map((v: unknown) => String(v)) : undefined,
      parseMode: body?.parseMode,
      disableNotification: typeof body?.disableNotification === "boolean" ? body.disableNotification : undefined,
      source: "trigger",
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
