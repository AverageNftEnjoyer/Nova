// User Settings - Persisted across sessions
// Access tiers: "Core Access" | "Developer" | "Admin" | "Operator"

export type AccessTier = "Core Access" | "Developer" | "Admin" | "Operator"

export type AccentColor = "violet" | "blue" | "cyan" | "emerald" | "amber" | "rose" | "orange"

export interface UserProfile {
  name: string
  avatar: string | null // URL or null for default
  accessTier: AccessTier
}

export interface Personalization {
  nickname: string // What Nova should call the user
  occupation: string
  interests: string[] // List of interests
  communicationStyle: "formal" | "casual" | "friendly" | "professional"
  tone: "neutral" | "enthusiastic" | "calm" | "direct"
  customInstructions: string // Freeform instructions for Nova
  characteristics: string // User personality traits to remember
  preferredLanguage: string
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  telegramAlerts: boolean
  systemUpdates: boolean
}

export interface AppSettings {
  theme: "dark" | "light" | "system"
  accentColor: AccentColor
  soundEnabled: boolean
  voiceEnabled: boolean
  ttsVoice: string // Voice ID for TTS
  bootAnimationEnabled: boolean
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

const STORAGE_KEY = "nova_user_settings"

const DEFAULT_SETTINGS: UserSettings = {
  profile: {
    name: "User",
    avatar: null,
    accessTier: "Core Access",
  },
  app: {
    theme: "dark",
    accentColor: "violet",
    soundEnabled: true,
    voiceEnabled: true,
    ttsVoice: "default",
    bootAnimationEnabled: true,
    compactMode: false,
    fontSize: "medium",
  },
  notifications: {
    enabled: true,
    sound: true,
    telegramAlerts: true,
    systemUpdates: true,
  },
  personalization: {
    nickname: "",
    occupation: "",
    interests: [],
    communicationStyle: "friendly",
    tone: "neutral",
    customInstructions: "",
    characteristics: "",
    preferredLanguage: "English",
  },
  updatedAt: new Date().toISOString(),
}

export function loadUserSettings(): UserSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<UserSettings>
    // Merge with defaults to handle new fields
    return {
      profile: { ...DEFAULT_SETTINGS.profile, ...parsed.profile },
      app: { ...DEFAULT_SETTINGS.app, ...parsed.app },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
      personalization: { ...DEFAULT_SETTINGS.personalization, ...parsed.personalization },
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveUserSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return

  const updated = {
    ...settings,
    updatedAt: new Date().toISOString(),
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
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
  const updated = {
    ...current,
    personalization: { ...current.personalization, ...personalization },
  }
  saveUserSettings(updated)
  return updated
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
  rose: { primary: "#f43f5e", secondary: "#fb7185", name: "Rose" },
  orange: { primary: "#f97316", secondary: "#fb923c", name: "Orange" },
}

// Available TTS voices (placeholder - will be populated with actual voices)
export const TTS_VOICES = [
  { id: "default", name: "Default Voice", description: "Nova's standard voice" },
  { id: "voice_1", name: "Voice 1", description: "Coming soon..." },
  { id: "voice_2", name: "Voice 2", description: "Coming soon..." },
]
