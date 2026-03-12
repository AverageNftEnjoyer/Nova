import { NextResponse } from "next/server"

import { buildIntegrationsHref } from "@/lib/integrations/navigation"
import { PHANTOM_APP_URL } from "@/lib/integrations/phantom/browser"
import { openExternalBrowser } from "@/lib/integrations/phantom/external-browser"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PhantomBrowserTarget = "connect" | "install"

function resolveTargetUrl(req: Request, target: PhantomBrowserTarget): string {
  if (target === "install") {
    return PHANTOM_APP_URL
  }
  const base = new URL(req.url)
  return new URL(buildIntegrationsHref("phantom"), base).toString()
}

export async function POST(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const body = await req.json()
  const target = body && typeof body === "object" && body.target === "install" ? "install" : "connect"
  const url = resolveTargetUrl(req, target)
  const opened = await openExternalBrowser(url)

  if (!opened) {
    return NextResponse.json(
      {
        ok: false,
        error: target === "install"
          ? "Failed to open Phantom in an external browser."
          : "Failed to open Nova in an external browser.",
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, target, url })
}
