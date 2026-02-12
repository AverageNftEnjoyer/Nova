"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Blocks, Save, Send, Eye, EyeOff, Settings, User } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type ThemeBackgroundType, type UserProfile } from "@/lib/userSettings"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations"
import { FluidSelect, type FluidSelectOption } from "@/components/ui/fluid-select"
import { SettingsModal } from "@/components/settings-modal"
import { useNovaState } from "@/lib/useNovaState"
import FloatingLines from "@/components/FloatingLines"
import { DiscordIcon } from "@/components/discord-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { NovaOrbIndicator } from "@/components/nova-orb-indicator"
import { readShellUiCache, writeShellUiCache } from "@/lib/shell-ui-cache"
import { getCachedBackgroundVideoObjectUrl, loadBackgroundVideoObjectUrl } from "@/lib/backgroundVideoStorage"
import "@/components/FloatingLines.css"

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const FLOATING_LINES_ENABLED_WAVES: string[] = ["top", "middle", "bottom"]
const FLOATING_LINES_LINE_COUNT: number[] = [5, 5, 5]
const FLOATING_LINES_LINE_DISTANCE: number[] = [5, 5, 5]
const FLOATING_LINES_TOP_WAVE_POSITION = { x: 10.0, y: 0.5, rotate: -0.4 }
const FLOATING_LINES_MIDDLE_WAVE_POSITION = { x: 5.0, y: 0.0, rotate: 0.2 }
const FLOATING_LINES_BOTTOM_WAVE_POSITION = { x: 2.0, y: -0.7, rotate: -1 }
const OPENAI_MODEL_OPTIONS: Array<{ value: string; label: string; priceHint: string }> = [
  { value: "gpt-5.2", label: "GPT-5.2", priceHint: "Latest flagship quality, premium token cost" },
  { value: "gpt-5.2-pro", label: "GPT-5.2 Pro", priceHint: "Highest precision, highest cost (availability-based)" },
  { value: "gpt-5", label: "GPT-5", priceHint: "High-quality reasoning and coding" },
  { value: "gpt-5-mini", label: "GPT-5 Mini", priceHint: "Lower-cost GPT-5 variant" },
  { value: "gpt-5-nano", label: "GPT-5 Nano", priceHint: "Fastest and cheapest GPT-5 variant" },
  { value: "gpt-4.1", label: "GPT-4.1", priceHint: "Balanced quality/cost" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", priceHint: "Lower cost for routine tasks" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", priceHint: "Most cost-efficient GPT-4.1 variant" },
  { value: "gpt-4o", label: "GPT-4o", priceHint: "Strong multimodal quality" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", priceHint: "Lightweight multimodal" },
]
const OPENAI_MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-5.2": { input: 1.75, output: 14.0 },
  "gpt-5.2-pro": { input: 12.0, output: 96.0 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 5.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.6, output: 2.4 },
}
const OPENAI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = OPENAI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
const CLAUDE_MODEL_OPTIONS: Array<{ value: string; label: string; priceHint: string }> = [
  { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1", priceHint: "Highest reasoning quality, premium token cost" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4", priceHint: "Advanced reasoning and coding, premium token cost" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", priceHint: "Balanced speed, quality, and cost" },
  { value: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", priceHint: "Strong all-around quality at mid-tier cost" },
  { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", priceHint: "Reliable quality with good cost efficiency" },
  { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", priceHint: "Fastest and lowest-cost Claude option" },
]
const CLAUDE_MODEL_SELECT_FALLBACK: FluidSelectOption[] = CLAUDE_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
const CLAUDE_MODEL_PRICING_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
}

function resolveThemeBackground(isLight: boolean): ThemeBackgroundType {
  const settings = loadUserSettings()
  if (isLight) return settings.app.lightModeBackground ?? "none"
  const legacyDark = settings.app.background === "none" ? "none" : "floatingLines"
  return settings.app.darkModeBackground ?? legacyDark
}

function normalizeCachedBackground(value: unknown): ThemeBackgroundType | null {
  if (value === "floatingLines" || value === "none" || value === "customVideo") return value
  if (value === "default") return "floatingLines"
  return null
}

function resolveModelPricing(model: string): { input: number; output: number } | null {
  if (!model) return null
  if (OPENAI_MODEL_PRICING_USD_PER_1M[model]) return OPENAI_MODEL_PRICING_USD_PER_1M[model]
  if (CLAUDE_MODEL_PRICING_USD_PER_1M[model]) return CLAUDE_MODEL_PRICING_USD_PER_1M[model]
  const normalized = model.trim().toLowerCase()
  if (normalized.includes("claude-opus-4-6") || normalized.includes("claude-opus-4.6")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 }
  return null
}

function estimateDailyCostRange(model: string): string {
  const pricing = resolveModelPricing(model)
  if (!pricing) return "N/A"
  const estimate = (totalTokens: number) => {
    const inputTokens = totalTokens / 2
    const outputTokens = totalTokens / 2
    return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
  }
  const min = estimate(20_000)
  const max = estimate(40_000)
  return `$${min.toFixed(2)}-$${max.toFixed(2)}/day`
}

function getClaudePriceHint(model: string): string {
  const preset = CLAUDE_MODEL_OPTIONS.find((option) => option.value === model)
  if (preset) return preset.priceHint
  const pricing = resolveModelPricing(model)
  if (!pricing) return "Pricing for this model is not in local presets yet."
  return `Estimated pricing for this model tier: $${pricing.input.toFixed(2)} in / $${pricing.output.toFixed(2)} out per 1M tokens.`
}
const INITIAL_INTEGRATIONS_SETTINGS: IntegrationsSettings = {
  telegram: {
    connected: true,
    botToken: "",
    chatIds: "",
  },
  discord: {
    connected: false,
    webhookUrls: "",
  },
  openai: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  claude: {
    connected: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeyConfigured: false,
    apiKeyMasked: "",
  },
  activeLlmProvider: "openai",
  updatedAt: "",
}

export default function IntegrationsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [settings, setSettings] = useState<IntegrationsSettings>(INITIAL_INTEGRATIONS_SETTINGS)
  const [botToken, setBotToken] = useState("")
  const [botTokenConfigured, setBotTokenConfigured] = useState(false)
  const [botTokenMasked, setBotTokenMasked] = useState("")
  const [chatIds, setChatIds] = useState("")
  const [discordWebhookUrls, setDiscordWebhookUrls] = useState("")
  const [openaiApiKey, setOpenaiApiKey] = useState("")
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("https://api.openai.com/v1")
  const [openaiDefaultModel, setOpenaiDefaultModel] = useState("gpt-4.1")
  const [openaiApiKeyConfigured, setOpenaiApiKeyConfigured] = useState(false)
  const [openaiApiKeyMasked, setOpenaiApiKeyMasked] = useState("")
  const [showOpenAIApiKey, setShowOpenAIApiKey] = useState(false)
  const [claudeApiKey, setClaudeApiKey] = useState("")
  const [claudeBaseUrl, setClaudeBaseUrl] = useState("https://api.anthropic.com")
  const [claudeDefaultModel, setClaudeDefaultModel] = useState("claude-sonnet-4-20250514")
  const [claudeApiKeyConfigured, setClaudeApiKeyConfigured] = useState(false)
  const [claudeApiKeyMasked, setClaudeApiKeyMasked] = useState("")
  const [showClaudeApiKey, setShowClaudeApiKey] = useState(false)
  const [claudeModelOptions, setClaudeModelOptions] = useState<FluidSelectOption[]>(CLAUDE_MODEL_SELECT_FALLBACK)
  const [activeLlmProvider, setActiveLlmProvider] = useState<LlmProvider>("openai")
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [orbHovered, setOrbHovered] = useState(false)
  const [profile, setProfile] = useState<UserProfile>({
    name: "User",
    avatar: null,
    accessTier: "Core Access",
  })
  // Keep initial render deterministic between server and client to avoid hydration mismatch.
  const [background, setBackground] = useState<ThemeBackgroundType>("none")
  const [backgroundVideoUrl, setBackgroundVideoUrl] = useState<string | null>(null)
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const [activeSetup, setActiveSetup] = useState<"telegram" | "discord" | "openai" | "claude">("telegram")
  const [isSavingTarget, setIsSavingTarget] = useState<null | "telegram" | "discord" | "openai" | "claude" | "provider">(null)
  const [saveStatus, setSaveStatus] = useState<null | { type: "success" | "error"; message: string }>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const connectivitySectionRef = useRef<HTMLElement | null>(null)
  const telegramSetupSectionRef = useRef<HTMLElement | null>(null)
  const discordSetupSectionRef = useRef<HTMLElement | null>(null)
  const openaiSetupSectionRef = useRef<HTMLElement | null>(null)
  const claudeSetupSectionRef = useRef<HTMLElement | null>(null)
  const activeStatusSectionRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const local = loadIntegrationsSettings()
    setSettings(local)
    setBotToken(local.telegram.botToken)
    setBotTokenConfigured(Boolean(local.telegram.botTokenConfigured))
    setBotTokenMasked(local.telegram.botTokenMasked || "")
    setChatIds(local.telegram.chatIds)
    setDiscordWebhookUrls(local.discord.webhookUrls)
    setOpenaiApiKey(local.openai.apiKey)
    setOpenaiBaseUrl(local.openai.baseUrl)
    setOpenaiDefaultModel(local.openai.defaultModel)
    setOpenaiApiKeyConfigured(Boolean(local.openai.apiKeyConfigured))
    setOpenaiApiKeyMasked(local.openai.apiKeyMasked || "")
    setClaudeApiKey(local.claude.apiKey)
    setClaudeBaseUrl(local.claude.baseUrl)
    setClaudeDefaultModel(local.claude.defaultModel)
    setClaudeApiKeyConfigured(Boolean(local.claude.apiKeyConfigured))
    setClaudeApiKeyMasked(local.claude.apiKeyMasked || "")
    setActiveLlmProvider(local.activeLlmProvider || "openai")

    const cached = readShellUiCache()

    const userSettings = loadUserSettings()
    const nextOrbColor = cached.orbColor ?? userSettings.app.orbColor
    const nextBackground = normalizeCachedBackground(cached.background) ?? resolveThemeBackground(isLight)
    const selectedAssetId = userSettings.app.customBackgroundVideoAssetId
    const nextBackgroundVideoUrl = cached.backgroundVideoUrl ?? getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
    const nextSpotlight = cached.spotlightEnabled ?? (userSettings.app.spotlightEnabled ?? true)
    setProfile(userSettings.profile)
    setOrbColor(nextOrbColor)
    setBackground(nextBackground)
    setBackgroundVideoUrl(nextBackgroundVideoUrl ?? null)
    setSpotlightEnabled(nextSpotlight)
    writeShellUiCache({
      orbColor: nextOrbColor,
      background: nextBackground,
      backgroundVideoUrl: nextBackgroundVideoUrl ?? null,
      spotlightEnabled: nextSpotlight,
    })
  }, [isLight])

  useEffect(() => {
    let cancelled = false

    fetch("/api/integrations/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const config = data?.config as IntegrationsSettings | undefined
        if (!config) {
          const fallback = loadIntegrationsSettings()
          setSettings(fallback)
          setBotToken(fallback.telegram.botToken)
          setBotTokenConfigured(Boolean(fallback.telegram.botTokenConfigured))
          setBotTokenMasked(fallback.telegram.botTokenMasked || "")
          setChatIds(fallback.telegram.chatIds)
          setDiscordWebhookUrls(fallback.discord.webhookUrls)
          setOpenaiApiKey(fallback.openai.apiKey)
          setOpenaiBaseUrl(fallback.openai.baseUrl)
          setOpenaiDefaultModel(fallback.openai.defaultModel)
          setOpenaiApiKeyConfigured(Boolean(fallback.openai.apiKeyConfigured))
          setOpenaiApiKeyMasked(fallback.openai.apiKeyMasked || "")
          setClaudeApiKey(fallback.claude.apiKey)
          setClaudeBaseUrl(fallback.claude.baseUrl)
          setClaudeDefaultModel(fallback.claude.defaultModel)
          setClaudeApiKeyConfigured(Boolean(fallback.claude.apiKeyConfigured))
          setClaudeApiKeyMasked(fallback.claude.apiKeyMasked || "")
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
          openai: {
            connected: Boolean(config.openai?.connected),
            apiKey: config.openai?.apiKey || "",
            baseUrl: config.openai?.baseUrl || "https://api.openai.com/v1",
            defaultModel: config.openai?.defaultModel || "gpt-4.1",
            apiKeyConfigured: Boolean(config.openai?.apiKeyConfigured),
            apiKeyMasked: typeof config.openai?.apiKeyMasked === "string" ? config.openai.apiKeyMasked : "",
          },
          claude: {
            connected: Boolean(config.claude?.connected),
            apiKey: config.claude?.apiKey || "",
            baseUrl: config.claude?.baseUrl || "https://api.anthropic.com",
            defaultModel: config.claude?.defaultModel || "claude-sonnet-4-20250514",
            apiKeyConfigured: Boolean(config.claude?.apiKeyConfigured),
            apiKeyMasked: typeof config.claude?.apiKeyMasked === "string" ? config.claude.apiKeyMasked : "",
          },
          activeLlmProvider: config.activeLlmProvider === "claude" ? "claude" : "openai",
          updatedAt: config.updatedAt || new Date().toISOString(),
        }
        setSettings(normalized)
        setBotToken(normalized.telegram.botToken)
        setBotTokenConfigured(Boolean(normalized.telegram.botTokenConfigured))
        setBotTokenMasked(normalized.telegram.botTokenMasked || "")
        setChatIds(normalized.telegram.chatIds)
        setDiscordWebhookUrls(normalized.discord.webhookUrls)
        setOpenaiApiKey(normalized.openai.apiKey)
        setOpenaiBaseUrl(normalized.openai.baseUrl)
        setOpenaiDefaultModel(normalized.openai.defaultModel)
        setOpenaiApiKeyConfigured(Boolean(normalized.openai.apiKeyConfigured))
        setOpenaiApiKeyMasked(normalized.openai.apiKeyMasked || "")
        setClaudeApiKey(normalized.claude.apiKey)
        setClaudeBaseUrl(normalized.claude.baseUrl)
        setClaudeDefaultModel(normalized.claude.defaultModel)
        setClaudeApiKeyConfigured(Boolean(normalized.claude.apiKeyConfigured))
        setClaudeApiKeyMasked(normalized.claude.apiKeyMasked || "")
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
        setOpenaiApiKey(fallback.openai.apiKey)
        setOpenaiBaseUrl(fallback.openai.baseUrl)
        setOpenaiDefaultModel(fallback.openai.defaultModel)
        setOpenaiApiKeyConfigured(Boolean(fallback.openai.apiKeyConfigured))
        setOpenaiApiKeyMasked(fallback.openai.apiKeyMasked || "")
        setClaudeApiKey(fallback.claude.apiKey)
        setClaudeBaseUrl(fallback.claude.baseUrl)
        setClaudeDefaultModel(fallback.claude.defaultModel)
        setClaudeApiKeyConfigured(Boolean(fallback.claude.apiKeyConfigured))
        setClaudeApiKeyMasked(fallback.claude.apiKeyMasked || "")
        setActiveLlmProvider(fallback.activeLlmProvider || "openai")
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      const userSettings = loadUserSettings()
      setProfile(userSettings.profile)
      setOrbColor(userSettings.app.orbColor)
      setBackground(resolveThemeBackground(isLight))
      setSpotlightEnabled(userSettings.app.spotlightEnabled ?? true)
      writeShellUiCache({
        orbColor: userSettings.app.orbColor,
        background: resolveThemeBackground(isLight),
        spotlightEnabled: userSettings.app.spotlightEnabled ?? true,
      })
    }
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, refresh as EventListener)
  }, [isLight])

  useEffect(() => {
    let cancelled = false
    if (isLight || background !== "customVideo") return

    const uiCached = readShellUiCache().backgroundVideoUrl
    if (uiCached) {
      setBackgroundVideoUrl(uiCached)
    }
    const selectedAssetId = loadUserSettings().app.customBackgroundVideoAssetId
    const cached = getCachedBackgroundVideoObjectUrl(selectedAssetId || undefined)
    if (cached) {
      setBackgroundVideoUrl(cached)
      writeShellUiCache({ backgroundVideoUrl: cached })
    }
    void loadBackgroundVideoObjectUrl(selectedAssetId || undefined)
      .then((url) => {
        if (cancelled) return
        setBackgroundVideoUrl(url)
        writeShellUiCache({ backgroundVideoUrl: url })
      })
      .catch(() => {
        if (cancelled) return
        const fallback = readShellUiCache().backgroundVideoUrl
        if (!fallback) setBackgroundVideoUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [background, isLight])

  useEffect(() => {
    if (!saveStatus) return
    const timeout = window.setTimeout(() => setSaveStatus(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [saveStatus])

  useEffect(() => {
    if (!spotlightEnabled) return

    const setupSectionSpotlight = (section: HTMLElement) => {
      const spotlight = document.createElement("div")
      spotlight.className = "home-global-spotlight"
      section.appendChild(spotlight)
      let liveStars = 0

      const handleMouseMove = (e: MouseEvent) => {
        const rect = section.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        spotlight.style.left = `${mouseX}px`
        spotlight.style.top = `${mouseY}px`
        spotlight.style.opacity = "1"

        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        const proximity = 70
        const fadeDistance = 140

        cards.forEach((card) => {
          const cardRect = card.getBoundingClientRect()
          const isInsideCard =
            e.clientX >= cardRect.left &&
            e.clientX <= cardRect.right &&
            e.clientY >= cardRect.top &&
            e.clientY <= cardRect.bottom
          const centerX = cardRect.left + cardRect.width / 2
          const centerY = cardRect.top + cardRect.height / 2
          const distance =
            Math.hypot(e.clientX - centerX, e.clientY - centerY) - Math.max(cardRect.width, cardRect.height) / 2
          const effectiveDistance = Math.max(0, distance)

          let glowIntensity = 0
          if (effectiveDistance <= proximity) {
            glowIntensity = 1
          } else if (effectiveDistance <= fadeDistance) {
            glowIntensity = (fadeDistance - effectiveDistance) / (fadeDistance - proximity)
          }

          const relativeX = ((e.clientX - cardRect.left) / cardRect.width) * 100
          const relativeY = ((e.clientY - cardRect.top) / cardRect.height) * 100
          card.style.setProperty("--glow-x", `${relativeX}%`)
          card.style.setProperty("--glow-y", `${relativeY}%`)
          card.style.setProperty("--glow-intensity", glowIntensity.toString())
          card.style.setProperty("--glow-radius", "120px")

          if (isInsideCard && glowIntensity > 0.2 && Math.random() <= 0.16 && liveStars < 42) {
            liveStars += 1
            const star = document.createElement("span")
            star.className = "fx-star-particle"
            star.style.left = `${e.clientX - cardRect.left}px`
            star.style.top = `${e.clientY - cardRect.top}px`
            star.style.setProperty("--fx-star-color", "rgba(255,255,255,1)")
            star.style.setProperty("--fx-star-glow", "rgba(255,255,255,0.7)")
            star.style.setProperty("--star-x", `${(Math.random() - 0.5) * 34}px`)
            star.style.setProperty("--star-y", `${-12 - Math.random() * 26}px`)
            star.style.animationDuration = `${0.9 + Math.random() * 0.6}s`
            card.appendChild(star)
            star.addEventListener(
              "animationend",
              () => {
                star.remove()
                liveStars = Math.max(0, liveStars - 1)
              },
              { once: true },
            )
          }
        })
      }

      const handleMouseLeave = () => {
        spotlight.style.opacity = "0"
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      }

      section.addEventListener("mousemove", handleMouseMove)
      section.addEventListener("mouseleave", handleMouseLeave)

      return () => {
        section.removeEventListener("mousemove", handleMouseMove)
        section.removeEventListener("mouseleave", handleMouseLeave)
        const cards = section.querySelectorAll<HTMLElement>(".home-spotlight-card")
        cards.forEach((card) => card.style.setProperty("--glow-intensity", "0"))
        spotlight.remove()
      }
    }

    const cleanups: Array<() => void> = []
    if (connectivitySectionRef.current) cleanups.push(setupSectionSpotlight(connectivitySectionRef.current))
    if (telegramSetupSectionRef.current) cleanups.push(setupSectionSpotlight(telegramSetupSectionRef.current))
    if (discordSetupSectionRef.current) cleanups.push(setupSectionSpotlight(discordSetupSectionRef.current))
    if (openaiSetupSectionRef.current) cleanups.push(setupSectionSpotlight(openaiSetupSectionRef.current))
    if (claudeSetupSectionRef.current) cleanups.push(setupSectionSpotlight(claudeSetupSectionRef.current))
    if (activeStatusSectionRef.current) cleanups.push(setupSectionSpotlight(activeStatusSectionRef.current))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [activeSetup, spotlightEnabled])

  const orbPalette = ORB_COLORS[orbColor]
  const orbHoverFilter = `drop-shadow(0 0 8px ${hexToRgba(orbPalette.circle1, 0.55)}) drop-shadow(0 0 14px ${hexToRgba(orbPalette.circle2, 0.35)})`
  const floatingLinesGradient = useMemo(() => [orbPalette.circle1, orbPalette.circle2], [orbPalette.circle1, orbPalette.circle2])

  const panelClass =
    isLight
      ? "rounded-2xl border border-[#d9e0ea] bg-white shadow-none"
      : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"
  const panelStyle = isLight ? undefined : { boxShadow: "0 20px 60px -35px rgba(var(--accent-rgb), 0.35)" }
  const moduleHeightClass = "h-[clamp(620px,82vh,980px)]"
  const showStatus = typeof agentConnected === "boolean" && typeof novaState !== "undefined"
  const statusText = !agentConnected
    ? "Agent offline"
    : novaState === "muted"
    ? "Nova muted"
    : novaState === "listening"
    ? "Nova online"
    : `Nova ${novaState}`
  const statusDotClass = !agentConnected
    ? "bg-red-400"
    : novaState === "muted"
    ? "bg-red-400"
    : novaState === "speaking"
    ? "bg-violet-400"
    : novaState === "thinking"
    ? "bg-amber-400"
    : novaState === "listening"
    ? "bg-emerald-400"
    : "bg-slate-400"

  const refreshClaudeModels = useCallback(async (override?: { apiKey?: string; baseUrl?: string }) => {
    const key = override?.apiKey ?? claudeApiKey
    const base = override?.baseUrl ?? claudeBaseUrl
    if (!claudeApiKeyConfigured && !key.trim()) {
      setClaudeModelOptions(CLAUDE_MODEL_SELECT_FALLBACK)
      return
    }

    try {
      const res = await fetch("/api/integrations/list-claude-models", {
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
        .map((m: { id?: string; label?: string }) => ({ value: String(m.id || ""), label: String(m.label || m.id || "") }))
        .filter((m: FluidSelectOption) => m.value.length > 0)
      const merged = new Map<string, FluidSelectOption>()
      CLAUDE_MODEL_SELECT_FALLBACK.forEach((option) => merged.set(option.value, option))
      dynamicOptions.forEach((option: FluidSelectOption) => merged.set(option.value, option))
      const selected = claudeDefaultModel.trim()
      if (selected && !merged.has(selected)) {
        merged.set(selected, { value: selected, label: selected })
      }
      setClaudeModelOptions(Array.from(merged.values()))
    } catch {
      // Keep fallback options on network/credential failure.
    }
  }, [claudeApiKey, claudeApiKeyConfigured, claudeBaseUrl, claudeDefaultModel])

  useEffect(() => {
    void refreshClaudeModels()
  }, [claudeApiKeyConfigured, refreshClaudeModels])

  const toggleTelegram = useCallback(async () => {
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
      setSaveStatus({
        type: "success",
        message: `Telegram ${next.telegram.connected ? "enabled" : "disabled"}.`,
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
  }, [settings])

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

  const toggleOpenAI = useCallback(async () => {
    const next = {
      ...settings,
      openai: {
        ...settings.openai,
        connected: !settings.openai.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("openai")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai: { connected: next.openai.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update OpenAI status")
      setSaveStatus({
        type: "success",
        message: `OpenAI ${next.openai.connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update OpenAI status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const toggleClaude = useCallback(async () => {
    const next = {
      ...settings,
      claude: {
        ...settings.claude,
        connected: !settings.claude.connected,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("claude")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude: { connected: next.claude.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Claude status")
      setSaveStatus({
        type: "success",
        message: `Claude ${next.claude.connected ? "enabled" : "disabled"}.`,
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Claude status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const saveActiveProvider = useCallback(async (provider: LlmProvider) => {
    if (provider === "openai" && !openaiApiKeyConfigured && !openaiApiKey.trim()) {
      setSaveStatus({ type: "error", message: "Set and save an OpenAI API key before switching to OpenAI." })
      return
    }
    if (provider === "claude" && !claudeApiKeyConfigured && !claudeApiKey.trim()) {
      setSaveStatus({ type: "error", message: "Set and save a Claude API key before switching to Claude." })
      return
    }

    const previous = activeLlmProvider
    setActiveLlmProvider(provider)
    setSettings((prev) => {
      const next = { ...prev, activeLlmProvider: provider }
      saveIntegrationsSettings(next)
      return next
    })
    setSaveStatus(null)
    setIsSavingTarget("provider")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeLlmProvider: provider }),
      })
      if (!res.ok) throw new Error("Failed to switch active LLM provider")
      setSaveStatus({
        type: "success",
        message: `Active model source switched to ${provider === "claude" ? "Claude" : "OpenAI"}.`,
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
  }, [activeLlmProvider, claudeApiKey, claudeApiKeyConfigured, openaiApiKey, openaiApiKeyConfigured])

  const saveTelegramConfig = useCallback(async () => {
    const trimmedBotToken = botToken.trim()
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
          telegram: payloadTelegram,
        }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Telegram configuration")
      const savedData = await saveRes.json().catch(() => ({}))
      const masked = typeof savedData?.config?.telegram?.botTokenMasked === "string" ? savedData.config.telegram.botTokenMasked : ""
      const configured = Boolean(savedData?.config?.telegram?.botTokenConfigured) || trimmedBotToken.length > 0
      setBotToken("")
      setBotTokenMasked(masked)
      setBotTokenConfigured(configured)

      const testRes = await fetch("/api/integrations/test-telegram", {
        method: "POST",
      })
      const testData = await testRes.json().catch(() => ({}))
      if (!testRes.ok || !testData?.ok) {
        const fallbackResultError =
          Array.isArray(testData?.results) && testData.results.length > 0
            ? testData.results.find((r: { ok?: boolean; error?: string }) => !r?.ok)?.error
            : undefined
        throw new Error(testData?.error || fallbackResultError || "Saved, but Telegram verification failed.")
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
  }, [botToken, chatIds, settings])

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

  const saveOpenAIConfig = useCallback(async () => {
    const trimmedApiKey = openaiApiKey.trim()
    const payloadOpenAI: Record<string, string> = {
      baseUrl: openaiBaseUrl.trim() || "https://api.openai.com/v1",
      defaultModel: openaiDefaultModel.trim() || "gpt-4.1",
    }
    if (trimmedApiKey) {
      payloadOpenAI.apiKey = trimmedApiKey
    }
    const next = {
      ...settings,
      openai: {
        ...settings.openai,
        ...payloadOpenAI,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("openai")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openai: payloadOpenAI,
        }),
      })
      if (!saveRes.ok) throw new Error("Failed to save OpenAI configuration")
      const savedData = await saveRes.json().catch(() => ({}))
      const masked = typeof savedData?.config?.openai?.apiKeyMasked === "string" ? savedData.config.openai.apiKeyMasked : ""
      const configured = Boolean(savedData?.config?.openai?.apiKeyConfigured) || trimmedApiKey.length > 0
      setOpenaiApiKey("")
      setOpenaiApiKeyMasked(masked)
      setOpenaiApiKeyConfigured(configured)

      const modelRes = await fetch("/api/integrations/test-openai-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payloadOpenAI.baseUrl,
          model: payloadOpenAI.defaultModel,
        }),
      })
      const modelData = await modelRes.json().catch(() => ({}))
      if (!modelRes.ok || !modelData?.ok) {
        throw new Error(modelData?.error || "Saved, but selected model is unavailable.")
      }

      setSaveStatus({
        type: "success",
        message: `OpenAI saved and verified (${payloadOpenAI.defaultModel}).`,
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save OpenAI configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [openaiApiKey, openaiBaseUrl, openaiDefaultModel, settings])

  const saveClaudeConfig = useCallback(async () => {
    const trimmedApiKey = claudeApiKey.trim()
    const payloadClaude: Record<string, string> = {
      baseUrl: claudeBaseUrl.trim() || "https://api.anthropic.com",
      defaultModel: claudeDefaultModel.trim() || "claude-sonnet-4-20250514",
    }
    if (trimmedApiKey) payloadClaude.apiKey = trimmedApiKey

    const next = {
      ...settings,
      claude: {
        ...settings.claude,
        ...payloadClaude,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("claude")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude: payloadClaude }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Claude configuration")
      const savedData = await saveRes.json().catch(() => ({}))
      const masked = typeof savedData?.config?.claude?.apiKeyMasked === "string" ? savedData.config.claude.apiKeyMasked : ""
      const configured = Boolean(savedData?.config?.claude?.apiKeyConfigured) || trimmedApiKey.length > 0
      setClaudeApiKey("")
      setClaudeApiKeyMasked(masked)
      setClaudeApiKeyConfigured(configured)

      const modelRes = await fetch("/api/integrations/test-claude-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payloadClaude.baseUrl,
          model: payloadClaude.defaultModel,
        }),
      })
      const modelData = await modelRes.json().catch(() => ({}))
      if (!modelRes.ok || !modelData?.ok) {
        throw new Error(modelData?.error || "Saved, but selected Claude model is unavailable.")
      }

      await refreshClaudeModels({
        apiKey: trimmedApiKey || undefined,
        baseUrl: payloadClaude.baseUrl,
      })
      setSaveStatus({
        type: "success",
        message: `Claude saved and verified (${payloadClaude.defaultModel}).`,
      })
    } catch (error) {
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Claude configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [claudeApiKey, claudeBaseUrl, claudeDefaultModel, refreshClaudeModels, settings])

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-[#05070a] text-slate-100")}>
      {background === "floatingLines" && !isLight && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute inset-0 opacity-30">
            <FloatingLines
              linesGradient={floatingLinesGradient}
              enabledWaves={FLOATING_LINES_ENABLED_WAVES}
              lineCount={FLOATING_LINES_LINE_COUNT}
              lineDistance={FLOATING_LINES_LINE_DISTANCE}
              topWavePosition={FLOATING_LINES_TOP_WAVE_POSITION}
              middleWavePosition={FLOATING_LINES_MIDDLE_WAVE_POSITION}
              bottomWavePosition={FLOATING_LINES_BOTTOM_WAVE_POSITION}
              bendRadius={5}
              bendStrength={-0.5}
              interactive={true}
              parallax={true}
            />
          </div>
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 48% 42%, ${hexToRgba(orbPalette.circle1, 0.22)} 0%, ${hexToRgba(orbPalette.circle2, 0.16)} 30%, transparent 60%)`,
            }}
          />
        </div>
      )}
      {background === "customVideo" && !isLight && !!backgroundVideoUrl && (
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            src={backgroundVideoUrl}
          />
          <div className="absolute inset-0 bg-black/45" />
        </div>
      )}

      <div className="relative z-10 flex-1 h-dvh overflow-hidden transition-all duration-200">
      <div className="flex h-full w-full items-start justify-start px-3 py-4 sm:px-4 lg:px-6">
        <div className="w-full">
          {saveStatus && (
            <div className="pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs backdrop-blur-md shadow-lg",
                  saveStatus.type === "success"
                    ? isLight
                      ? "border-emerald-300/40 bg-emerald-500/12 text-emerald-700"
                      : "border-emerald-300/40 bg-emerald-500/15 text-emerald-300"
                    : isLight
                      ? "border-rose-300/40 bg-rose-500/12 text-rose-700"
                      : "border-rose-300/40 bg-rose-500/15 text-rose-300",
                )}
              >
                {saveStatus.message}
              </div>
            </div>
          )}

          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => router.push("/home")}
              onMouseEnter={() => setOrbHovered(true)}
              onMouseLeave={() => setOrbHovered(false)}
              className="group relative h-10 w-10 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105"
              aria-label="Go to home"
            >
              <NovaOrbIndicator
                palette={orbPalette}
                size={26}
                animated={false}
                className="transition-all duration-200"
                style={{ filter: orbHovered ? orbHoverFilter : "none" }}
              />
            </button>
            <div>
              <h1 className={cn("text-2xl font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-[10px] text-accent font-mono">V.0 Beta</p>
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] font-semibold",
                    isLight ? "border border-[#d5dce8] bg-[#f4f7fd] text-s-80" : "border border-white/10 bg-black/25 text-slate-300",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", statusDotClass)} aria-hidden="true" />
                  <span>{showStatus ? statusText : "Status unknown"}</span>
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
              <div className="grid grid-cols-6 gap-1">
                <button
                  onClick={() => setActiveSetup("telegram")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    settings.telegram.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "telegram" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Telegram setup"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveSetup("discord")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    settings.discord.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "discord" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Discord setup"
                >
                  <DiscordIcon className="w-3.5 h-3.5 text-white" />
                </button>
                <button
                  onClick={() => setActiveSetup("openai")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    settings.openai.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "openai" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open OpenAI setup"
                >
                  <OpenAIIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setActiveSetup("claude")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    settings.claude.connected
                      ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
                      : "border-rose-300/50 bg-rose-500/35 text-rose-100",
                    activeSetup === "claude" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Claude setup"
                >
                  <ClaudeIcon className="w-4 h-4" />
                </button>
                {Array.from({ length: 20 }).map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "h-9 rounded-sm border home-spotlight-card home-border-glow",
                      isLight ? "border-[#d5dce8] bg-[#eef3fb]" : "border-white/10 bg-black/20",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className={cn("mt-3 rounded-lg border p-3 home-spotlight-card home-border-glow", isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20")}>
              <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Profile & Settings</p>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden border", isLight ? "border-[#d5dce8] bg-white" : "border-white/15 bg-white/5")}>
                  {profile.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-s-80" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium truncate", isLight ? "text-s-90" : "text-slate-100")}>{profile.name || "User"}</p>
                  <p className="text-[11px] text-accent font-mono truncate">{profile.accessTier || "Core Access"}</p>
                </div>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className={cn(
                    "h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors group/gear home-spotlight-card home-border-glow",
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
                      type={showOpenAIApiKey ? "text" : "password"}
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
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
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

            {activeSetup === "openai" && (
            <section ref={openaiSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    OpenAI Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save your OpenAI credentials and model defaults for Nova API usage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleOpenAI}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.openai.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.openai.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveOpenAIConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "openai" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {openaiApiKeyConfigured && openaiApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{openaiApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type="text"
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      placeholder={
                        openaiApiKeyConfigured
                          ? ""
                          : "sk-fake-dwehdwuieiw123456"
                      }
                      name="openai_token_input"
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
                      onClick={() => setShowOpenAIApiKey((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showOpenAIApiKey ? "Hide API key" : "Show API key"}
                      title={showOpenAIApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showOpenAIApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Base URL</p>
                  <input
                    value={openaiBaseUrl}
                    onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
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
                    Keep <span className="font-mono">https://api.openai.com/v1</span> unless you are using a compatible proxy endpoint.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Default Model</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 items-stretch">
                    <FluidSelect
                      value={openaiDefaultModel}
                      onChange={setOpenaiDefaultModel}
                      options={OPENAI_MODEL_SELECT_OPTIONS}
                      isLight={isLight}
                    />
                    <div
                      className={cn(
                        "h-9 rounded-md border px-2.5 flex items-center justify-end text-xs tabular-nums",
                        isLight ? "border-[#d5dce8] bg-[#eef3fb] text-s-70" : "border-white/10 bg-black/20 text-slate-300",
                      )}
                      title="Estimated daily cost for 20k-40k total tokens/day (50/50 input/output)."
                    >
                      {estimateDailyCostRange(openaiDefaultModel)}
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    {
                      OPENAI_MODEL_OPTIONS.find((option) => option.value === openaiDefaultModel)?.priceHint ??
                      "Model pricing and output quality vary by selection."
                    }
                  </p>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Est. uses 20k-40k total tokens/day at a 50/50 input-output split.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <ol className={cn("space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. Create an API key from your OpenAI dashboard.</li>
                    <li>2. Paste your key into API Key, then save to verify.</li>
                    <li>3. Choose a model from the dropdown; model choice affects quality and token cost.</li>
                  </ol>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "claude" && (
            <section ref={claudeSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Claude Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save your Anthropic credentials and model defaults for Nova API usage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleClaude}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.claude.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.claude.connected ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={saveClaudeConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "claude" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {claudeApiKeyConfigured && claudeApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{claudeApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showClaudeApiKey ? "text" : "password"}
                      value={claudeApiKey}
                      onChange={(e) => setClaudeApiKey(e.target.value)}
                      placeholder={claudeApiKeyConfigured ? "Paste new Claude API key to replace current key" : "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx"}
                      name="claude_token_input"
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
                      onClick={() => setShowClaudeApiKey((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showClaudeApiKey ? "Hide API key" : "Show API key"}
                      title={showClaudeApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showClaudeApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Base URL</p>
                  <input
                    value={claudeBaseUrl}
                    onChange={(e) => setClaudeBaseUrl(e.target.value)}
                    placeholder="https://api.anthropic.com"
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
                    Keep <span className="font-mono">https://api.anthropic.com</span> unless you are using a compatible proxy endpoint.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Default Model</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 items-stretch">
                    <FluidSelect
                      value={claudeDefaultModel}
                      onChange={setClaudeDefaultModel}
                      options={claudeModelOptions}
                      isLight={isLight}
                    />
                    <div
                      className={cn(
                        "h-9 rounded-md border px-2.5 flex items-center justify-end text-xs tabular-nums",
                        isLight ? "border-[#d5dce8] bg-[#eef3fb] text-s-70" : "border-white/10 bg-black/20 text-slate-300",
                      )}
                      title="Estimated daily cost for 20k-40k total tokens/day (50/50 input/output)."
                    >
                      {estimateDailyCostRange(claudeDefaultModel)}
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    {getClaudePriceHint(claudeDefaultModel)}
                  </p>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Est. uses 20k-40k total tokens/day at a 50/50 input-output split.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <ol className={cn("space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. Create an API key from your Anthropic dashboard.</li>
                    <li>2. Paste your key and save to verify access.</li>
                    <li>3. Pick an available Claude model from the dropdown and save.</li>
                  </ol>
                </div>
              </div>
            </section>
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
                      item.active ? "bg-emerald-400" : "bg-rose-400",
                    )}
                    aria-hidden="true"
                  />
                  <span className={cn(item.active ? "text-emerald-400" : "text-rose-400")}>
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



