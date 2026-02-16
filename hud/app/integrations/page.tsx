"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Blocks, Save, Eye, EyeOff, Settings, User } from "lucide-react"

import { useTheme } from "@/lib/theme-context"
import { cn } from "@/lib/utils"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor, type ThemeBackgroundType, type UserProfile } from "@/lib/userSettings"
import { loadIntegrationsSettings, saveIntegrationsSettings, type IntegrationsSettings, type LlmProvider } from "@/lib/integrations"
import { FluidSelect, type FluidSelectOption } from "@/components/ui/fluid-select"
import { SettingsModal } from "@/components/settings-modal"
import { useNovaState } from "@/lib/useNovaState"
import FloatingLines from "@/components/FloatingLines"
import { TelegramIcon } from "@/components/telegram-icon"
import { DiscordIcon } from "@/components/discord-icon"
import { OpenAIIcon } from "@/components/openai-icon"
import { ClaudeIcon } from "@/components/claude-icon"
import { XAIIcon } from "@/components/xai-icon"
import { GeminiIcon } from "@/components/gemini-icon"
import { GmailIcon } from "@/components/gmail-icon"
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
type ModelPricing = { input: number; output: number; cachedInput?: number }

const OPENAI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
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

function extractHighestVersion(text: string): { major: number; minor: number } {
  const normalized = text.toLowerCase()
  const scopedMatches = [
    ...normalized.matchAll(/(?:opus|sonnet|haiku)\s*(\d+)(?:[.\-_](\d+))?/g),
    ...normalized.matchAll(/claude\s*(\d+)(?:[.\-_](\d+))?/g),
  ]
  if (scopedMatches.length === 0) return { major: 0, minor: 0 }

  let bestMajor = 0
  let bestMinor = 0
  for (const m of scopedMatches) {
    const major = Number(m[1] || 0)
    const minor = Number(m[2] || 0)
    // Ignore date-like or malformed high numbers; Claude major versions are small integers.
    if (major > 20) continue
    if (major > bestMajor || (major === bestMajor && minor > bestMinor)) {
      bestMajor = major
      bestMinor = minor
    }
  }
  return { major: bestMajor, minor: bestMinor }
}

function extractClaudeDate(model: string): number {
  const match = model.match(/(20\d{6})/)
  return Number(match?.[1] || 0)
}

function claudeFamilyWeight(model: string): number {
  const normalized = model.toLowerCase()
  if (normalized.includes("opus")) return 3
  if (normalized.includes("sonnet")) return 2
  if (normalized.includes("haiku")) return 1
  return 0
}

function sortClaudeOptions(options: FluidSelectOption[]): FluidSelectOption[] {
  return [...options].sort((a, b) => {
    const aText = `${a.label} ${a.value}`
    const bText = `${b.label} ${b.value}`
    const av = extractHighestVersion(aText)
    const bv = extractHighestVersion(bText)
    if (av.major !== bv.major) return bv.major - av.major
    if (av.minor !== bv.minor) return bv.minor - av.minor

    const af = claudeFamilyWeight(aText)
    const bf = claudeFamilyWeight(bText)
    if (af !== bf) return bf - af

    const ad = extractClaudeDate(aText)
    const bd = extractClaudeDate(bText)
    if (ad !== bd) return bd - ad

    return a.label.localeCompare(b.label)
  })
}

const CLAUDE_MODEL_SELECT_FALLBACK: FluidSelectOption[] = sortClaudeOptions(
  CLAUDE_MODEL_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  })),
)
const CLAUDE_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4.0 },
}
const GROK_MODEL_OPTIONS: Array<{ value: string; label: string; priceHint: string }> = [
  { value: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning", priceHint: "Fastest 4.1 reasoning profile, very low token cost" },
  { value: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-Reasoning", priceHint: "Fast 4.1 non-reasoning profile, very low token cost" },
  { value: "grok-code-fast-1", label: "Grok Code Fast 1", priceHint: "Code-optimized fast model with higher output cost" },
  { value: "grok-4-fast-reasoning", label: "Grok 4 Fast Reasoning", priceHint: "Fast Grok 4 reasoning profile, low token cost" },
  { value: "grok-4-fast-non-reasoning", label: "Grok 4 Fast Non-Reasoning", priceHint: "Fast Grok 4 non-reasoning profile, low token cost" },
  { value: "grok-4-0709", label: "Grok 4 (0709)", priceHint: "Highest quality Grok 4 generation profile" },
  { value: "grok-3", label: "Grok 3", priceHint: "Strong general model at premium output pricing" },
  { value: "grok-3-mini", label: "Grok 3 Mini", priceHint: "Most cost-efficient Grok option" },
]
const GROK_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GROK_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
const GROK_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "grok-4-1-fast-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-1-fast-non-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-code-fast-1": { input: 0.2, cachedInput: 0.05, output: 1.5 },
  "grok-4-fast-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-fast-non-reasoning": { input: 0.2, cachedInput: 0.05, output: 0.5 },
  "grok-4-0709": { input: 3.0, output: 15.0 },
  "grok-3": { input: 3.0, output: 15.0 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
  "grok-3-latest": { input: 3.0, output: 15.0 },
}
const GEMINI_MODEL_OPTIONS: Array<{ value: string; label: string; priceHint: string }> = [
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", priceHint: "Highest quality Gemini reasoning profile." },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", priceHint: "Fast/efficient Gemini profile for frequent runs." },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", priceHint: "Lowest-cost Gemini 2.5 option for lightweight automations." },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", priceHint: "Low-latency, cost-efficient Gemini option." },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", priceHint: "Most efficient legacy Gemini 2.0 profile." },
]
const GEMINI_MODEL_SELECT_OPTIONS: FluidSelectOption[] = GEMINI_MODEL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
const GEMINI_MODEL_PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.2, output: 1.6 },
  "gemini-2.0-flash": { input: 0.15, output: 1.2 },
  "gemini-2.0-flash-lite": { input: 0.1, output: 0.9 },
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

function resolveModelPricing(model: string): ModelPricing | null {
  if (!model) return null
  if (OPENAI_MODEL_PRICING_USD_PER_1M[model]) return OPENAI_MODEL_PRICING_USD_PER_1M[model]
  if (CLAUDE_MODEL_PRICING_USD_PER_1M[model]) return CLAUDE_MODEL_PRICING_USD_PER_1M[model]
  if (GROK_MODEL_PRICING_USD_PER_1M[model]) return GROK_MODEL_PRICING_USD_PER_1M[model]
  if (GEMINI_MODEL_PRICING_USD_PER_1M[model]) return GEMINI_MODEL_PRICING_USD_PER_1M[model]
  const normalized = model.trim().toLowerCase()
  if (normalized.includes("claude-opus-4-6") || normalized.includes("claude-opus-4.6")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-opus-4")) return { input: 15.0, output: 75.0 }
  if (normalized.includes("claude-sonnet-4")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-7-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-sonnet")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("claude-3-5-haiku")) return { input: 0.8, output: 4.0 }
  if (normalized.includes("grok-4-1-fast-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-1-fast-non-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-code-fast-1")) return { input: 0.2, output: 1.5 }
  if (normalized.includes("grok-4-fast-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-fast-non-reasoning")) return { input: 0.2, output: 0.5 }
  if (normalized.includes("grok-4-0709")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("grok-3-mini")) return { input: 0.3, output: 0.5 }
  if (normalized.includes("grok-3")) return { input: 3.0, output: 15.0 }
  if (normalized.includes("gemini-2.5-pro")) return { input: 1.25, output: 10.0 }
  if (normalized.includes("gemini-2.5-flash")) return { input: 0.3, output: 2.5 }
  if (normalized.includes("gemini-2.5-flash-lite")) return { input: 0.2, output: 1.6 }
  if (normalized.includes("gemini-2.0-flash")) return { input: 0.15, output: 1.2 }
  if (normalized.includes("gemini-2.0-flash-lite")) return { input: 0.1, output: 0.9 }
  return null
}

function estimateDailyCostRange(model: string): string {
  const pricing = resolveModelPricing(model)
  if (!pricing) return "N/A"
  const cacheHitRate = pricing.cachedInput ? 0.5 : 0
  const estimate = (totalTokens: number) => {
    const inputTokens = totalTokens / 2
    const outputTokens = totalTokens / 2
    const cachedInputTokens = inputTokens * cacheHitRate
    const uncachedInputTokens = inputTokens - cachedInputTokens
    const inputCost = (uncachedInputTokens / 1_000_000) * pricing.input
    const cachedInputCost = pricing.cachedInput ? (cachedInputTokens / 1_000_000) * pricing.cachedInput : 0
    const outputCost = (outputTokens / 1_000_000) * pricing.output
    return inputCost + cachedInputCost + outputCost
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

function normalizeGmailAccountsForUi(raw: unknown, activeAccountId: string) {
  const active = String(activeAccountId || "").trim().toLowerCase()
  if (!Array.isArray(raw)) return []
  return raw
    .map((account) => {
      const id = String((account as { id?: string })?.id || "").trim().toLowerCase()
      const email = String((account as { email?: string })?.email || "").trim()
      if (!id || !email) return null
      const scopes = Array.isArray((account as { scopes?: string[] })?.scopes)
        ? (account as { scopes: string[] }).scopes.map((scope) => String(scope).trim()).filter(Boolean)
        : []
      return {
        id,
        email,
        scopes,
        connectedAt: typeof (account as { connectedAt?: string })?.connectedAt === "string" ? String((account as { connectedAt?: string }).connectedAt) : "",
        active: id === active,
        enabled: typeof (account as { enabled?: boolean })?.enabled === "boolean" ? Boolean((account as { enabled?: boolean }).enabled) : true,
      }
    })
    .filter((account): account is NonNullable<typeof account> => Boolean(account))
}

export default function IntegrationsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isLight = theme === "light"
  const { state: novaState, connected: agentConnected } = useNovaState()

  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [integrationsHydrated, setIntegrationsHydrated] = useState(false)
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
  const [grokApiKey, setGrokApiKey] = useState("")
  const [grokBaseUrl, setGrokBaseUrl] = useState("https://api.x.ai/v1")
  const [grokDefaultModel, setGrokDefaultModel] = useState("grok-4-0709")
  const [grokApiKeyConfigured, setGrokApiKeyConfigured] = useState(false)
  const [grokApiKeyMasked, setGrokApiKeyMasked] = useState("")
  const [showGrokApiKey, setShowGrokApiKey] = useState(false)
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
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [geminiBaseUrl, setGeminiBaseUrl] = useState("https://generativelanguage.googleapis.com/v1beta/openai")
  const [geminiDefaultModel, setGeminiDefaultModel] = useState("gemini-2.5-pro")
  const [geminiApiKeyConfigured, setGeminiApiKeyConfigured] = useState(false)
  const [geminiApiKeyMasked, setGeminiApiKeyMasked] = useState("")
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false)
  const [geminiModelOptions, setGeminiModelOptions] = useState<FluidSelectOption[]>(GEMINI_MODEL_SELECT_OPTIONS)
  const [gmailClientId, setGmailClientId] = useState("")
  const [gmailClientSecret, setGmailClientSecret] = useState("")
  const [gmailClientSecretConfigured, setGmailClientSecretConfigured] = useState(false)
  const [gmailClientSecretMasked, setGmailClientSecretMasked] = useState("")
  const [showGmailClientSecret, setShowGmailClientSecret] = useState(false)
  const [gmailRedirectUri, setGmailRedirectUri] = useState("http://localhost:3000/api/integrations/gmail/callback")
  const [selectedGmailAccountId, setSelectedGmailAccountId] = useState("")
  const [activeSetup, setActiveSetup] = useState<"telegram" | "discord" | "openai" | "claude" | "grok" | "gemini" | "gmail">("telegram")
  const [isSavingTarget, setIsSavingTarget] = useState<null | "telegram" | "discord" | "openai" | "claude" | "grok" | "gemini" | "gmail-oauth" | "gmail-disconnect" | "gmail-primary" | "gmail-account" | "provider">(null)
  const [saveStatus, setSaveStatus] = useState<null | { type: "success" | "error"; message: string }>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const connectivitySectionRef = useRef<HTMLElement | null>(null)
  const telegramSetupSectionRef = useRef<HTMLElement | null>(null)
  const discordSetupSectionRef = useRef<HTMLElement | null>(null)
  const openaiSetupSectionRef = useRef<HTMLElement | null>(null)
  const claudeSetupSectionRef = useRef<HTMLElement | null>(null)
  const grokSetupSectionRef = useRef<HTMLElement | null>(null)
  const geminiSetupSectionRef = useRef<HTMLElement | null>(null)
  const gmailSetupSectionRef = useRef<HTMLElement | null>(null)
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
    setGrokApiKey(local.grok.apiKey)
    setGrokBaseUrl(local.grok.baseUrl)
    setGrokDefaultModel(local.grok.defaultModel)
    setGrokApiKeyConfigured(Boolean(local.grok.apiKeyConfigured))
    setGrokApiKeyMasked(local.grok.apiKeyMasked || "")
    setGeminiApiKey(local.gemini.apiKey)
    setGeminiBaseUrl(local.gemini.baseUrl)
    setGeminiDefaultModel(local.gemini.defaultModel)
    setGeminiApiKeyConfigured(Boolean(local.gemini.apiKeyConfigured))
    setGeminiApiKeyMasked(local.gemini.apiKeyMasked || "")
    setGmailClientId(local.gmail.oauthClientId || "")
    setGmailClientSecret(local.gmail.oauthClientSecret || "")
    setGmailClientSecretConfigured(Boolean(local.gmail.oauthClientSecretConfigured))
    setGmailClientSecretMasked(local.gmail.oauthClientSecretMasked || "")
    setGmailRedirectUri(local.gmail.redirectUri || "http://localhost:3000/api/integrations/gmail/callback")
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
    setIntegrationsHydrated(true)
  }, [isLight])

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
          setGrokApiKey(fallback.grok.apiKey)
          setGrokBaseUrl(fallback.grok.baseUrl)
          setGrokDefaultModel(fallback.grok.defaultModel)
          setGrokApiKeyConfigured(Boolean(fallback.grok.apiKeyConfigured))
          setGrokApiKeyMasked(fallback.grok.apiKeyMasked || "")
          setGeminiApiKey(fallback.gemini.apiKey)
          setGeminiBaseUrl(fallback.gemini.baseUrl)
          setGeminiDefaultModel(fallback.gemini.defaultModel)
          setGeminiApiKeyConfigured(Boolean(fallback.gemini.apiKeyConfigured))
          setGeminiApiKeyMasked(fallback.gemini.apiKeyMasked || "")
          setGmailClientId(fallback.gmail.oauthClientId || "")
          setGmailClientSecret(fallback.gmail.oauthClientSecret || "")
          setGmailClientSecretConfigured(Boolean(fallback.gmail.oauthClientSecretConfigured))
          setGmailClientSecretMasked(fallback.gmail.oauthClientSecretMasked || "")
          setGmailRedirectUri(fallback.gmail.redirectUri || "http://localhost:3000/api/integrations/gmail/callback")
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
          grok: {
            connected: Boolean(config.grok?.connected),
            apiKey: config.grok?.apiKey || "",
            baseUrl: config.grok?.baseUrl || "https://api.x.ai/v1",
            defaultModel: config.grok?.defaultModel || "grok-4-0709",
            apiKeyConfigured: Boolean(config.grok?.apiKeyConfigured),
            apiKeyMasked: typeof config.grok?.apiKeyMasked === "string" ? config.grok.apiKeyMasked : "",
          },
          gemini: {
            connected: Boolean(config.gemini?.connected),
            apiKey: config.gemini?.apiKey || "",
            baseUrl: config.gemini?.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
            defaultModel: config.gemini?.defaultModel || "gemini-2.5-pro",
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
            redirectUri: typeof config.gmail?.redirectUri === "string" ? config.gmail.redirectUri : "http://localhost:3000/api/integrations/gmail/callback",
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
        setGrokApiKey(normalized.grok.apiKey)
        setGrokBaseUrl(normalized.grok.baseUrl)
        setGrokDefaultModel(normalized.grok.defaultModel)
        setGrokApiKeyConfigured(Boolean(normalized.grok.apiKeyConfigured))
        setGrokApiKeyMasked(normalized.grok.apiKeyMasked || "")
        setGeminiApiKey(normalized.gemini.apiKey)
        setGeminiBaseUrl(normalized.gemini.baseUrl)
        setGeminiDefaultModel(normalized.gemini.defaultModel)
        setGeminiApiKeyConfigured(Boolean(normalized.gemini.apiKeyConfigured))
        setGeminiApiKeyMasked(normalized.gemini.apiKeyMasked || "")
        setGmailClientId(normalized.gmail.oauthClientId || "")
        setGmailClientSecret(normalized.gmail.oauthClientSecret || "")
        setGmailClientSecretConfigured(Boolean(normalized.gmail.oauthClientSecretConfigured))
        setGmailClientSecretMasked(normalized.gmail.oauthClientSecretMasked || "")
        setGmailRedirectUri(normalized.gmail.redirectUri || "http://localhost:3000/api/integrations/gmail/callback")
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
        setGrokApiKey(fallback.grok.apiKey)
        setGrokBaseUrl(fallback.grok.baseUrl)
        setGrokDefaultModel(fallback.grok.defaultModel)
        setGrokApiKeyConfigured(Boolean(fallback.grok.apiKeyConfigured))
        setGrokApiKeyMasked(fallback.grok.apiKeyMasked || "")
        setGeminiApiKey(fallback.gemini.apiKey)
        setGeminiBaseUrl(fallback.gemini.baseUrl)
        setGeminiDefaultModel(fallback.gemini.defaultModel)
        setGeminiApiKeyConfigured(Boolean(fallback.gemini.apiKeyConfigured))
        setGeminiApiKeyMasked(fallback.gemini.apiKeyMasked || "")
        setGmailClientId(fallback.gmail.oauthClientId || "")
        setGmailClientSecret(fallback.gmail.oauthClientSecret || "")
        setGmailClientSecretConfigured(Boolean(fallback.gmail.oauthClientSecretConfigured))
        setGmailClientSecretMasked(fallback.gmail.oauthClientSecretMasked || "")
        setGmailRedirectUri(fallback.gmail.redirectUri || "http://localhost:3000/api/integrations/gmail/callback")
        setActiveLlmProvider(fallback.activeLlmProvider || "openai")
      })

    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    const accounts = settings.gmail.accounts || []
    if (accounts.length === 0) {
      if (selectedGmailAccountId) setSelectedGmailAccountId("")
      return
    }
    const hasSelected = accounts.some((account) => account.id === selectedGmailAccountId)
    if (hasSelected) return
    const preferred = accounts.find((account) => account.active) || accounts[0]
    if (preferred) setSelectedGmailAccountId(preferred.id)
  }, [settings.gmail.accounts, selectedGmailAccountId])

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
    if (grokSetupSectionRef.current) cleanups.push(setupSectionSpotlight(grokSetupSectionRef.current))
    if (geminiSetupSectionRef.current) cleanups.push(setupSectionSpotlight(geminiSetupSectionRef.current))
    if (gmailSetupSectionRef.current) cleanups.push(setupSectionSpotlight(gmailSetupSectionRef.current))
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
  const moduleHeightClass = "h-[clamp(620px,88vh,1240px)]"
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
  const integrationBadgeClass = (connected: boolean) =>
    !integrationsHydrated
      ? "border-white/15 bg-white/10 text-slate-200"
      : connected
        ? "border-emerald-300/50 bg-emerald-500/35 text-emerald-100"
        : "border-rose-300/50 bg-rose-500/35 text-rose-100"
  const integrationDotClass = (connected: boolean) =>
    !integrationsHydrated ? "bg-slate-400" : connected ? "bg-emerald-400" : "bg-rose-400"
  const integrationTextClass = (connected: boolean) =>
    !integrationsHydrated ? "text-slate-400" : connected ? "text-emerald-400" : "text-rose-400"

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
      setClaudeModelOptions(sortClaudeOptions(Array.from(merged.values())))
    } catch {
      // Keep fallback options on network/credential failure.
    }
  }, [claudeApiKey, claudeApiKeyConfigured, claudeBaseUrl, claudeDefaultModel])

  useEffect(() => {
    void refreshClaudeModels()
  }, [claudeApiKeyConfigured, refreshClaudeModels])

  const refreshGeminiModels = useCallback(async (override?: { apiKey?: string; baseUrl?: string }) => {
    const key = override?.apiKey ?? geminiApiKey
    const base = override?.baseUrl ?? geminiBaseUrl
    if (!geminiApiKeyConfigured && !key.trim()) {
      setGeminiModelOptions(GEMINI_MODEL_SELECT_OPTIONS)
      return
    }

    try {
      const res = await fetch("/api/integrations/list-gemini-models", {
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
      GEMINI_MODEL_SELECT_OPTIONS.forEach((option) => merged.set(option.value, option))
      dynamicOptions.forEach((option: FluidSelectOption) => merged.set(option.value, option))
      const selected = geminiDefaultModel.trim()
      if (selected && !merged.has(selected)) {
        merged.set(selected, { value: selected, label: selected })
      }

      const nextOptions = Array.from(merged.values()).sort((a, b) => {
        const aValue = a.value.toLowerCase()
        const bValue = b.value.toLowerCase()
        const aPro = aValue.includes("pro") ? 1 : 0
        const bPro = bValue.includes("pro") ? 1 : 0
        if (aPro !== bPro) return bPro - aPro
        return a.label.localeCompare(b.label)
      })
      setGeminiModelOptions(nextOptions)
    } catch {
      // Keep fallback options on network/credential failure.
    }
  }, [geminiApiKey, geminiApiKeyConfigured, geminiBaseUrl, geminiDefaultModel])

  useEffect(() => {
    void refreshGeminiModels()
  }, [geminiApiKeyConfigured, refreshGeminiModels])

  const refreshGmailFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const data = await res.json().catch(() => ({}))
      const config = data?.config as IntegrationsSettings | undefined
      if (!config) return
      setSettings((prev) => {
        const next = {
          ...prev,
          gmail: {
            ...prev.gmail,
            connected: Boolean(config.gmail?.connected),
            email: String(config.gmail?.email || ""),
            scopes: Array.isArray(config.gmail?.scopes)
              ? config.gmail.scopes.join(" ")
              : typeof config.gmail?.scopes === "string"
                ? config.gmail.scopes
                : "",
            accounts: normalizeGmailAccountsForUi(config.gmail?.accounts, String(config.gmail?.activeAccountId || "")),
            activeAccountId: String(config.gmail?.activeAccountId || ""),
            tokenConfigured: Boolean(config.gmail?.tokenConfigured),
          },
        }
        saveIntegrationsSettings(next)
        return next
      })
    } catch {
      // no-op
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const gmailStatus = params.get("gmail")
    const message = params.get("message")
    const gmailPopup = params.get("gmailPopup") === "1"
    if (!gmailStatus) return

    if (gmailPopup && window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "nova:gmail-oauth", status: gmailStatus, message: message || "" },
        window.location.origin,
      )
      window.close()
      return
    }

    if (gmailStatus === "success") {
      setSaveStatus({ type: "success", message: message || "Gmail connected." })
      void refreshGmailFromServer()
    } else {
      setSaveStatus({ type: "error", message: message || "Gmail connection failed." })
    }

    params.delete("gmail")
    params.delete("message")
    const next = params.toString()
    const newUrl = `${window.location.pathname}${next ? `?${next}` : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [refreshGmailFromServer, router])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as { type?: string; status?: string; message?: string } | null
      if (!payload || payload.type !== "nova:gmail-oauth") return
      if (payload.status === "success") {
        setSaveStatus({ type: "success", message: payload.message || "Gmail connected." })
        void refreshGmailFromServer()
      } else {
        setSaveStatus({ type: "error", message: payload.message || "Gmail connection failed." })
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [refreshGmailFromServer, router])

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

  const toggleOpenAI = useCallback(async () => {
    if (!settings.openai.connected) {
      setSaveStatus({
        type: "error",
        message: "OpenAI stays inactive until a valid API key + model is saved.",
      })
      return
    }
    const next = {
      ...settings,
      openai: {
        ...settings.openai,
        connected: false,
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
        message: "OpenAI disabled.",
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
    if (!settings.claude.connected) {
      setSaveStatus({
        type: "error",
        message: "Claude stays inactive until a valid API key + model is saved.",
      })
      return
    }
    const next = {
      ...settings,
      claude: {
        ...settings.claude,
        connected: false,
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
        message: "Claude disabled.",
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

  const toggleGrok = useCallback(async () => {
    if (!settings.grok.connected) {
      setSaveStatus({
        type: "error",
        message: "Grok stays inactive until a valid API key + model is saved.",
      })
      return
    }
    const next = {
      ...settings,
      grok: {
        ...settings.grok,
        connected: false,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("grok")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grok: { connected: next.grok.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Grok status")
      setSaveStatus({
        type: "success",
        message: "Grok disabled.",
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Grok status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const toggleGemini = useCallback(async () => {
    if (!settings.gemini.connected) {
      setSaveStatus({
        type: "error",
        message: "Gemini stays inactive until a valid API key + model is saved.",
      })
      return
    }
    const next = {
      ...settings,
      gemini: {
        ...settings.gemini,
        connected: false,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("gemini")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini: { connected: next.gemini.connected } }),
      })
      if (!res.ok) throw new Error("Failed to update Gemini status")
      setSaveStatus({
        type: "success",
        message: "Gemini disabled.",
      })
    } catch {
      setSettings(settings)
      saveIntegrationsSettings(settings)
      setSaveStatus({
        type: "error",
        message: "Failed to update Gemini status. Try again.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [settings])

  const connectGmail = useCallback(() => {
    if (!gmailClientId.trim() || (!gmailClientSecretConfigured && !gmailClientSecret.trim())) {
      setSaveStatus({ type: "error", message: "Save Gmail OAuth Client ID and Client Secret first." })
      return
    }
    setSaveStatus(null)
    const returnTo = "/integrations?gmailPopup=1"
    const fetchUrl = `/api/integrations/gmail/connect?mode=json&returnTo=${encodeURIComponent(returnTo)}`
    void fetch(fetchUrl, { cache: "no-store", credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.authUrl) {
          if (res.status === 401) {
            router.push(`/login?next=${encodeURIComponent("/integrations")}`)
            throw new Error("Session expired. Please sign in again.")
          }
          throw new Error(data?.error || "Failed to start Gmail OAuth.")
        }
        return String(data.authUrl)
      })
      .then((target) => {
        const width = 620
        const height = 760
        const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
        const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
        const popup = window.open(
          target,
          "nova-gmail-oauth",
          `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
        )
        if (!popup) {
          const tab = window.open(target, "_blank")
          if (!tab) {
            setSaveStatus({
              type: "error",
              message: "Popup was blocked. Allow popups for Nova to connect Gmail without leaving this screen.",
            })
          } else {
            setSaveStatus({
              type: "success",
              message: "Opened Gmail auth in a new tab/window. Nova will stay open here.",
            })
          }
        }
      })
      .catch((error) => {
        setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to start Gmail OAuth." })
      })
  }, [gmailClientId, gmailClientSecret, gmailClientSecretConfigured, router])

  const saveGmailConfig = useCallback(async () => {
    const payload: Record<string, unknown> = {
      oauthClientId: gmailClientId.trim(),
      redirectUri: gmailRedirectUri.trim() || "http://localhost:3000/api/integrations/gmail/callback",
    }
    const trimmedSecret = gmailClientSecret.trim()
    if (trimmedSecret) payload.oauthClientSecret = trimmedSecret

    if (!payload.oauthClientId || (!gmailClientSecretConfigured && !trimmedSecret)) {
      setSaveStatus({ type: "error", message: "Gmail Client ID and Client Secret are required." })
      return
    }

    setSaveStatus(null)
    setIsSavingTarget("gmail-oauth")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmail: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to save Gmail OAuth config.")

      const masked = typeof data?.config?.gmail?.oauthClientSecretMasked === "string" ? data.config.gmail.oauthClientSecretMasked : ""
      const configured = Boolean(data?.config?.gmail?.oauthClientSecretConfigured) || trimmedSecret.length > 0
      setGmailClientSecret("")
      setGmailClientSecretMasked(masked)
      setGmailClientSecretConfigured(configured)
      setSettings((prev) => {
        const next = {
          ...prev,
          gmail: {
            ...prev.gmail,
            oauthClientId: String(payload.oauthClientId || ""),
            redirectUri: String(payload.redirectUri || ""),
            oauthClientSecret: "",
            oauthClientSecretConfigured: configured,
            oauthClientSecretMasked: masked,
          },
        }
        saveIntegrationsSettings(next)
        return next
      })

      setSaveStatus({ type: "success", message: "Gmail OAuth configuration saved." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to save Gmail OAuth config." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [gmailClientId, gmailClientSecret, gmailClientSecretConfigured, gmailRedirectUri])

  const disconnectGmail = useCallback(async (accountId?: string) => {
    setSaveStatus(null)
    setIsSavingTarget("gmail-disconnect")
    try {
      const res = await fetch("/api/integrations/gmail/disconnect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId || "" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          router.push(`/login?next=${encodeURIComponent("/integrations")}`)
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to disconnect Gmail.")
      }
      const refreshed = await fetch("/api/integrations/config", { cache: "no-store", credentials: "include" })
      const payload = await refreshed.json().catch(() => ({}))
      const config = payload?.config as IntegrationsSettings | undefined
      if (config) {
        setSettings((prev) => {
          const next = {
            ...prev,
            gmail: {
              ...prev.gmail,
              connected: Boolean(config.gmail?.connected),
              email: String(config.gmail?.email || ""),
              scopes: Array.isArray(config.gmail?.scopes)
                ? config.gmail.scopes.join(" ")
                : typeof config.gmail?.scopes === "string"
                  ? config.gmail.scopes
                  : "",
              accounts: normalizeGmailAccountsForUi(config.gmail?.accounts, String(config.gmail?.activeAccountId || "")),
              activeAccountId: String(config.gmail?.activeAccountId || ""),
              tokenConfigured: Boolean(config.gmail?.tokenConfigured),
            },
          }
          saveIntegrationsSettings(next)
          return next
        })
      }
      setSaveStatus({ type: "success", message: accountId ? "Gmail account disconnected." : "All Gmail accounts disconnected." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to disconnect Gmail." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [router])

  const setPrimaryGmailAccount = useCallback(async (accountId: string) => {
    const nextId = String(accountId || "").trim().toLowerCase()
    if (!nextId) return
    setSaveStatus(null)
    setIsSavingTarget("gmail-primary")
    try {
      const res = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmail: { activeAccountId: nextId } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Failed to set primary Gmail account.")
      const config = data?.config as IntegrationsSettings | undefined
      if (config) {
        setSettings((prev) => {
          const next = {
            ...prev,
            gmail: {
              ...prev.gmail,
              connected: Boolean(config.gmail?.connected),
              email: String(config.gmail?.email || ""),
              scopes: Array.isArray(config.gmail?.scopes)
                ? config.gmail.scopes.join(" ")
                : typeof config.gmail?.scopes === "string"
                  ? config.gmail.scopes
                  : "",
              accounts: normalizeGmailAccountsForUi(config.gmail?.accounts, String(config.gmail?.activeAccountId || "")),
              activeAccountId: String(config.gmail?.activeAccountId || ""),
              tokenConfigured: Boolean(config.gmail?.tokenConfigured),
            },
          }
          saveIntegrationsSettings(next)
          return next
        })
      }
      setSaveStatus({ type: "success", message: "Primary Gmail account updated." })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to set primary Gmail account." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [])

  const updateGmailAccountState = useCallback(async (action: "set_enabled" | "delete", accountId: string, enabled?: boolean) => {
    const targetId = String(accountId || "").trim().toLowerCase()
    if (!targetId) return
    setSaveStatus(null)
    setIsSavingTarget("gmail-account")
    try {
      const res = await fetch("/api/integrations/gmail/accounts", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "set_enabled"
            ? { action, accountId: targetId, enabled: Boolean(enabled) }
            : { action, accountId: targetId },
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          router.push(`/login?next=${encodeURIComponent("/integrations")}`)
          throw new Error("Session expired. Please sign in again.")
        }
        throw new Error(data?.error || "Failed to update Gmail account.")
      }
      await refreshGmailFromServer()
      setSaveStatus({
        type: "success",
        message:
          action === "delete"
            ? "Gmail account removed."
            : (enabled ? "Gmail account enabled." : "Gmail account disabled."),
      })
    } catch (error) {
      setSaveStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to update Gmail account." })
    } finally {
      setIsSavingTarget(null)
    }
  }, [refreshGmailFromServer, router])

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
    const persistedOpenAIModel = openaiDefaultModel.trim() || "gpt-4.1"
    const persistedClaudeModel = claudeDefaultModel.trim() || "claude-sonnet-4-20250514"
    const persistedGrokModel = grokDefaultModel.trim() || "grok-4-0709"
    const persistedGeminiModel = geminiDefaultModel.trim() || "gemini-2.5-pro"
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
  }, [activeLlmProvider, claudeDefaultModel, geminiDefaultModel, grokDefaultModel, openaiDefaultModel, settings.claude.connected, settings.gemini.connected, settings.grok.connected, settings.openai.connected])

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

      const enableRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai: { connected: true } }),
      })
      if (!enableRes.ok) throw new Error("Model validated, but failed to activate OpenAI.")
      setSettings((prev) => {
        const updated = {
          ...prev,
          openai: {
            ...prev.openai,
            connected: true,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })

      setSaveStatus({
        type: "success",
        message: `OpenAI saved and verified (${payloadOpenAI.defaultModel}).`,
      })
    } catch (error) {
      void fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai: { connected: false } }),
      }).catch(() => {})
      setSettings((prev) => {
        const updated = {
          ...prev,
          openai: {
            ...prev.openai,
            connected: false,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
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
      const enableRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude: { connected: true } }),
      })
      if (!enableRes.ok) throw new Error("Model validated, but failed to activate Claude.")
      setSettings((prev) => {
        const updated = {
          ...prev,
          claude: {
            ...prev.claude,
            connected: true,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "success",
        message: `Claude saved and verified (${payloadClaude.defaultModel}).`,
      })
    } catch (error) {
      void fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claude: { connected: false } }),
      }).catch(() => {})
      setSettings((prev) => {
        const updated = {
          ...prev,
          claude: {
            ...prev.claude,
            connected: false,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Claude configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [claudeApiKey, claudeBaseUrl, claudeDefaultModel, refreshClaudeModels, settings])

  const saveGrokConfig = useCallback(async () => {
    const trimmedApiKey = grokApiKey.trim()
    const payloadGrok: Record<string, string> = {
      baseUrl: grokBaseUrl.trim() || "https://api.x.ai/v1",
      defaultModel: grokDefaultModel.trim() || "grok-4-0709",
    }
    if (trimmedApiKey) payloadGrok.apiKey = trimmedApiKey

    const next = {
      ...settings,
      grok: {
        ...settings.grok,
        ...payloadGrok,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("grok")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grok: payloadGrok }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Grok configuration")
      const savedData = await saveRes.json().catch(() => ({}))
      const masked = typeof savedData?.config?.grok?.apiKeyMasked === "string" ? savedData.config.grok.apiKeyMasked : ""
      const configured = Boolean(savedData?.config?.grok?.apiKeyConfigured) || trimmedApiKey.length > 0
      setGrokApiKey("")
      setGrokApiKeyMasked(masked)
      setGrokApiKeyConfigured(configured)

      const modelRes = await fetch("/api/integrations/test-grok-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payloadGrok.baseUrl,
          model: payloadGrok.defaultModel,
        }),
      })
      const modelData = await modelRes.json().catch(() => ({}))
      if (!modelRes.ok || !modelData?.ok) {
        throw new Error(modelData?.error || "Saved, but selected Grok model is unavailable.")
      }

      const enableRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grok: { connected: true } }),
      })
      if (!enableRes.ok) throw new Error("Model validated, but failed to activate Grok.")
      setSettings((prev) => {
        const updated = {
          ...prev,
          grok: {
            ...prev.grok,
            connected: true,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })

      setSaveStatus({
        type: "success",
        message: `Grok saved and verified (${payloadGrok.defaultModel}).`,
      })
    } catch (error) {
      void fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grok: { connected: false } }),
      }).catch(() => {})
      setSettings((prev) => {
        const updated = {
          ...prev,
          grok: {
            ...prev.grok,
            connected: false,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Grok configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [grokApiKey, grokBaseUrl, grokDefaultModel, settings])

  const saveGeminiConfig = useCallback(async () => {
    const trimmedApiKey = geminiApiKey.trim()
    const payloadGemini: Record<string, string> = {
      baseUrl: geminiBaseUrl.trim() || "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: geminiDefaultModel.trim() || "gemini-2.5-pro",
    }
    if (trimmedApiKey) payloadGemini.apiKey = trimmedApiKey

    const next = {
      ...settings,
      gemini: {
        ...settings.gemini,
        ...payloadGemini,
      },
    }
    setSettings(next)
    saveIntegrationsSettings(next)
    setSaveStatus(null)
    setIsSavingTarget("gemini")
    try {
      const saveRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini: payloadGemini }),
      })
      if (!saveRes.ok) throw new Error("Failed to save Gemini configuration")
      const savedData = await saveRes.json().catch(() => ({}))
      const masked = typeof savedData?.config?.gemini?.apiKeyMasked === "string" ? savedData.config.gemini.apiKeyMasked : ""
      const configured = Boolean(savedData?.config?.gemini?.apiKeyConfigured) || trimmedApiKey.length > 0
      setGeminiApiKey("")
      setGeminiApiKeyMasked(masked)
      setGeminiApiKeyConfigured(configured)
      await refreshGeminiModels({
        apiKey: trimmedApiKey || undefined,
        baseUrl: payloadGemini.baseUrl,
      })

      const modelRes = await fetch("/api/integrations/test-gemini-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmedApiKey || undefined,
          baseUrl: payloadGemini.baseUrl,
          model: payloadGemini.defaultModel,
        }),
      })
      const modelData = await modelRes.json().catch(() => ({}))
      if (!modelRes.ok || !modelData?.ok) {
        throw new Error(modelData?.error || "Saved, but selected Gemini model is unavailable.")
      }

      const enableRes = await fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini: { connected: true } }),
      })
      if (!enableRes.ok) throw new Error("Model validated, but failed to activate Gemini.")
      setSettings((prev) => {
        const updated = {
          ...prev,
          gemini: {
            ...prev.gemini,
            connected: true,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })

      setSaveStatus({
        type: "success",
        message: `Gemini saved and verified (${payloadGemini.defaultModel}).`,
      })
    } catch (error) {
      void fetch("/api/integrations/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini: { connected: false } }),
      }).catch(() => {})
      setSettings((prev) => {
        const updated = {
          ...prev,
          gemini: {
            ...prev.gemini,
            connected: false,
          },
        }
        saveIntegrationsSettings(updated)
        return updated
      })
      setSaveStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save Gemini configuration.",
      })
    } finally {
      setIsSavingTarget(null)
    }
  }, [geminiApiKey, geminiBaseUrl, geminiDefaultModel, refreshGeminiModels, settings])

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
                    integrationBadgeClass(settings.telegram.connected),
                    activeSetup === "telegram" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Telegram setup"
                >
                  <TelegramIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveSetup("discord")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.discord.connected),
                    activeSetup === "discord" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Discord setup"
                >
                  <DiscordIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveSetup("openai")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.openai.connected),
                    activeSetup === "openai" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open OpenAI setup"
                >
                  <OpenAIIcon className="w-4.5[18px]" />
                </button>
                <button
                  onClick={() => setActiveSetup("claude")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.claude.connected),
                    activeSetup === "claude" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Claude setup"
                >
                  <ClaudeIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setActiveSetup("grok")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.grok.connected),
                    activeSetup === "grok" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Grok setup"
                >
                  <XAIIcon size={16} />
                </button>
                <button
                  onClick={() => setActiveSetup("gemini")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.gemini.connected),
                    activeSetup === "gemini" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Gemini setup"
                >
                  <GeminiIcon size={16} />
                </button>
                <button
                  onClick={() => setActiveSetup("gmail")}
                  className={cn(
                    "h-9 rounded-sm border transition-colors flex items-center justify-center home-spotlight-card home-border-glow",
                    integrationBadgeClass(settings.gmail.connected),
                    activeSetup === "gmail" && "ring-1 ring-white/55",
                  )}
                  aria-label="Open Gmail setup"
                >
                  <GmailIcon className="w-3.5 h-3.5" />
                </button>
                {Array.from({ length: 17 }).map((_, index) => (
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
                    <Image src={profile.avatar} alt="Profile" width={40} height={40} className="w-full h-full object-cover" />
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
                    {settings.openai.connected ? "Disable" : "Save to Activate"}
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
                      type={showOpenAIApiKey ? "text" : "password"}
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      placeholder={
                        openaiApiKeyConfigured
                          ? "Paste new OpenAI API key to replace current key"
                          : "Paste your OpenAI API key here"
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
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 home-spotlight-card home-border-glow home-spotlight-card--hover",
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
                    {settings.claude.connected ? "Disable" : "Save to Activate"}
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
                      placeholder={claudeApiKeyConfigured ? "Paste new Claude API key to replace current key" : "anthropic-api-key-placeholder"}
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
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 home-spotlight-card home-border-glow home-spotlight-card--hover",
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

            {activeSetup === "grok" && (
            <section ref={grokSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Grok Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save your xAI credentials and model defaults for Nova API usage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleGrok}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.grok.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.grok.connected ? "Disable" : "Save to Activate"}
                  </button>
                  <button
                    onClick={saveGrokConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "grok" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {grokApiKeyConfigured && grokApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{grokApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showGrokApiKey ? "text" : "password"}
                      value={grokApiKey}
                      onChange={(e) => setGrokApiKey(e.target.value)}
                      placeholder={grokApiKeyConfigured ? "Paste new Grok API key to replace current key" : "xai-xxxxxxxxxxxxxxxxxxxxxxxx"}
                      name="grok_token_input"
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
                      onClick={() => setShowGrokApiKey((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showGrokApiKey ? "Hide API key" : "Show API key"}
                      title={showGrokApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showGrokApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Base URL</p>
                  <input
                    value={grokBaseUrl}
                    onChange={(e) => setGrokBaseUrl(e.target.value)}
                    placeholder="https://api.x.ai/v1"
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
                    Keep <span className="font-mono">https://api.x.ai/v1</span> unless you are using a compatible proxy endpoint.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Default Model</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 items-stretch">
                    <FluidSelect
                      value={grokDefaultModel}
                      onChange={setGrokDefaultModel}
                      options={GROK_MODEL_SELECT_OPTIONS}
                      isLight={isLight}
                    />
                    <div
                      className={cn(
                        "h-9 rounded-md border px-2.5 flex items-center justify-end text-xs tabular-nums",
                        isLight ? "border-[#d5dce8] bg-[#eef3fb] text-s-70" : "border-white/10 bg-black/20 text-slate-300",
                      )}
                      title="Estimated daily cost for 20k-40k total tokens/day (50/50 input/output)."
                    >
                      {estimateDailyCostRange(grokDefaultModel)}
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    {GROK_MODEL_OPTIONS.find((option) => option.value === grokDefaultModel)?.priceHint ?? "Model pricing and output quality vary by selection."}
                  </p>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Est. uses 20k-40k total tokens/day at a 50/50 input-output split.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <ol className={cn("space-y-1 text-[11px] leading-4", isLight ? "text-s-60" : "text-slate-400")}>
                    <li>1. Create an API key from your xAI dashboard.</li>
                    <li>2. Paste your key and save to verify access.</li>
                    <li>3. Pick a Grok model from the dropdown and save.</li>
                  </ol>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "gemini" && (
            <section ref={geminiSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Gemini Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Save your Gemini credentials and model defaults for Nova API usage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleGemini}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                      settings.gemini.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.gemini.connected ? "Disable" : "Save to Activate"}
                  </button>
                  <button
                    onClick={saveGeminiConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center gap-1.5 disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "gemini" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Key</p>
                  {geminiApiKeyConfigured && geminiApiKeyMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Key on server: <span className="font-mono">{geminiApiKeyMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showGeminiApiKey ? "text" : "password"}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder={
                        geminiApiKeyConfigured
                          ? "Paste new Gemini API key to replace current key"
                          : "Paste Gemini API key"
                      }
                      name="gemini_token_input"
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
                      onClick={() => setShowGeminiApiKey((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showGeminiApiKey ? "Hide API key" : "Show API key"}
                      title={showGeminiApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showGeminiApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>API Base URL</p>
                  <input
                    value={geminiBaseUrl}
                    onChange={(e) => setGeminiBaseUrl(e.target.value)}
                    placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
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
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Keep <span className="font-mono">https://generativelanguage.googleapis.com/v1beta/openai</span> unless you are using a compatible proxy endpoint.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Default Model</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-2 items-stretch">
                    <FluidSelect
                      value={geminiDefaultModel}
                      onChange={setGeminiDefaultModel}
                      options={geminiModelOptions}
                      isLight={isLight}
                    />
                    <div
                      className={cn(
                        "h-9 rounded-md border px-2.5 flex items-center justify-end text-xs tabular-nums",
                        isLight ? "border-[#d5dce8] bg-[#eef3fb] text-s-70" : "border-white/10 bg-black/20 text-slate-300",
                      )}
                      title="Estimated daily cost for 20k-40k total tokens/day (50/50 input/output)."
                    >
                      {estimateDailyCostRange(geminiDefaultModel)}
                    </div>
                  </div>
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    {GEMINI_MODEL_OPTIONS.find((option) => option.value === geminiDefaultModel)?.priceHint ?? "Model pricing and output quality vary by selection."}
                  </p>
                </div>
              </div>
            </section>
            )}

            {activeSetup === "gmail" && (
            <section ref={gmailSetupSectionRef} style={panelStyle} className={`${panelClass} home-spotlight-shell p-4 ${moduleHeightClass} flex flex-col`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className={cn("text-sm uppercase tracking-[0.22em] font-semibold", isLight ? "text-s-90" : "text-slate-200")}>
                    Gmail Setup
                  </h2>
                  <p className={cn("text-xs mt-1", isLight ? "text-s-50" : "text-slate-400")}>
                    Connect one or more Gmail accounts for Nova workflows and chat-triggered inbox automations.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full lg:w-auto">
                  <button
                    onClick={saveGmailConfig}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border border-accent-30 bg-accent-10 text-accent transition-colors hover:bg-accent-20 home-spotlight-card home-border-glow inline-flex items-center justify-center gap-1.5 text-xs font-medium whitespace-nowrap disabled:opacity-60",
                    )}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isSavingTarget === "gmail-oauth" ? "Saving..." : "Save OAuth"}
                  </button>
                  <button
                    onClick={settings.gmail.connected ? () => disconnectGmail() : connectGmail}
                    disabled={isSavingTarget !== null}
                    className={cn(
                      "h-8 px-3 rounded-lg border transition-colors home-spotlight-card home-border-glow inline-flex items-center justify-center gap-1.5 text-xs font-medium whitespace-nowrap disabled:opacity-60",
                      settings.gmail.connected
                        ? "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20"
                        : "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                    )}
                  >
                    {settings.gmail.connected ? "Disconnect All" : "Connect"}
                  </button>
                </div>
              </div>

              <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto no-scrollbar pr-1">
                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>OAuth Client ID</p>
                  <input
                    value={gmailClientId}
                    onChange={(e) => setGmailClientId(e.target.value)}
                    placeholder="123456789012-abc123def456.apps.googleusercontent.com"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>OAuth Client Secret</p>
                  {gmailClientSecretConfigured && gmailClientSecretMasked && (
                    <p className={cn("mb-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                      Secret on server: <span className="font-mono">{gmailClientSecretMasked}</span>
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type={showGmailClientSecret ? "text" : "password"}
                      value={gmailClientSecret}
                      onChange={(e) => setGmailClientSecret(e.target.value)}
                      placeholder={gmailClientSecretConfigured ? "Paste new secret to replace current secret" : "Paste Gmail OAuth client secret"}
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="none"
                      className={cn(
                        "w-full h-9 pr-10 pl-3 rounded-md border bg-transparent text-sm outline-none",
                        isLight
                          ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                          : "border-white/10 text-slate-100 placeholder:text-slate-500",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGmailClientSecret((v) => !v)}
                      className={cn(
                        "absolute right-1 top-1 h-7 w-7 rounded-md flex items-center justify-center transition-all duration-150 home-spotlight-card home-border-glow home-spotlight-card--hover",
                        isLight ? "text-s-50 hover:bg-black/5" : "text-slate-400 hover:bg-white/10",
                      )}
                      aria-label={showGmailClientSecret ? "Hide client secret" : "Show client secret"}
                      title={showGmailClientSecret ? "Hide client secret" : "Show client secret"}
                    >
                      {showGmailClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Redirect URI</p>
                  <input
                    value={gmailRedirectUri}
                    onChange={(e) => setGmailRedirectUri(e.target.value)}
                    placeholder="http://localhost:3000/api/integrations/gmail/callback"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="none"
                    className={cn(
                      "w-full h-9 px-3 rounded-md border bg-transparent text-sm outline-none",
                      isLight
                        ? "border-[#d5dce8] text-s-90 placeholder:text-s-30"
                        : "border-white/10 text-slate-100 placeholder:text-slate-500",
                    )}
                  />
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Must exactly match the authorized redirect URI in your Google Cloud OAuth client.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Connection Status</p>
                  <p className={cn("text-sm", isLight ? "text-s-90" : "text-slate-200")}>
                    {settings.gmail.connected ? "Connected" : "Disconnected"} - {settings.gmail.accounts.length} linked
                  </p>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Primary: {settings.gmail.email || "Not linked yet"}
                  </p>
                  <p className={cn("mt-1 text-[11px]", isLight ? "text-s-40" : "text-slate-500")}>
                    Enabled accounts: {settings.gmail.accounts.filter((account) => account.enabled !== false).length}
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Linked Accounts</p>
                  <div className="space-y-2">
                    {settings.gmail.accounts.length === 0 && (
                      <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                        No Gmail accounts linked yet.
                      </p>
                    )}
                    {settings.gmail.accounts.map((account) => (
                      <div
                        key={account.id}
                        onClick={() => setSelectedGmailAccountId(account.id)}
                        className={cn(
                          "rounded-md border px-2.5 py-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 cursor-pointer",
                          selectedGmailAccountId === account.id
                            ? (isLight ? "border-[#9fb3d8] bg-[#eaf1fc]" : "border-white/30 bg-white/10")
                            : (isLight ? "border-[#d5dce8] bg-[#f4f7fd]" : "border-white/10 bg-black/20"),
                        )}
                      >
                        <div className="min-w-0">
                          <p className={cn("text-[12px] truncate", isLight ? "text-s-90" : "text-slate-100")}>{account.email}</p>
                          <p className={cn("text-[10px] truncate", isLight ? "text-s-50" : "text-slate-500")}>
                            {account.active ? "Primary" : "Linked"} • {account.enabled === false ? "Disabled" : "Enabled"}
                          </p>
                        </div>
                        <span className={cn("text-[10px]", isLight ? "text-s-50" : "text-slate-400")}>
                          {selectedGmailAccountId === account.id ? "Selected" : "Select"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => connectGmail()}
                      disabled={isSavingTarget !== null}
                      className={cn(
                        "h-7 px-2 rounded-md border text-[10px] transition-colors disabled:opacity-50",
                        "border-emerald-300/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20",
                      )}
                    >
                      Link Another
                    </button>
                    <button
                      onClick={() => selectedGmailAccountId && setPrimaryGmailAccount(selectedGmailAccountId)}
                      disabled={isSavingTarget !== null || !selectedGmailAccountId}
                      className={cn(
                        "h-7 px-2 rounded-md border text-[10px] transition-colors disabled:opacity-50",
                        isLight ? "border-[#cad5e6] text-s-70 hover:bg-[#e8eef9]" : "border-white/15 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      Set Primary
                    </button>
                    <button
                      onClick={() => {
                        const account = settings.gmail.accounts.find((item) => item.id === selectedGmailAccountId)
                        if (!account) return
                        void updateGmailAccountState("set_enabled", account.id, account.enabled === false)
                      }}
                      disabled={isSavingTarget !== null || !selectedGmailAccountId}
                      className={cn(
                        "h-7 px-2 rounded-md border text-[10px] transition-colors disabled:opacity-50",
                        isLight ? "border-[#cad5e6] text-s-70 hover:bg-[#e8eef9]" : "border-white/15 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      {settings.gmail.accounts.find((item) => item.id === selectedGmailAccountId)?.enabled === false ? "Enable" : "Disable"}
                    </button>
                    <button
                      onClick={() => selectedGmailAccountId && updateGmailAccountState("delete", selectedGmailAccountId)}
                      disabled={isSavingTarget !== null || !selectedGmailAccountId}
                      className={cn(
                        "h-7 px-2 rounded-md border text-[10px] transition-colors disabled:opacity-50",
                        "border-rose-300/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/20",
                      )}
                    >
                      Delete
                    </button>
                  </div>
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                    Inbox summaries and email actions run via Nova chat prompts or mission workflow steps, not from this setup panel.
                  </p>
                </div>

                <div className={cn("p-3", subPanelClass, "home-spotlight-card home-border-glow")}>
                  <p className={cn("text-xs mb-2 uppercase tracking-[0.14em]", isLight ? "text-s-60" : "text-slate-400")}>Setup Instructions</p>
                  <ol className={cn("text-[11px] leading-5 list-decimal pl-4 space-y-1", isLight ? "text-s-60" : "text-slate-300")}>
                    <li>In Google Cloud, create/select your project and enable Gmail API.</li>
                    <li>Open OAuth consent screen, choose External, and when asked choose <span className="font-semibold">User Data</span>.</li>
                    <li>Fill app info, then add Gmail scopes (start with gmail.readonly).</li>
                    <li>If app is in Testing mode, add your Gmail addresses as Test users.</li>
                    <li>Create OAuth Client ID (Web application) and paste the Client ID + Client Secret here.</li>
                    <li>Add the exact Redirect URI shown above, click Save OAuth, then click Connect.</li>
                    <li>Repeat Connect to add multiple Gmail accounts, then use Set Primary.</li>
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
