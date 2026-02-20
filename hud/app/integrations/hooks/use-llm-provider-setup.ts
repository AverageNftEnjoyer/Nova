import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations/client-store"
import type { FluidSelectOption } from "@/components/ui/fluid-select"

export type IntegrationsSaveTarget =
  | null
  | "telegram"
  | "discord"
  | "brave"
  | "coinbase"
  | "openai"
  | "claude"
  | "grok"
  | "gemini"
  | "gmail-oauth"
  | "gmail-disconnect"
  | "gmail-primary"
  | "gmail-account"
  | "provider"

export type IntegrationsSaveStatus = null | { type: "success" | "error"; message: string }

interface UseLlmProviderSetupParams {
  provider: LlmProvider
  label: string
  settings: IntegrationsSettings
  setSettings: Dispatch<SetStateAction<IntegrationsSettings>>
  setIsSavingTarget: Dispatch<SetStateAction<IntegrationsSaveTarget>>
  setSaveStatus: Dispatch<SetStateAction<IntegrationsSaveStatus>>
  defaultBaseUrl: string
  defaultModel: string
  defaultModelOptions: FluidSelectOption[]
  testModelEndpoint: string
  listModelsEndpoint?: string
  unavailableErrorMessage: string
  sortModelOptions?: (options: FluidSelectOption[]) => FluidSelectOption[]
}

interface RefreshOverride {
  apiKey?: string
  baseUrl?: string
}

export function useLlmProviderSetup({
  provider,
  label,
  settings,
  setSettings,
  setIsSavingTarget,
  setSaveStatus,
  defaultBaseUrl,
  defaultModel,
  defaultModelOptions,
  testModelEndpoint,
  listModelsEndpoint,
  unavailableErrorMessage,
  sortModelOptions,
}: UseLlmProviderSetupParams) {
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl)
  const [model, setModel] = useState(defaultModel)
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyMasked, setApiKeyMasked] = useState("")
  const [modelOptions, setModelOptions] = useState<FluidSelectOption[]>(defaultModelOptions)

  const hydrate = useCallback((nextSettings: IntegrationsSettings) => {
    const source = nextSettings[provider]
    setApiKey(source.apiKey || "")
    setBaseUrl(source.baseUrl || defaultBaseUrl)
    setModel(source.defaultModel || defaultModel)
    setApiKeyConfigured(Boolean(source.apiKeyConfigured))
    setApiKeyMasked(source.apiKeyMasked || "")
  }, [defaultBaseUrl, defaultModel, provider])

  const refreshModels = useCallback(async (override?: RefreshOverride) => {
    if (!listModelsEndpoint) return
    const key = override?.apiKey ?? apiKey
    const base = override?.baseUrl ?? baseUrl
    if (!apiKeyConfigured && !key.trim()) {
      setModelOptions(defaultModelOptions)
      return
    }

    try {
      const res = await fetch(listModelsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key.trim() || undefined,
          baseUrl: base.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok || !Array.isArray(data?.models)) return
      const dynamicOptions = data.models
        .map((item: { id?: string; label?: string }) => ({ value: String(item.id || ""), label: String(item.label || item.id || "") }))
        .filter((item: FluidSelectOption) => item.value.length > 0)

      const merged = new Map<string, FluidSelectOption>()
      defaultModelOptions.forEach((option) => merged.set(option.value, option))
      dynamicOptions.forEach((option: FluidSelectOption) => merged.set(option.value, option))
      const selected = model.trim()
      if (selected && !merged.has(selected)) {
        merged.set(selected, { value: selected, label: selected })
      }
      const mergedOptions = Array.from(merged.values())
      setModelOptions(sortModelOptions ? sortModelOptions(mergedOptions) : mergedOptions)
    } catch {
      // Keep current fallback options on network/credential failure.
    }
  }, [apiKey, apiKeyConfigured, baseUrl, defaultModelOptions, listModelsEndpoint, model, sortModelOptions])

  useEffect(() => {
    if (!listModelsEndpoint) return
    void refreshModels()
  }, [apiKeyConfigured, listModelsEndpoint, refreshModels])

  const toggle = useCallback(async () => {
    const current = settings[provider]
    if (!current.connected) {
      setSaveStatus({
        type: "error",
        message: `${label} stays inactive until a valid API key + model is saved.`,
      })
      return
    }

    const next = {
      ...settings,
      [provider]: {
        ...current,
        connected: false,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget(provider)
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: { connected: false } }),
      })
      if (!res.ok) throw new Error(`Failed to update ${label} status`)
      setSaveStatus({
        type: "success",
        message: `${label} disabled.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: `Failed to update ${label} status. Try again.`,
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [label, provider, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const save = useCallback(async () => {
    const trimmedApiKey = apiKey.trim()
    const payload: Record<string, string> = {
      baseUrl: baseUrl.trim() || defaultBaseUrl,
      defaultModel: model.trim() || defaultModel,
    }
    if (trimmedApiKey) payload.apiKey = trimmedApiKey

    const next = {
      ...settings,
      [provider]: {
        ...settings[provider],
        ...payload,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget(provider)

    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: payload }),
      })
      if (!saveRes.ok) throw new Error(`Failed to save ${label} configuration`)
      const savedData = await saveRes.json().catch(() => ({}))
      const savedProvider = savedData?.config?.[provider]
      const masked = typeof savedProvider?.apiKeyMasked === "string" ? savedProvider.apiKeyMasked : ""
      const configured = Boolean(savedProvider?.apiKeyConfigured) || trimmedApiKey.length > 0
      setApiKey("")
      setApiKeyMasked(masked)
      setApiKeyConfigured(configured)

      if (listModelsEndpoint) {
        await refreshModels({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payload.baseUrl,
        })
      }

      const modelRes = await fetch(testModelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payload.baseUrl,
          model: payload.defaultModel,
        }),
      })
      const modelData = await modelRes.json().catch(() => ({}))
      if (!modelRes.ok || !modelData?.ok) {
        throw new Error(modelData?.error || unavailableErrorMessage)
      }

      const enableRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: { connected: true } }),
      })
      if (!enableRes.ok) throw new Error(`Model validated, but failed to activate ${label}.`)
      setSettings((prev) => {
        const updated = {
          ...prev,
          [provider]: {
            ...prev[provider],
            connected: true,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })

      setSaveStatus({
        type: "success",
        message: `${label} saved and verified (${payload.defaultModel}).`,
      })
    } catch (error) {
      void fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: { connected: false } }),
      }).catch(() => {})
      setSettings((prev) => {
        const updated = {
          ...prev,
          [provider]: {
            ...prev[provider],
            connected: false,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : `Could not save ${label} configuration.`,
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [
    apiKey,
    baseUrl,
    defaultBaseUrl,
    defaultModel,
    label,
    listModelsEndpoint,
    model,
    provider,
    refreshModels,
    setIsSavingTarget,
    setSaveStatus,
    setSettings,
    settings,
    testModelEndpoint,
    unavailableErrorMessage,
  ])

  const persistedModel = useMemo(() => model.trim() || defaultModel, [defaultModel, model])

  return {
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    apiKeyConfigured,
    apiKeyMasked,
    modelOptions,
    hydrate,
    toggle,
    save,
    persistedModel,
  }
}
