import { NextResponse } from "next/server"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog-server"
import { loadIntegrationsConfig } from "@/lib/integrations/server-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const [catalog, config] = await Promise.all([loadIntegrationCatalog(), loadIntegrationsConfig()])
  return NextResponse.json({
    catalog,
    updatedAt: config.updatedAt,
  })
}
