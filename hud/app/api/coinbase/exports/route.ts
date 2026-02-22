import { NextResponse } from "next/server"

import { createCoinbaseStore, reportsToCsv, transactionsToCsv } from "@/lib/coinbase/reporting"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function normalizeFormat(value: string): "json" | "csv" {
  return String(value || "").trim().toLowerCase() === "csv" ? "csv" : "json"
}

function normalizeKind(value: string): "reports" | "transactions" {
  return String(value || "").trim().toLowerCase() === "transactions" ? "transactions" : "reports"
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const url = new URL(req.url)
  const format = normalizeFormat(url.searchParams.get("format") || "json")
  const kind = normalizeKind(url.searchParams.get("kind") || "reports")
  const limit = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get("limit") || "500", 10) || 500))
  const userContextId = String(verified.user.id || "").trim().toLowerCase()
  if (!userContextId) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const store = await createCoinbaseStore(userContextId)
  try {
    if (kind === "reports") {
      const rows = store.listReportHistory(userContextId, limit)
      if (format === "csv") {
        return new NextResponse(reportsToCsv(rows), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="coinbase-reports-${userContextId}.csv"`,
          },
        })
      }
      return NextResponse.json({ ok: true, kind, count: rows.length, rows })
    }

    const privacy = store.getPrivacySettings(userContextId)
    if (privacy.requireTransactionConsent && !privacy.transactionHistoryConsentGranted) {
      return NextResponse.json(
        {
          ok: false,
          error: "Transaction-history consent is required before exporting Coinbase transactions.",
          guidance: "Enable Coinbase transaction-history consent in privacy controls.",
        },
        { status: 403 },
      )
    }
    const rows = store.listSnapshots(userContextId, "transactions", limit)
    if (format === "csv") {
      return new NextResponse(transactionsToCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="coinbase-transactions-${userContextId}.csv"`,
        },
      })
    }
    return NextResponse.json({ ok: true, kind, count: rows.length, rows })
  } finally {
    store.close()
  }
}
