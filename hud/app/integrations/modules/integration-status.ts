import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { IntegrationStatus } from "../components/SetupPanelHeader"

export function isIntegrationConnected(settings: IntegrationsSettings, key: IntegrationSetupKey): boolean {
  switch (key) {
    case "gmail-calendar":
      return Boolean(settings.gcalendar?.connected)
    case "slack":
      return Boolean(settings.slack?.connected)
    default:
      return Boolean(settings[key]?.connected)
  }
}

/** Connected / not connected, or error when the integration's last sync or save failed. */
export function integrationStatus(
  settings: IntegrationsSettings,
  key: IntegrationSetupKey,
  failedSetup: IntegrationSetupKey | null,
): IntegrationStatus {
  if (failedSetup === key) return "error"
  if (key === "coinbase" && settings.coinbase.connected && settings.coinbase.lastSyncStatus === "error") return "error"
  return isIntegrationConnected(settings, key) ? "connected" : "disconnected"
}
