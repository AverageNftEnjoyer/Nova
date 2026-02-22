"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Blocks, Eye, EyeOff, Save, Settings, User } from "lucide-react"

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
import { readShellUiCache, writeShellUiCache } from "@/lib/settings/shell-ui-cache"
import { formatCompactModelLabelFromIntegrations } from "@/lib/integrations/model-label"

// Constants
import {
  OPENAI_MODEL_OPTIONS,
  OPENAI_DEFAULT_MODEL,
  OPENAI_DEFAULT_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_DEFAULT_BASE_URL,
  GROK_MODEL_OPTIONS,
  GROK_DEFAULT_MODEL,
  GROK_DEFAULT_BASE_URL,
  GEMINI_MODEL_OPTIONS,
  GEMINI_DEFAULT_MODEL,
  GEMINI_DEFAULT_BASE_URL,
  GMAIL_DEFAULT_REDIRECT_URI,
  estimateDailyCostRange,
  getClaudePriceHint,
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
  LlmSetupPanel,
  GmailSetupPanel,
  ConnectivityGrid,
  type IntegrationSetupKey,
} from "./components"

const COINBASE_TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "UTC", label: "UTC" },
]

const COINBASE_CURRENCY_OPTIONS = [
  { value: "USD", label: "USD" },
  { value: "EUR", label: "EUR" },
  { value: "GBP", label: "GBP" },
  { value: "CAD", label: "CAD" },
  { value: "JPY", label: "JPY" },
]

const COINBASE_CADENCE_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
]

const COINBASE_ERROR_COPY: Record<string, string> = {
  expired_token: "Coinbase token expired. Reconnect Coinbase credentials.",
  permission_denied: "Coinbase permission denied. Check key permissions/scopes.",
  rate_limited: "Coinbase rate limit reached. Retry after a short cooldown.",
  coinbase_outage: "Coinbase service outage detected. Retry when upstream recovers.",
  network: "Network error while calling Coinbase. Verify connectivity and retry.",
  unknown: "Coinbase sync failed with an unknown error. Retry and review logs.",
  none: "",
}

function formatIsoTimestamp(iso: string): string {
  if (!iso) return "Never"
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms))
}

function formatFreshnessMs(value: number): string {
  const ms = Math.max(0, Math.floor(Number(value || 0)))
  if (ms <= 0) return "Unknown"
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h`
  const totalDays = Math.floor(totalHours / 24)
  return `${totalDays}d`
}

type CoinbasePersistedSnapshot = {
  reportTimezone: string
  reportCurrency: string
  reportCadence: "daily" | "weekly"
  requiredScopes: string[]
}

function normalizeScopes(scopes: string[]): string[] {
  return scopes.map((scope) => String(scope || "").trim().toLowerCase()).filter(Boolean)
}

function makeCoinbaseSnapshot(coinbase: IntegrationsSettings["coinbase"]): CoinbasePersistedSnapshot {
  return {
    reportTimezone: String(coinbase.reportTimezone || "").trim(),
    reportCurrency: String(coinbase.reportCurrency || "").trim().toUpperCase(),
    reportCadence: coinbase.reportCadence === "weekly" ? "weekly" : "daily",
    requiredScopes: normalizeScopes(Array.isArray(coinbase.requiredScopes) ? coinbase.requiredScopes : []),
  }
}

function coinbaseSnapshotsEqual(a: CoinbasePersistedSnapshot, b: CoinbasePersistedSnapshot): boolean {
  return (
    a.reportTimezone === b.reportTimezone &&
    a.reportCurrency === b.reportCurrency &&
    a.reportCadence === b.reportCadence &&
    a.requiredScopes.join(",") === b.requiredScopes.join(",")
  )
}

export default function IntegrationsPage() {
  const router = useRouter()
  const [orbHovered, setOrbHovered] = useState(false)
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
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
  const [coinbasePersistedSnapshot, setCoinbasePersistedSnapshot] = useState<CoinbasePersistedSnapshot>(() =>
    makeCoinbaseSnapshot(loadIntegrationsSettings().coinbase),
  )
  const [showCoinbaseApiKey, setShowCoinbaseApiKey] = useState(false)
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

  useLayoutEffect(() => {
    const local = loadIntegrationsSettings()
    setSettings(local)
    setBotToken(local.telegram.botToken)
    setBotTokenConfigured(Boolean(local.telegram.botTokenConfigured))
    setBotTokenMasked(local.telegram.botTokenMasked || "")
    setChatIds(local.telegram.chatIds)
    setDiscordWebhookUrls(local.discord.webhookUrls)
    setBraveApiKey(local.brave.apiKey)
    setBraveApiKeyConfigured(Boolean(local.brave.apiKeyConfigured))
    setBraveApiKeyMasked(local.brave.apiKeyMasked || "")
    setCoinbaseApiKey(local.coinbase.apiKey)
    setCoinbaseApiSecret(local.coinbase.apiSecret)
    setCoinbaseApiKeyConfigured(Boolean(local.coinbase.apiKeyConfigured))
    setCoinbaseApiSecretConfigured(Boolean(local.coinbase.apiSecretConfigured))
    setCoinbaseApiKeyMasked(local.coinbase.apiKeyMasked || "")
    setCoinbaseApiSecretMasked(local.coinbase.apiSecretMasked || "")
    setCoinbasePersistedSnapshot(makeCoinbaseSnapshot(local.coinbase))
    hydrateOpenAISetup(local)
    hydrateClaudeSetup(local)
    hydrateGrokSetup(local)
    hydrateGeminiSetup(local)
    hydrateGmailSetup(local)
    setActiveLlmProvider(local.activeLlmProvider || "openai")

    const cached = readShellUiCache()

    const userSettings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? userSettings.app.orbColor
    const nextSpotlight = cached.spotlightEnabled ?? (userSettings.app.spotlightEnabled ?? true)
    setProfile(userSettings.profile)
    setOrbColor(nextOrbColor)
    setSpotlightEnabled(nextSpotlight)
    writeShellUiCache({
      orbColor: nextOrbColor,
      spotlightEnabled: nextSpotlight,
    })
    setIntegrationsHydrated(true)
  }, [hydrateClaudeSetup, hydrateGeminiSetup, hydrateGmailSetup, hydrateGrokSetup, hydrateOpenAISetup])

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
  const braveNeedsKeyWarning = !(settings.brave.connected && (settings.brave.apiKeyConfigured || braveApiKeyConfigured))
  const coinbaseNeedsKeyWarning = !(settings.coinbase.connected && (settings.coinbase.apiKeyConfigured || coinbaseApiKeyConfigured) && (settings.coinbase.apiSecretConfigured || coinbaseApiSecretConfigured))
  const coinbaseHasKeys = Boolean(
    (settings.coinbase.apiKeyConfigured || coinbaseApiKeyConfigured) &&
    (settings.coinbase.apiSecretConfigured || coinbaseApiSecretConfigured),
  )
  const coinbaseHasDraftCredentials = coinbaseApiKey.trim().length > 0 || coinbaseApiSecret.trim().length > 0
  const coinbaseDefaultsDirty = !coinbaseSnapshotsEqual(
    coinbasePersistedSnapshot,
    makeCoinbaseSnapshot(settings.coinbase),
  )
  const coinbasePrimaryActionMode: "save" | "sync" =
    !coinbaseHasKeys || coinbaseHasDraftCredentials || coinbaseDefaultsDirty ? "save" : "sync"
  const coinbaseSyncLabel =
    settings.coinbase.lastSyncStatus === "success"
      ? "Sync Healthy"
      : settings.coinbase.lastSyncStatus === "error"
        ? "Sync Error"
        : "Not Synced"
  const coinbasePrimaryActionLabel =
    isSavingTarget === "coinbase"
      ? coinbasePrimaryActionMode === "save"
        ? "Saving..."
        : "Syncing..."
      : coinbasePrimaryActionMode === "save"
        ? "Save"
        : "Sync"
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
  const providerDefinitions = useMemo(() => ({
    openai: {
      sectionRef: openaiSetupSectionRef,
      title: "OpenAI Setup",
      description: "Save your OpenAI credentials and model defaults for Nova API usage.",
      isConnected: settings.openai.connected,
      isSaving: isSavingTarget === "openai",
      onToggle: openAISetup.toggle,
      onSave: openAISetup.save,
      apiKey: openAISetup.apiKey,
      onApiKeyChange: openAISetup.setApiKey,
      apiKeyConfigured: openAISetup.apiKeyConfigured,
      apiKeyMasked: openAISetup.apiKeyMasked,
      baseUrl: openAISetup.baseUrl,
      onBaseUrlChange: openAISetup.setBaseUrl,
      model: openAISetup.model,
      onModelChange: openAISetup.setModel,
      modelOptions: openAISetup.modelOptions,
      apiKeyPlaceholder: "Paste your OpenAI API key here",
      apiKeyPlaceholderWhenConfigured: "Paste new OpenAI API key to replace current key",
      apiKeyInputName: "openai_token_input",
      baseUrlPlaceholder: "https://api.openai.com/v1",
      baseUrlHint: "Keep https://api.openai.com/v1 unless you are using a compatible proxy endpoint.",
      costEstimate: estimateDailyCostRange(openAISetup.model),
      priceHint: OPENAI_MODEL_OPTIONS.find((item) => item.value === openAISetup.model)?.priceHint ?? "Model pricing and output quality vary by selection.",
      usageNote: "Est. uses 20k-40k total tokens/day at a 50/50 input-output split.",
      instructionSteps: [
        "Create an API key from your OpenAI dashboard.",
        "Paste your key into API Key, then save to verify.",
        "Choose a model from the dropdown; model choice affects quality and token cost.",
      ],
    },
    claude: {
      sectionRef: claudeSetupSectionRef,
      title: "Claude Setup",
      description: "Save your Anthropic credentials and model defaults for Nova API usage.",
      isConnected: settings.claude.connected,
      isSaving: isSavingTarget === "claude",
      onToggle: claudeSetup.toggle,
      onSave: claudeSetup.save,
      apiKey: claudeSetup.apiKey,
      onApiKeyChange: claudeSetup.setApiKey,
      apiKeyConfigured: claudeSetup.apiKeyConfigured,
      apiKeyMasked: claudeSetup.apiKeyMasked,
      baseUrl: claudeSetup.baseUrl,
      onBaseUrlChange: claudeSetup.setBaseUrl,
      model: claudeSetup.model,
      onModelChange: claudeSetup.setModel,
      modelOptions: claudeSetup.modelOptions,
      apiKeyPlaceholder: "anthropic-api-key-placeholder",
      apiKeyPlaceholderWhenConfigured: "Paste new Claude API key to replace current key",
      apiKeyInputName: "claude_token_input",
      baseUrlPlaceholder: "https://api.anthropic.com",
      baseUrlHint: "Keep https://api.anthropic.com unless you are using a compatible proxy endpoint.",
      costEstimate: estimateDailyCostRange(claudeSetup.model),
      priceHint: getClaudePriceHint(claudeSetup.model),
      usageNote: "Est. uses 20k-40k total tokens/day at a 50/50 input-output split.",
      instructionSteps: [
        "Create an API key from your Anthropic dashboard.",
        "Paste your key and save to verify access.",
        "Pick an available Claude model from the dropdown and save.",
      ],
    },
    grok: {
      sectionRef: grokSetupSectionRef,
      title: "Grok Setup",
      description: "Save your xAI credentials and model defaults for Nova API usage.",
      isConnected: settings.grok.connected,
      isSaving: isSavingTarget === "grok",
      onToggle: grokSetup.toggle,
      onSave: grokSetup.save,
      apiKey: grokSetup.apiKey,
      onApiKeyChange: grokSetup.setApiKey,
      apiKeyConfigured: grokSetup.apiKeyConfigured,
      apiKeyMasked: grokSetup.apiKeyMasked,
      baseUrl: grokSetup.baseUrl,
      onBaseUrlChange: grokSetup.setBaseUrl,
      model: grokSetup.model,
      onModelChange: grokSetup.setModel,
      modelOptions: grokSetup.modelOptions,
      apiKeyPlaceholder: "xai-xxxxxxxxxxxxxxxxxxxxxxxx",
      apiKeyPlaceholderWhenConfigured: "Paste new Grok API key to replace current key",
      apiKeyInputName: "grok_token_input",
      baseUrlPlaceholder: "https://api.x.ai/v1",
      baseUrlHint: "Keep https://api.x.ai/v1 unless you are using a compatible proxy endpoint.",
      costEstimate: estimateDailyCostRange(grokSetup.model),
      priceHint: GROK_MODEL_OPTIONS.find((item) => item.value === grokSetup.model)?.priceHint ?? "Model pricing and output quality vary by selection.",
      usageNote: "Est. uses 20k-40k total tokens/day at a 50/50 input-output split.",
      instructionSteps: [
        "Create an API key from your xAI dashboard.",
        "Paste your key and save to verify access.",
        "Pick a Grok model from the dropdown and save.",
      ],
    },
    gemini: {
      sectionRef: geminiSetupSectionRef,
      title: "Gemini Setup",
      description: "Save your Gemini credentials and model defaults for Nova API usage.",
      isConnected: settings.gemini.connected,
      isSaving: isSavingTarget === "gemini",
      onToggle: geminiSetup.toggle,
      onSave: geminiSetup.save,
      apiKey: geminiSetup.apiKey,
      onApiKeyChange: geminiSetup.setApiKey,
      apiKeyConfigured: geminiSetup.apiKeyConfigured,
      apiKeyMasked: geminiSetup.apiKeyMasked,
      baseUrl: geminiSetup.baseUrl,
      onBaseUrlChange: geminiSetup.setBaseUrl,
      model: geminiSetup.model,
      onModelChange: geminiSetup.setModel,
      modelOptions: geminiSetup.modelOptions,
      apiKeyPlaceholder: "Paste Gemini API key",
      apiKeyPlaceholderWhenConfigured: "Paste new Gemini API key to replace current key",
      apiKeyInputName: "gemini_token_input",
      baseUrlPlaceholder: "https://generativelanguage.googleapis.com/v1beta/openai",
      baseUrlHint: "Keep https://generativelanguage.googleapis.com/v1beta/openai unless you are using a compatible proxy endpoint.",
      costEstimate: estimateDailyCostRange(geminiSetup.model),
      priceHint: GEMINI_MODEL_OPTIONS.find((item) => item.value === geminiSetup.model)?.priceHint ?? "Model pricing and output quality vary by selection.",
      usageNote: undefined,
      instructionSteps: [
        "Create an API key from your Google AI Studio project.",
        "Paste your key and save to verify access.",
        "Pick a Gemini model from the dropdown and save.",
      ],
    },
  }), [
    claudeSetup.apiKey,
    claudeSetup.apiKeyConfigured,
    claudeSetup.apiKeyMasked,
    claudeSetup.baseUrl,
    claudeSetup.model,
    claudeSetup.modelOptions,
    claudeSetup.save,
    claudeSetup.setApiKey,
    claudeSetup.setBaseUrl,
    claudeSetup.setModel,
    claudeSetup.toggle,
    geminiSetup.apiKey,
    geminiSetup.apiKeyConfigured,
    geminiSetup.apiKeyMasked,
    geminiSetup.baseUrl,
    geminiSetup.model,
    geminiSetup.modelOptions,
    geminiSetup.save,
    geminiSetup.setApiKey,
    geminiSetup.setBaseUrl,
    geminiSetup.setModel,
    geminiSetup.toggle,
    grokSetup.apiKey,
    grokSetup.apiKeyConfigured,
    grokSetup.apiKeyMasked,
    grokSetup.baseUrl,
    grokSetup.model,
    grokSetup.modelOptions,
    grokSetup.save,
    grokSetup.setApiKey,
    grokSetup.setBaseUrl,
    grokSetup.setModel,
    grokSetup.toggle,
    isSavingTarget,
    openAISetup.apiKey,
    openAISetup.apiKeyConfigured,
    openAISetup.apiKeyMasked,
    openAISetup.baseUrl,
    openAISetup.model,
    openAISetup.modelOptions,
    openAISetup.save,
    openAISetup.setApiKey,
    openAISetup.setBaseUrl,
    openAISetup.setModel,
    openAISetup.toggle,
    settings.claude.connected,
    settings.gemini.connected,
    settings.grok.connected,
    settings.openai.connected,
  ])
  const activeProviderDefinition = activeSetup === "openai" || activeSetup === "claude" || activeSetup === "grok" || activeSetup === "gemini"
    ? providerDefinitions[activeSetup]
    : null
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
      setSettings((prev) => {
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
  }, [botTokenConfigured, settings])

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
  }, [settings])

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
      setSettings((prev) => {
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
  }, [braveApiKeyConfigured, settings])

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

    setSettings((prev) => {
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
  }, [])

  const probeCoinbaseConnection = useCallback(async (successMessage = "Coinbase probe passed.") => {
    if (isSavingTarget !== null) return
    setSaveStatus(null)
    setIsSavingTarget("coinbase")
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
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, isSavingTarget])

  const toggleCoinbase = useCallback(async () => {
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
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, coinbaseApiKeyConfigured, coinbaseApiSecretConfigured, settings])

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
    setSettings((prev) => {
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
      setSettings((prev) => {
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
      setSettings((prev) => {
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
  }, [botToken, botTokenConfigured, chatIds, settings])

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
  }, [discordWebhookUrls, settings])

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
      setSettings((prev) => {
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
  }, [braveApiKey, braveApiKeyConfigured, settings])

  const saveCoinbaseConfig = useCallback(async () => {
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
      setIsSavingTarget(null)
    }
  }, [applyCoinbaseServerConfig, coinbaseApiKey, coinbaseApiKeyConfigured, coinbaseApiSecret, coinbaseApiSecretConfigured, settings])

  const updateCoinbaseDefaults = useCallback((partial: Partial<IntegrationsSettings["coinbase"]>) => {
    setSettings((prev) => {
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
  }, [])

  const handleCoinbasePrimaryAction = useCallback(async () => {
    if (coinbasePrimaryActionMode === "save") {
      await saveCoinbaseConfig()
      return
    }
    await probeCoinbaseConnection("Coinbase sync probe passed.")
  }, [coinbasePrimaryActionMode, probeCoinbaseConnection, saveCoinbaseConfig])

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

          <div className="space-y-4">
            {activeSetup === "telegram" && (
            <section ref={telegramSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Telegram Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Telegram credentials and destination IDs for workflows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleTelegram}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.telegram.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.telegram.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveTelegramConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "telegram" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Bot Token</p>
                  {botTokenConfigured && botTokenMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Token on server: <span className="font-mono">{botTokenMasked}</span>
                    </p>
                  )}
                  <div>
                    <input
                      type="password"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder={botTokenConfigured ? "Enter new bot token to replace current token" : "1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
                      name="telegram_token_input"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Chat IDs</p>
                  <input
                    value={chatIds}
                    onChange={(e) => setChatIds(e.target.value)}
                    placeholder="123456789,-100987654321"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated IDs for multi-device delivery targets.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                    {braveNeedsKeyWarning && (
                      <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                        Key missing
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Bot Token</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open Telegram and message <span className="font-mono">@BotFather</span>.</li>
                        <li>2. Run <span className="font-mono">/newbot</span> (or <span className="font-mono">/token</span> for existing bot).</li>
                        <li>3. Copy the token and paste it into <span className="font-mono">Bot Token</span> above.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Telegram Chat ID</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open your bot chat, press <span className="font-mono">Start</span>, send <span className="font-mono">hello</span>.</li>
                        <li>2. Open <span className="font-mono">/getUpdates</span> with your bot token.</li>
                        <li>3. Copy <span className="font-mono">message.chat.id</span> into <span className="font-mono">Chat IDs</span>.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "discord" && (
            <section ref={discordSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Discord Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save Discord webhooks for mission and notification delivery.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleDiscord}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.discord.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.discord.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveDiscordConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "discord" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Webhook URLs</p>
                  <input
                    value={discordWebhookUrls}
                    onChange={(e) => setDiscordWebhookUrls(e.target.value)}
                    placeholder="https://discord.com/api/webhooks/... , https://discord.com/api/webhooks/..."
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Use comma-separated webhook URLs for multi-channel delivery.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div
                    className={cn(
                      "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                      isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                    )}
                  >
                    <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Discord Webhook URL</p>
                    <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                      <li>1. Open Discord server settings and go to <span className="font-mono">Integrations</span> then <span className="font-mono">Webhooks</span>.</li>
                      <li>2. Create or select a webhook and copy its webhook URL.</li>
                      <li>3. Paste one or more URLs into <span className="font-mono">Webhook URLs</span>, then Save.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "brave" && (
            <section ref={braveSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Brave Search API
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save a per-user Brave API key for secure web search access.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleBrave}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.brave.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.brave.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveBraveConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "brave" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {braveApiKeyConfigured && braveApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{braveApiKeyMasked}</span>
                    </p>
                  )}
                  <input
                    type="password"
                    value={braveApiKey}
                    onChange={(e) => setBraveApiKey(e.target.value)}
                    placeholder={braveApiKeyConfigured ? "Enter new key to replace current key" : "BSAI-xxxxxxxxxxxxxxxx"}
                    name="brave_api_key_input"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create Brave API Key</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Open <span className="font-mono">api.search.brave.com</span> and sign in to your Brave Search API account.</li>
                        <li>2. Create a new key for this Nova workspace and give it a clear label (for example: <span className="font-mono">Nova Desktop - Personal</span>).</li>
                        <li>3. Copy the key immediately and keep it private. Treat it like a password.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Save and Enable in Nova</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Paste the key into <span className="font-mono">API Key</span> and click <span className="font-mono">Save</span>.</li>
                        <li>2. Confirm you see a masked server value (for example: <span className="font-mono">BSAI****ABCD</span>).</li>
                        <li>3. Click <span className="font-mono">Enable</span> so mission web-search and scraping can use Brave.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Verification and Security</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Run a mission that includes web fetch/search and check run trace for successful web sources.</li>
                        <li>2. If you still see low-source or key-missing warnings, disable then re-enable Brave after saving a fresh key.</li>
                        <li>3. Rotate the key in Brave dashboard immediately if it is ever exposed in logs, screenshots, or shared text.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "coinbase" && (
            <section ref={coinbaseSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Coinbase API
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save per-user Coinbase credentials for crypto prices, portfolio reports, and automations.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={cn("rounded-full border px-2 py-0.5", settings.coinbase.connected ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200" : "border-rose-300/40 bg-rose-500/15 text-rose-200")}>
                      {settings.coinbase.connected ? "Connected" : "Disconnected"}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5", coinbaseSyncBadgeClass)}>
                      {coinbaseSyncLabel}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5", isLight ? "border-[#d5dce8] text-s-60 bg-white" : "border-white/10 text-slate-300 bg-black/20")}>
                      Mode: {settings.coinbase.connectionMode === "oauth" ? "OAuth" : "API Key Pair"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleCoinbase}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.coinbase.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.coinbase.connected ? "Disconnect" : "Connect"}
                  </button>
                  <button
                    onClick={() => void handleCoinbasePrimaryAction()}
                    disabled={isSavingTarget !== null || (coinbasePrimaryActionMode === "sync" && !coinbaseHasKeys)}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      coinbasePrimaryActionMode === "save"
                        ? "border-accent-30 bg-accent-10 text-accent hover:bg-accent-20"
                        : isLight
                          ? "border-[#d5dce8] bg-white text-s-80 hover:bg-[#f4f7fd]"
                          : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10",
                    )}
                  >
                    {coinbasePrimaryActionMode === "save" && <Save className="w-3.5 h-3.5" />}
                    {coinbasePrimaryActionLabel}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Sync Health</p>
                    <span className={cn("text-[11px] rounded-full border px-2 py-0.5", coinbaseSyncBadgeClass)}>
                      {coinbaseSyncLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Last Sync</p>
                      <p className={cn("mt-1 text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>{coinbaseLastSyncText}</p>
                    </div>
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Freshness</p>
                      <p className={cn("mt-1 text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>{coinbaseFreshnessText}</p>
                    </div>
                    <div className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
                      <p className={cn("text-[11px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Scopes</p>
                      <p className={cn("mt-1 text-sm font-medium truncate", isLight ? "text-s-80" : "text-slate-200")} title={coinbaseScopeSummary}>
                        {settings.coinbase.requiredScopes.length || 0}
                      </p>
                    </div>
                  </div>
                  {settings.coinbase.lastSyncStatus === "error" && coinbaseErrorText && (
                    <p className={cn("mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-4", isLight ? "border-rose-200 bg-rose-50 text-rose-700" : "border-rose-300/30 bg-rose-500/10 text-rose-200")}>
                      {coinbaseErrorText}
                    </p>
                  )}
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Report Defaults</p>
                    <span className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>Saved with Coinbase config</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Timezone</p>
                      <FluidSelect
                        value={settings.coinbase.reportTimezone}
                        onChange={(value) => updateCoinbaseDefaults({ reportTimezone: String(value || "UTC") })}
                        options={COINBASE_TIMEZONE_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Currency</p>
                      <FluidSelect
                        value={settings.coinbase.reportCurrency}
                        onChange={(value) => updateCoinbaseDefaults({ reportCurrency: String(value || "USD").toUpperCase() })}
                        options={COINBASE_CURRENCY_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className={cn("text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>Cadence</p>
                      <FluidSelect
                        value={settings.coinbase.reportCadence}
                        onChange={(value) => updateCoinbaseDefaults({ reportCadence: String(value) === "weekly" ? "weekly" : "daily" })}
                        options={COINBASE_CADENCE_OPTIONS}
                        isLight={isLight}
                      />
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Required scopes: <span className="font-mono">{coinbaseScopeSummary}</span>
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Secret API Key</p>
                  {coinbaseApiKeyConfigured && coinbaseApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{coinbaseApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showCoinbaseApiKey ? "text" : "password"}
                      value={coinbaseApiKey}
                      onChange={(e) => setCoinbaseApiKey(e.target.value)}
                      placeholder={coinbaseApiKeyConfigured ? "Enter new key to replace current key" : "organizations/{org_id}/apiKeys/{key_id}"}
                      name="coinbase_api_key_input"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                        )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCoinbaseApiKey((v) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 z-10 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showCoinbaseApiKey ? "Hide API key" : "Show API key"}
                      title={showCoinbaseApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showCoinbaseApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Paste the Coinbase secret API key value (usually <span className="font-mono">organizations/.../apiKeys/...</span>). Do not paste the nickname.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Secret</p>
                  {coinbaseApiSecretConfigured && coinbaseApiSecretMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Secret on server: <span className="font-mono">{coinbaseApiSecretMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <textarea
                      value={coinbaseApiSecret}
                      onChange={(e) => setCoinbaseApiSecret(e.target.value)}
                      placeholder={coinbaseApiSecretConfigured ? "Enter new secret to replace current secret" : "-----BEGIN EC PRIVATE KEY-----\\n...\\n-----END EC PRIVATE KEY-----"}
                      name="coinbase_api_secret_input"
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-enable-grammarly="false"
                      rows={showCoinbaseApiSecret ? 6 : 2}
                      className={cn(
                        "w-full min-h-[3.5rem] pr-10 pl-3 py-2 rounded-md border bg-transparent text-sm font-mono outline-none resize-y",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                        )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCoinbaseApiSecret((v) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 z-10 -translate-y-1/2 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showCoinbaseApiSecret ? "Hide API secret" : "Show API secret"}
                      title={showCoinbaseApiSecret ? "Hide API secret" : "Show API secret"}
                    >
                      {showCoinbaseApiSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-s-50" : "text-slate-400")}>
                    Paste the private key secret exactly as downloaded from Coinbase. Keep line breaks if present. If Coinbase also shows an extra passphrase/secret string, Nova does not use that field in this panel.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className={cn("text-xs uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                    {coinbaseNeedsKeyWarning && (
                      <p className={cn("text-[11px]", isLight ? "text-amber-700" : "text-amber-300")}>
                        Keys missing
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Create Coinbase API Credentials</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>
                          1. In{" "}
                          <a
                            href="https://portal.cdp.coinbase.com/access/api"
                            target="_blank"
                            rel="noreferrer noopener"
                            className={cn(
                              "underline underline-offset-2 transition-colors",
                              isLight ? "text-s-80 hover:text-s-100" : "text-slate-200 hover:text-white",
                            )}
                          >
                            Link
                          </a>
                          , create a new API key (Advanced Trade / Coinbase App).
                        </li>
                        <li>2. In Advanced Settings, choose <span className="font-mono">ECDSA</span> for SDK compatibility; direct API supports ECDSA and Ed25519.</li>
                        <li>3. For Nova v1, set permissions to read-only (Portfolio View). Leave Trade/Transfer off unless you explicitly need execution flows.</li>
                        <li>4. If you enable IP allowlist, include the real client/server IPs (and IPv6 if your network uses it), or calls will fail.</li>
                        <li>5. Copy the API key value and private key immediately, then store them securely.</li>
                        <li>6. If you see three values in Coinbase, use only the secret API key + secret (private key) here; ignore extra passphrase/secret-string fields for now.</li>
                      </ol>
                    </div>

                    <div
                      className={cn(
                        "rounded-md border p-2.5 home-spotlight-card home-border-glow",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20",
                      )}
                    >
                      <p className={cn("text-xs font-medium", isLight ? "text-s-80" : "text-slate-200")}>Save and Enable in Nova</p>
                      <ol className={cn("mt-1 space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                        <li>1. Paste Coinbase value into <span className="font-mono">Secret API Key</span>.</li>
                        <li>2. Paste Coinbase private key into <span className="font-mono">Secret</span> and click <span className="font-mono">Save</span>.</li>
                        <li>3. Confirm both values show masked on server, then click <span className="font-mono">Connect</span>.</li>
                        <li>4. Nova only needs this key + secret pair here. OAuth client ID/secret are not required in this Coinbase panel.</li>
                        <li>5. Do not paste nickname labels or extra passphrase/secret-string values into these fields.</li>
                        <li>6. Click <span className="font-mono">Sync</span> to run the live probe and update sync/freshness status.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </section>
            )}

            {activeProviderDefinition && (
              <LlmSetupPanel
                sectionRef={activeProviderDefinition.sectionRef}
                panelStyle={panelStyle}
                panelClass={panelClass}
                moduleHeightClass={moduleHeightClass}
                isLight={isLight}
                subPanelClass={subPanelClass}
                title={activeProviderDefinition.title}
                description={activeProviderDefinition.description}
                isConnected={activeProviderDefinition.isConnected}
                isSaving={activeProviderDefinition.isSaving}
                isSavingAny={isSavingTarget !== null}
                onToggle={activeProviderDefinition.onToggle}
                onSave={activeProviderDefinition.onSave}
                apiKey={activeProviderDefinition.apiKey}
                onApiKeyChange={activeProviderDefinition.onApiKeyChange}
                apiKeyPlaceholder={activeProviderDefinition.apiKeyPlaceholder}
                apiKeyConfigured={activeProviderDefinition.apiKeyConfigured}
                apiKeyMasked={activeProviderDefinition.apiKeyMasked}
                apiKeyInputName={activeProviderDefinition.apiKeyInputName}
                apiKeyPlaceholderWhenConfigured={activeProviderDefinition.apiKeyPlaceholderWhenConfigured}
                baseUrl={activeProviderDefinition.baseUrl}
                onBaseUrlChange={activeProviderDefinition.onBaseUrlChange}
                baseUrlPlaceholder={activeProviderDefinition.baseUrlPlaceholder}
                baseUrlHint={activeProviderDefinition.baseUrlHint}
                model={activeProviderDefinition.model}
                onModelChange={activeProviderDefinition.onModelChange}
                modelOptions={activeProviderDefinition.modelOptions}
                costEstimate={activeProviderDefinition.costEstimate}
                priceHint={activeProviderDefinition.priceHint}
                usageNote={activeProviderDefinition.usageNote}
                instructionSteps={activeProviderDefinition.instructionSteps}
              />
            )}

            {activeSetup === "gmail" && (
              <GmailSetupPanel
                sectionRef={gmailSetupSectionRef}
                panelStyle={panelStyle}
                panelClass={panelClass}
                moduleHeightClass={moduleHeightClass}
                isLight={isLight}
                subPanelClass={subPanelClass}
                settings={settings}
                isSavingAny={isSavingTarget !== null}
                isSavingOauth={isSavingTarget === "gmail-oauth"}
                gmailClientId={gmailSetup.gmailClientId}
                onGmailClientIdChange={gmailSetup.setGmailClientId}
                gmailClientSecret={gmailSetup.gmailClientSecret}
                onGmailClientSecretChange={gmailSetup.setGmailClientSecret}
                gmailClientSecretConfigured={gmailSetup.gmailClientSecretConfigured}
                gmailClientSecretMasked={gmailSetup.gmailClientSecretMasked}
                gmailRedirectUri={gmailSetup.gmailRedirectUri}
                onGmailRedirectUriChange={gmailSetup.setGmailRedirectUri}
                selectedGmailAccountId={gmailSetup.selectedGmailAccountId}
                onSelectGmailAccount={gmailSetup.setSelectedGmailAccountId}
                onSaveGmailConfig={gmailSetup.saveGmailConfig}
                onConnectGmail={gmailSetup.connectGmail}
                onDisconnectGmail={gmailSetup.disconnectGmail}
                onSetPrimaryGmailAccount={gmailSetup.setPrimaryGmailAccount}
                onUpdateGmailAccountState={gmailSetup.updateGmailAccountState}
              />
            )}

          </div>

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

