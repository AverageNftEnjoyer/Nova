import { NextResponse } from "next/server"

import { buildGmailOAuthUrl } from "@/lib/integrations/gmail"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  try {
    const url = new URL(req.url)
    const returnTo = String(url.searchParams.get("returnTo") || "/integrations")
    const authUrl = await buildGmailOAuthUrl(returnTo)
    if (url.searchParams.get("mode") === "json") {
      return NextResponse.json({ ok: true, authUrl })
    }
    return NextResponse.redirect(authUrl, { status: 302 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to start Gmail OAuth." },
      { status: 500 },
    )
  }
}
