import { NextResponse } from "next/server"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog/server"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { requireSupabaseApiUser } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { unauthorized, verified } = await requireSupabaseApiUser(req)
  if (unauthorized || !verified) return unauthorized ?? NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 })

  const [catalog, config] = await Promise.all([loadIntegrationCatalog(verified), loadIntegrationsConfig(verified)])
  return NextResponse.json({
    catalog,
    updatedAt: config.updatedAt,
  })
}
