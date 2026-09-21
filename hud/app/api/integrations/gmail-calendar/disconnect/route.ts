import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { disconnectGmailCalendar } from "@/lib/integrations/google-calendar/service"

import { disconnectBodySchema, gmailCalendarApiErrorResponse, logGmailCalendarApi, safeJson } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const parsed = disconnectBodySchema.safeParse(await safeJson(req))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 })
    }
    const accountId = String(parsed.data.accountId || "").trim()
    logGmailCalendarApi("disconnect.begin", {
      userContextId: userId,
      accountId: accountId || "all",
    })
    await disconnectGmailCalendar(accountId || undefined)
    logGmailCalendarApi("disconnect.success", {
      userContextId: userId,
      accountId: accountId || "all",
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to disconnect Google Calendar.")
  }
}

