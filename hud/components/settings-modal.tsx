"use client"

import { useEffect, useState, useCallback } from "react"
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
  ACCENT_COLORS,
  TTS_VOICES,
} from "@/lib/userSettings"

const ACCESS_TIERS: AccessTier[] = ["Core Access", "Developer", "Admin", "Operator"]

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [activeSection, setActiveSection] = useState<string>("profile")
  const { setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()

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

  const updateProfile = (key: string, value: string) => {
    if (!settings) return
    const newSettings = {
      ...settings,
      profile: { ...settings.profile, [key]: value },
    }
    autoSave(newSettings)
  }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-page border border-s-10 rounded-2xl shadow-2xl flex overflow-hidden">
        {/* Left Nav */}
        <div className="w-48 bg-s-2 border-r border-s-5 flex flex-col shrink-0">
          <div className="p-4 border-b border-s-5">
            <h2 className="text-lg font-medium text-white">Settings</h2>
          </div>

          <div className="flex-1 py-2 px-2 overflow-y-auto">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 mb-0.5 group ${
                    isActive
                      ? "bg-accent-20 text-accent shadow-sm"
                      : "text-s-50 hover:bg-s-8 hover:text-white hover:translate-x-0.5"
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-transform duration-200 ${!isActive ? "group-hover:scale-110" : ""}`} />
                  {section.label}
                </button>
              )
            })}
          </div>

          {/* Reset Button Only */}
          <div className="p-3 border-t border-s-5">
            <Button
              onClick={handleReset}
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-s-40 hover:text-s-60 hover:bg-s-8 h-9 transition-all duration-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default
            </Button>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with close */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-s-5">
            <h3 className="text-sm font-medium text-s-50 uppercase tracking-wider">
              {sections.find((s) => s.id === activeSection)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-s-5 text-s-40 hover:text-s-70 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6">
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
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200 group">
                      <div
                        className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden shadow-lg transition-all duration-200"
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
                        <p className="text-sm text-s-70 group-hover:text-s-90 transition-colors">Profile Picture</p>
                        <p className="text-xs text-s-30">Upload a custom avatar</p>
                      </div>
                      <Button variant="outline" size="sm" className="gap-2 text-s-50 border-s-10 hover:border-accent-30 hover:text-accent hover:bg-accent-10 transition-all duration-200">
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
                    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
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
                              className={`w-10 h-10 rounded-xl transition-all duration-200 hover:scale-110 hover:shadow-lg ${
                                isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-s-3 scale-110" : "hover:ring-1 hover:ring-white/30"
                              }`}
                              style={{
                                backgroundColor: ACCENT_COLORS[color].primary,
                                boxShadow: isSelected ? `0 4px 20px ${ACCENT_COLORS[color].primary}50` : undefined
                              }}
                              title={ACCENT_COLORS[color].name}
                            >
                              {isSelected && (
                                <Check className="w-5 h-5 text-white mx-auto drop-shadow-md" />
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
                    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
                      <p className="text-sm text-s-70 mb-1">TTS Voice</p>
                      <p className="text-xs text-s-30 mb-3">Choose Nova's speaking voice</p>
                      <div className="space-y-2">
                        {TTS_VOICES.map((voice) => {
                          const isSelected = settings.app.ttsVoice === voice.id
                          return (
                            <button
                              key={voice.id}
                              onClick={() => updateApp("ttsVoice", voice.id)}
                              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                                isSelected
                                  ? "bg-accent-15 border border-accent-30 shadow-sm shadow-accent"
                                  : "bg-s-5 border border-s-5 hover:bg-s-8 hover:border-s-10"
                              }`}
                            >
                              <div
                                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                                  isSelected
                                    ? "bg-accent shadow-sm shadow-accent"
                                    : "bg-s-20 group-hover:bg-s-30"
                                }`}
                              />
                              <div className="flex-1 text-left">
                                <span className={`text-sm transition-colors duration-200 ${
                                  isSelected
                                    ? "text-accent"
                                    : "text-s-60 group-hover:text-s-80"
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
                    <div className="p-4 rounded-xl bg-accent-10 border border-accent-30 hover:bg-accent-15 transition-all duration-200 mb-4">
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
                    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
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
                              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                                isSelected
                                  ? "bg-accent-15 border border-accent-30 shadow-sm shadow-accent"
                                  : "bg-s-5 border border-s-5 hover:bg-s-8 hover:border-s-10"
                              }`}
                            >
                              <div
                                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                                  isSelected
                                    ? "bg-accent shadow-sm shadow-accent"
                                    : "bg-s-20 group-hover:bg-s-30"
                                }`}
                              />
                              <span
                                className={`text-sm transition-colors duration-200 ${
                                  isSelected
                                    ? "text-accent"
                                    : "text-s-50 group-hover:text-s-70"
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
    <div className="flex items-center justify-between p-4 rounded-xl bg-s-3 border border-s-5 hover:bg-s-5 hover:border-s-10 transition-all duration-200 cursor-pointer group"
      onClick={() => onChange(!checked)}
    >
      <div>
        <p className="text-sm text-s-70 group-hover:text-s-90 transition-colors">{label}</p>
        <p className="text-xs text-s-30 mt-0.5">{description}</p>
      </div>
      <button
        className={`relative w-11 h-6 rounded-full transition-all duration-200 ${
          checked ? "bg-accent shadow-lg shadow-accent" : "bg-s-15 group-hover:bg-s-20"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-200 ${
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
    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-s-5 border border-s-10 text-s-90 text-sm placeholder:text-s-25 focus:outline-none focus:border-accent-50 focus:bg-s-8 transition-all duration-200"
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
    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg bg-s-5 border border-s-10 text-s-90 text-sm placeholder:text-s-25 focus:outline-none focus:border-accent-50 focus:bg-s-8 transition-all duration-200 resize-none"
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
    <div className="p-4 rounded-xl bg-s-3 border border-s-5 hover:border-s-10 transition-all duration-200">
      <p className="text-sm text-s-70 mb-0.5">{label}</p>
      <p className="text-xs text-s-30 mb-3">{description}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-200 ${
              value === opt.value
                ? "bg-accent-20 text-accent border border-accent-30 shadow-sm shadow-accent"
                : "bg-s-5 text-s-50 border border-s-10 hover:bg-s-10 hover:text-s-70 hover:border-s-15"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
