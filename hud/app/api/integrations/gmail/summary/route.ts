import { NextResponse } from "next/server"

import { listRecentGmailMessages } from "@/lib/integrations/gmail"
import { completeWithConfiguredLlm } from "@/lib/missions/runtime"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseMaxResults(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 8
  if (!Number.isFinite(raw)) return 8
  return Math.max(1, Math.min(25, Math.floor(raw)))
}

async function handleSummary(req: Request, input: { maxResults?: unknown; accountId?: unknown }) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const maxResults = parseMaxResults(input.maxResults)
    const accountId = typeof input.accountId === "string" ? input.accountId.trim().toLowerCase() : undefined
    const emails = await listRecentGmailMessages(maxResults, accountId, verified)
    if (emails.length === 0) {
      return NextResponse.json({
        ok: true,
        summary: "No recent inbox emails found.",
        emails: [],
      })
    }

    const digestInput = emails.map((email, idx) =>
      `${idx + 1}. From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\nSnippet: ${email.snippet}`,
    ).join("\n\n")
    const completion = await completeWithConfiguredLlm(
      "You summarize inbox emails for an automation dashboard. Produce concise bullets: urgent, action-needed, and FYI.",
      `Summarize these recent inbox emails:\n\n${digestInput}`,
      700,
      verified,
    )

    return NextResponse.json({
      ok: true,
      provider: completion.provider,
      model: completion.model,
      summary: completion.text || "Summary unavailable.",
      emails,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to summarize Gmail inbox." },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { maxResults?: number; accountId?: string }
  return handleSummary(req, body)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  return handleSummary(req, {
    maxResults: url.searchParams.get("maxResults"),
    accountId: url.searchParams.get("accountId"),
  })
}
