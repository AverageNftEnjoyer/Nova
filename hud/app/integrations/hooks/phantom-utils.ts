import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import { normalizePhantomIntegrationConfig } from "@/lib/integrations/phantom/types"

export function normalizePhantomSettingsForUi(config: unknown): IntegrationsSettings["phantom"] {
  return normalizePhantomIntegrationConfig(config)
}
