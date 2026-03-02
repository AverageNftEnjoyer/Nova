import {
  CLAUDE_DEFAULT_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_SELECT_FALLBACK,
  sortClaudeOptions,
} from "../constants"
import {
  useLlmProviderSetup,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./use-llm-provider-setup"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { Dispatch, SetStateAction } from "react"

interface UseClaudeSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
}

export function useClaudeSetup(params: UseClaudeSetupParams) {
  return useLlmProviderSetup({
    provider: "claude",
    label: "Claude",
    defaultBaseUrl: CLAUDE_DEFAULT_BASE_URL,
    defaultModel: CLAUDE_DEFAULT_MODEL,
    defaultModelOptions: CLAUDE_MODEL_SELECT_FALLBACK,
    testModelEndpoint: "/api/integrations/test-claude-model",
    listModelsEndpoint: "/api/integrations/list-claude-models",
    sortModelOptions: sortClaudeOptions,
    unavailableErrorMessage: "Saved, but selected Claude model is unavailable.",
    ...params,
  })
}
