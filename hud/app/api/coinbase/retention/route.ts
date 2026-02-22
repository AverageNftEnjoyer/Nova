import { NextResponse } from "next/server"

import { createCoinbaseStore } from "@/lib/coinbase/reporting"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    return NextResponse.json({ ok: true, retention: store.getRetentionSettings(userContextId) })
  } finally {
    store.close()
  }
}

export async function PATCH(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const userContextId = String(verified.user.id || "").trim().toLowerCase()
  const body = await req.json().catch(() => ({})) as {
    reportRetentionDays?: number
    snapshotRetentionDays?: number
    transactionRetentionDays?: number
  }
  const store = await createCoinbaseStore(userContextId)
  try {
    const next = store.setRetentionSettings({
      userContextId,
      reportRetentionDays: safeDays(body.reportRetentionDays),
      snapshotRetentionDays: safeDays(body.snapshotRetentionDays),
      transactionRetentionDays: safeDays(body.transactionRetentionDays),
    })
    store.appendAuditLog({
      userContextId,
      eventType: "coinbase.retention.update",
      status: "ok",
      details: {
        reportRetentionDays: next.reportRetentionDays,
        snapshotRetentionDays: next.snapshotRetentionDays,
        transactionRetentionDays: next.transactionRetentionDays,
      },
    })
    return NextResponse.json({ ok: true, retention: next })
  } finally {
    store.close()
  }
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const userContextId = String(verified.user.id || "").trim().toLowerCase()
  const body = await req.json().catch(() => ({})) as { action?: string }
  if (String(body.action || "").trim().toLowerCase() !== "prune_now") {
    return NextResponse.json({ ok: false, error: "Unsupported action. Use action=prune_now." }, { status: 400 })
  }
  const store = await createCoinbaseStore(userContextId)
  try {
    const result = store.pruneForUser(userContextId)
    store.appendAuditLog({
      userContextId,
      eventType: "coinbase.retention.prune",
      status: "ok",
      details: result,
    })
    return NextResponse.json({ ok: true, pruned: result })
  } finally {
    store.close()
  }
}
