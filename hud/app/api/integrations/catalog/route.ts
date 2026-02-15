import { NextResponse } from "next/server"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"
import { requireApiSession } from "@/lib/security/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const unauthorized = await requireApiSession(req)
  if (unauthorized) return unauthorized

  const [catalog, config] = await Promise.all([loadIntegrationCatalog(), loadIntegrationsConfig()])
  return NextResponse.json({
    catalog,
    updatedAt: config.updatedAt,
  })
}
