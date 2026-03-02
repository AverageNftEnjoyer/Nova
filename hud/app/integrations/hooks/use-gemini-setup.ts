import {
  GEMINI_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  GEMINI_MODEL_OPTIONS,
  GEMINI_MODEL_SELECT_OPTIONS,
} from "../constants"
import {
  useLlmProviderSetup,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./use-llm-provider-setup"
import type { IntegrationsSettings } from "@/lib/integrations/store/client-store"
import type { Dispatch, SetStateAction } from "react"
import type { FluidSelectOption } from "@/components/ui/fluid-select"

interface UseGeminiSetupParams {
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
}

function sortGeminiOptions(options: FluidSelectOption[]) {
  const curatedOrder = new Map(GEMINI_MODEL_OPTIONS.map((option, index) => [option.value, index]))
  const parseGeminiVersion = (value: string): number => {
    const match = value.toLowerCase().match(/gemini-(\d+(?:\.\d+)?)/)
    if (!match) return 0
    const parsed = Number.parseFloat(match[1] || "0")
    return Number.isFinite(parsed) ? parsed : 0
  }
  const tierRank = (value: string): number => {
    const normalized = value.toLowerCase()
    if (normalized.includes("pro")) return 0
    if (normalized.includes("flash-lite")) return 2
    if (normalized.includes("flash")) return 1
    return 3
  }

  return [...options].sort((a, b) => {
    const aCuratedIdx = curatedOrder.get(a.value)
    const bCuratedIdx = curatedOrder.get(b.value)
    if (typeof aCuratedIdx === "number" && typeof bCuratedIdx === "number") {
      return aCuratedIdx - bCuratedIdx
    }
    if (typeof aCuratedIdx === "number") return -1
    if (typeof bCuratedIdx === "number") return 1

    const versionDiff = parseGeminiVersion(b.value) - parseGeminiVersion(a.value)
    if (versionDiff !== 0) return versionDiff

    const tierDiff = tierRank(a.value) - tierRank(b.value)
    if (tierDiff !== 0) return tierDiff

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
