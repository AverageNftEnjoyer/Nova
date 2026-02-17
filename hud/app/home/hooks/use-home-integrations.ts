"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  INTEGRATIONS_UPDATED_EVENT,
  loadIntegrationsSettings,
  type IntegrationsSettings,
  type LlmProvider,
  updateBraveIntegrationSettings,
  updateClaudeIntegrationSettings,
  updateDiscordIntegrationSettings,
  updateGeminiIntegrationSettings,
  updateGmailIntegrationSettings,
  updateGrokIntegrationSettings,
  updateOpenAIIntegrationSettings,
  updateTelegramIntegrationSettings,
} from "@/lib/integrations/client-store"
import { compareMissionPriority, parseMissionWorkflowMeta } from "../helpers"
import type { MissionSummary, NotificationSchedule } from "./types"

interface UseHomeIntegrationsInput {
  latestUsage?: { provider?: string; model?: string } | null
}

interface IntegrationConfigShape {
  openai?: { defaultModel?: unknown }
  claude?: { defaultModel?: unknown }
  grok?: { defaultModel?: unknown }
  gemini?: { defaultModel?: unknown }
}

function modelForProvider(provider: LlmProvider, config: IntegrationConfigShape): string {
  if (provider === "claude") return String(config?.claude?.defaultModel || "claude-sonnet-4-20250514")
  if (provider === "grok") return String(config?.grok?.defaultModel || "grok-4-0709")
  if (provider === "gemini") return String(config?.gemini?.defaultModel || "gemini-2.5-pro")
  return String(config?.openai?.defaultModel || "gpt-4.1")
}

function providerFromValue(value: unknown): LlmProvider {
  return value === "claude" || value === "grok" || value === "gemini" ? value : "openai"
}

export function useHomeIntegrations({ latestUsage }: UseHomeIntegrationsInput) {
  const router = useRouter()

  const [notificationSchedules, setNotificationSchedules] = useState<NotificationSchedule[]>([])
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [discordConnected, setDiscordConnected] = useState(false)
  const [braveConnected, setBraveConnected] = useState(false)
  const [openaiConnected, setOpenaiConnected] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [grokConnected, setGrokConnected] = useState(false)
  const [geminiConnected, setGeminiConnected] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [braveConfigured, setBraveConfigured] = useState(false)
  const [openaiConfigured, setOpenaiConfigured] = useState(false)
  const [claudeConfigured, setClaudeConfigured] = useState(false)
  const [grokConfigured, setGrokConfigured] = useState(false)
  const [geminiConfigured, setGeminiConfigured] = useState(false)
  const [gmailTokenConfigured, setGmailTokenConfigured] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [activeLlmModel, setActiveLlmModel] = useState("gpt-4.1")

  const applyLocalSettings = useCallback((settings: IntegrationsSettings) => {
    setTelegramConnected(settings.telegram.connected)
    setDiscordConnected(settings.discord.connected)
    setBraveConnected(settings.brave.connected)
    setOpenaiConnected(settings.openai.connected)
    setClaudeConnected(settings.claude.connected)
    setGrokConnected(settings.grok.connected)
    setGeminiConnected(settings.gemini.connected)
    setGmailConnected(settings.gmail.connected)
    setBraveConfigured(Boolean(settings.brave.apiKeyConfigured))
    setOpenaiConfigured(Boolean(settings.openai.apiKeyConfigured))
    setClaudeConfigured(Boolean(settings.claude.apiKeyConfigured))
    setGrokConfigured(Boolean(settings.grok.apiKeyConfigured))
    setGeminiConfigured(Boolean(settings.gemini.apiKeyConfigured))
    setGmailTokenConfigured(Boolean(settings.gmail.tokenConfigured))
    setActiveLlmProvider(settings.activeLlmProvider)
    setActiveLlmModel(
      settings.activeLlmProvider === "claude"
        ? settings.claude.defaultModel
        : settings.activeLlmProvider === "grok"
          ? settings.grok.defaultModel
          : settings.activeLlmProvider === "gemini"
            ? settings.gemini.defaultModel
            : settings.openai.defaultModel,
    )
  }, [])

  const refreshNotificationSchedules = useCallback(() => {
    void fetch("/api/notifications/schedules", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const schedules = Array.isArray(data?.schedules) ? (data.schedules as NotificationSchedule[]) : []
        setNotificationSchedules(schedules)
      })
      .catch(() => {
        setNotificationSchedules([])
      })
  }, [router])

  useLayoutEffect(() => {
    const local = loadIntegrationsSettings()
    applyLocalSettings(local)
    setIntegrationsHydrated(true)
  }, [applyLocalSettings])

  useEffect(() => {
    void fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/home")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const config = data?.config || {}
        const provider = providerFromValue(config?.activeLlmProvider)
        setTelegramConnected(Boolean(config?.telegram?.connected))
        setDiscordConnected(Boolean(config?.discord?.connected))
        setBraveConnected(Boolean(config?.brave?.connected))
        setOpenaiConnected(Boolean(config?.openai?.connected))
        setClaudeConnected(Boolean(config?.claude?.connected))
        setGrokConnected(Boolean(config?.grok?.connected))
        setGeminiConnected(Boolean(config?.gemini?.connected))
        setGmailConnected(Boolean(config?.gmail?.connected))
        setBraveConfigured(Boolean(config?.brave?.apiKeyConfigured))
        setOpenaiConfigured(Boolean(config?.openai?.apiKeyConfigured))
        setClaudeConfigured(Boolean(config?.claude?.apiKeyConfigured))
        setGrokConfigured(Boolean(config?.grok?.apiKeyConfigured))
        setGeminiConfigured(Boolean(config?.gemini?.apiKeyConfigured))
        setGmailTokenConfigured(Boolean(config?.gmail?.tokenConfigured))
        setActiveLlmProvider(provider)
        setActiveLlmModel(modelForProvider(provider, config))
      })
      .catch(() => {})

    refreshNotificationSchedules()
  }, [refreshNotificationSchedules, router])

  useEffect(() => {
    const onUpdate = () => {
      const local = loadIntegrationsSettings()
      applyLocalSettings(local)
      refreshNotificationSchedules()
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [applyLocalSettings, refreshNotificationSchedules])

  const handleToggleTelegramIntegration = useCallback(() => {
    const next = !telegramConnected
    setTelegramConnected(next)
    updateTelegramIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram: { connected: next } }),
    }).catch(() => {})
  }, [telegramConnected])

  const handleToggleDiscordIntegration = useCallback(() => {
    const next = !discordConnected
    setDiscordConnected(next)
    updateDiscordIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discord: { connected: next } }),
    }).catch(() => {})
  }, [discordConnected])

  const handleToggleBraveIntegration = useCallback(() => {
    if (!braveConnected && !braveConfigured) return
    const next = !braveConnected
    setBraveConnected(next)
    updateBraveIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brave: { connected: next } }),
    }).catch(() => {})
  }, [braveConnected, braveConfigured])

  const handleToggleOpenAIIntegration = useCallback(() => {
    if (!openaiConnected && !openaiConfigured) return
    const next = !openaiConnected
    setOpenaiConnected(next)
    updateOpenAIIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openai: { connected: next } }),
    }).catch(() => {})
  }, [openaiConnected, openaiConfigured])

  const handleToggleClaudeIntegration = useCallback(() => {
    if (!claudeConnected && !claudeConfigured) return
    const next = !claudeConnected
    setClaudeConnected(next)
    updateClaudeIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claude: { connected: next } }),
    }).catch(() => {})
  }, [claudeConnected, claudeConfigured])

  const handleToggleGrokIntegration = useCallback(() => {
    if (!grokConnected && !grokConfigured) return
    const next = !grokConnected
    setGrokConnected(next)
    updateGrokIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grok: { connected: next } }),
    }).catch(() => {})
  }, [grokConnected, grokConfigured])

  const handleToggleGeminiIntegration = useCallback(() => {
    if (!geminiConnected && !geminiConfigured) return
    const next = !geminiConnected
    setGeminiConnected(next)
    updateGeminiIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gemini: { connected: next } }),
    }).catch(() => {})
  }, [geminiConnected, geminiConfigured])

  const handleToggleGmailIntegration = useCallback(() => {
    if (!gmailConnected && !gmailTokenConfigured) return
    const next = !gmailConnected
    setGmailConnected(next)
    updateGmailIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail: { connected: next } }),
    }).catch(() => {})
  }, [gmailConnected, gmailTokenConfigured])

  const missions = useMemo<MissionSummary[]>(() => {
    const grouped = new Map<string, MissionSummary>()

    for (const schedule of notificationSchedules) {
      const meta = parseMissionWorkflowMeta(schedule.message)
      const title = schedule.label?.trim() || "Scheduled notification"
      const integration = schedule.integration?.trim().toLowerCase() || "unknown"
      const key = `${integration}:${title.toLowerCase()}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: schedule.id,
          integration,
          title,
          description: meta.description,
          priority: meta.priority,
          enabledCount: schedule.enabled ? 1 : 0,
          totalCount: 1,
          times: [schedule.time],
          timezone: schedule.timezone || "America/New_York",
        })
        continue
      }

      existing.totalCount += 1
      if (schedule.enabled) existing.enabledCount += 1
      existing.times.push(schedule.time)
      if (!existing.description && meta.description) existing.description = meta.description
      if (compareMissionPriority(meta.priority, existing.priority) > 0) existing.priority = meta.priority
    }

    return Array.from(grouped.values())
      .map((mission) => ({ ...mission, times: mission.times.sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => {
        const activeDelta = Number(b.enabledCount > 0) - Number(a.enabledCount > 0)
        if (activeDelta !== 0) return activeDelta
        return b.totalCount - a.totalCount
      })
  }, [notificationSchedules])

  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"

  const runningProvider = latestUsage?.provider
    ? providerFromValue(latestUsage.provider)
    : activeLlmProvider
  const runningModel = latestUsage?.model ?? activeLlmModel
  const hasAnyLlmApiSetup = openaiConfigured || claudeConfigured || grokConfigured || geminiConfigured
  const runningLabel = !latestUsage && !hasAnyLlmApiSetup
    ? "Needs Setup"
    : `${runningProvider === "claude" ? "Claude" : runningProvider === "grok" ? "Grok" : runningProvider === "gemini" ? "Gemini" : "OpenAI"} - ${runningModel || "N/A"}`

  return {
    missions,
    runningLabel,
    integrationBadgeClass,
    telegramConnected,
    discordConnected,
    braveConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
    handleToggleTelegramIntegration,
    handleToggleDiscordIntegration,
    handleToggleBraveIntegration,
    handleToggleOpenAIIntegration,
    handleToggleClaudeIntegration,
    handleToggleGrokIntegration,
    handleToggleGeminiIntegration,
    handleToggleGmailIntegration,
  }
}
