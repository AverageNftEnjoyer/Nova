import {
  GROK_DEFAULT_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_MODEL_SELECT_OPTIONS,
} from "../constants"
import {
  useLlmProviderSetup,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./use-llm-provider-setup"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { Dispatch, SetStateAction } from "react"

interface UseGrokSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
}

export function useGrokSetup(params: UseGrokSetupParams) {
  return useLlmProviderSetup({
    provider: "grok",
    label: "Grok",
    defaultBaseUrl: GROK_DEFAULT_BASE_URL,
    defaultModel: GROK_DEFAULT_MODEL,
    defaultModelOptions: GROK_MODEL_SELECT_OPTIONS,
    testModelEndpoint: "/api/integrations/test-grok-model",
    unavailableErrorMessage: "Saved, but selected Grok model is unavailable.",
    ...params,
  })
}
