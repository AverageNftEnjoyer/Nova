"use client"

import { Switch } from "@/components/ui"
import { SettingRow, SettingsGroup, playClickSound } from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  settings: UserSettings
  updateNotifications: (key: string, value: boolean) => void
}

export function SettingsNotificationsPanel({ settings, updateNotifications }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="In chat">
        <SettingRow
          label="Rewrite hints"
          hint="Show an Edited note under your message when Nova corrected it a lot or was unsure what you meant."
        >
          <Switch
            checked={settings.notifications.nlpEditHintsEnabled}
            onCheckedChange={(value) => {
              playClickSound()
              updateNotifications("nlpEditHintsEnabled", value)
            }}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}
