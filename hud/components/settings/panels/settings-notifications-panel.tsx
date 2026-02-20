"use client"

import { SettingToggle } from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  updateNotifications: (key: string, value: boolean) => void
}

export function SettingsNotificationsPanel({ isLight, settings, updateNotifications }: Props) {
  return (
    <div className="space-y-5">
      <SettingToggle
        label="Enable Notifications"
        description="Receive alerts from Nova"
        checked={settings.notifications.enabled}
        onChange={(v) => updateNotifications("enabled", v)}
        isLight={isLight}
      />
      <SettingToggle
        label="Notification Sounds"
        description="Play sound when notifications arrive"
        checked={settings.notifications.sound}
        onChange={(v) => updateNotifications("sound", v)}
        isLight={isLight}
      />
      <SettingToggle
        label="Telegram Alerts"
        description="Show alerts for Telegram messages"
        checked={settings.notifications.telegramAlerts}
        onChange={(v) => updateNotifications("telegramAlerts", v)}
        isLight={isLight}
      />
      <SettingToggle
        label="System Updates"
        description="Notify about system status changes"
        checked={settings.notifications.systemUpdates}
        onChange={(v) => updateNotifications("systemUpdates", v)}
        isLight={isLight}
      />
      <SettingToggle
        label="NLP Edit Hints"
        description="Show 'Edited' hints only for low-confidence or major input rewrites"
        checked={settings.notifications.nlpEditHintsEnabled}
        onChange={(v) => updateNotifications("nlpEditHintsEnabled", v)}
        isLight={isLight}
      />
    </div>
  )
}
