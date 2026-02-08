"use client"

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react"
import {
  X,
  User,
  Palette,
  Volume2,
  Bell,
  Sparkles,
  Shield,
  RotateCcw,
  Camera,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme-context"
import { useAccent } from "@/lib/accent-context"
import {
  loadUserSettings,
  saveUserSettings,
  resetSettings,
  type UserSettings,
  type AccessTier,
  type AccentColor,
  type OrbColor,
  ACCENT_COLORS,
  ORB_COLORS,
  TTS_VOICES,
} from "@/lib/userSettings"

const ACCESS_TIERS: AccessTier[] = ["Core Access", "Developer", "Admin", "Operator"]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type CropOffset = { x: number; y: number }

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [activeSection, setActiveSection] = useState<string>("profile")
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [cropZoom, setCropZoom] = useState(1)
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const { theme, setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const isLight = theme === "light"

  const palette = {
    bg: isLight ? "#f6f8fc" : "#0f1117",
    border: isLight ? "#d9e0ea" : "#252b36",
    hover: isLight ? "#eef3fb" : "#141923",
    cardBg: isLight ? "#ffffff" : "#121620",
    cardHover: isLight ? "#f7faff" : "#151a25",
    subBg: isLight ? "#f4f7fd" : "#0f1117",
    subBorder: isLight ? "#d5dce8" : "#2b3240",
    selectedBg: isLight ? "#edf3ff" : "#161b25",
  }

  const paletteVars = {
    "--settings-bg": palette.bg,
    "--settings-border": palette.border,
    "--settings-hover": palette.hover,
    "--settings-card-bg": palette.cardBg,
    "--settings-card-hover": palette.cardHover,
    "--settings-sub-bg": palette.subBg,
    "--settings-sub-border": palette.subBorder,
    "--settings-selected-bg": palette.selectedBg,
  } as CSSProperties

  useEffect(() => {
    if (isOpen) {
      setSettings(loadUserSettings())
    }
  }, [isOpen])

  // Auto-save helper
  const autoSave = useCallback((newSettings: UserSettings) => {
    setSettings(newSettings)
    saveUserSettings(newSettings)
  }, [])

  const handleReset = useCallback(() => {
    const fresh = resetSettings()
    setSettings(fresh)
  }, [])

  const updateProfile = (key: string, value: string | null) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      profile: { ...settings.profile, [key]: value },
    }
    autoSave(newSettings)
  }

  const CROP_FRAME = 240
  const EXPORT_SIZE = 320
  const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

  const getBaseScale = useCallback(
    (size: { width: number; height: number } | null) => {
      if (!size) return 1
      return Math.max(CROP_FRAME / size.width, CROP_FRAME / size.height)
    },
    [],
  )

  const clampOffset = useCallback(
    (next: CropOffset, zoom: number, size: { width: number; height: number } | null): CropOffset => {
      if (!size) return { x: 0, y: 0 }
      const displayScale = getBaseScale(size) * zoom
      const displayedWidth = size.width * displayScale
      const displayedHeight = size.height * displayScale
      const maxX = Math.max(0, (displayedWidth - CROP_FRAME) / 2)
      const maxY = Math.max(0, (displayedHeight - CROP_FRAME) / 2)
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      }
    },
    [getBaseScale],
  )

  const handleAvatarUpload = useCallback(async (file: File) => {
    if (!settings) return
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setAvatarError("Only JPG, PNG, or WEBP images are allowed.")
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setAvatarError("Image is too large. Max size is 8MB.")
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ""))
      reader.onerror = () => reject(new Error("Could not read image file."))
      reader.readAsDataURL(file)
    })

    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error("Invalid image file."))
      img.src = dataUrl
    })

    setImageSize(size)
    setCropSource(dataUrl)
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
    setAvatarError(null)
  }, [settings])

  const saveCroppedAvatar = useCallback(async () => {
    if (!cropSource || !imageSize) return

    const output = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const baseScale = getBaseScale(imageSize)
        const displayScale = baseScale * cropZoom
        const displayedWidth = imageSize.width * displayScale
        const displayedHeight = imageSize.height * displayScale
        const imageLeft = CROP_FRAME / 2 - displayedWidth / 2 + cropOffset.x
        const imageTop = CROP_FRAME / 2 - displayedHeight / 2 + cropOffset.y

        let sx = ((0 - imageLeft) / displayedWidth) * imageSize.width
        let sy = ((0 - imageTop) / displayedHeight) * imageSize.height
        let sw = (CROP_FRAME / displayedWidth) * imageSize.width
        let sh = (CROP_FRAME / displayedHeight) * imageSize.height

        sx = Math.max(0, Math.min(imageSize.width - 1, sx))
        sy = Math.max(0, Math.min(imageSize.height - 1, sy))
        sw = Math.max(1, Math.min(imageSize.width - sx, sw))
        sh = Math.max(1, Math.min(imageSize.height - sy, sh))

        const canvas = document.createElement("canvas")
        canvas.width = EXPORT_SIZE
        canvas.height = EXPORT_SIZE
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          reject(new Error("Could not process image."))
          return
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, EXPORT_SIZE, EXPORT_SIZE)
        resolve(canvas.toDataURL("image/jpeg", 0.9))
      }
      img.onerror = () => reject(new Error("Could not process image."))
      img.src = cropSource
    })

    updateProfile("avatar", output)
    setCropSource(null)
    setImageSize(null)
    setCropZoom(1)
    setCropOffset({ x: 0, y: 0 })
  }, [cropOffset.x, cropOffset.y, cropSource, cropZoom, getBaseScale, imageSize])

  const updateApp = (key: string, value: boolean | string) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      app: { ...settings.app, [key]: value },
    }
    autoSave(newSettings)
  }

  const updateNotifications = (key: string, value: boolean) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      notifications: { ...settings.notifications, [key]: value },
    }
    autoSave(newSettings)
  }

  const updatePersonalization = (key: string, value: string | string[]) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      personalization: { ...settings.personalization, [key]: value },
    }
    autoSave(newSettings)
  }

  if (!isOpen) return null

  const sections = [
    { id: "profile", label: "Profile", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "audio", label: "Audio & Voice", icon: Volume2 },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "personalization", label: "Personalization", icon: Sparkles },
    { id: "access", label: "Access Level", icon: Shield },
  ]

  return (
    <div style={paletteVars} className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${isLight ? "bg-black/45" : "bg-black/75"}`}
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-[var(--settings-bg)] border border-[var(--settings-border)] rounded-2xl flex overflow-hidden">
        {/* Left Nav */}
        <div className="w-48 bg-[var(--settings-bg)] border-r border-[var(--settings-border)] flex flex-col shrink-0">
          <div className="p-4 border-b border-[var(--settings-border)]">
            <h2 className="text-lg font-medium text-s-90">Settings</h2>
          </div>

          <div className="flex-1 py-2 px-2 overflow-y-auto">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 mb-0.5 ${
                    isActive
                      ? "bg-[var(--settings-selected-bg)] text-accent border border-accent-30"
                      : "text-s-50 border border-transparent hover:bg-[var(--settings-hover)] hover:text-s-80 hover:border-[var(--settings-sub-border)]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {section.label}
                </button>
              )
            })}
          </div>

          {/* Reset Button Only */}
          <div className="p-3 border-t border-[var(--settings-border)]">
            <Button
              onClick={handleReset}
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-s-40 hover:text-s-60 hover:bg-[var(--settings-hover)] h-9 transition-colors duration-150"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default
            </Button>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[var(--settings-bg)]">
          {/* Header with close */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--settings-border)] bg-[var(--settings-bg)]">
            <h3 className="text-sm font-medium text-s-50 uppercase tracking-wider">
              {sections.find((s) => s.id === activeSection)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-[var(--settings-hover)] text-s-40 hover:text-s-70 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-[var(--settings-bg)]">
            {!settings ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Profile Section */}
                {activeSection === "profile" && (
                  <div className="space-y-5">
                    {/* Avatar */}
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden"
                        style={{
                          background: `linear-gradient(to bottom right, var(--accent-primary), var(--accent-secondary))`,
                          boxShadow: `0 10px 15px -3px rgba(var(--accent-rgb), 0.2)`
                        }}
                      >
                        {settings.profile.avatar ? (
                          <img
                            src={settings.profile.avatar}
                            alt="Avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-7 h-7 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-s-70">Profile Picture</p>
                        <p className="text-xs text-s-30">Upload a custom avatar</p>
                        {avatarError && (
                          <p className="text-xs text-red-400 mt-1">{avatarError}</p>
                        )}
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const inputEl = e.currentTarget
                          const file = e.target.files?.[0]
                          if (!file) return
                          try {
                            await handleAvatarUpload(file)
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : "Failed to upload image."
                            setAvatarError(msg)
                          } finally {
                            inputEl.value = ""
                          }
                        }}
                      />
                      <Button
                        onClick={() => avatarInputRef.current?.click()}
                        variant="outline"
                        size="sm"
                        className="gap-2 text-s-50 border-[var(--settings-sub-border)] hover:border-accent-30 hover:text-accent hover:bg-accent-10 transition-colors duration-150"
                      >
                        <Camera className="w-4 h-4" />
                        Upload
                      </Button>
                    </div>

                    {/* Name */}
                    <SettingInput
                      label="Display Name"
                      description="Your name shown in the interface"
                      value={settings.profile.name}
                      onChange={(v) => updateProfile("name", v)}
                    />
                  </div>
                )}

                {/* Appearance Section */}
                {activeSection === "appearance" && (
                  <div className="space-y-5">
                    {/* Theme */}
                    <SettingSelect
                      label="Theme"
                      description="Choose your color scheme"
                      value={settings.app.theme}
                      options={[
                        { value: "dark", label: "Dark" },
                        { value: "light", label: "Light" },
                        { value: "system", label: "System" },
                      ]}
                      onChange={(v) => {
                        setThemeSetting(v as "dark" | "light" | "system")
                        // Also update local state so UI stays in sync
                        setSettings(prev => prev ? { ...prev, app: { ...prev.app, theme: v as "dark" | "light" | "system" } } : prev)
                      }}
                    />

                    {/* Accent Color */}
                    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">Accent Color</p>
                      <p className="text-xs text-s-30 mb-4">Choose your UI accent color</p>
                      <div className="flex gap-3 flex-wrap">
                        {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => {
                          const isSelected = settings.app.accentColor === color
                          return (
                            <button
                              key={color}
                              onClick={() => {
                                setAccentColor(color)
                                // Also update local state so UI stays in sync
                                setSettings(prev => prev ? { ...prev, app: { ...prev.app, accentColor: color } } : prev)
                              }}
                              className={`w-10 h-10 rounded-xl transition-colors duration-150 border ${
                                isSelected ? "border-accent-30" : "border-[var(--settings-sub-border)]"
                              }`}
                              style={{
                                backgroundColor: ACCENT_COLORS[color].primary,
                              }}
                              title={ACCENT_COLORS[color].name}
                            >
                              {isSelected && (
                                <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
                                  <Check className="w-3.5 h-3.5 text-white" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Orb Color */}
                    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">Nova Orb Color</p>
                      <p className="text-xs text-s-30 mb-4">Choose the orb color on the home screen</p>
                      <div className="flex gap-3 flex-wrap">
                        {(Object.keys(ORB_COLORS) as OrbColor[]).map((color) => {
                          const palette = ORB_COLORS[color]
                          const isSelected = settings.app.orbColor === color
                          return (
                            <button
                              key={color}
                              onClick={() => updateApp("orbColor", color)}
                              className={`w-10 h-10 rounded-xl transition-colors duration-150 border ${
                                isSelected ? "border-accent-30" : "border-[var(--settings-sub-border)]"
                              }`}
                              style={{
                                background: `linear-gradient(135deg, ${palette.circle1}, ${palette.circle2})`,
                              }}
                              title={palette.name}
                            >
                              {isSelected && (
                                <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/25">
                                  <Check className="w-3.5 h-3.5 text-white" />
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Font Size */}
                    <SettingSelect
                      label="Font Size"
                      description="Adjust text size"
                      value={settings.app.fontSize}
                      options={[
                        { value: "small", label: "Small" },
                        { value: "medium", label: "Medium" },
                        { value: "large", label: "Large" },
                      ]}
                      onChange={(v) => updateApp("fontSize", v)}
                    />

                    {/* Compact Mode */}
                    <SettingToggle
                      label="Compact Mode"
                      description="Reduce spacing for denser layout"
                      checked={settings.app.compactMode}
                      onChange={(v) => updateApp("compactMode", v)}
                    />

                    {/* Boot Animation */}
                    <SettingToggle
                      label="Boot Animation"
                      description="Show startup sequence on launch"
                      checked={settings.app.bootAnimationEnabled}
                      onChange={(v) => updateApp("bootAnimationEnabled", v)}
                    />
                  </div>
                )}

                {/* Audio & Voice Section */}
                {activeSection === "audio" && (
                  <div className="space-y-5">
                    <SettingToggle
                      label="Sound Effects"
                      description="Play sounds for actions and notifications"
                      checked={settings.app.soundEnabled}
                      onChange={(v) => updateApp("soundEnabled", v)}
                    />

                    <SettingToggle
                      label="Voice Responses"
                      description="Enable Nova's voice synthesis"
                      checked={settings.app.voiceEnabled}
                      onChange={(v) => updateApp("voiceEnabled", v)}
                    />

                    {/* TTS Voice Selection */}
                    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <p className="text-sm text-s-70 mb-1">TTS Voice</p>
                      <p className="text-xs text-s-30 mb-3">Choose Nova's speaking voice</p>
                      <div className="space-y-2">
                        {TTS_VOICES.map((voice) => {
                          const isSelected = settings.app.ttsVoice === voice.id
                          return (
                            <button
                              key={voice.id}
                              onClick={() => {
                                updateApp("ttsVoice", voice.id)
                                // Send voice preference to agent immediately
                                try {
                                  const ws = new WebSocket("ws://localhost:8765")
                                  ws.onopen = () => {
                                    ws.send(JSON.stringify({ type: "set_voice", ttsVoice: voice.id }))
                                    ws.close()
                                  }
                                } catch {}
                              }}
                              className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors duration-150 ${
                                isSelected
                                  ? "bg-[var(--settings-selected-bg)] border border-accent-30"
                                  : "bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)]"
                              }`}
                            >
                              <div className="flex-1 text-left">
                                <span className={`text-sm transition-colors duration-200 ${
                                  isSelected
                                    ? "text-accent"
                                    : "text-s-60"
                                }`}>
                                  {voice.name}
                                </span>
                                <p className="text-xs text-s-30">{voice.description}</p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Notifications Section */}
                {activeSection === "notifications" && (
                  <div className="space-y-5">
                    <SettingToggle
                      label="Enable Notifications"
                      description="Receive alerts from Nova"
                      checked={settings.notifications.enabled}
                      onChange={(v) => updateNotifications("enabled", v)}
                    />

                    <SettingToggle
                      label="Notification Sounds"
                      description="Play sound when notifications arrive"
                      checked={settings.notifications.sound}
                      onChange={(v) => updateNotifications("sound", v)}
                    />

                    <SettingToggle
                      label="Telegram Alerts"
                      description="Show alerts for Telegram messages"
                      checked={settings.notifications.telegramAlerts}
                      onChange={(v) => updateNotifications("telegramAlerts", v)}
                    />

                    <SettingToggle
                      label="System Updates"
                      description="Notify about system status changes"
                      checked={settings.notifications.systemUpdates}
                      onChange={(v) => updateNotifications("systemUpdates", v)}
                    />
                  </div>
                )}

                {/* Personalization Section */}
                {activeSection === "personalization" && (
                  <div className="space-y-5">
                    <div className="p-4 rounded-xl bg-accent-10 border border-accent-30 transition-colors duration-150 hover:bg-accent-15 mb-4">
                      <p className="text-sm text-accent-secondary">
                        Help Nova understand you better by filling in these details.
                        This information helps personalize your experience.
                      </p>
                    </div>

                    <SettingInput
                      label="Nickname"
                      description="What should Nova call you?"
                      value={settings.personalization.nickname}
                      onChange={(v) => updatePersonalization("nickname", v)}
                      placeholder="e.g., Boss, Chief, Captain..."
                    />

                    <SettingInput
                      label="Occupation"
                      description="Your profession or role"
                      value={settings.personalization.occupation}
                      onChange={(v) => updatePersonalization("occupation", v)}
                      placeholder="e.g., Software Developer, Designer..."
                    />

                    <SettingInput
                      label="Preferred Language"
                      description="Your preferred language for responses"
                      value={settings.personalization.preferredLanguage}
                      onChange={(v) => updatePersonalization("preferredLanguage", v)}
                    />

                    <SettingSelect
                      label="Communication Style"
                      description="How formal should Nova be?"
                      value={settings.personalization.communicationStyle}
                      options={[
                        { value: "formal", label: "Formal" },
                        { value: "professional", label: "Professional" },
                        { value: "friendly", label: "Friendly" },
                        { value: "casual", label: "Casual" },
                      ]}
                      onChange={(v) => updatePersonalization("communicationStyle", v)}
                    />

                    <SettingSelect
                      label="Response Tone"
                      description="Nova's conversational tone"
                      value={settings.personalization.tone}
                      options={[
                        { value: "neutral", label: "Neutral" },
                        { value: "enthusiastic", label: "Enthusiastic" },
                        { value: "calm", label: "Calm" },
                        { value: "direct", label: "Direct" },
                      ]}
                      onChange={(v) => updatePersonalization("tone", v)}
                    />

                    <SettingTextarea
                      label="Your Characteristics"
                      description="Describe yourself - personality traits, preferences, quirks"
                      value={settings.personalization.characteristics}
                      onChange={(v) => updatePersonalization("characteristics", v)}
                      placeholder="e.g., I'm detail-oriented, prefer concise answers, work late nights..."
                      rows={3}
                    />

                    <SettingTextarea
                      label="Custom Instructions"
                      description="Special instructions for Nova to follow"
                      value={settings.personalization.customInstructions}
                      onChange={(v) => updatePersonalization("customInstructions", v)}
                      placeholder="e.g., Always provide code examples in Python, remind me to take breaks..."
                      rows={4}
                    />
                  </div>
                )}

                {/* Access Level Section */}
                {activeSection === "access" && (
                  <div className="space-y-5">
                    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-accent-15 flex items-center justify-center">
                          <Shield className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm text-s-70">Current Tier</p>
                          <p className="text-lg text-accent font-mono">
                            {settings.profile.accessTier}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {ACCESS_TIERS.map((tier) => {
                          const isSelected = settings.profile.accessTier === tier
                          return (
                            <button
                              key={tier}
                              onClick={() => updateProfile("accessTier", tier)}
                              className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors duration-150 ${
                                isSelected
                                  ? "bg-[var(--settings-selected-bg)] border border-accent-30"
                                  : "bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)]"
                              }`}
                            >
                              <span
                                className={`text-sm transition-colors duration-200 ${
                                  isSelected
                                    ? "text-accent"
                                    : "text-s-50"
                                }`}
                              >
                                {tier}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {cropSource && imageSize && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="w-[360px] rounded-2xl border border-[var(--settings-border)] bg-[var(--settings-card-bg)] p-4">
            <h4 className="text-sm font-medium text-s-90">Adjust profile photo</h4>
            <p className="mt-1 text-xs text-s-40">Drag to reposition. Use zoom to crop.</p>

            <div className="mt-4 flex justify-center">
              <div
                className="relative h-[240px] w-[240px] overflow-hidden rounded-full border border-[var(--settings-sub-border)] bg-[var(--settings-sub-bg)] cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.preventDefault()
                  const target = e.currentTarget
                  target.setPointerCapture(e.pointerId)
                  setDragStart({ x: e.clientX, y: e.clientY, offsetX: cropOffset.x, offsetY: cropOffset.y })
                }}
                onPointerMove={(e) => {
                  if (!dragStart) return
                  const next = {
                    x: dragStart.offsetX + (e.clientX - dragStart.x),
                    y: dragStart.offsetY + (e.clientY - dragStart.y),
                  }
                  setCropOffset(clampOffset(next, cropZoom, imageSize))
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  setDragStart(null)
                }}
                onPointerCancel={() => setDragStart(null)}
              >
                <img
                  src={cropSource}
                  alt="Crop preview"
                  draggable={false}
                  className="absolute left-1/2 top-1/2 select-none"
                  style={{
                    width: `${imageSize.width * getBaseScale(imageSize) * cropZoom}px`,
                    height: `${imageSize.height * getBaseScale(imageSize) * cropZoom}px`,
                    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px))`,
                    maxWidth: "none",
                  }}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-s-50">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={cropZoom}
                onChange={(e) => {
                  const nextZoom = Number(e.target.value)
                  setCropZoom(nextZoom)
                  setCropOffset((prev) => clampOffset(prev, nextZoom, imageSize))
                }}
                className="w-full accent-violet-500"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setCropSource(null)
                  setImageSize(null)
                  setDragStart(null)
                }}
              >
                Cancel
              </Button>
              <Button onClick={saveCroppedAvatar}>Save Photo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)] cursor-pointer group"
      onClick={() => onChange(!checked)}
    >
      <div>
        <p className="text-sm text-s-70 group-hover:text-s-90 transition-colors">{label}</p>
        <p className="text-xs text-s-30 mt-0.5">{description}</p>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-colors duration-150 ${
          checked ? "bg-accent" : "bg-[var(--settings-sub-border)]"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all duration-200 ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  )
}

function SettingInput({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] text-s-90 text-sm placeholder:text-s-25 focus:outline-none focus:border-accent-50 focus:bg-[var(--settings-hover)] transition-colors duration-150"
      />
    </div>
  )
}

function SettingTextarea({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] text-s-90 text-sm placeholder:text-s-25 focus:outline-none focus:border-accent-50 focus:bg-[var(--settings-hover)] transition-colors duration-150 resize-none"
      />
    </div>
  )
}

function SettingSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--settings-card-bg)] border border-[var(--settings-border)] transition-colors duration-150 hover:bg-[var(--settings-card-hover)]">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <div className="flex flex-wrap gap-2 rounded-lg bg-[var(--settings-sub-bg)] border border-[var(--settings-sub-border)] p-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`min-w-[92px] px-3 py-2 rounded-md text-sm border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              value === opt.value
                ? "bg-[var(--settings-selected-bg)] text-accent border-accent-30"
                : "bg-[var(--settings-sub-bg)] text-s-50 border border-[var(--settings-sub-border)] hover:bg-[var(--settings-hover)] hover:text-s-80"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
