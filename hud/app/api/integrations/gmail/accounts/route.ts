import { NextResponse } from "next/server"

import { disconnectGmail } from "@/lib/integrations/gmail"
import { loadIntegrationsConfig, updateIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body =
  | { action: "set_primary"; accountId?: string }
  | { action: "set_enabled"; accountId?: string; enabled?: boolean }
  | { action: "delete"; accountId?: string }

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const body = (await req.json().catch(() => ({}))) as Body
    const action = String((body as { action?: string }).action || "").trim()
    const accountId = String((body as { accountId?: string }).accountId || "").trim().toLowerCase()
    if (!accountId) {
      return NextResponse.json({ ok: false, error: "accountId is required." }, { status: 400 })
    }

    if (action === "delete") {
      await disconnectGmail(accountId, verified)
      return NextResponse.json({ ok: true })
    }

    const current = await loadIntegrationsConfig(verified)
    const accounts = current.gmail.accounts
    const exists = accounts.some((item) => item.id === accountId)
    if (!exists) {
      return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 })
    }

    if (action === "set_primary") {
      const target = accounts.find((item) => item.id === accountId)
      if (!target || !target.enabled) {
        return NextResponse.json({ ok: false, error: "Only enabled accounts can be primary." }, { status: 400 })
      }
      await updateIntegrationsConfig({
        gmail: {
          ...current.gmail,
          activeAccountId: accountId,
          email: target.email,
          scopes: target.scopes,
          accessTokenEnc: target.accessTokenEnc,
          refreshTokenEnc: target.refreshTokenEnc,
          tokenExpiry: target.tokenExpiry,
          connected: true,
        },
      }, verified)
      return NextResponse.json({ ok: true })
    }

    if (action === "set_enabled") {
      const enabled = Boolean((body as { enabled?: boolean }).enabled)
      const nextAccounts = accounts.map((item) =>
        item.id === accountId
          ? { ...item, enabled }
          : item,
      )
      const enabledAccounts = nextAccounts.filter((item) => item.enabled)
      const nextActive = enabledAccounts.find((item) => item.id === current.gmail.activeAccountId) || enabledAccounts[0] || null
      await updateIntegrationsConfig({
        gmail: {
          ...current.gmail,
          accounts: nextAccounts,
          connected: enabledAccounts.length > 0,
          activeAccountId: nextActive?.id || "",
          email: nextActive?.email || "",
          scopes: nextActive?.scopes || [],
          accessTokenEnc: nextActive?.accessTokenEnc || "",
          refreshTokenEnc: nextActive?.refreshTokenEnc || "",
          tokenExpiry: nextActive?.tokenExpiry || 0,
        },
      }, verified)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update Gmail account." },
      { status: 500 },
    )
  }
}
