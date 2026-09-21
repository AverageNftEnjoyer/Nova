import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { buildGmailCalendarOAuthUrl } from "@/lib/integrations/google-calendar/service"
import { gmailError } from "@/lib/integrations/gmail/errors"

import { connectQuerySchema, gmailCalendarApiErrorResponse, logGmailCalendarApi } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  try {
    const url = new URL(req.url)
    const parsed = connectQuerySchema.safeParse({
      returnTo: url.searchParams.get("returnTo") ?? "/integrations",
      mode: url.searchParams.get("mode") ?? undefined,
    })
    if (!parsed.success) {
      throw gmailError("gmail.invalid_request", parsed.error.issues[0]?.message || "Invalid request.", { status: 400 })
    }
    const { returnTo, mode } = parsed.data
    logGmailCalendarApi("connect.begin", {
      userContextId: userId,
      returnTo,
      mode: mode || "redirect",
    })
    const authUrl = await buildGmailCalendarOAuthUrl(returnTo)
    if (mode === "json") {
      return NextResponse.json({ ok: true, authUrl })
    }
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    return gmailCalendarApiErrorResponse(error, "Failed to start GmailCalendar OAuth.")
  }
}

