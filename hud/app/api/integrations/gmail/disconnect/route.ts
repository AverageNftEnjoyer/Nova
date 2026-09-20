import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { disconnectGmail } from "@/lib/integrations/gmail"

import { disconnectBodySchema, gmailApiErrorResponse, logGmailApi, safeJson } from "@/app/api/integrations/gmail/_shared"

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
    logGmailApi("disconnect.begin", {
      userContextId: userId,
      accountId: accountId || "all",
    })
    await disconnectGmail(accountId || undefined, verified)
    logGmailApi("disconnect.success", {
      userContextId: userId,
      accountId: accountId || "all",
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return gmailApiErrorResponse(error, "Failed to disconnect Gmail.")
  }
}
