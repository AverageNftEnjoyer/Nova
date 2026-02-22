import { NextResponse } from "next/server"

import { createCoinbaseStore } from "@/lib/coinbase/reporting"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  return undefined
}

function safeDays(value: unknown): number | undefined {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(1, Math.min(3650, parsed))
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const userContextId = String(verified.user.id || "").trim().toLowerCase()
  const store = await createCoinbaseStore(userContextId)
  try {
    return NextResponse.json({
      ok: true,
      privacy: store.getPrivacySettings(userContextId),
      retention: store.getRetentionSettings(userContextId),
    })
  } finally {
    store.close()
  }
}

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const userContextId = String(verified.user.id || "").trim().toLowerCase()
  const body = (await req.json().catch(() => ({}))) as {
    showBalances?: boolean
    showTransactions?: boolean
    requireTransactionConsent?: boolean
    transactionHistoryConsentGranted?: boolean
    reportRetentionDays?: number
    snapshotRetentionDays?: number
    transactionRetentionDays?: number
  }
  const store = await createCoinbaseStore(userContextId)
  try {
    const privacy = store.setPrivacySettings({
      userContextId,
      showBalances: toOptionalBool(body.showBalances),
      showTransactions: toOptionalBool(body.showTransactions),
      requireTransactionConsent: toOptionalBool(body.requireTransactionConsent),
      transactionHistoryConsentGranted: toOptionalBool(body.transactionHistoryConsentGranted),
    })
    const retention = store.setRetentionSettings({
      userContextId,
      reportRetentionDays: safeDays(body.reportRetentionDays),
      snapshotRetentionDays: safeDays(body.snapshotRetentionDays),
      transactionRetentionDays: safeDays(body.transactionRetentionDays),
    })
    store.appendAuditLog({
      userContextId,
      eventType: "coinbase.privacy.update",
      status: "ok",
      details: {
        privacy,
        retention,
      },
    })
    return NextResponse.json({ ok: true, privacy, retention })
  } finally {
    store.close()
  }
}
