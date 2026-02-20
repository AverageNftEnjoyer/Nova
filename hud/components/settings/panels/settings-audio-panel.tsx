"use client"

import { FluidSelect } from "@/components/ui/fluid-select"
import { cn } from "@/lib/shared/utils"
import { SettingToggle, getSettingsCardClass, playClickSound } from "@/components/settings/settings-primitives"
import { TTS_VOICES, type UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  updateApp: (key: string, value: boolean | string | null) => void
}

export function SettingsAudioPanel({ isLight, settings, updateApp }: Props) {
  return (
    <div className="space-y-5">
      <SettingToggle
        label="Sound Effects"
        description="Play sounds for actions and notifications"
        checked={settings.app.soundEnabled}
        onChange={(v) => updateApp("soundEnabled", v)}
        isLight={isLight}
      />

      <SettingToggle
        label="Voice Responses"
        description="Enable Nova's voice synthesis"
        checked={settings.app.voiceEnabled}
        onChange={(v) => {
          updateApp("voiceEnabled", v)
          try {
            const ws = new WebSocket("ws://localhost:8765")
            ws.onopen = () => {
              ws.send(JSON.stringify({ type: "set_voice", ttsVoice: settings.app.ttsVoice, voiceEnabled: v }))
              ws.close()
            }
          } catch {}
        }}
        isLight={isLight}
      />

      {/* TTS Voice */}
      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>TTS Voice</p>
        <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>Choose Nova&apos;s speaking voice</p>
        <FluidSelect
          value={settings.app.ttsVoice}
          isLight={isLight}
          options={TTS_VOICES.map((voice) => ({ value: voice.id, label: voice.name }))}
          onChange={(voiceId) => {
            playClickSound()
            updateApp("ttsVoice", voiceId)
            try {
              const ws = new WebSocket("ws://localhost:8765")
              ws.onopen = () => {
                ws.send(JSON.stringify({ type: "set_voice", ttsVoice: voiceId }))
                ws.close()
              }
            } catch {}
          }}
        />
        <p className={cn("text-xs mt-3", isLight ? "text-s-30" : "text-slate-500")}>
          {TTS_VOICES.find((voice) => voice.id === settings.app.ttsVoice)?.description}
        </p>
      </div>
    </div>
  )
}
