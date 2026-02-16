import { NextResponse } from "next/server"

import { buildGmailOAuthUrl } from "@/lib/integrations/gmail"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  try {
    const url = new URL(req.url)
    const returnTo = String(url.searchParams.get("returnTo") || "/integrations")
    const authUrl = await buildGmailOAuthUrl(returnTo, verified)
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
