"use client"

import { useCallback, useEffect, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { formatCompactModelLabel } from "@/lib/integrations/llm/model-label"
import { INTEGRATION_SETUP_KEYS, integrationSetupLabel, type IntegrationSetupKey } from "@/lib/integrations/navigation"
import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings, type LlmProvider } from "@/lib/integrations/store/client-store"

export interface HomeConnection {
  key: IntegrationSetupKey
  label: string
  connected: boolean
  /** A problem the integration itself reported (e.g. a failed Coinbase sync). */
  problem: string | null
}

export interface HomeConnectionsState {
  connections: HomeConnection[]
  /** "GPT-5.6 Terra" for the active provider when that provider is connected; null otherwise. */
  activeModelLabel: string | null
  /** True until the server config has answered once (the local cache renders meanwhile). */
  loading: boolean
  error: string | null
  refresh: () => void
}

type ConfigRecord = Record<string, unknown>

const PROVIDERS: readonly LlmProvider[] = ["openai", "claude", "grok", "gemini"]

/** The config object key for a setup key (the calendar setup is stored as `gcalendar`). */
function configKey(key: IntegrationSetupKey): string {
  return key === "gmail-calendar" ? "gcalendar" : key
}

function asRecord(value: unknown): ConfigRecord {
  return value && typeof value === "object" ? (value as ConfigRecord) : {}
}

function readProblem(key: IntegrationSetupKey, entry: ConfigRecord): string | null {
  if (key === "coinbase" && entry.connected && entry.lastSyncStatus === "error") {
    const message = typeof entry.lastSyncErrorMessage === "string" ? entry.lastSyncErrorMessage.trim() : ""
    return message || "The last sync failed."
  }
  return null
}

function fromConfig(config: ConfigRecord): Pick<HomeConnectionsState, "connections" | "activeModelLabel"> {
  const connections = INTEGRATION_SETUP_KEYS.map((key) => {
    const entry = asRecord(config[configKey(key)])
    return { key, label: integrationSetupLabel(key), connected: Boolean(entry.connected), problem: readProblem(key, entry) }
  })
  const provider = PROVIDERS.find((candidate) => candidate === config.activeLlmProvider) ?? "openai"
  const providerEntry = asRecord(config[provider])
  const model = typeof providerEntry.defaultModel === "string" ? providerEntry.defaultModel : ""
  const activeModelLabel = providerEntry.connected && model.trim() ? formatCompactModelLabel(provider, model) : null
  return { connections, activeModelLabel }
}

function fromLocalCache(): Pick<HomeConnectionsState, "connections" | "activeModelLabel"> {
  return fromConfig(loadIntegrationsSettings() as unknown as ConfigRecord)
}

/** Connection flags for every integration plus the active model label, from GET /api/integrations/config. */
export function useHomeConnections(): HomeConnectionsState {
  const [state, setState] = useState<Omit<HomeConnectionsState, "refresh">>(() => ({
    ...fromLocalCache(),
    loading: true,
    error: null,
  }))

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = (await res.json().catch(() => null)) as { config?: unknown; error?: string } | null
      if (!res.ok || !data?.config) throw new Error(data?.error || `Integrations request failed (${res.status}).`)
      setState({ ...fromConfig(asRecord(data.config)), loading: false, error: null })
    } catch (err) {
      setState((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : "Could not load integrations." }))
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const onChange = () => void load()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onChange)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onChange)
    return () => {
      window.clearTimeout(initial)
      window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onChange)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onChange)
    }
  }, [load])

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
    void load()
  }, [load])

  return { ...state, refresh }
}
