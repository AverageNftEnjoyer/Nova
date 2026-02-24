import { NextResponse } from "next/server"

import { disconnectGmail } from "@/lib/integrations/gmail"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { disconnectBodySchema, gmailApiErrorResponse, logGmailApi, safeJson } from "@/app/api/integrations/gmail/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const parsed = disconnectBodySchema.safeParse(await safeJson(req))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 })
    }
    const accountId = String(parsed.data.accountId || "").trim()
    logGmailApi("disconnect.begin", {
      userContextId: verified.user.id,
      accountId: accountId || "all",
    })
    await disconnectGmail(accountId || undefined, verified)
    logGmailApi("disconnect.success", {
      userContextId: verified.user.id,
      accountId: accountId || "all",
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return gmailApiErrorResponse(error, "Failed to disconnect Gmail.")
  }
}
