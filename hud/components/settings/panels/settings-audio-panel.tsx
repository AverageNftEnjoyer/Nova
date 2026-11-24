"use client"

import { Select, Switch } from "@/components/ui"
import { SettingRow, SettingsGroup, playClickSound } from "@/components/settings/settings-primitives"
import { TTS_VOICES, type UserSettings } from "@/lib/settings/userSettings"

interface Props {
  settings: UserSettings
  updateApp: (key: string, value: boolean | string | null) => void
}

/** Tells the local runtime about a voice change (it speaks replies, so it needs to know right away). */
function pushVoiceSettings(payload: { ttsVoice: string; voiceEnabled?: boolean }) {
  try {
    const ws = new WebSocket("ws://localhost:8765")
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "set_voice", ...payload }))
      ws.close()
    }
  } catch {
    // Runtime not reachable: the setting is saved and is read again on the next connection.
  }
}

export function SettingsAudioPanel({ settings, updateApp }: Props) {
  const voice = TTS_VOICES.find((item) => item.id === settings.app.ttsVoice)

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="Sounds">
        <SettingRow label="Interface sounds" hint="Short click sounds when you use buttons and controls.">
          <Switch
            checked={settings.app.soundEnabled}
            onCheckedChange={(value) => {
              updateApp("soundEnabled", value)
              if (value) window.setTimeout(playClickSound, 0)
            }}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Voice">
        <SettingRow label="Spoken replies" hint="Nova reads its replies aloud.">
          <Switch
            checked={settings.app.voiceEnabled}
            onCheckedChange={(value) => {
              playClickSound()
              updateApp("voiceEnabled", value)
              pushVoiceSettings({ ttsVoice: settings.app.ttsVoice, voiceEnabled: value })
            }}
          />
        </SettingRow>
        <SettingRow label="Voice" hint={voice?.description ?? "The voice used for spoken replies."}>
          <Select
            value={settings.app.ttsVoice}
            options={TTS_VOICES.map((item) => ({ value: item.id, label: item.name }))}
            onValueChange={(voiceId) => {
              playClickSound()
              updateApp("ttsVoice", voiceId)
              pushVoiceSettings({ ttsVoice: voiceId })
            }}
            disabled={!settings.app.voiceEnabled}
            className="w-52"
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  )
}
