import type { AgentTaskBudgetProvider } from "@/lib/agents/types"
import type {
  ModelRoutingMode,
  ModelRoutingSettings,
} from "../../../../src/runtime/modules/model-routing/index.js"

export type { ModelRoutingMode, ModelRoutingSettings }

/** GET /api/model-routing (PUT returns the same shape). Never carries secrets. */
export interface ModelRoutingSettingsResponse {
  settings: ModelRoutingSettings
  defaultMode: ModelRoutingMode
  modes: ModelRoutingMode[]
  /** The per-provider economy model (Settings -> Agent budgets, the single source of truth). */
  economyModels: Record<AgentTaskBudgetProvider, string>
  /** Display label of each economy model (the model id when it is not in the provider's picker list). */
  economyModelLabels: Record<AgentTaskBudgetProvider, string>
  /** The active chat provider and its selected model; null when the integrations config can't be read. */
  activeProvider: AgentTaskBudgetProvider | null
  activeModel: string | null
}

/** PUT /api/model-routing body. */
export interface ModelRoutingSettingsUpdate {
  mode: ModelRoutingMode
}
