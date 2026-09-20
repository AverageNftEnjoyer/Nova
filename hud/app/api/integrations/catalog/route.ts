import { NextResponse } from "next/server"
import { requireLocalUser } from "@/lib/auth/local-user"

import { loadIntegrationCatalog } from "@/lib/integrations/catalog/server"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { userId } = await requireLocalUser()

  const [catalog, config] = await Promise.all([loadIntegrationCatalog(verified), loadIntegrationsConfig({ userId })])
  return NextResponse.json({
    catalog,
    updatedAt: config.updatedAt,
  })
}
