import { NextResponse } from "next/server"

import { disconnectGmail } from "@/lib/integrations/gmail"
import { deriveGmailAfterSetEnabled, deriveGmailAfterSetPrimary } from "@/lib/integrations/gmail/accounts"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { accountsBodySchema, gmailApiErrorResponse, logGmailApi, safeJson } from "@/app/api/integrations/gmail/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const parsed = accountsBodySchema.safeParse(await safeJson(req))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 })
    }
    const { action, accountId } = parsed.data
    logGmailApi("accounts.patch.begin", {
      userContextId: verified.user.id,
      action,
      accountId,
    })

    if (action === "delete") {
      await disconnectGmail(accountId, verified)
      logGmailApi("accounts.patch.success", {
        userContextId: verified.user.id,
        action,
        accountId,
      })
      return NextResponse.json({ ok: true })
    }

    const current = await loadIntegrationsConfig(verified)
    const accounts = current.gmail.accounts
    const exists = accounts.some((item) => item.id === accountId)
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 })
    }

    if (action === "set_primary") {
      await updateIntegrationsConfig({
        gmail: deriveGmailAfterSetPrimary(current.gmail, accountId),
      }, verified)
      logGmailApi("accounts.patch.success", {
        userContextId: verified.user.id,
        action,
        accountId,
      })
      return NextResponse.json({ ok: true })
    }

    if (action === "set_enabled") {
      const enabled = parsed.data.enabled
      await updateIntegrationsConfig({
        gmail: deriveGmailAfterSetEnabled(current.gmail, accountId, enabled),
      }, verified)
      logGmailApi("accounts.patch.success", {
        userContextId: verified.user.id,
        action,
        accountId,
        enabled,
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 })
  } catch (error) {
    return gmailApiErrorResponse(error, "Failed to update Gmail account.")
  }
}
