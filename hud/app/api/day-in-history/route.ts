import { NextResponse } from "next/server"

import { checkUserRateLimit, RATE_LIMIT_POLICIES, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const API_BASE = "https://api.api-ninjas.com/v1/dayinhistory"
const API_KEY = String(process.env.NOVA_DAY_IN_HISTORY_API_KEY || "").trim()
const FETCH_TIMEOUT_MS = 6_000

interface DayInHistoryEvent {
  year: number
  month: number
  day: number
  event: string
}

let cachedDate = ""
let cachedEvents: DayInHistoryEvent[] = []

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) {
    return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  }

  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.coinbaseMarketRead)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  if (!API_KEY) {
    return NextResponse.json({ ok: false, error: "NOVA_DAY_IN_HISTORY_API_KEY not configured." }, { status: 503 })
  }

  const key = todayKey()
  if (cachedDate === key && cachedEvents.length > 0) {
    return NextResponse.json({ ok: true, events: cachedEvents, cached: true, date: key })
  }

  // Free tier: no params allowed (month/day/limit are premium-only).
  // Returns 1 event for today's date.
  const url = API_BASE

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      headers: { "X-Api-Key": API_KEY },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `API returned ${res.status}` }, { status: 502 })
    }

    const data: DayInHistoryEvent[] = await res.json()
    if (!Array.isArray(data)) {
      return NextResponse.json({ ok: false, error: "Unexpected response format." }, { status: 502 })
    }

    cachedDate = key
    cachedEvents = data
    return NextResponse.json({ ok: true, events: data, cached: false, date: key })
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error && err.name === "AbortError" ? "Request timed out" : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
