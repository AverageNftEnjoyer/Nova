import { useCallback, useEffect } from "react"

import { saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations/client-store"
import type { CoinbasePrivacySettings } from "../coinbase/meta"
import { makeCoinbaseSnapshot, normalizeCoinbasePrivacy } from "../coinbase/meta"
import type { UseIntegrationsActionsParams } from "../types"

export function useIntegrationsActions(params: UseIntegrationsActionsParams) {
  const {
    settings,
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
    isSavingTarget,
    activeSetup,
    integrationsHydrated,
    activeLlmProvider,
    setActiveLlmProvider,
    botToken,
    setBotToken,
    botTokenConfigured,
    setBotTokenConfigured,
    setBotTokenMasked,
    chatIds,
    discordWebhookUrls,
    braveApiKey,
    braveApiKeyConfigured,
    setBraveApiKey,
    setBraveApiKeyConfigured,
    setBraveApiKeyMasked,
    coinbaseApiKey,
    setCoinbaseApiKey,
    coinbaseApiSecret,
    setCoinbaseApiSecret,
    coinbaseApiKeyConfigured,
    setCoinbaseApiKeyConfigured,
    coinbaseApiSecretConfigured,
    setCoinbaseApiSecretConfigured,
    setCoinbaseApiKeyMasked,
    setCoinbaseApiSecretMasked,
    setCoinbasePersistedSnapshot,
    coinbasePendingAction,
    setCoinbasePendingAction,
    coinbasePrivacy,
    setCoinbasePrivacy,
    coinbasePrivacyHydrated,
    setCoinbasePrivacyHydrated,
    coinbasePrivacySaving,
    setCoinbasePrivacySaving,
    setCoinbasePrivacyError,
    openAISetup,
    claudeSetup,
    grokSetup,
    geminiSetup,
  } = params
  const toggleTelegram = useCallback(async () => {
    const canEnableFromSavedToken = Boolean(botTokenConfigured || settings.telegram.botTokenConfigured)
    if (!settings.telegram.connected && !canEnableFromSavedToken) {
      setSaveStatus({
        type: "error",
        message: "Save a Telegram bot token first, then enable Telegram.",
      })
      return
    }
    const next = {
      ...settings,
      telegram: {
        ...settings.telegram,
        connected: !settings.telegram.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("telegram")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram: { connected: next.telegram.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Telegram status")
      const payload = await res.json().catch(() => ({}))
      const connected = Boolean(payload?.config?.telegram?.connected)
      setSettings((prev: IntegrationsSettings) => {
        const updated = {
          ...prev,
          telegram: {
            ...prev.telegram,
            connected,
            botTokenConfigured: Boolean(payload?.config?.telegram?.botTokenConfigured) || prev.telegram.botTokenConfigured,
            botTokenMasked: typeof payload?.config?.telegram?.botTokenMasked === "string" ? payload.config.telegram.botTokenMasked : prev.telegram.botTokenMasked,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "success",
        message: `Telegram ${connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Telegram status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [botTokenConfigured, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const toggleDiscord = useCallback(async () => {
    const next = {
      ...settings,
      discord: {
        ...settings.discord,
        connected: !settings.discord.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("discord")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discord: { connected: next.discord.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Discord status")
      setSaveStatus({
        type: "success",
        message: `Discord ${next.discord.connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Discord status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [setIsSavingTarget, setSaveStatus, setSettings, settings])

  const toggleBrave = useCallback(async () => {
    const canEnableFromSavedKey = Boolean(braveApiKeyConfigured || settings.brave.apiKeyConfigured)
    if (!settings.brave.connected && !canEnableFromSavedKey) {
      setSaveStatus({
        type: "error",
        message: "Save a Brave API key first, then enable Brave.",
      })
      return
    }

    const next = {
      ...settings,
      brave: {
        ...settings.brave,
        connected: !settings.brave.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("brave")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brave: { connected: next.brave.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Brave status")
      const payload = await res.json().catch(() => ({}))
      const connected = Boolean(payload?.config?.brave?.connected)
      setSettings((prev: IntegrationsSettings) => {
        const updated = {
          ...prev,
          brave: {
            ...prev.brave,
            connected,
            apiKeyConfigured: Boolean(payload?.config?.brave?.apiKeyConfigured) || prev.brave.apiKeyConfigured,
            apiKeyMasked: typeof payload?.config?.brave?.apiKeyMasked === "string" ? payload.config.brave.apiKeyMasked : prev.brave.apiKeyMasked,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "success",
        message: `Brave ${connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Brave status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [braveApiKeyConfigured, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const applyCoinbaseServerConfig = useCallback((incoming: unknown) => {
    if (!incoming || typeof incoming !== "object") return
    const coinbase = incoming as Partial<IntegrationsSettings["coinbase"]>
    const hasKeyMasked = typeof coinbase.apiKeyMasked === "string"
    const keyMasked = hasKeyMasked ? String(coinbase.apiKeyMasked) : ""
    const keyConfigured = typeof coinbase.apiKeyConfigured === "boolean" ? coinbase.apiKeyConfigured : undefined
    const hasSecretMasked = typeof coinbase.apiSecretMasked === "string"
    const secretMasked = hasSecretMasked ? String(coinbase.apiSecretMasked) : ""
    const secretConfigured = typeof coinbase.apiSecretConfigured === "boolean" ? coinbase.apiSecretConfigured : undefined
    if (hasKeyMasked) setCoinbaseApiKeyMasked(keyMasked)
    if (hasSecretMasked) setCoinbaseApiSecretMasked(secretMasked)
    if (typeof keyConfigured === "boolean") setCoinbaseApiKeyConfigured(keyConfigured)
    if (typeof secretConfigured === "boolean") setCoinbaseApiSecretConfigured(secretConfigured)

    setSettings((prev: IntegrationsSettings) => {
      const updated: IntegrationsSettings = {
        ...prev,
        coinbase: {
          ...prev.coinbase,
          connected: typeof coinbase.connected === "boolean" ? coinbase.connected : prev.coinbase.connected,
          connectionMode:
            coinbase.connectionMode === "oauth" || coinbase.connectionMode === "api_key_pair"
              ? coinbase.connectionMode
              : prev.coinbase.connectionMode,
          requiredScopes: Array.isArray(coinbase.requiredScopes)
            ? coinbase.requiredScopes.map((scope) => String(scope).trim()).filter(Boolean)
            : prev.coinbase.requiredScopes,
          lastSyncAt: typeof coinbase.lastSyncAt === "string" ? coinbase.lastSyncAt : prev.coinbase.lastSyncAt,
          lastSyncStatus:
            coinbase.lastSyncStatus === "success" || coinbase.lastSyncStatus === "error"
              ? coinbase.lastSyncStatus
              : prev.coinbase.lastSyncStatus,
          lastSyncErrorCode:
            coinbase.lastSyncErrorCode === "expired_token" ||
            coinbase.lastSyncErrorCode === "permission_denied" ||
            coinbase.lastSyncErrorCode === "rate_limited" ||
            coinbase.lastSyncErrorCode === "coinbase_outage" ||
            coinbase.lastSyncErrorCode === "network" ||
            coinbase.lastSyncErrorCode === "unknown"
              ? coinbase.lastSyncErrorCode
              : coinbase.lastSyncErrorCode === "none"
                ? "none"
                : prev.coinbase.lastSyncErrorCode,
          lastSyncErrorMessage:
            typeof coinbase.lastSyncErrorMessage === "string" ? coinbase.lastSyncErrorMessage : prev.coinbase.lastSyncErrorMessage,
          lastFreshnessMs:
            typeof coinbase.lastFreshnessMs === "number" ? coinbase.lastFreshnessMs : prev.coinbase.lastFreshnessMs,
          reportTimezone:
            typeof coinbase.reportTimezone === "string" && coinbase.reportTimezone.trim().length > 0
              ? coinbase.reportTimezone.trim()
              : prev.coinbase.reportTimezone,
          reportCurrency:
            typeof coinbase.reportCurrency === "string" && coinbase.reportCurrency.trim().length > 0
              ? coinbase.reportCurrency.trim().toUpperCase()
              : prev.coinbase.reportCurrency,
          reportCadence: coinbase.reportCadence === "weekly" ? "weekly" : coinbase.reportCadence === "daily" ? "daily" : prev.coinbase.reportCadence,
          apiKeyConfigured: typeof keyConfigured === "boolean" ? keyConfigured : prev.coinbase.apiKeyConfigured,
          apiKeyMasked: hasKeyMasked ? keyMasked : prev.coinbase.apiKeyMasked,
          apiSecretConfigured: typeof secretConfigured === "boolean" ? secretConfigured : prev.coinbase.apiSecretConfigured,
          apiSecretMasked: hasSecretMasked ? secretMasked : prev.coinbase.apiSecretMasked,
        },
      }
      setCoinbasePersistedSnapshot(makeCoinbaseSnapshot(updated.coinbase))
      saveIntegrationsSettings(updated)
      return updated
    })
  }, [setCoinbaseApiKeyConfigured, setCoinbaseApiKeyMasked, setCoinbaseApiSecretConfigured, setCoinbaseApiSecretMasked, setCoinbasePersistedSnapshot, setSettings])

  const probeCoinbaseConnection = useCallback(async (successMessage = "Coinbase probe passed.") => {
    if (isSavingTarget !== null || coinbasePendingAction !== null) return
    setSaveStatus(null)
    setIsSavingTarget("coinbase")
    setCoinbasePendingAction("sync")
    try {
      const res = await fetch("/api/integrations/test-coinbase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload?.ok) {
        applyCoinbaseServerConfig(payload?.config?.coinbase)
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim().length > 0
            ? payload.error
            : "Coinbase probe failed.",
        )
      }
      applyCoinbaseServerConfig(payload?.config?.coinbase)
      setSaveStatus({
        type: "success",
        message: successMessage,
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Coinbase probe failed.",
      })
    } finally {
      setCoinbasePendingAction(null)
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, coinbasePendingAction, isSavingTarget, setCoinbasePendingAction, setIsSavingTarget, setSaveStatus])

  const toggleCoinbase = useCallback(async () => {
    if (isSavingTarget !== null || coinbasePendingAction !== null) return
    const canEnableFromSavedKeys = Boolean(
      (coinbaseApiKeyConfigured || settings.coinbase.apiKeyConfigured) &&
      (coinbaseApiSecretConfigured || settings.coinbase.apiSecretConfigured),
    )
    if (!settings.coinbase.connected && !canEnableFromSavedKeys) {
      setSaveStatus({
        type: "error",
        message: "Save Coinbase API key + secret first, then enable Coinbase.",
      })
      return
    }

    const next = {
      ...settings,
      coinbase: {
        ...settings.coinbase,
        connected: !settings.coinbase.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setCoinbasePendingAction("toggle")
    setIsSavingTarget("coinbase")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coinbase: { connected: next.coinbase.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Coinbase status")
      const payload = await res.json().catch(() => ({}))
      const connected = Boolean(payload?.config?.coinbase?.connected)
      applyCoinbaseServerConfig(payload?.config?.coinbase)
      setSaveStatus({
        type: "success",
        message: `Coinbase ${connected ? "connected" : "disconnected"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Coinbase status. Try again.",
      })
    } finally {
      setCoinbasePendingAction(null)
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, coinbaseApiKeyConfigured, coinbaseApiSecretConfigured, coinbasePendingAction, isSavingTarget, setCoinbasePendingAction, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const saveActiveProvider = useCallback(async (provider: LlmProvider) => {
    if (provider === "openai" && !settings.openai.connected) {
      setSaveStatus({ type: "error", message: "OpenAI is inactive. Save a valid key + model first." })
      return
    }
    if (provider === "claude" && !settings.claude.connected) {
      setSaveStatus({ type: "error", message: "Claude is inactive. Save a valid key + model first." })
      return
    }
    if (provider === "grok" && !settings.grok.connected) {
      setSaveStatus({ type: "error", message: "Grok is inactive. Save a valid key + model first." })
      return
    }
    if (provider === "gemini" && !settings.gemini.connected) {
      setSaveStatus({ type: "error", message: "Gemini is inactive. Save a valid key + model first." })
      return
    }

    const previous = activeLlmProvider
    const persistedOpenAIModel = openAISetup.persistedModel
    const persistedClaudeModel = claudeSetup.persistedModel
    const persistedGrokModel = grokSetup.persistedModel
    const persistedGeminiModel = geminiSetup.persistedModel
    setActiveLlmProvider(provider)
    setSettings((prev: IntegrationsSettings) => {
      const next = {
        ...prev,
        activeLlmProvider: provider,
        openai: {
          ...prev.openai,
          defaultModel: persistedOpenAIModel,
        },
        claude: {
          ...prev.claude,
          defaultModel: persistedClaudeModel,
        },
        grok: {
          ...prev.grok,
          defaultModel: persistedGrokModel,
        },
        gemini: {
          ...prev.gemini,
          defaultModel: persistedGeminiModel,
        },
      }
      saveIntegrationsSettings(next)
      return next
    })
    setSaveStatus(null)
    setIsSavingTarget("provider")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activeLlmProvider: provider,
          openai: { defaultModel: persistedOpenAIModel },
          claude: { defaultModel: persistedClaudeModel },
          grok: { defaultModel: persistedGrokModel },
          gemini: { defaultModel: persistedGeminiModel },
        }),
      })
      if (!res.ok) throw new Error("Failed to switch active LLM provider")
      setSaveStatus({
        type: "success",
        message: `Active model source switched to ${provider === "claude" ? "Claude" : provider === "grok" ? "Grok" : provider === "gemini" ? "Gemini" : "OpenAI"}.`,
      })
    } catch {
      setActiveLlmProvider(previous)
      setSettings((prev: IntegrationsSettings) => {
        const next = { ...prev, activeLlmProvider: previous }
        saveIntegrationsSettings(next)
        return next
      })
      setSaveStatus({
        type: "error",
        message: "Failed to switch active provider.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [
    activeLlmProvider,
    claudeSetup.persistedModel,
    geminiSetup.persistedModel,
    grokSetup.persistedModel,
    openAISetup.persistedModel,
    settings.claude.connected,
    settings.gemini.connected,
    settings.grok.connected,
    settings.openai.connected,
    setActiveLlmProvider,
    setIsSavingTarget,
    setSaveStatus,
    setSettings,
  ])

  const saveTelegramConfig = useCallback(async () => {
    const trimmedBotToken = botToken.trim()
    const shouldEnable = settings.telegram.connected || trimmedBotToken.length > 0 || botTokenConfigured
    const payloadTelegram: Record<string, string> = {
      chatIds: chatIds.trim(),
    }
    if (trimmedBotToken) {
      payloadTelegram.botToken = trimmedBotToken
    }
    const next = {
      ...settings,
      telegram: {
        ...settings.telegram,
        ...payloadTelegram,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("telegram")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram: {
            ...payloadTelegram,
            connected: shouldEnable,
          },
        }),
      })
      const savedData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok) {
        const message =
          typeof savedData?.error === "string" && savedData.error.trim().length > 0
            ? savedData.error.trim()
            : "Failed to save Telegram configuration."
        throw new Error(message)
      }
      const masked = typeof savedData?.config?.telegram?.botTokenMasked === "string" ? savedData.config.telegram.botTokenMasked : ""
      const configured = Boolean(savedData?.config?.telegram?.botTokenConfigured) || trimmedBotToken.length > 0
      const connected = Boolean(savedData?.config?.telegram?.connected)
      setBotToken("")
      setBotTokenMasked(masked)
      setBotTokenConfigured(configured)
      setSettings((prev: IntegrationsSettings) => {
        const updated = {
          ...prev,
          telegram: {
            ...prev.telegram,
            connected,
            botTokenConfigured: configured,
            botTokenMasked: masked,
            chatIds: chatIds.trim(),
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })

      const testRes = await fetch("/api/integrations/test-telegram", {
        method: "POST",
      })
      const testData = await testRes.json().catch(() => ({}))
      if (!testRes.ok || !testData?.ok) {
        const fallbackResultError =
          Array.isArray(testData?.results) && testData.results.length > 0
            ? testData.results.find((r: { ok?: boolean; error?: string }) => !r?.ok)?.error
            : undefined
        setSaveStatus({
          type: "error",
          message: testData?.error || fallbackResultError || "Saved, but Telegram verification failed.",
        })
        return
      }

      setSaveStatus({
        type: "success",
        message: "Telegram saved and verified.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Telegram configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [botToken, botTokenConfigured, chatIds, setBotToken, setBotTokenConfigured, setBotTokenMasked, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const saveDiscordConfig = useCallback(async () => {
    const next = {
      ...settings,
      discord: {
        ...settings.discord,
        webhookUrls: discordWebhookUrls.trim(),
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("discord")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discord: {
            webhookUrls: next.discord.webhookUrls,
          },
        }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Discord configuration")

      const testRes = await fetch("/api/integrations/test-discord", {
        method: "POST",
      })
      const testData = await testRes.json().catch(() => ({}))
      if (!testRes.ok || !testData?.ok) {
        const fallbackResultError =
          Array.isArray(testData?.results) && testData.results.length > 0
            ? testData.results.find((r: { ok?: boolean; error?: string }) => !r?.ok)?.error
            : undefined
        throw new Error(testData?.error || fallbackResultError || "Saved, but Discord verification failed.")
      }

      setSaveStatus({
        type: "success",
        message: "Discord saved and verified.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Discord configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [discordWebhookUrls, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const saveBraveConfig = useCallback(async () => {
    const trimmedApiKey = braveApiKey.trim()
    const shouldEnable = settings.brave.connected || trimmedApiKey.length > 0 || braveApiKeyConfigured
    const payloadBrave: Record<string, string> = {}
    if (trimmedApiKey) payloadBrave.apiKey = trimmedApiKey

    const next = {
      ...settings,
      brave: {
        ...settings.brave,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("brave")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brave: {
            ...payloadBrave,
            connected: shouldEnable,
          },
        }),
      })
      const savedData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok) {
        const message =
          typeof savedData?.error === "string" && savedData.error.trim().length > 0
            ? savedData.error.trim()
            : "Failed to save Brave configuration."
        throw new Error(message)
      }
      const masked = typeof savedData?.config?.brave?.apiKeyMasked === "string" ? savedData.config.brave.apiKeyMasked : ""
      const configured = Boolean(savedData?.config?.brave?.apiKeyConfigured) || trimmedApiKey.length > 0
      const connected = Boolean(savedData?.config?.brave?.connected)
      setBraveApiKey("")
      setBraveApiKeyMasked(masked)
      setBraveApiKeyConfigured(configured)
      setSettings((prev: IntegrationsSettings) => {
        const updated = {
          ...prev,
          brave: {
            ...prev.brave,
            connected,
            apiKeyConfigured: configured,
            apiKeyMasked: masked,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "success",
        message: "Brave saved.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Brave configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [braveApiKey, braveApiKeyConfigured, setBraveApiKey, setBraveApiKeyConfigured, setBraveApiKeyMasked, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const saveCoinbaseConfig = useCallback(async () => {
    if (isSavingTarget !== null || coinbasePendingAction !== null) return
    const trimmedApiKey = coinbaseApiKey.trim()
    const trimmedApiSecret = coinbaseApiSecret.trim()
    const shouldEnable =
      settings.coinbase.connected ||
      ((trimmedApiKey.length > 0 || coinbaseApiKeyConfigured) && (trimmedApiSecret.length > 0 || coinbaseApiSecretConfigured))
    const payloadCoinbase: Partial<IntegrationsSettings["coinbase"]> = {
      connectionMode: "api_key_pair",
      requiredScopes: settings.coinbase.requiredScopes,
      reportTimezone: settings.coinbase.reportTimezone,
      reportCurrency: settings.coinbase.reportCurrency,
      reportCadence: settings.coinbase.reportCadence,
    }
    if (trimmedApiKey) payloadCoinbase.apiKey = trimmedApiKey
    if (trimmedApiSecret) payloadCoinbase.apiSecret = trimmedApiSecret

    const next = {
      ...settings,
      coinbase: {
        ...settings.coinbase,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setCoinbasePendingAction("save")
    setIsSavingTarget("coinbase")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coinbase: {
            ...payloadCoinbase,
            connected: shouldEnable,
          },
        }),
      })
      const savedData = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok) {
        const message =
          typeof savedData?.error === "string" && savedData.error.trim().length > 0
            ? savedData.error.trim()
            : "Failed to save Coinbase configuration."
        throw new Error(message)
      }
      setCoinbaseApiKey("")
      setCoinbaseApiSecret("")
      applyCoinbaseServerConfig(savedData?.config?.coinbase)
      setSaveStatus({
        type: "success",
        message: "Coinbase saved. Use Sync to run a live sync probe.",
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Coinbase configuration.",
      })
    } finally {
      setCoinbasePendingAction(null)
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, coinbaseApiKey, coinbaseApiKeyConfigured, coinbaseApiSecret, coinbaseApiSecretConfigured, coinbasePendingAction, isSavingTarget, setCoinbaseApiKey, setCoinbaseApiSecret, setCoinbasePendingAction, setIsSavingTarget, setSaveStatus, setSettings, settings])

  const updateCoinbaseDefaults = useCallback((partial: Partial<IntegrationsSettings["coinbase"]>) => {
    setSettings((prev: IntegrationsSettings) => {
      const updated: IntegrationsSettings = {
        ...prev,
        coinbase: {
          ...prev.coinbase,
          ...partial,
        },
      }
      saveIntegrationsSettings(updated)
      return updated
    })
  }, [setSettings])

  const loadCoinbasePrivacy = useCallback(async () => {
    try {
      const res = await fetch("/api/coinbase/privacy", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim().length > 0
            ? payload.error.trim()
            : "Failed to load Coinbase privacy controls.",
        )
      }
      setCoinbasePrivacy(normalizeCoinbasePrivacy(payload?.privacy))
      setCoinbasePrivacyError("")
    } catch (error) {
      setCoinbasePrivacyError(error instanceof Error ? error.message : "Failed to load Coinbase privacy controls.")
    } finally {
      setCoinbasePrivacyHydrated(true)
    }
  }, [setCoinbasePrivacy, setCoinbasePrivacyError, setCoinbasePrivacyHydrated])

  const updateCoinbasePrivacy = useCallback(async (patch: Partial<CoinbasePrivacySettings>) => {
    if (coinbasePrivacySaving) return
    const previous = coinbasePrivacy
    const optimistic = { ...previous, ...patch }
    setCoinbasePrivacy(optimistic)
    setCoinbasePrivacySaving(true)
    setCoinbasePrivacyError("")
    try {
      const res = await fetch("/api/coinbase/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string" && payload.error.trim().length > 0
            ? payload.error.trim()
            : "Failed to update Coinbase privacy controls.",
        )
      }
      setCoinbasePrivacy(normalizeCoinbasePrivacy(payload?.privacy))
    } catch (error) {
      setCoinbasePrivacy(previous)
      setCoinbasePrivacyError(error instanceof Error ? error.message : "Failed to update Coinbase privacy controls.")
    } finally {
      setCoinbasePrivacySaving(false)
    }
  }, [coinbasePrivacy, coinbasePrivacySaving, setCoinbasePrivacy, setCoinbasePrivacyError, setCoinbasePrivacySaving])

  useEffect(() => {
    if (!integrationsHydrated || activeSetup !== "coinbase") return
    if (coinbasePrivacyHydrated) return
    void loadCoinbasePrivacy()
  }, [activeSetup, coinbasePrivacyHydrated, integrationsHydrated, loadCoinbasePrivacy])
  return {
    toggleTelegram,
    toggleDiscord,
    toggleBrave,
    probeCoinbaseConnection,
    toggleCoinbase,
    saveActiveProvider,
    saveTelegramConfig,
    saveDiscordConfig,
    saveBraveConfig,
    saveCoinbaseConfig,
    updateCoinbaseDefaults,
    updateCoinbasePrivacy,
  }
}
