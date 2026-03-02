import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODEL_SELECT_OPTIONS,
} from "../constants"
import {
  useLlmProviderSetup,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./use-llm-provider-setup"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { Dispatch, SetStateAction } from "react"

interface UseOpenAISetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
}

export function useOpenAISetup(params: UseOpenAISetupParams) {
  return useLlmProviderSetup({
    provider: "openai",
    label: "OpenAI",
    defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
    defaultModel: OPENAI_DEFAULT_MODEL,
    defaultModelOptions: OPENAI_MODEL_SELECT_OPTIONS,
    testModelEndpoint: "/api/integrations/test-openai-model",
    unavailableErrorMessage: "Saved, but selected model is unavailable.",
    ...params,
  })
}
