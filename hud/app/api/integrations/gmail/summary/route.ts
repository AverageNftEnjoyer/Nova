import { NextResponse } from "next/server"

import { listRecentGmailMessages } from "@/lib/integrations/gmail"
import { completeWithConfiguredLlm } from "@/lib/missions/runtime"
import { checkUserRateLimit, rateLimitExceededResponse, RATE_LIMIT_POLICIES } from "@/lib/security/rate-limit"
import { requireSupabaseApiUser } from "@/lib/supabase/server"
import { gmailApiErrorResponse, logGmailApi, safeJson, summaryInputSchema } from "@/app/api/integrations/gmail/_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handleSummary(req: Request, input: { maxResults?: unknown; accountId?: unknown }) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })
  const limit = checkUserRateLimit(verified.user.id, RATE_LIMIT_POLICIES.integrationModelProbe)
  if (!limit.allowed) return rateLimitExceededResponse(limit)

  try {
    const parsed = summaryInputSchema.safeParse(input)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 })
    }
    const { maxResults, accountId } = parsed.data
    logGmailApi("summary.begin", {
      userContextId: verified.user.id,
      maxResults,
      accountId: accountId || "active",
    })
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
    return gmailApiErrorResponse(error, "Failed to summarize Gmail inbox.")
  }
}

export async function POST(req: Request) {
  const body = (await safeJson(req)) as { maxResults?: number; accountId?: string }
  return handleSummary(req, body)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  return handleSummary(req, {
    maxResults: url.searchParams.get("maxResults"),
    accountId: url.searchParams.get("accountId"),
  })
}
