"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  INTEGRATIONS_UPDATED_EVENT,
  loadIntegrationsSettings,
  updateTelegramIntegrationSettings,
  updateDiscordIntegrationSettings,
  updateBraveIntegrationSettings,
  updateOpenAIIntegrationSettings,
  updateClaudeIntegrationSettings,
  updateGeminiIntegrationSettings,
  updateGrokIntegrationSettings,
  type LlmProvider,
} from "@/lib/integrations/client-store"

export interface IntegrationsStatus {
  integrationsHydrated: boolean
  telegramConnected: boolean
  discordConnected: boolean
  braveConnected: boolean
  openaiConnected: boolean
  claudeConnected: boolean
  grokConnected: boolean
  geminiConnected: boolean
  gmailConnected: boolean
  braveConfigured: boolean
  openaiConfigured: boolean
  claudeConfigured: boolean
  grokConfigured: boolean
  geminiConfigured: boolean
  activeLlmProvider: LlmProvider
  activeLlmModel: string
}

export interface UseIntegrationsStatusReturn extends IntegrationsStatus {
  integrationGuardNotice: string | null
  integrationGuardTarget: "brave" | "openai" | "claude" | "grok" | "gemini" | "gmail" | null
  handleToggleTelegramIntegration: () => void
  handleToggleDiscordIntegration: () => void
  handleToggleBraveIntegration: () => void
  handleToggleOpenAIIntegration: () => void
  handleToggleClaudeIntegration: () => void
  handleToggleGrokIntegration: () => void
  handleToggleGeminiIntegration: () => void
  handleToggleGmailIntegration: () => void
}

function resolveActiveModelFromProvider(
  provider: LlmProvider,
  models: {
    openai?: string
    claude?: string
    grok?: string
    gemini?: string
  },
): string {
  if (provider === "claude") return String(models.claude || "claude-sonnet-4-20250514")
  if (provider === "grok") return String(models.grok || "grok-4-0709")
  if (provider === "gemini") return String(models.gemini || "gemini-2.5-pro")
  return String(models.openai || "gpt-4.1")
}

export function useIntegrationsStatus(): UseIntegrationsStatusReturn {
  const router = useRouter()
  const initialIntegrations = useMemo(() => loadIntegrationsSettings(), [])
  const [integrationsHydrated] = useState(true)
  const [telegramConnected, setTelegramConnected] = useState(Boolean(initialIntegrations.telegram.connected))
  const [discordConnected, setDiscordConnected] = useState(Boolean(initialIntegrations.discord.connected))
  const [braveConnected, setBraveConnected] = useState(Boolean(initialIntegrations.brave.connected))
  const [openaiConnected, setOpenaiConnected] = useState(Boolean(initialIntegrations.openai.connected))
  const [claudeConnected, setClaudeConnected] = useState(Boolean(initialIntegrations.claude.connected))
  const [grokConnected, setGrokConnected] = useState(Boolean(initialIntegrations.grok.connected))
  const [geminiConnected, setGeminiConnected] = useState(Boolean(initialIntegrations.gemini.connected))
  const [gmailConnected, setGmailConnected] = useState(Boolean(initialIntegrations.gmail?.connected))
  const [braveConfigured, setBraveConfigured] = useState(Boolean(initialIntegrations.brave.apiKeyConfigured))
  const [openaiConfigured, setOpenaiConfigured] = useState(Boolean(initialIntegrations.openai.apiKeyConfigured))
  const [claudeConfigured, setClaudeConfigured] = useState(Boolean(initialIntegrations.claude.apiKeyConfigured))
  const [grokConfigured, setGrokConfigured] = useState(Boolean(initialIntegrations.grok.apiKeyConfigured))
  const [geminiConfigured, setGeminiConfigured] = useState(Boolean(initialIntegrations.gemini.apiKeyConfigured))
  const [gmailTokenConfigured, setGmailTokenConfigured] = useState(Boolean(initialIntegrations.gmail?.tokenConfigured))
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>(initialIntegrations.activeLlmProvider)
  const [integrationGuardNotice, setIntegrationGuardNotice] = useState<string | null>(null)
  const [integrationGuardTarget, setIntegrationGuardTarget] = useState<"brave" | "openai" | "claude" | "grok" | "gemini" | "gmail" | null>(null)
  const [activeLlmModel, setActiveLlmModel] = useState(
    resolveActiveModelFromProvider(initialIntegrations.activeLlmProvider, {
      openai: initialIntegrations.openai.defaultModel,
      claude: initialIntegrations.claude.defaultModel,
      grok: initialIntegrations.grok.defaultModel,
      gemini: initialIntegrations.gemini.defaultModel,
    }),
  )

  useEffect(() => {
    if (!integrationGuardNotice) return
    const timer = window.setTimeout(() => {
      setIntegrationGuardNotice(null)
      setIntegrationGuardTarget(null)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [integrationGuardNotice])

  // Load from server
  useEffect(() => {
    void fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/chat")}`)
          throw new Error("Unauthorized")
        }
        return res.json()
      })
      .then((data) => {
        const telegram = Boolean(data?.config?.telegram?.connected)
        const discord = Boolean(data?.config?.discord?.connected)
        const openai = Boolean(data?.config?.openai?.connected)
        const brave = Boolean(data?.config?.brave?.connected)
        const claude = Boolean(data?.config?.claude?.connected)
        const grok = Boolean(data?.config?.grok?.connected)
        const gemini = Boolean(data?.config?.gemini?.connected)
        const openaiReady = Boolean(data?.config?.openai?.apiKeyConfigured)
        const braveReady = Boolean(data?.config?.brave?.apiKeyConfigured)
        const claudeReady = Boolean(data?.config?.claude?.apiKeyConfigured)
        const grokReady = Boolean(data?.config?.grok?.apiKeyConfigured)
        const geminiReady = Boolean(data?.config?.gemini?.apiKeyConfigured)
        const gmailReady = Boolean(data?.config?.gmail?.tokenConfigured)
        const provider: LlmProvider =
          data?.config?.activeLlmProvider === "claude"
            ? "claude"
            : data?.config?.activeLlmProvider === "grok"
              ? "grok"
              : data?.config?.activeLlmProvider === "gemini"
                ? "gemini"
              : "openai"
        setTelegramConnected(telegram)
        setDiscordConnected(discord)
        setOpenaiConnected(openai)
        setBraveConnected(brave)
        setClaudeConnected(claude)
        setGrokConnected(grok)
        setGeminiConnected(gemini)
        setOpenaiConfigured(openaiReady)
        setBraveConfigured(braveReady)
        setClaudeConfigured(claudeReady)
        setGrokConfigured(grokReady)
        setGeminiConfigured(geminiReady)
        setGmailTokenConfigured(gmailReady)
        setActiveLlmProvider(provider)
        setActiveLlmModel(resolveActiveModelFromProvider(provider, {
          openai: data?.config?.openai?.defaultModel,
          claude: data?.config?.claude?.defaultModel,
          grok: data?.config?.grok?.defaultModel,
          gemini: data?.config?.gemini?.defaultModel,
        }))
      })
      .catch(() => {})
  }, [router])

  // Listen for updates
  useEffect(() => {
    const onUpdate = () => {
      void fetch("/api/integrations/config", { cache: "no-store" })
        .then(async (res) => {
          if (res.status === 401) {
            router.replace(`/login?next=${encodeURIComponent("/chat")}`)
            throw new Error("Unauthorized")
          }
          return res.json()
        })
        .then((data) => {
          const provider: LlmProvider =
            data?.config?.activeLlmProvider === "claude"
              ? "claude"
              : data?.config?.activeLlmProvider === "grok"
                ? "grok"
                : data?.config?.activeLlmProvider === "gemini"
                  ? "gemini"
                : "openai"
          setTelegramConnected(Boolean(data?.config?.telegram?.connected))
          setDiscordConnected(Boolean(data?.config?.discord?.connected))
          setBraveConnected(Boolean(data?.config?.brave?.connected))
          setOpenaiConnected(Boolean(data?.config?.openai?.connected))
          setClaudeConnected(Boolean(data?.config?.claude?.connected))
          setGrokConnected(Boolean(data?.config?.grok?.connected))
          setGeminiConnected(Boolean(data?.config?.gemini?.connected))
          setOpenaiConfigured(Boolean(data?.config?.openai?.apiKeyConfigured))
          setBraveConfigured(Boolean(data?.config?.brave?.apiKeyConfigured))
          setClaudeConfigured(Boolean(data?.config?.claude?.apiKeyConfigured))
          setGrokConfigured(Boolean(data?.config?.grok?.apiKeyConfigured))
          setGeminiConfigured(Boolean(data?.config?.gemini?.apiKeyConfigured))
          setGmailTokenConfigured(Boolean(data?.config?.gmail?.tokenConfigured))
          setActiveLlmProvider(provider)
          setActiveLlmModel(resolveActiveModelFromProvider(provider, {
            openai: data?.config?.openai?.defaultModel,
            claude: data?.config?.claude?.defaultModel,
            grok: data?.config?.grok?.defaultModel,
            gemini: data?.config?.gemini?.defaultModel,
          }))
        })
        .catch(() => {})
    }
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, onUpdate as EventListener)
  }, [router])

  // Toggle handlers
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
    if (!braveConnected && !braveConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("brave")
      return
    }
    const next = !braveConnected
    setBraveConnected(next)
    updateBraveIntegrationSettings({ connected: next })
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brave: { connected: next } }),
    }).catch(() => {})
  }, [braveConfigured, braveConnected])

  const handleToggleOpenAIIntegration = useCallback(() => {
    if (!openaiConnected && !openaiConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("openai")
      return
    }
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
    if (!claudeConnected && !claudeConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("claude")
      return
    }
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
    if (!grokConnected && !grokConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("grok")
      return
    }
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
    if (!geminiConnected && !geminiConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("gemini")
      return
    }
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
    if (!gmailConnected && !gmailTokenConfigured) {
      setIntegrationGuardNotice("Error: Integration not set up.")
      setIntegrationGuardTarget("gmail")
      return
    }
    const next = !gmailConnected
    setGmailConnected(next)
    void fetch("/api/integrations/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmail: { connected: next } }),
    }).catch(() => {})
  }, [gmailConnected, gmailTokenConfigured])

  return {
    integrationsHydrated,
    telegramConnected,
    discordConnected,
    braveConnected,
    openaiConnected,
    claudeConnected,
    grokConnected,
    geminiConnected,
    gmailConnected,
    braveConfigured,
    openaiConfigured,
    claudeConfigured,
    grokConfigured,
    geminiConfigured,
    integrationGuardNotice,
    integrationGuardTarget,
    activeLlmProvider,
    activeLlmModel,
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
