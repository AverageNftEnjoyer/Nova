import { NextResponse } from "next/server"

import { requireLocalUser } from "@/lib/auth/local-user"
import {
  listConfiguredLlmProviders,
  resolveConfiguredLlmProvider,
} from "@/lib/integrations/llm/provider-selection"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const { userId } = await requireLocalUser()
  const config = await loadIntegrationsConfig({ userId })
  const providers = listConfiguredLlmProviders(config)

  let active: { provider: string; model: string } | null = null
  try {
    active = resolveConfiguredLlmProvider(config)
  } catch {
    // The form can still offer another connected provider when the saved active provider is incomplete.
  }

  return NextResponse.json({ ok: true, providers, active })
}
