import "server-only"

import { INTEGRATION_SETUP_KEYS, type IntegrationSetupKey } from "@/lib/integrations/navigation"
import { loadIntegrationsConfig, type IntegrationsConfig } from "@/lib/integrations/store/server-store"
import { buildTownProgress } from "./progress"
import type { TownProgress } from "./types"

export { applyTownAck, parseTownAckRequest } from "./progress"

/** The config section behind each setup key (Google Calendar is stored as `gcalendar`). */
function isConnected(config: IntegrationsConfig, key: IntegrationSetupKey): boolean {
  const section = key === "gmail-calendar" ? config.gcalendar : config[key]
  return Boolean(section?.connected)
}

/** Connected integrations, from the same `connected` flags Home uses for its signs (use-home-integrations). */
export async function readConnectedIntegrations(userId: string): Promise<Set<IntegrationSetupKey>> {
  const config = await loadIntegrationsConfig({ userId })
  return new Set(INTEGRATION_SETUP_KEYS.filter((key) => isConnected(config, key)))
}

export async function loadTownProgress(userId: string, timeZone: string): Promise<TownProgress> {
  const connected = await readConnectedIntegrations(userId)
  return buildTownProgress(userId, { timeZone, connected })
}
