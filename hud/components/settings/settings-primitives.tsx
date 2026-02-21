"use client"

import { cn } from "@/lib/shared/utils"
import { FluidSelect } from "@/components/ui/fluid-select"
import { NovaSwitch } from "@/components/ui/nova-switch"
import { loadUserSettings } from "@/lib/settings/userSettings"

export function playClickSound() {
  try {
    const settings = loadUserSettings()
    if (!settings.app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.9
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {}
}

export function getSettingsCardClass(isLight: boolean) {
  return cn(
    "fx-spotlight-card fx-border-glow rounded-xl border transition-all duration-150",
    isLight
      ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]"
      : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
  )
}

export function getSettingsFieldClass(isLight: boolean) {
  return cn(
    "w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:border-accent-50 transition-colors duration-150",
    isLight
      ? "bg-white border-[#d5dce8] text-s-90 placeholder:text-s-25 focus:bg-[#eef3fb]"
      : "bg-black/25 border-white/10 text-slate-100 placeholder:text-slate-500 focus:bg-white/[0.06]"
  )
}

export function SettingToggle({
  label,
  description,
  checked,
  onChange,
  isLight = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  isLight?: boolean
}) {
  const handleChange = (newValue: boolean) => {
    playClickSound()
    onChange(newValue)
  }
  return (
    <div
      className={cn(
        getSettingsCardClass(isLight),
        "group flex items-center justify-between gap-4 p-4 cursor-pointer select-none",
      )}
      onClick={() => handleChange(!checked)}
    >
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm transition-colors", isLight ? "text-s-70 group-hover:text-s-90" : "text-slate-200 group-hover:text-white")}>{label}</p>
        <p className={cn("text-xs mt-0.5", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      </div>
      <NovaSwitch checked={checked} onChange={handleChange} />
    </div>
  )
}

export function SettingInput({
  label,
  description,
  value,
  onChange,
  placeholder,
  maxLength,
  errorText,
  isLight = false,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  errorText?: string
  isLight?: boolean
}) {
  return (
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={getSettingsFieldClass(isLight)}
      />
      {errorText ? (
        <p className={cn("mt-2 text-[11px]", isLight ? "text-rose-600" : "text-rose-300")}>{errorText}</p>
      ) : null}
    </div>
  )
}

export function SettingTextarea({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 3,
  isLight = false,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  isLight?: boolean
}) {
  return (
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cn(getSettingsFieldClass(isLight), "resize-none")}
      />
    </div>
  )
}

export function SettingSelect({
  label,
  description,
  value,
  isLight,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  isLight: boolean
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className={cn(getSettingsCardClass(isLight), "p-4")}>
      <p className={cn("text-sm mb-0.5", isLight ? "text-s-70" : "text-slate-200")}>{label}</p>
      <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>{description}</p>
      <FluidSelect
        value={value}
        options={options}
        isLight={isLight}
        onChange={(v) => {
          playClickSound()
          onChange(v)
        }}
      />
    </div>
  )
}
