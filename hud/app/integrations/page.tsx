"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Blocks, Settings, User } from "lucide-react"

import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type UserProfile } from "@/lib/settings/userSettings"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations/client-store"
import { FluidSelect } from "@/components/ui/fluid-select"
import { SettingsModal } from "@/components/settings/settings-modal"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { BraveIcon, ClaudeIcon, CoinbaseIcon, DiscordIcon, GeminiIcon, GmailIcon, OpenAIIcon, TelegramIcon, XAIIcon } from "@/components/icons"
import { NOVA_VERSION } from "@/lib/meta/version"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { formatCompactModelLabelFromIntegrations } from "@/lib/integrations/model-label"

// Constants
import {
  OPENAI_DEFAULT_MODEL,
  OPENAI_DEFAULT_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_DEFAULT_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_BASE_URL,
  GMAIL_DEFAULT_REDIRECT_URI,
  hexToRgba,
} from "./constants"

// Hooks and utilities
import {
  useSpotlightEffect,
  useOpenAISetup,
  useClaudeSetup,
  useGrokSetup,
  useGeminiSetup,
  useGmailSetup,
  normalizeGmailAccountsForUi,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "./hooks"

// Shared components
import {
  SaveStatusToast,
  ConnectivityGrid,
  type IntegrationSetupKey,
} from "./components"
import {
  COINBASE_ERROR_COPY,
  DEFAULT_COINBASE_PRIVACY,
  formatFreshnessMs,
  formatIsoTimestamp,
  makeCoinbaseSnapshot,
  type CoinbasePendingAction,
  type CoinbasePersistedSnapshot,
  type CoinbasePrivacySettings,
} from "./modules/coinbase/meta"
import { useIntegrationsActions } from "./modules/hooks/use-integrations-actions"
import { useProviderDefinitions } from "./modules/hooks/use-provider-definitions"
import { IntegrationsMainPanel } from "./modules/components/integrations-main-panel"

export default function IntegrationsPage() {
  const router = useRouter()
  const [orbHovered, setOrbHovered] = useState(false)
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [integrationsHydrated] = useState(true)
  const [botToken, setBotToken] = useState("")
  const [botTokenConfigured, setBotTokenConfigured] = useState(false)
  const [botTokenMasked, setBotTokenMasked] = useState("")
  const [chatIds, setChatIds] = useState("")
  const [discordWebhookUrls, setDiscordWebhookUrls] = useState("")
  const [braveApiKey, setBraveApiKey] = useState("")
  const [braveApiKeyConfigured, setBraveApiKeyConfigured] = useState(false)
  const [braveApiKeyMasked, setBraveApiKeyMasked] = useState("")
  const [coinbaseApiKey, setCoinbaseApiKey] = useState("")
  const [coinbaseApiSecret, setCoinbaseApiSecret] = useState("")
  const [coinbaseApiKeyConfigured, setCoinbaseApiKeyConfigured] = useState(false)
  const [coinbaseApiSecretConfigured, setCoinbaseApiSecretConfigured] = useState(false)
  const [coinbaseApiKeyMasked, setCoinbaseApiKeyMasked] = useState("")
  const [coinbaseApiSecretMasked, setCoinbaseApiSecretMasked] = useState("")
  const [, setCoinbasePersistedSnapshot] = useState<CoinbasePersistedSnapshot>(() =>
    makeCoinbaseSnapshot(loadIntegrationsSettings().coinbase),
  )
  const [showCoinbaseApiSecret, setShowCoinbaseApiSecret] = useState(false)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [profile, setProfile] = useState<UserProfile>({
    name: "User",
    avatar: null,
    accessTier: "Model Unset",
  })
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [activeSetup, setActiveSetup] = useState<IntegrationSetupKey>("telegram")
  const [isSavingTarget, setIsSavingTarget] = useState<IntegrationsSaveTarget>(null)
  const [coinbasePendingAction, setCoinbasePendingAction] = useState<CoinbasePendingAction | null>(null)
  const [coinbasePrivacy, setCoinbasePrivacy] = useState<CoinbasePrivacySettings>(DEFAULT_COINBASE_PRIVACY)
  const [coinbasePrivacyHydrated, setCoinbasePrivacyHydrated] = useState(false)
  const [coinbasePrivacySaving, setCoinbasePrivacySaving] = useState(false)
  const [coinbasePrivacyError, setCoinbasePrivacyError] = useState("")
  const [saveStatus, setSaveStatus] = useState<IntegrationsSaveStatus>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const topHeaderRef = useRef<HTMLDivElement | null>(null)
  const connectivitySectionRef = useRef<HTMLElement | null>(null)
  const telegramSetupSectionRef = useRef<HTMLElement | null>(null)
  const discordSetupSectionRef = useRef<HTMLElement | null>(null)
  const braveSetupSectionRef = useRef<HTMLElement | null>(null)
  const coinbaseSetupSectionRef = useRef<HTMLElement | null>(null)
  const openaiSetupSectionRef = useRef<HTMLElement | null>(null)
  const claudeSetupSectionRef = useRef<HTMLElement | null>(null)
  const grokSetupSectionRef = useRef<HTMLElement | null>(null)
  const geminiSetupSectionRef = useRef<HTMLElement | null>(null)
  const gmailSetupSectionRef = useRef<HTMLElement | null>(null)
  const activeStatusSectionRef = useRef<HTMLElement | null>(null)

  const openAISetup = useOpenAISetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const claudeSetup = useClaudeSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const grokSetup = useGrokSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const geminiSetup = useGeminiSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const gmailSetup = useGmailSetup({
    settings,
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
    onRequireLogin: () => router.push(`/login?next=${encodeURIComponent("/integrations")}`),
  })
  const hydrateOpenAISetup = openAISetup.hydrate
  const hydrateClaudeSetup = claudeSetup.hydrate
  const hydrateGrokSetup = grokSetup.hydrate
  const hydrateGeminiSetup = geminiSetup.hydrate
  const hydrateGmailSetup = gmailSetup.hydrate

  useEffect(() => {
    let cancelled = false

    fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => ({
        ok: res.ok,
        status: res.status,
        data: await res.json().catch(() => ({})),
      }))
      .then(({ ok, status, data }) => {
        if (cancelled) return
        if (!ok) {
          if (status === 401 || status === 403) {
            router.push(`/login?next=${encodeURIComponent("/integrations")}`)
            return
          }
        }
        const config = data?.config as IntegrationsSettings | undefined
        if (!config) {
          const fallback = loadIntegrationsSettings()
          setSettings(fallback)
          setBotToken(fallback.telegram.botToken)
          setBotTokenConfigured(Boolean(fallback.telegram.botTokenConfigured))
          setBotTokenMasked(fallback.telegram.botTokenMasked || "")
          setChatIds(fallback.telegram.chatIds)
          setDiscordWebhookUrls(fallback.discord.webhookUrls)
          setBraveApiKey(fallback.brave.apiKey)
          setBraveApiKeyConfigured(Boolean(fallback.brave.apiKeyConfigured))
          setBraveApiKeyMasked(fallback.brave.apiKeyMasked || "")
          setCoinbaseApiKey(fallback.coinbase.apiKey)
          setCoinbaseApiSecret(fallback.coinbase.apiSecret)
          setCoinbaseApiKeyConfigured(Boolean(fallback.coinbase.apiKeyConfigured))
          setCoinbaseApiSecretConfigured(Boolean(fallback.coinbase.apiSecretConfigured))
          setCoinbaseApiKeyMasked(fallback.coinbase.apiKeyMasked || "")
          setCoinbaseApiSecretMasked(fallback.coinbase.apiSecretMasked || "")
          setCoinbasePersistedSnapshot(makeCoinbaseSnapshot(fallback.coinbase))
          hydrateOpenAISetup(fallback)
          hydrateClaudeSetup(fallback)
          hydrateGrokSetup(fallback)
          hydrateGeminiSetup(fallback)
          hydrateGmailSetup(fallback)
          setActiveLlmProvider(fallback.activeLlmProvider || "openai")
          return
        }
        const normalized: IntegrationsSettings = {
          telegram: {
            connected: Boolean(config.telegram?.connected),
            botToken: config.telegram?.botToken || "",
            botTokenConfigured: Boolean(config.telegram?.botTokenConfigured),
            botTokenMasked: typeof config.telegram?.botTokenMasked === "string" ? config.telegram.botTokenMasked : "",
            chatIds: Array.isArray(config.telegram?.chatIds)
              ? config.telegram.chatIds.join(",")
              : typeof config.telegram?.chatIds === "string"
                ? config.telegram.chatIds
                : "",
          },
          discord: {
            connected: Boolean(config.discord?.connected),
            webhookUrls: Array.isArray(config.discord?.webhookUrls)
              ? config.discord.webhookUrls.join(",")
              : typeof config.discord?.webhookUrls === "string"
                ? config.discord.webhookUrls
                : "",
            webhookUrlsConfigured: Boolean(config.discord?.webhookUrlsConfigured),
            webhookUrlsMasked: Array.isArray(config.discord?.webhookUrlsMasked)
              ? config.discord.webhookUrlsMasked.map((value: unknown) => String(value))
              : [],
          },
          brave: {
            connected: Boolean(config.brave?.connected),
            apiKey: config.brave?.apiKey || "",
            apiKeyConfigured: Boolean(config.brave?.apiKeyConfigured),
            apiKeyMasked: typeof config.brave?.apiKeyMasked === "string" ? config.brave.apiKeyMasked : "",
          },
          coinbase: {
            connected: Boolean(config.coinbase?.connected),
            apiKey: config.coinbase?.apiKey || "",
            apiSecret: config.coinbase?.apiSecret || "",
            connectionMode: config.coinbase?.connectionMode === "oauth" ? "oauth" : "api_key_pair",
            requiredScopes: Array.isArray(config.coinbase?.requiredScopes)
              ? config.coinbase.requiredScopes.map((scope: unknown) => String(scope).trim()).filter(Boolean)
              : ["portfolio:view", "accounts:read", "transactions:read"],
            lastSyncAt: typeof config.coinbase?.lastSyncAt === "string" ? config.coinbase.lastSyncAt : "",
            lastSyncStatus:
              config.coinbase?.lastSyncStatus === "success" || config.coinbase?.lastSyncStatus === "error"
                ? config.coinbase.lastSyncStatus
                : "never",
            lastSyncErrorCode:
              config.coinbase?.lastSyncErrorCode === "expired_token" ||
              config.coinbase?.lastSyncErrorCode === "permission_denied" ||
              config.coinbase?.lastSyncErrorCode === "rate_limited" ||
              config.coinbase?.lastSyncErrorCode === "coinbase_outage" ||
              config.coinbase?.lastSyncErrorCode === "network" ||
              config.coinbase?.lastSyncErrorCode === "unknown"
                ? config.coinbase.lastSyncErrorCode
                : "none",
            lastSyncErrorMessage: typeof config.coinbase?.lastSyncErrorMessage === "string" ? config.coinbase.lastSyncErrorMessage : "",
            lastFreshnessMs: typeof config.coinbase?.lastFreshnessMs === "number" ? config.coinbase.lastFreshnessMs : 0,
            reportTimezone:
              typeof config.coinbase?.reportTimezone === "string" && config.coinbase.reportTimezone.trim().length > 0
                ? config.coinbase.reportTimezone
                : "America/New_York",
            reportCurrency:
              typeof config.coinbase?.reportCurrency === "string" && config.coinbase.reportCurrency.trim().length > 0
                ? config.coinbase.reportCurrency.toUpperCase()
                : "USD",
            reportCadence: config.coinbase?.reportCadence === "weekly" ? "weekly" : "daily",
            apiKeyConfigured: Boolean(config.coinbase?.apiKeyConfigured),
            apiKeyMasked: typeof config.coinbase?.apiKeyMasked === "string" ? config.coinbase.apiKeyMasked : "",
            apiSecretConfigured: Boolean(config.coinbase?.apiSecretConfigured),
            apiSecretMasked: typeof config.coinbase?.apiSecretMasked === "string" ? config.coinbase.apiSecretMasked : "",
          },
          openai: {
            connected: Boolean(config.openai?.connected),
            apiKey: config.openai?.apiKey || "",
            baseUrl: config.openai?.baseUrl || OPENAI_DEFAULT_BASE_URL,
            defaultModel: config.openai?.defaultModel || OPENAI_DEFAULT_MODEL,
            apiKeyConfigured: Boolean(config.openai?.apiKeyConfigured),
            apiKeyMasked: typeof config.openai?.apiKeyMasked === "string" ? config.openai.apiKeyMasked : "",
          },
          claude: {
            connected: Boolean(config.claude?.connected),
            apiKey: config.claude?.apiKey || "",
            baseUrl: config.claude?.baseUrl || CLAUDE_DEFAULT_BASE_URL,
            defaultModel: config.claude?.defaultModel || CLAUDE_DEFAULT_MODEL,
            apiKeyConfigured: Boolean(config.claude?.apiKeyConfigured),
            apiKeyMasked: typeof config.claude?.apiKeyMasked === "string" ? config.claude.apiKeyMasked : "",
          },
          grok: {
            connected: Boolean(config.grok?.connected),
            apiKey: config.grok?.apiKey || "",
            baseUrl: config.grok?.baseUrl || GROK_DEFAULT_BASE_URL,
            defaultModel: config.grok?.defaultModel || GROK_DEFAULT_MODEL,
            apiKeyConfigured: Boolean(config.grok?.apiKeyConfigured),
            apiKeyMasked: typeof config.grok?.apiKeyMasked === "string" ? config.grok.apiKeyMasked : "",
          },
          gemini: {
            connected: Boolean(config.gemini?.connected),
            apiKey: config.gemini?.apiKey || "",
            baseUrl: config.gemini?.baseUrl || GEMINI_DEFAULT_BASE_URL,
            defaultModel: config.gemini?.defaultModel || GEMINI_DEFAULT_MODEL,
            apiKeyConfigured: Boolean(config.gemini?.apiKeyConfigured),
            apiKeyMasked: typeof config.gemini?.apiKeyMasked === "string" ? config.gemini.apiKeyMasked : "",
          },
          gmail: {
            connected: Boolean(config.gmail?.connected),
            email: typeof config.gmail?.email === "string" ? config.gmail.email : "",
            scopes: Array.isArray(config.gmail?.scopes)
              ? config.gmail.scopes.join(" ")
              : typeof config.gmail?.scopes === "string"
                ? config.gmail.scopes
                : "",
            accounts: normalizeGmailAccountsForUi(config.gmail?.accounts, String(config.gmail?.activeAccountId || "")),
            activeAccountId: typeof config.gmail?.activeAccountId === "string" ? config.gmail.activeAccountId : "",
            oauthClientId: typeof config.gmail?.oauthClientId === "string" ? config.gmail.oauthClientId : "",
            oauthClientSecret: "",
            redirectUri: typeof config.gmail?.redirectUri === "string" ? config.gmail.redirectUri : GMAIL_DEFAULT_REDIRECT_URI,
            oauthClientSecretConfigured: Boolean(config.gmail?.oauthClientSecretConfigured),
            oauthClientSecretMasked: typeof config.gmail?.oauthClientSecretMasked === "string" ? config.gmail.oauthClientSecretMasked : "",
            tokenConfigured: Boolean(config.gmail?.tokenConfigured),
          },
          activeLlmProvider:
            config.activeLlmProvider === "claude"
              ? "claude"
              : config.activeLlmProvider === "grok"
                ? "grok"
                : config.activeLlmProvider === "gemini"
                  ? "gemini"
                : "openai",
          updatedAt: config.updatedAt || new Date().toISOString(),
        }
        setSettings(normalized)
        setBotToken(normalized.telegram.botToken)
        setBotTokenConfigured(Boolean(normalized.telegram.botTokenConfigured))
        setBotTokenMasked(normalized.telegram.botTokenMasked || "")
        setChatIds(normalized.telegram.chatIds)
        setDiscordWebhookUrls(normalized.discord.webhookUrls)
        setBraveApiKey(normalized.brave.apiKey)
        setBraveApiKeyConfigured(Boolean(normalized.brave.apiKeyConfigured))
        setBraveApiKeyMasked(normalized.brave.apiKeyMasked || "")
        setCoinbaseApiKey(normalized.coinbase.apiKey)
        setCoinbaseApiSecret(normalized.coinbase.apiSecret)
        setCoinbaseApiKeyConfigured(Boolean(normalized.coinbase.apiKeyConfigured))
        setCoinbaseApiSecretConfigured(Boolean(normalized.coinbase.apiSecretConfigured))
        setCoinbaseApiKeyMasked(normalized.coinbase.apiKeyMasked || "")
        setCoinbaseApiSecretMasked(normalized.coinbase.apiSecretMasked || "")
        setCoinbasePersistedSnapshot(makeCoinbaseSnapshot(normalized.coinbase))
        hydrateOpenAISetup(normalized)
        hydrateClaudeSetup(normalized)
        hydrateGrokSetup(normalized)
        hydrateGeminiSetup(normalized)
        hydrateGmailSetup(normalized)
        setActiveLlmProvider(normalized.activeLlmProvider || "openai")
        saveIntegrationsSettings(normalized)
      })
      .catch(() => {
        if (cancelled) return
        const fallback = loadIntegrationsSettings()
        setSettings(fallback)
        setBotToken(fallback.telegram.botToken)
        setBotTokenConfigured(Boolean(fallback.telegram.botTokenConfigured))
        setBotTokenMasked(fallback.telegram.botTokenMasked || "")
        setChatIds(fallback.telegram.chatIds)
        setDiscordWebhookUrls(fallback.discord.webhookUrls)
        setBraveApiKey(fallback.brave.apiKey)
        setBraveApiKeyConfigured(Boolean(fallback.brave.apiKeyConfigured))
        setBraveApiKeyMasked(fallback.brave.apiKeyMasked || "")
        setCoinbaseApiKey(fallback.coinbase.apiKey)
        setCoinbaseApiSecret(fallback.coinbase.apiSecret)
        setCoinbaseApiKeyConfigured(Boolean(fallback.coinbase.apiKeyConfigured))
        setCoinbaseApiSecretConfigured(Boolean(fallback.coinbase.apiSecretConfigured))
        setCoinbaseApiKeyMasked(fallback.coinbase.apiKeyMasked || "")
        setCoinbaseApiSecretMasked(fallback.coinbase.apiSecretMasked || "")
        setCoinbasePersistedSnapshot(makeCoinbaseSnapshot(fallback.coinbase))
        hydrateOpenAISetup(fallback)
        hydrateClaudeSetup(fallback)
        hydrateGrokSetup(fallback)
        hydrateGeminiSetup(fallback)
        hydrateGmailSetup(fallback)
        setActiveLlmProvider(fallback.activeLlmProvider || "openai")
      })

    return () => {
      cancelled = true
    }
  }, [hydrateClaudeSetup, hydrateGeminiSetup, hydrateGmailSetup, hydrateGrokSetup, hydrateOpenAISetup, router])

  useEffect(() => {
    const refresh = () => {
      const userSettings = loadUserSettings()
      setProfile(userSettings.profile)
      setOrbColor(userSettings.app.orbColor)
      setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: userSettings.app.orbColor,
        spotlightEnabled: userSettings.app.spotlightEnabled ?? true,
      })
    }
    refresh()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [])

  // Auto-dismiss save status
  useEffect(() => {
    if (!saveStatus) return
    const timeout = window.setTimeout(() => setSaveStatus(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [saveStatus])

  // Spotlight effect for all sections
  useSpotlightEffect(
    spotlightEnabled,
    [
      { ref: connectivitySectionRef },
      { ref: telegramSetupSectionRef },
      { ref: discordSetupSectionRef },
      { ref: braveSetupSectionRef },
      { ref: coinbaseSetupSectionRef },
      { ref: openaiSetupSectionRef },
      { ref: claudeSetupSectionRef },
      { ref: grokSetupSectionRef },
      { ref: geminiSetupSectionRef },
      { ref: gmailSetupSectionRef },
      { ref: activeStatusSectionRef },
    ],
    [activeSetup]
  )

  const orbPalette = ORB_COLORS[orbColor]

  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const moduleHeightClass = "h-[clamp(620px,88vh,1240px)]"
  const presence = getNovaPresence({ agentConnected, novaState })
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"
  const integrationDotClass = (connected: boolean) =>
    !integrationsHydrated ? "bg-slate-400" : connected ? "bg-emerald-400" : "bg-rose-400"
  const compactModelLabel = useMemo(() => formatCompactModelLabelFromIntegrations(settings), [settings])
  const integrationTextClass = (connected: boolean) =>
    !integrationsHydrated ? "text-slate-400" : connected ? "text-emerald-400" : "text-rose-400"
  const telegramNeedsKeyWarning = !(
    settings.telegram.botTokenConfigured ||
    botTokenConfigured ||
    botToken.trim().length > 0
  )
  const braveNeedsKeyWarning = !(settings.brave.connected && (settings.brave.apiKeyConfigured || braveApiKeyConfigured))
  const coinbaseNeedsKeyWarning = !(settings.coinbase.connected && (settings.coinbase.apiKeyConfigured || coinbaseApiKeyConfigured) && (settings.coinbase.apiSecretConfigured || coinbaseApiSecretConfigured))
  const coinbaseHasKeys = Boolean(
    (settings.coinbase.apiKeyConfigured || coinbaseApiKeyConfigured) &&
    (settings.coinbase.apiSecretConfigured || coinbaseApiSecretConfigured),
  )
  const coinbaseSyncLabel =
    settings.coinbase.lastSyncStatus === "success"
      ? "Sync Healthy"
      : settings.coinbase.lastSyncStatus === "error"
        ? "Sync Error"
        : "Not Synced"
  const coinbaseSyncBadgeClass =
    settings.coinbase.lastSyncStatus === "success"
      ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
      : settings.coinbase.lastSyncStatus === "error"
        ? "border-rose-300/40 bg-rose-500/15 text-rose-200"
        : "border-amber-300/40 bg-amber-500/15 text-amber-200"
  const coinbaseLastSyncText = formatIsoTimestamp(settings.coinbase.lastSyncAt)
  const coinbaseFreshnessText = formatFreshnessMs(settings.coinbase.lastFreshnessMs)
  const coinbaseErrorText =
    settings.coinbase.lastSyncErrorMessage.trim() || COINBASE_ERROR_COPY[settings.coinbase.lastSyncErrorCode] || ""
  const coinbaseScopeSummary = settings.coinbase.requiredScopes.length > 0
    ? settings.coinbase.requiredScopes.join(", ")
    : "No scope summary configured."
  const connectivityItems = [
    { key: "telegram" as const, connected: settings.telegram.connected, icon: <TelegramIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Telegram setup" },
    { key: "discord" as const, connected: settings.discord.connected, icon: <DiscordIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Discord setup" },
    { key: "openai" as const, connected: settings.openai.connected, icon: <OpenAIIcon className="w-4.5[18px]" />, ariaLabel: "Open OpenAI setup" },
    { key: "claude" as const, connected: settings.claude.connected, icon: <ClaudeIcon className="w-4 h-4" />, ariaLabel: "Open Claude setup" },
    { key: "grok" as const, connected: settings.grok.connected, icon: <XAIIcon size={16} />, ariaLabel: "Open Grok setup" },
    { key: "gemini" as const, connected: settings.gemini.connected, icon: <GeminiIcon size={16} />, ariaLabel: "Open Gemini setup" },
    { key: "gmail" as const, connected: settings.gmail.connected, icon: <GmailIcon className="w-3.5 h-3.5" />, ariaLabel: "Open Gmail setup" },
    { key: "brave" as const, connected: settings.brave.connected, icon: <BraveIcon className="w-4 h-4" />, ariaLabel: "Open Brave setup" },
    { key: "coinbase" as const, connected: settings.coinbase.connected, icon: <CoinbaseIcon className="w-4 h-4" />, ariaLabel: "Open Coinbase setup" },
  ]
  const activeProviderDefinition = useProviderDefinitions({
    settings,
    isSavingTarget,
    activeSetup,
    openaiSetupSectionRef: openaiSetupSectionRef,
    claudeSetupSectionRef,
    grokSetupSectionRef,
    geminiSetupSectionRef,
    openAISetup,
    claudeSetup,
    grokSetup,
    geminiSetup,
  })

  const {
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
  } = useIntegrationsActions({
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
  })
  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>

      <div className="relative z-10 flex-1 h-dvh overflow-hidden transition-all duration-200">
      <div className="flex h-full w-full items-start justify-start px-3 py-4 sm:px-4 lg:px-6">
        <div className="w-full">
          <SaveStatusToast status={saveStatus} isLight={isLight} />

          <div ref={topHeaderRef} className="mb-4 flex items-center gap-3">
            <button
              onClick={() => router.push("/home")}
              onMouseEnter={() => setOrbHovered(true)}
              onMouseLeave={() => setOrbHovered(false)}
              className="group relative h-11 w-11 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110"
              aria-label="Go to home"
            >
              <NovaOrbIndicator
                palette={orbPalette}
                size={30}
                animated={pageActive}
                className="transition-all duration-200"
                style={{ filter: orbHovered ? orbHoverFilter : "none" }}
              />
            </button>
            <div className="min-w-0">
              <div className="flex flex-col leading-tight">
                <div className="flex items-baseline gap-3">
                  <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                  <p className="text-[11px] text-accent font-mono">{NOVA_VERSION}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-3">
                  <div className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} aria-hidden="true" />
                    <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>
                      {presence.label}
                    </span>
                  </div>
                  <p className={cn("text-[13px] whitespace-nowrap", isLight ? "text-s-50" : "text-slate-400")}>Integrations Hub</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,24vw)_minmax(0,1fr)_minmax(340px,24vw)]">
          <div className="space-y-4">
          <section ref={connectivitySectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass}`}>
            <div className="flex items-center gap-2 text-s-80">
              <Blocks className="w-4 h-4 text-accent" />
              <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>Nova Integrations</h2>
            </div>
            <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>Node connectivity</p>

            <div className={cn("mt-3 p-2 rounded-lg", subPanelClass)}>
              <ConnectivityGrid
                isLight={isLight}
                activeSetup={activeSetup}
                integrationBadgeClass={integrationBadgeClass}
                onSelect={setActiveSetup}
                items={connectivityItems}
              />
            </div>
            <div className={cn("mt-3 rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
              <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Profile & Settings</p>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden border", isLight ? "border-[#d5dce8] bg-white" : "border-white/15 bg-white/5")}>
                  {profile.avatar ? (
                    <Image src={profile.avatar} alt="Profile" width={40} height={40} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-s-80" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium truncate", isLight ? "text-s-90" : "text-slate-100")}>{profile.name || "User"}</p>
                  <p className="text-[11px] text-accent font-mono truncate">{compactModelLabel}</p>
                </div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={cn(
                    "h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors group/gear home-spotlight-card home-border-glow home-spotlight-card--hover",
                    isLight ? "border-[#d5dce8] bg-white text-s-80" : "border-white/10 bg-black/20 text-slate-300",
                  )}
                  aria-label="Open settings"
                  title="Settings"
                >
                  <Settings className="w-4 h-4 transition-transform duration-200 group-hover/gear:rotate-90" />
                </button>
              </div>
            </div>
          </section>
          </div>

          <IntegrationsMainPanel
            activeSetup={activeSetup}
            panelStyle={panelStyle}
            panelClass={panelClass}
            moduleHeightClass={moduleHeightClass}
            isLight={isLight}
            subPanelClass={subPanelClass}
            settings={settings}
            isSavingTarget={isSavingTarget}
            telegramNeedsKeyWarning={telegramNeedsKeyWarning}
            braveNeedsKeyWarning={braveNeedsKeyWarning}
            braveApiKeyConfigured={braveApiKeyConfigured}
            braveApiKeyMasked={braveApiKeyMasked}
            coinbaseNeedsKeyWarning={coinbaseNeedsKeyWarning}
            coinbasePendingAction={coinbasePendingAction}
            coinbaseSyncBadgeClass={coinbaseSyncBadgeClass}
            coinbaseSyncLabel={coinbaseSyncLabel}
            coinbaseLastSyncText={coinbaseLastSyncText}
            coinbaseFreshnessText={coinbaseFreshnessText}
            coinbaseErrorText={coinbaseErrorText}
            coinbaseHasKeys={coinbaseHasKeys}
            coinbaseScopeSummary={coinbaseScopeSummary}
            coinbasePrivacy={coinbasePrivacy}
            coinbasePrivacyHydrated={coinbasePrivacyHydrated}
            coinbasePrivacySaving={coinbasePrivacySaving}
            coinbasePrivacyError={coinbasePrivacyError}
            coinbaseApiKey={coinbaseApiKey}
            setCoinbaseApiKey={setCoinbaseApiKey}
            coinbaseApiKeyConfigured={coinbaseApiKeyConfigured}
            coinbaseApiKeyMasked={coinbaseApiKeyMasked}
            coinbaseApiSecret={coinbaseApiSecret}
            setCoinbaseApiSecret={setCoinbaseApiSecret}
            showCoinbaseApiSecret={showCoinbaseApiSecret}
            setShowCoinbaseApiSecret={setShowCoinbaseApiSecret}
            coinbaseApiSecretConfigured={coinbaseApiSecretConfigured}
            coinbaseApiSecretMasked={coinbaseApiSecretMasked}
            providerDefinition={activeProviderDefinition}
            gmailSetup={gmailSetup}
            telegramSetupSectionRef={telegramSetupSectionRef}
            discordSetupSectionRef={discordSetupSectionRef}
            braveSetupSectionRef={braveSetupSectionRef}
            coinbaseSetupSectionRef={coinbaseSetupSectionRef}
            gmailSetupSectionRef={gmailSetupSectionRef}
            setBotToken={setBotToken}
            botToken={botToken}
            botTokenConfigured={botTokenConfigured}
            botTokenMasked={botTokenMasked}
            setChatIds={setChatIds}
            chatIds={chatIds}
            setDiscordWebhookUrls={setDiscordWebhookUrls}
            discordWebhookUrls={discordWebhookUrls}
            setBraveApiKey={setBraveApiKey}
            braveApiKey={braveApiKey}
            toggleTelegram={toggleTelegram}
            saveTelegramConfig={saveTelegramConfig}
            toggleDiscord={toggleDiscord}
            saveDiscordConfig={saveDiscordConfig}
            toggleBrave={toggleBrave}
            saveBraveConfig={saveBraveConfig}
            probeCoinbaseConnection={probeCoinbaseConnection}
            toggleCoinbase={toggleCoinbase}
            saveCoinbaseConfig={saveCoinbaseConfig}
            updateCoinbasePrivacy={updateCoinbasePrivacy}
            updateCoinbaseDefaults={updateCoinbaseDefaults}
          />

          <section ref={activeStatusSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
            <div>
              <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                Active
              </h2>
              <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                Live provider and integration status.
              </p>
            </div>

            <div className={cn("mt-4 rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
              <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Active LLM Provider</p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                <FluidSelect
                  value={activeLlmProvider}
                  onChange={(v) => saveActiveProvider(v as LlmProvider)}
                  options={[
                    { value: "openai", label: "OpenAI" },
                    { value: "claude", label: "Claude" },
                    { value: "grok", label: "Grok" },
                    { value: "gemini", label: "Gemini" },
                  ]}
                  isLight={isLight}
                />
                <span className={cn("text-[11px]", isLight ? "text-s-60" : "text-slate-400")}>
                  {isSavingTarget === "provider" ? "Switching..." : "One provider live at a time"}
                </span>
              </div>
            </div>

            <div className={cn("mt-3 min-h-0 flex-1 rounded-lg border overflow-hidden", isLight ? "border-[#d5dce8]" : "border-white/10")}>
              {[
                { name: "Telegram", active: settings.telegram.connected },
                { name: "Discord", active: settings.discord.connected },
                { name: "OpenAI", active: settings.openai.connected },
                { name: "Claude", active: settings.claude.connected },
                { name: "Grok", active: settings.grok.connected },
                { name: "Gemini", active: settings.gemini.connected },
                { name: "Gmail", active: settings.gmail.connected },
                { name: "Brave", active: settings.brave.connected },
                { name: "Coinbase", active: settings.coinbase.connected },
              ].map((item) => (
                <div
                  key={item.name}
                  className={cn(
                    "home-spotlight-card home-border-glow grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-xs",
                    isLight ? "bg-[#f4f7fd] text-s-70 border-b border-[#dfe5ef] last:border-b-0" : "bg-black/20 text-slate-300 border-b border-white/8 last:border-b-0",
                  )}
                >
                  <span className={cn("font-medium", isLight ? "text-s-90" : "text-slate-100")}>{item.name}</span>
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      integrationDotClass(item.active),
                    )}
                    aria-hidden="true"
                  />
                  <span className={cn(integrationTextClass(item.active))}>
                    {item.active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        </div>
      </div>
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
