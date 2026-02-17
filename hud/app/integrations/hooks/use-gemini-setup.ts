import {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_SELECT_OPTIONS,
} from "../constants"
import {
  useLlmProviderSetup,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./use-llm-provider-setup"
import type { IntegrationsSettings } from "@/lib/integrations/client-store"
import type { Dispatch, SetStateAction } from "react"
import type { FluidSelectOption } from "@/components/ui/fluid-select"

interface UseGeminiSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
}

function sortGeminiOptions(options: FluidSelectOption[]) {
  return [...options].sort((a, b) => {
    const aValue = a.value.toLowerCase()
    const bValue = b.value.toLowerCase()
    const aPro = aValue.includes("pro") ? 1 : 0
    const bPro = bValue.includes("pro") ? 1 : 0
    if (aPro !== bPro) return bPro - aPro
    return a.label.localeCompare(b.label)
  })
}

export function useGeminiSetup(params: UseGeminiSetupParams) {
  return useLlmProviderSetup({
    provider: "gemini",
    label: "Gemini",
    defaultBaseUrl: GEMINI_DEFAULT_BASE_URL,
    defaultModel: GEMINI_DEFAULT_MODEL,
    defaultModelOptions: GEMINI_MODEL_SELECT_OPTIONS,
    testModelEndpoint: "/api/integrations/test-gemini-model",
    listModelsEndpoint: "/api/integrations/list-gemini-models",
    sortModelOptions: sortGeminiOptions,
    unavailableErrorMessage: "Saved, but selected Gemini model is unavailable.",
    ...params,
  })
}
