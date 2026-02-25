// User Settings - Persisted across sessions
import { getActiveUserId } from "@/lib/auth/active-user"

export type AccessTier = string

export type AccentColor = "violet" | "blue" | "cyan" | "emerald" | "amber" | "orange" | "rose" | "pastelPink" | "white"
export type OrbColor = "violet" | "blue" | "cyan" | "emerald" | "amber" | "orange" | "rose" | "pastelPink" | "white"
export type SpotlightColor = OrbColor
export type BackgroundType = "default" | "none" // legacy
export type DarkBackgroundType = "floatingLines" | "space" | "none" | "customVideo"
export type LightBackgroundType = "none"
export type ThemeBackgroundType = DarkBackgroundType | LightBackgroundType

export interface UserProfile {
  name: string
  avatar: string | null // URL or null for default
  accessTier: AccessTier
}

export type PersonalityProactivity = "reactive" | "balanced" | "proactive"
export type PersonalityHumorLevel = "none" | "subtle" | "playful"
export type PersonalityRiskTolerance = "conservative" | "balanced" | "bold"
export type PersonalityStructure = "freeform" | "mixed" | "structured"
export type PersonalityChallengeLevel = "supportive" | "neutral" | "challenger"

export interface Personalization {
  assistantName: string // What the user wants to call the assistant
  nickname: string // What Nova should call the user
  occupation: string
  interests: string[] // List of interests
  communicationStyle: "formal" | "casual" | "friendly" | "professional"
  tone: ResponseTone
  customInstructions: string // Freeform instructions for Nova
  characteristics: string // User personality traits to remember
  preferredLanguage: string
  // Behavior dimensions — seeded into personality engine via settings_sync
  proactivity: PersonalityProactivity
  humor_level: PersonalityHumorLevel
  risk_tolerance: PersonalityRiskTolerance
  structure_preference: PersonalityStructure
  challenge_level: PersonalityChallengeLevel
}

export type ResponseTone = "neutral" | "enthusiastic" | "calm" | "direct" | "relaxed"

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  telegramAlerts: boolean
  systemUpdates: boolean
  nlpEditHintsEnabled: boolean
}

export interface AppSettings {
  theme: "dark" | "light" | "system"
  accentColor: AccentColor
  orbColor: OrbColor
  spotlightColor: SpotlightColor
  background: BackgroundType // legacy fallback for older installs
  darkModeBackground: DarkBackgroundType
  lightModeBackground: LightBackgroundType
  spotlightEnabled: boolean
  soundEnabled: boolean
  voiceEnabled: boolean
  ttsVoice: string // Voice ID for TTS
  bootAnimationEnabled: boolean
  bootMusicEnabled: boolean
  extendedBootMusicEnabled: boolean
  bootMusicDataUrl: string | null
  bootMusicFileName: string | null
  bootMusicAssetId: string | null
  customBackgroundVideoDataUrl: string | null
  customBackgroundVideoFileName: string | null
  customBackgroundVideoMimeType: string | null
  customBackgroundVideoAssetId: string | null
  compactMode: boolean
  fontSize: "small" | "medium" | "large"
}

export interface UserSettings {
  profile: UserProfile
  app: AppSettings
  notifications: NotificationSettings
  personalization: Personalization
  updatedAt: string
}

const STORAGE_KEY_PREFIX = "nova_user_settings"
export const USER_SETTINGS_UPDATED_EVENT = "nova:user-settings-updated"
export const MAX_ASSISTANT_NAME_LENGTH = 8
const BLOCKED_ASSISTANT_NAME_PATTERNS: RegExp[] = [
  /^fuck(?:er|ing|ed|s)?$/i,
  /^shit(?:ty|s)?$/i,
  /^bitch(?:es|y)?$/i,
  /^asshole$/i,
  /^bastard(?:s)?$/i,
  /^dick(?:head|s)?$/i,
  /^cunt(?:s)?$/i,
  /^fag(?:got|gots)?$/i,
  /^slut(?:s)?$/i,
  /^whore(?:s)?$/i,
  /^n[i1]gg(?:a|er|az?|ers?|as?)$/i,
]

const DEFAULT_SETTINGS: UserSettings = {
  profile: {
    name: "User",
    avatar: null,
    accessTier: "Model Unset",
  },
  app: {
    theme: "dark",
    accentColor: "violet",
    orbColor: "violet",
    spotlightColor: "violet",
    background: "default",
    darkModeBackground: "floatingLines",
    lightModeBackground: "none",
    spotlightEnabled: true,
    soundEnabled: true,
    voiceEnabled: true,
    ttsVoice: "default",
    bootAnimationEnabled: true,
    bootMusicEnabled: true,
    extendedBootMusicEnabled: false,
    bootMusicDataUrl: null,
    bootMusicFileName: null,
    bootMusicAssetId: null,
    customBackgroundVideoDataUrl: null,
    customBackgroundVideoFileName: null,
    customBackgroundVideoMimeType: null,
    customBackgroundVideoAssetId: null,
    compactMode: false,
    fontSize: "medium",
  },
  notifications: {
    enabled: true,
    sound: true,
    telegramAlerts: true,
    systemUpdates: true,
    nlpEditHintsEnabled: true,
  },
  personalization: {
    assistantName: "Nova",
    nickname: "",
    occupation: "",
    interests: [],
    communicationStyle: "friendly",
    tone: "neutral",
    customInstructions: "",
    characteristics: "",
    preferredLanguage: "English",
    proactivity: "balanced",
    humor_level: "subtle",
    risk_tolerance: "balanced",
    structure_preference: "mixed",
    challenge_level: "neutral",
  },
  updatedAt: new Date().toISOString(),
}

export function normalizeResponseTone(value: unknown): ResponseTone {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "enthusiastic") return "enthusiastic"
  if (normalized === "calm") return "calm"
  if (normalized === "direct") return "direct"
  if (normalized === "relaxed") return "relaxed"
  return "neutral"
}

function getStorageKey(): string {
  const userId = getActiveUserId()
  if (!userId) return ""
  return `${STORAGE_KEY_PREFIX}:${userId}`
}

export function loadUserSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS

  try {
    const key = getStorageKey()
    if (!key) return DEFAULT_SETTINGS
    const stored = localStorage.getItem(key)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<UserSettings>
    // Merge with defaults to handle new fields
    const merged = {
      profile: { ...DEFAULT_SETTINGS.profile, ...parsed.profile },
      app: { ...DEFAULT_SETTINGS.app, ...parsed.app },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
      personalization: { ...DEFAULT_SETTINGS.personalization, ...parsed.personalization },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }
    return {
      ...merged,
      personalization: {
        ...merged.personalization,
        assistantName: clampAssistantName(merged.personalization.assistantName),
        tone: normalizeResponseTone(merged.personalization.tone),
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveUserSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return
  const key = getStorageKey()
  if (!key) return

  const updated = {
    ...settings,
    personalization: {
      ...settings.personalization,
      assistantName: clampAssistantName(settings.personalization.assistantName),
    },
    updatedAt: new Date().toISOString(),
  }

  localStorage.setItem(key, JSON.stringify(updated))
  window.dispatchEvent(
    new CustomEvent(USER_SETTINGS_UPDATED_EVENT, {
      detail: updated,
    }),
  )
}

export function updateProfile(profile: Partial<UserProfile>): UserSettings {
  const current = loadUserSettings()
  const updated = {
    ...current,
    profile: { ...current.profile, ...profile },
  }
  saveUserSettings(updated)
  return updated
}

export function updateAppSettings(app: Partial<AppSettings>): UserSettings {
  const current = loadUserSettings()
  const updated = {
    ...current,
    app: { ...current.app, ...app },
  }
  saveUserSettings(updated)
  return updated
}

export function updateNotifications(notifications: Partial<NotificationSettings>): UserSettings {
  const current = loadUserSettings()
  const updated = {
    ...current,
    notifications: { ...current.notifications, ...notifications },
  }
  saveUserSettings(updated)
  return updated
}

export function updatePersonalization(personalization: Partial<Personalization>): UserSettings {
  const current = loadUserSettings()
  const nextPersonalization = { ...personalization }
  if (typeof nextPersonalization.assistantName === "string") {
    nextPersonalization.assistantName = clampAssistantName(nextPersonalization.assistantName)
  }
  const updated = {
    ...current,
    personalization: { ...current.personalization, ...nextPersonalization },
  }
  saveUserSettings(updated)
  return updated
}

function clampAssistantName(value: unknown): string {
  const trimmed = String(value || "").trim().slice(0, MAX_ASSISTANT_NAME_LENGTH)
  if (isBlockedAssistantName(trimmed)) return "Nova"
  return trimmed
}

export function isBlockedAssistantName(value: unknown): boolean {
  const trimmed = String(value || "").trim()
  if (!trimmed) return false
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (!normalized) return false
  const tokens = normalized.split(/\s+/g).filter(Boolean)
  for (const token of tokens) {
    if (BLOCKED_ASSISTANT_NAME_PATTERNS.some((pattern) => pattern.test(token))) {
      return true
    }
  }
  const condensed = normalized.replace(/\s+/g, "")
  return BLOCKED_ASSISTANT_NAME_PATTERNS.some((pattern) => pattern.test(condensed))
}

export function resetSettings(): UserSettings {
  saveUserSettings(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

// Accent color CSS variables
export const ACCENT_COLORS: Record<AccentColor, { primary: string; secondary: string; name: string }> = {
  violet: { primary: "#8b5cf6", secondary: "#a78bfa", name: "Violet" },
  blue: { primary: "#3b82f6", secondary: "#60a5fa", name: "Blue" },
  cyan: { primary: "#06b6d4", secondary: "#22d3ee", name: "Cyan" },
  emerald: { primary: "#10b981", secondary: "#34d399", name: "Emerald" },
  amber: { primary: "#f59e0b", secondary: "#fbbf24", name: "Amber" },
  orange: { primary: "#f97316", secondary: "#fb923c", name: "Orange" },
  rose: { primary: "#f43f5e", secondary: "#fb7185", name: "Rose" },
  pastelPink: { primary: "#f9a8d4", secondary: "#fbcfe8", name: "Pastel Pink" },
  white: { primary: "#cbd5e1", secondary: "#f8fafc", name: "White" },
}

export const ORB_COLORS: Record<
  OrbColor,
  { name: string; bg: string; circle1: string; circle2: string; circle3: string; circle4: string; circle5: string }
> = {
  violet: {
    name: "Violet",
    bg: "#1a1a2e",
    circle1: "#9e9fef",
    circle2: "#c471ec",
    circle3: "#818cf8",
    circle4: "#a78bfa",
    circle5: "#f472b6",
  },
  blue: {
    name: "Blue",
    bg: "#0b1426",
    circle1: "#3b82f6",
    circle2: "#60a5fa",
    circle3: "#2563eb",
    circle4: "#38bdf8",
    circle5: "#93c5fd",
  },
  cyan: {
    name: "Cyan",
    bg: "#071a1f",
    circle1: "#06b6d4",
    circle2: "#22d3ee",
    circle3: "#0891b2",
    circle4: "#67e8f9",
    circle5: "#0ea5e9",
  },
  emerald: {
    name: "Emerald",
    bg: "#071a14",
    circle1: "#10b981",
    circle2: "#34d399",
    circle3: "#059669",
    circle4: "#6ee7b7",
    circle5: "#2dd4bf",
  },
  amber: {
    name: "Amber",
    bg: "#1f1607",
    circle1: "#f59e0b",
    circle2: "#fbbf24",
    circle3: "#d97706",
    circle4: "#fde68a",
    circle5: "#fb923c",
  },
  orange: {
    name: "Orange",
    bg: "#1f1208",
    circle1: "#f97316",
    circle2: "#fb923c",
    circle3: "#ea580c",
    circle4: "#fdba74",
    circle5: "#fb7185",
  },
  rose: {
    name: "Rose",
    bg: "#210b14",
    circle1: "#f43f5e",
    circle2: "#fb7185",
    circle3: "#e11d48",
    circle4: "#fda4af",
    circle5: "#ec4899",
  },
  pastelPink: {
    name: "Pastel Pink",
    bg: "#1f0f18",
    circle1: "#f9a8d4",
    circle2: "#fbcfe8",
    circle3: "#f472b6",
    circle4: "#fce7f3",
    circle5: "#fda4af",
  },
  white: {
    name: "White",
    bg: "#111827",
    circle1: "#ffffff",
    circle2: "#f8fafc",
    circle3: "#e2e8f0",
    circle4: "#cbd5e1",
    circle5: "#94a3b8",
  },
}

// Available TTS voices
export const TTS_VOICES = [
  { id: "default", name: "Default Voice", description: "Nova's standard voice" },
  { id: "peter", name: "Peter", description: "Alternative male voice" },
  { id: "mord", name: "Mord", description: "Deep authoritative voice" },
  { id: "ultron", name: "Ultron", description: "Dark tone" },
]

// Available backgrounds
export const BACKGROUNDS: Record<BackgroundType, { name: string; description: string }> = {
  default: { name: "Floating Lines", description: "Interactive wave lines" },
  none: { name: "None", description: "No background animation" },
}

export const DARK_BACKGROUNDS: Record<DarkBackgroundType, { name: string; description: string }> = {
  floatingLines: { name: "Floating Lines", description: "Interactive wave lines" },
  space: { name: "Space", description: "Futuristic starfield with planets and Nova orbit rings" },
  customVideo: { name: "Custom Media", description: "Use an uploaded MP4 or image as the background" },
  none: { name: "None", description: "No background animation" },
}

export const LIGHT_BACKGROUNDS: Record<LightBackgroundType, { name: string; description: string }> = {
  none: { name: "None", description: "No background animation" },
}
