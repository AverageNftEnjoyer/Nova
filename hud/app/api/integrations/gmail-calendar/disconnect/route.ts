import { NextResponse } from "next/server"

import { disconnectGmailCalendar } from "@/lib/integrations/gmail-calendar/service"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { disconnectBodySchema, gmailCalendarApiErrorResponse, logGmailCalendarApi, safeJson } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  try {
    const parsed = disconnectBodySchema.safeParse(await safeJson(req))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 })
    }
    const accountId = String(parsed.data.accountId || "").trim()
    logGmailCalendarApi("disconnect.begin", {
      userContextId: verified.user.id,
      accountId: accountId || "all",
    })
    await disconnectGmailCalendar(accountId || undefined, verified)
    logGmailCalendarApi("disconnect.success", {
      userContextId: verified.user.id,
      accountId: accountId || "all",
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to disconnect Google Calendar.")
  }
}
