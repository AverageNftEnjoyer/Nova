"use client"

import { useEffect, useRef, useState, type MutableRefObject } from "react"
import { useRouter } from "next/navigation"

import type { IntegrationSetupKey } from "@/lib/integrations/navigation"
import { getRuntimeTimezone } from "@/lib/shared/timezone"
import { LOCAL_API_UNAUTHORIZED_MESSAGE } from "@/lib/shared/local-api-auth"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations/store/client-store"
import { normalizePolymarketIntegrationConfig } from "@/lib/integrations/polymarket/types"
import { connectPolymarketWallet } from "@/lib/integrations/polymarket/browser"

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
  SPOTIFY_DEFAULT_REDIRECT_URI,
  YOUTUBE_DEFAULT_REDIRECT_URI,
} from "../../constants"
import {
  useOpenAISetup,
  useClaudeSetup,
  useGrokSetup,
  useGeminiSetup,
  useGmailSetup,
  useGmailCalendarSetup,
  usePhantomSetup,
  useSpotifySetup,
  useYouTubeSetup,
  normalizeGmailAccountsForUi,
  normalizePhantomSettingsForUi,
  type IntegrationsSaveStatus,
  type IntegrationsSaveTarget,
} from "../../hooks"
import {
  COINBASE_ERROR_COPY,
  DEFAULT_COINBASE_PRIVACY,
  formatFreshnessMs,
  formatIsoTimestamp,
  makeCoinbaseSnapshot,
  type CoinbasePendingAction,
  type CoinbasePersistedSnapshot,
  type CoinbasePrivacySettings,
} from "../coinbase/meta"
import type { IntegrationsMainPanelProps } from "../types"
import { useIntegrationsActions } from "./use-integrations-actions"
import { useProviderDefinitions } from "./use-provider-definitions"

/** The props of IntegrationsMainPanel that come from integration state; the caller adds where and how it is drawn. */
export type IntegrationsPanelStateProps = Omit<
  IntegrationsMainPanelProps,
  "activeSetup" | "panelStyle" | "panelClass" | "moduleHeightClass" | "isLight" | "subPanelClass"
>

export interface IntegrationsController {
  settings: IntegrationsSettings
  /** False until the first config load settles (the page draws neutral status dots until then). */
  integrationsHydrated: boolean
  saveStatus: IntegrationsSaveStatus
  isSavingTarget: IntegrationsSaveTarget
  activeLlmProvider: LlmProvider
  saveActiveProvider: (provider: LlmProvider) => void | Promise<void>
  /** Every setup panel's section ref, in the page's order (the page's spotlight effect follows them). */
  setupSectionRefs: readonly MutableRefObject<HTMLElement | null>[]
  /** Everything IntegrationsMainPanel needs for any setup, including each setup's section ref. */
  panelProps: IntegrationsPanelStateProps
}

/**
 * The integrations connect / settings state the /integrations page and the Home building rooms share: loads the
 * masked config from /api/integrations/config, owns every setup form's state and wires the existing setup hooks and
 * actions (which do the saving, testing and disconnecting through the API; secrets never come back unmasked).
 * `activeSetup` is the setup on screen (some setups load extra data only while shown).
 */
export function useIntegrationsController(activeSetup: IntegrationSetupKey): IntegrationsController {
  const router = useRouter()
  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [integrationsHydrated] = useState(true)
  const [botToken, setBotToken] = useState("")
  const [botTokenConfigured, setBotTokenConfigured] = useState(false)
  const [botTokenMasked, setBotTokenMasked] = useState("")
  const [chatIds, setChatIds] = useState("")
  const [discordWebhookUrls, setDiscordWebhookUrls] = useState("")
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("")
  const [slackWebhookUrlConfigured, setSlackWebhookUrlConfigured] = useState(false)
  const [slackWebhookUrlMasked, setSlackWebhookUrlMasked] = useState("")
  const [braveApiKey, setBraveApiKey] = useState("")
  const [braveApiKeyConfigured, setBraveApiKeyConfigured] = useState(false)
  const [braveApiKeyMasked, setBraveApiKeyMasked] = useState("")
  const [newsApiKey, setNewsApiKey] = useState("")
  const [newsApiKeyConfigured, setNewsApiKeyConfigured] = useState(false)
  const [newsApiKeyMasked, setNewsApiKeyMasked] = useState("")
  const [newsDefaultTopics, setNewsDefaultTopics] = useState("world,business,technology,markets,crypto")
  const [newsPreferredSources, setNewsPreferredSources] = useState("")
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
  const [isSavingTarget, setIsSavingTarget] = useState<IntegrationsSaveTarget>(null)
  const [coinbasePendingAction, setCoinbasePendingAction] = useState<CoinbasePendingAction | null>(null)
  const [coinbasePrivacy, setCoinbasePrivacy] = useState<CoinbasePrivacySettings>(DEFAULT_COINBASE_PRIVACY)
  const [coinbasePrivacyHydrated, setCoinbasePrivacyHydrated] = useState(false)
  const [coinbasePrivacySaving, setCoinbasePrivacySaving] = useState(false)
  const [coinbasePrivacyError, setCoinbasePrivacyError] = useState("")
  const [saveStatus, setSaveStatus] = useState<IntegrationsSaveStatus>(null)
  const telegramSetupSectionRef = useRef<HTMLElement | null>(null)
  const discordSetupSectionRef = useRef<HTMLElement | null>(null)
  const slackSetupSectionRef = useRef<HTMLElement | null>(null)
  const braveSetupSectionRef = useRef<HTMLElement | null>(null)
  const newsSetupSectionRef = useRef<HTMLElement | null>(null)
  const coinbaseSetupSectionRef = useRef<HTMLElement | null>(null)
  const phantomSetupSectionRef = useRef<HTMLElement | null>(null)
  const polymarketSetupSectionRef = useRef<HTMLElement | null>(null)
  const openaiSetupSectionRef = useRef<HTMLElement | null>(null)
  const claudeSetupSectionRef = useRef<HTMLElement | null>(null)
  const grokSetupSectionRef = useRef<HTMLElement | null>(null)
  const geminiSetupSectionRef = useRef<HTMLElement | null>(null)
  const spotifySetupSectionRef = useRef<HTMLElement | null>(null)
  const youtubeSetupSectionRef = useRef<HTMLElement | null>(null)
  const gmailSetupSectionRef = useRef<HTMLElement | null>(null)
  const gmailCalendarSetupSectionRef = useRef<HTMLElement | null>(null)

  const openAISetup = useOpenAISetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const claudeSetup = useClaudeSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const grokSetup = useGrokSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const geminiSetup = useGeminiSetup({ settings, setSettings, setIsSavingTarget, setSaveStatus })
  const gmailSetup = useGmailSetup({
    settings,
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
  })
  const gmailCalendarSetup = useGmailCalendarSetup({
    settings,
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
  })
  const spotifySetup = useSpotifySetup({
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
  })
  const phantomSetup = usePhantomSetup({
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
  })
  const youtubeSetup = useYouTubeSetup({
    setSettings,
    setSaveStatus,
    setIsSavingTarget,
  })
  const hydrateOpenAISetup = openAISetup.hydrate
  const hydrateClaudeSetup = claudeSetup.hydrate
  const hydrateGrokSetup = grokSetup.hydrate
  const hydrateGeminiSetup = geminiSetup.hydrate
  const hydrateGmailSetup = gmailSetup.hydrate
  const hydrateSpotifySetup = spotifySetup.hydrate
  const hydratePhantomSetup = phantomSetup.hydrate
  const hydrateYouTubeSetup = youtubeSetup.hydrate

  const applyNormalizedPolymarket = (nextPolymarket: IntegrationsSettings["polymarket"]) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        polymarket: normalizePolymarketIntegrationConfig(nextPolymarket),
      }
      saveIntegrationsSettings(next)
      return next
    })
  }

  const connectPolymarket = async () => {
    setIsSavingTarget("polymarket-connect")
    try {
      const binding = await connectPolymarketWallet(window)
      const res = await fetch("/api/polymarket/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: binding.walletAddress,
          signatureType: 0,
          liveTradingEnabled: settings.polymarket.liveTradingEnabled,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.config) {
        throw new Error(String(data?.error || "Failed to connect Polymarket."))
      }
      applyNormalizedPolymarket(data.config)
      setSaveStatus({ type: "success", message: "Polymarket wallet binding saved." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to connect Polymarket." })
    } finally {
      setIsSavingTarget(null)
    }
  }

  const disconnectPolymarket = async () => {
    setIsSavingTarget("polymarket-disconnect")
    try {
      const res = await fetch("/api/polymarket/disconnect", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok || !data?.config) {
        throw new Error(String(data?.error || "Failed to disconnect Polymarket."))
      }
      applyNormalizedPolymarket(data.config)
      setSaveStatus({ type: "success", message: "Polymarket binding removed." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to disconnect Polymarket." })
    } finally {
      setIsSavingTarget(null)
    }
  }

  const setPolymarketLiveTradingEnabled = async (enabled: boolean) => {
    setIsSavingTarget("polymarket-settings")
    try {
      const res = await fetch("/api/polymarket/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveTradingEnabled: enabled }),
      })
      const data = await res.json()
      if (!res.ok || !data?.config) {
        throw new Error(String(data?.error || "Failed to update Polymarket settings."))
      }
      applyNormalizedPolymarket(data.config)
      setSaveStatus({ type: "success", message: enabled ? "Live Polymarket trading enabled." : "Live Polymarket trading disabled." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to update Polymarket settings." })
    } finally {
      setIsSavingTarget(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => ({
        ok: res.ok,
        status: res.status,
        data: await res.json(),
      }))
      .then(({ ok, status, data }) => {
        if (cancelled) return
        // Falls back to the cached settings below; a runtime-token 401 is surfaced instead of silently ignored.
        if (!ok && status === 401) setSaveStatus({ type: "error", message: LOCAL_API_UNAUTHORIZED_MESSAGE })
        const config = data?.config as IntegrationsSettings | undefined
        if (!config) {
          const fallback = loadIntegrationsSettings()
          setSettings(fallback)
          setBotToken(fallback.telegram.botToken)
          setBotTokenConfigured(Boolean(fallback.telegram.botTokenConfigured))
          setBotTokenMasked(fallback.telegram.botTokenMasked || "")
          setChatIds(fallback.telegram.chatIds)
          setDiscordWebhookUrls(fallback.discord.webhookUrls)
          setSlackWebhookUrl(fallback.slack?.webhookUrl || "")
          setSlackWebhookUrlConfigured(Boolean(fallback.slack?.webhookUrlConfigured))
          setSlackWebhookUrlMasked(fallback.slack?.webhookUrlMasked || "")
          setBraveApiKey(fallback.brave.apiKey)
          setBraveApiKeyConfigured(Boolean(fallback.brave.apiKeyConfigured))
          setBraveApiKeyMasked(fallback.brave.apiKeyMasked || "")
          setNewsApiKey(fallback.news.apiKey)
          setNewsApiKeyConfigured(Boolean(fallback.news.apiKeyConfigured))
          setNewsApiKeyMasked(fallback.news.apiKeyMasked || "")
          setNewsDefaultTopics(fallback.news.defaultTopics || "world,business,technology,markets,crypto")
          setNewsPreferredSources(fallback.news.preferredSources || "")
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
          hydrateSpotifySetup(fallback)
          hydratePhantomSetup(fallback)
          hydrateYouTubeSetup(fallback)
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
          slack: {
            connected: Boolean(config.slack?.connected),
            webhookUrl: config.slack?.webhookUrl || "",
            webhookUrlConfigured: Boolean(config.slack?.webhookUrlConfigured),
            webhookUrlMasked: typeof config.slack?.webhookUrlMasked === "string" ? config.slack.webhookUrlMasked : "",
          },
          brave: {
            connected: Boolean(config.brave?.connected),
            apiKey: config.brave?.apiKey || "",
            apiKeyConfigured: Boolean(config.brave?.apiKeyConfigured),
            apiKeyMasked: typeof config.brave?.apiKeyMasked === "string" ? config.brave.apiKeyMasked : "",
          },
          news: {
            connected: Boolean(config.news?.connected),
            apiKey: config.news?.apiKey || "",
            defaultTopics: Array.isArray(config.news?.defaultTopics)
              ? config.news.defaultTopics.map((topic: unknown) => String(topic).trim()).filter(Boolean).join(",")
              : typeof config.news?.defaultTopics === "string"
                ? config.news.defaultTopics
                : "world,business,technology,markets,crypto",
            preferredSources: Array.isArray(config.news?.preferredSources)
              ? config.news.preferredSources.map((source: unknown) => String(source).trim()).filter(Boolean).join(",")
              : typeof config.news?.preferredSources === "string"
                ? config.news.preferredSources
                : "",
            language: typeof config.news?.language === "string" && config.news.language.trim().length > 0
              ? config.news.language.trim().toLowerCase()
              : "en",
            country: typeof config.news?.country === "string" && config.news.country.trim().length > 0
              ? config.news.country.trim().toLowerCase()
              : "us",
            apiKeyConfigured: Boolean(config.news?.apiKeyConfigured),
            apiKeyMasked: typeof config.news?.apiKeyMasked === "string" ? config.news.apiKeyMasked : "",
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
                : getRuntimeTimezone(),
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
          phantom: normalizePhantomSettingsForUi(config.phantom),
          polymarket: normalizePolymarketIntegrationConfig(config.polymarket),
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
          spotify: {
            connected: Boolean(config.spotify?.connected),
            spotifyUserId: typeof config.spotify?.spotifyUserId === "string" ? config.spotify.spotifyUserId : "",
            displayName: typeof config.spotify?.displayName === "string" ? config.spotify.displayName : "",
            scopes: Array.isArray(config.spotify?.scopes)
              ? config.spotify.scopes.join(" ")
              : typeof config.spotify?.scopes === "string"
                ? config.spotify.scopes
                : "",
            oauthClientId: typeof config.spotify?.oauthClientId === "string" ? config.spotify.oauthClientId : "",
            redirectUri: typeof config.spotify?.redirectUri === "string" ? config.spotify.redirectUri : SPOTIFY_DEFAULT_REDIRECT_URI,
            tokenConfigured: Boolean(config.spotify?.tokenConfigured),
          },
          youtube: {
            connected: Boolean(config.youtube?.connected),
            channelId: typeof config.youtube?.channelId === "string" ? config.youtube.channelId : "",
            channelTitle: typeof config.youtube?.channelTitle === "string" ? config.youtube.channelTitle : "",
            scopes: Array.isArray(config.youtube?.scopes)
              ? config.youtube.scopes.join(" ")
              : typeof config.youtube?.scopes === "string"
                ? config.youtube.scopes
                : "",
            permissions: {
              allowFeed: typeof config.youtube?.permissions?.allowFeed === "boolean"
                ? config.youtube.permissions.allowFeed
                : true,
              allowSearch: typeof config.youtube?.permissions?.allowSearch === "boolean"
                ? config.youtube.permissions.allowSearch
                : true,
              allowVideoDetails: typeof config.youtube?.permissions?.allowVideoDetails === "boolean"
                ? config.youtube.permissions.allowVideoDetails
                : true,
            },
            redirectUri: typeof config.youtube?.redirectUri === "string" ? config.youtube.redirectUri : YOUTUBE_DEFAULT_REDIRECT_URI,
            tokenConfigured: Boolean(config.youtube?.tokenConfigured),
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
          gcalendar: {
            connected: Boolean(config.gcalendar?.connected),
            email: typeof config.gcalendar?.email === "string" ? config.gcalendar.email : "",
            scopes: Array.isArray(config.gcalendar?.scopes)
              ? config.gcalendar.scopes.join(" ")
              : typeof config.gcalendar?.scopes === "string"
                ? config.gcalendar.scopes
                : "",
            permissions: {
              allowCreate: typeof config.gcalendar?.permissions?.allowCreate === "boolean" ? config.gcalendar.permissions.allowCreate : true,
              allowEdit: typeof config.gcalendar?.permissions?.allowEdit === "boolean" ? config.gcalendar.permissions.allowEdit : true,
              allowDelete: typeof config.gcalendar?.permissions?.allowDelete === "boolean" ? config.gcalendar.permissions.allowDelete : false,
            },
            accounts: Array.isArray(config.gcalendar?.accounts)
              ? config.gcalendar.accounts.map((a: { id?: string; email?: string; scopes?: string[]; connectedAt?: string; enabled?: boolean; active?: boolean }) => ({
                  id: String(a?.id || ""),
                  email: String(a?.email || ""),
                  scopes: Array.isArray(a?.scopes) ? a.scopes : [],
                  connectedAt: a?.connectedAt || "",
                  active: a?.id === config.gcalendar?.activeAccountId,
                  enabled: a?.enabled ?? true,
                }))
              : [],
            activeAccountId: typeof config.gcalendar?.activeAccountId === "string" ? config.gcalendar.activeAccountId : "",
            redirectUri: typeof config.gcalendar?.redirectUri === "string" ? config.gcalendar.redirectUri : "http://localhost:3000/api/integrations/gmail-calendar/callback",
            tokenConfigured: Boolean(config.gcalendar?.tokenConfigured),
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
        setSlackWebhookUrl(normalized.slack?.webhookUrl || "")
        setSlackWebhookUrlConfigured(Boolean(normalized.slack?.webhookUrlConfigured))
        setSlackWebhookUrlMasked(normalized.slack?.webhookUrlMasked || "")
        setBraveApiKey(normalized.brave.apiKey)
        setBraveApiKeyConfigured(Boolean(normalized.brave.apiKeyConfigured))
        setBraveApiKeyMasked(normalized.brave.apiKeyMasked || "")
        setNewsApiKey(normalized.news.apiKey)
        setNewsApiKeyConfigured(Boolean(normalized.news.apiKeyConfigured))
        setNewsApiKeyMasked(normalized.news.apiKeyMasked || "")
        setNewsDefaultTopics(normalized.news.defaultTopics || "world,business,technology,markets,crypto")
        setNewsPreferredSources(normalized.news.preferredSources || "")
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
        hydrateSpotifySetup(normalized)
        hydratePhantomSetup(normalized)
        hydrateYouTubeSetup(normalized)
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
        setSlackWebhookUrl(fallback.slack?.webhookUrl || "")
        setSlackWebhookUrlConfigured(Boolean(fallback.slack?.webhookUrlConfigured))
        setSlackWebhookUrlMasked(fallback.slack?.webhookUrlMasked || "")
        setBraveApiKey(fallback.brave.apiKey)
        setBraveApiKeyConfigured(Boolean(fallback.brave.apiKeyConfigured))
        setBraveApiKeyMasked(fallback.brave.apiKeyMasked || "")
        setNewsApiKey(fallback.news.apiKey)
        setNewsApiKeyConfigured(Boolean(fallback.news.apiKeyConfigured))
        setNewsApiKeyMasked(fallback.news.apiKeyMasked || "")
        setNewsDefaultTopics(fallback.news.defaultTopics || "world,business,technology,markets,crypto")
        setNewsPreferredSources(fallback.news.preferredSources || "")
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
        hydrateSpotifySetup(fallback)
        hydratePhantomSetup(fallback)
        hydrateYouTubeSetup(fallback)
        hydrateGmailSetup(fallback)
        setActiveLlmProvider(fallback.activeLlmProvider || "openai")
      })

    return () => {
      cancelled = true
    }
  }, [hydrateClaudeSetup, hydrateGeminiSetup, hydrateGmailSetup, hydrateGrokSetup, hydrateOpenAISetup, hydratePhantomSetup, hydrateSpotifySetup, hydrateYouTubeSetup])

  // Auto-dismiss save status
  useEffect(() => {
    if (!saveStatus) return
    const timeout = window.setTimeout(() => setSaveStatus(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [saveStatus])

  const telegramNeedsKeyWarning = !(
    settings.telegram.botTokenConfigured ||
    botTokenConfigured ||
    botToken.trim().length > 0
  )
  const braveNeedsKeyWarning = !(settings.brave.connected && (settings.brave.apiKeyConfigured || braveApiKeyConfigured))
  const newsNeedsKeyWarning = !(settings.news.connected && (settings.news.apiKeyConfigured || newsApiKeyConfigured))
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
    toggleSlack,
    toggleBrave,
    toggleNews,
    probeCoinbaseConnection,
    toggleCoinbase,
    saveActiveProvider,
    saveTelegramConfig,
    saveDiscordConfig,
    saveSlackConfig,
    saveBraveConfig,
    saveNewsConfig,
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
    slackWebhookUrl,
    slackWebhookUrlConfigured,
    setSlackWebhookUrlConfigured,
    setSlackWebhookUrlMasked,
    braveApiKey,
    braveApiKeyConfigured,
    setBraveApiKey,
    setBraveApiKeyConfigured,
    setBraveApiKeyMasked,
    newsApiKey,
    newsApiKeyConfigured,
    setNewsApiKey,
    setNewsApiKeyConfigured,
    setNewsApiKeyMasked,
    newsDefaultTopics,
    setNewsDefaultTopics,
    newsPreferredSources,
    setNewsPreferredSources,
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

  const panelProps: IntegrationsPanelStateProps = {
    settings,
    isSavingTarget,
    telegramNeedsKeyWarning,
    braveNeedsKeyWarning,
    braveApiKeyConfigured,
    braveApiKeyMasked,
    newsNeedsKeyWarning,
    newsApiKey,
    setNewsApiKey,
    newsApiKeyConfigured,
    newsApiKeyMasked,
    newsDefaultTopics,
    setNewsDefaultTopics,
    newsPreferredSources,
    setNewsPreferredSources,
    coinbaseNeedsKeyWarning,
    coinbasePendingAction,
    coinbaseSyncBadgeClass,
    coinbaseSyncLabel,
    coinbaseLastSyncText,
    coinbaseFreshnessText,
    coinbaseErrorText,
    coinbaseHasKeys,
    coinbaseScopeSummary,
    coinbasePrivacy,
    coinbasePrivacyHydrated,
    coinbasePrivacySaving,
    coinbasePrivacyError,
    coinbaseApiKey,
    setCoinbaseApiKey,
    coinbaseApiKeyConfigured,
    coinbaseApiKeyMasked,
    coinbaseApiSecret,
    setCoinbaseApiSecret,
    showCoinbaseApiSecret,
    setShowCoinbaseApiSecret,
    coinbaseApiSecretConfigured,
    coinbaseApiSecretMasked,
    providerDefinition: activeProviderDefinition,
    gmailSetup,
    gmailCalendarSetup,
    phantomSetup: {
      walletAddress: phantomSetup.walletAddress,
      walletLabel: phantomSetup.walletLabel,
      connectedAt: phantomSetup.connectedAt,
      verifiedAt: phantomSetup.verifiedAt,
      lastDisconnectedAt: phantomSetup.lastDisconnectedAt,
      evmAddress: phantomSetup.evmAddress,
      evmLabel: phantomSetup.evmLabel,
      evmChainId: phantomSetup.evmChainId,
      evmConnectedAt: phantomSetup.evmConnectedAt,
      evmAvailable: phantomSetup.evmAvailable,
      providerInstalled: phantomSetup.providerInstalled,
      providerReady: phantomSetup.providerReady,
      providerSupportedContext: phantomSetup.providerSupportedContext,
      providerContextReason: phantomSetup.providerContextReason,
      trustedReconnectReady: phantomSetup.trustedReconnectReady,
      openBrowserConnect: phantomSetup.openBrowserConnect,
      openPhantomInstall: phantomSetup.openPhantomInstall,
      refreshProviderState: phantomSetup.refreshProviderState,
      savePhantomPreferences: phantomSetup.savePhantomPreferences,
      connectPhantom: phantomSetup.connectPhantom,
      disconnectPhantom: () => phantomSetup.disconnectPhantom(),
    },
    polymarketSetup: {
      connectPolymarket,
      disconnectPolymarket,
      openPolymarketWorkspace: () => router.push("/polymarket"),
      setLiveTradingEnabled: setPolymarketLiveTradingEnabled,
    },
    spotifySetup,
    youtubeSetup,
    phantomSetupSectionRef,
    polymarketSetupSectionRef,
    spotifySetupSectionRef,
    youtubeSetupSectionRef,
    gmailCalendarSetupSectionRef,
    telegramSetupSectionRef,
    discordSetupSectionRef,
    slackSetupSectionRef,
    braveSetupSectionRef,
    newsSetupSectionRef,
    coinbaseSetupSectionRef,
    gmailSetupSectionRef,
    setBotToken,
    botToken,
    botTokenConfigured,
    botTokenMasked,
    setChatIds,
    chatIds,
    setDiscordWebhookUrls,
    discordWebhookUrls,
    setSlackWebhookUrl,
    slackWebhookUrl,
    slackWebhookUrlConfigured,
    slackWebhookUrlMasked,
    setBraveApiKey,
    braveApiKey,
    toggleTelegram,
    saveTelegramConfig,
    toggleDiscord,
    saveDiscordConfig,
    toggleSlack,
    saveSlackConfig,
    toggleBrave,
    saveBraveConfig,
    toggleNews,
    saveNewsConfig,
    probeCoinbaseConnection,
    toggleCoinbase,
    saveCoinbaseConfig,
    updateCoinbasePrivacy,
    updateCoinbaseDefaults,
  }

  return {
    settings,
    integrationsHydrated,
    saveStatus,
    isSavingTarget,
    activeLlmProvider,
    saveActiveProvider,
    setupSectionRefs: [
      telegramSetupSectionRef,
      discordSetupSectionRef,
      slackSetupSectionRef,
      braveSetupSectionRef,
      newsSetupSectionRef,
      coinbaseSetupSectionRef,
      phantomSetupSectionRef,
      polymarketSetupSectionRef,
      openaiSetupSectionRef,
      claudeSetupSectionRef,
      grokSetupSectionRef,
      geminiSetupSectionRef,
      spotifySetupSectionRef,
      youtubeSetupSectionRef,
      gmailSetupSectionRef,
      gmailCalendarSetupSectionRef,
    ],
    panelProps,
  }
}
