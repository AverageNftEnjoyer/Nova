/**
 * Mission Generation - V.29 Native
 */

import "server-only"

import type { IntegrationsStoreScope } from "@/lib/integrations/store/server-store"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { loadIntegrationCatalog } from "@/lib/integrations/catalog/server"
import { parseJsonObject } from "@/lib/missions/text/cleaning"
import type {
  Mission,
  MissionCategory,
  Provider,
} from "../types/index"
import { buildMission } from "../store"
import { completeWithConfiguredLlm } from "../llm/providers"
import { runBuildMissionFromPrompt } from "../../../../src/runtime/modules/services/missions/build-from-prompt/index.js"
import { isMissionAgentGraphEnabled, missionUsesAgentGraph } from "./agent-flags"
import { validateMissionGraphForVersioning } from "./versioning"

export interface BuildMissionResult {
  mission: Mission
  provider: Provider
  model: string
}

export async function buildMissionFromPrompt(
  prompt: string,
  options?: {
    userId?: string
    scope?: IntegrationsStoreScope
    chatIds?: string[]
    integration?: string
  },
): Promise<BuildMissionResult> {
  return runBuildMissionFromPrompt(prompt, options, {
    loadIntegrationsConfig,
    loadIntegrationCatalog,
    parseJsonObject,
    completeWithConfiguredLlm,
    isMissionAgentGraphEnabled,
    missionUsesAgentGraph,
    validateMissionGraphForVersioning,
    buildMission,
    warn: console.warn,
  }) as Promise<BuildMissionResult>
}

/**
 * Guess category from mission label and tags.
 * Re-exported for UI use.
 */
export function guessMissionCategory(label: string, tags: string[] = []): MissionCategory {
  const text = `${label} ${tags.join(" ")}`.toLowerCase()
  if (/crypto|bitcoin|eth|coinbase|polymarket|prediction market|market odds|portfolio|pnl/.test(text)) return "finance"
  if (/market|stock|trading|earnings|forex/.test(text)) return "finance"
  if (/deploy|uptime|error|monitor|devops|ci|cd/.test(text)) return "devops"
  if (/seo|lead|ad|campaign|marketing/.test(text)) return "marketing"
  if (/research|brief|news|digest|summary|headline/.test(text)) return "research"
  if (/ecommerce|order|product|shop|inventory/.test(text)) return "ecommerce"
  if (/hr|employee|onboard|leave|payroll/.test(text)) return "hr"
  if (/security|threat|cve|vuln|breach/.test(text)) return "security"
  if (/content|blog|post|social|tweet/.test(text)) return "content"
  if (/weather|remind|habit|travel|personal/.test(text)) return "personal"
  return "research"
}

