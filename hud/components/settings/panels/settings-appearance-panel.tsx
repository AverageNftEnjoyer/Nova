"use client"

import { useRef } from "react"
import { Check } from "lucide-react"
import { FluidSelect } from "@/components/ui/fluid-select"
import { cn } from "@/lib/shared/utils"
import {
  SettingSelect,
  SettingToggle,
  getSettingsCardClass,
  playClickSound,
} from "@/components/settings/settings-primitives"
import {
  type UserSettings,
  type AccentColor,
  type OrbColor,
  type DarkBackgroundType,
  ACCENT_COLORS,
  ORB_COLORS,
  DARK_BACKGROUNDS,
} from "@/lib/settings/userSettings"
import { isBackgroundAssetImage, type BackgroundVideoAssetMeta } from "@/lib/media/backgroundVideoStorage"
import { useTheme } from "@/lib/context/theme-context"
import { useAccent } from "@/lib/context/accent-context"

interface Props {
  isLight: boolean
  settings: UserSettings
  setSettings: React.Dispatch<React.SetStateAction<UserSettings | null>>
  updateApp: (key: string, value: boolean | string | null) => void
  backgroundVideoAssets: BackgroundVideoAssetMeta[]
  activeBackgroundVideoAssetId: string | null
  backgroundVideoError: string | null
  setBackgroundVideoError: (e: string | null) => void
  handleBackgroundVideoUpload: (file: File) => Promise<void>
  removeBackgroundVideo: () => Promise<void>
  selectBackgroundVideoAsset: (id: string | null) => void
}

const NONE_OPTION = "__none__"

export function SettingsAppearancePanel({
  isLight,
  settings,
  setSettings,
  updateApp,
  backgroundVideoAssets,
  activeBackgroundVideoAssetId,
  backgroundVideoError,
  setBackgroundVideoError,
  handleBackgroundVideoUpload,
  removeBackgroundVideo,
  selectBackgroundVideoAsset,
}: Props) {
  const backgroundVideoInputRef = useRef<HTMLInputElement | null>(null)
  const { setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()

  const activeBackgroundVideo =
    backgroundVideoAssets.find((a) => a.id === (activeBackgroundVideoAssetId || settings.app.customBackgroundVideoAssetId)) ?? null

  const backgroundVideoOptions = [
    { value: NONE_OPTION, label: "None" },
    ...backgroundVideoAssets.map((a) => ({ value: a.id, label: a.fileName })),
  ]

  return (
    <div className="space-y-5">
      {/* Theme */}
      <SettingSelect
        label="Theme"
        description="Choose your color scheme"
        isLight={isLight}
        value={settings.app.theme}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System" },
        ]}
        onChange={(v) => {
          setThemeSetting(v as "dark" | "light" | "system")
          setSettings((prev) => prev ? { ...prev, app: { ...prev.app, theme: v as "dark" | "light" | "system" } } : prev)
        }}
      />

      {/* Accent Color */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Accent Color</p>
        <p className={cn("text-xs mb-4", isLight ? "text-s-30" : "text-slate-500")}>Choose your UI accent color</p>
        <div className="flex gap-3 flex-wrap">
          {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => {
            const isSelected = settings.app.accentColor === color
            return (
              <button
                key={color}
                onClick={() => {
                  playClickSound()
                  setAccentColor(color)
                  setSettings((prev) => prev ? { ...prev, app: { ...prev.app, accentColor: color } } : prev)
                }}
                className={cn(
                  "fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  isSelected ? "border-accent-30" : isLight ? "border-[#d5dce8] hover:border-white/30" : "border-white/10 hover:border-white/20"
                )}
                style={{ backgroundColor: ACCENT_COLORS[color].primary }}
                title={ACCENT_COLORS[color].name}
              >
                {isSelected && (
                  <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Orb Color */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Nova Orb Color</p>
        <p className={cn("text-xs mb-4", isLight ? "text-s-30" : "text-slate-500")}>Choose the orb color on the home screen</p>
        <div className="flex gap-3 flex-wrap">
          {(Object.keys(ORB_COLORS) as OrbColor[]).map((color) => {
            const pal = ORB_COLORS[color]
            const isSelected = settings.app.orbColor === color
            return (
              <button
                key={color}
                onClick={() => { playClickSound(); updateApp("orbColor", color) }}
                className={cn(
                  "fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  isSelected ? "border-accent-30" : isLight ? "border-[#d5dce8] hover:border-white/30" : "border-white/10 hover:border-white/20"
                )}
                style={{ background: `linear-gradient(135deg, ${pal.circle1}, ${pal.circle2})` }}
                title={pal.name}
              >
                {isSelected && (
                  <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Background preset */}
      <SettingSelect
        label="Background"
        description="Choose the app background"
        isLight={isLight}
        value={settings.app.darkModeBackground}
        options={(Object.entries(DARK_BACKGROUNDS) as [DarkBackgroundType, { name: string; description: string }][]).map(([value, info]) => ({
          value,
          label: info.name,
        }))}
        onChange={(v) => updateApp("darkModeBackground", v)}
      />

      {/* Custom background upload */}
      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Custom Background</p>
        <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>Upload an MP4 or image (JPG, PNG, WEBP, SVG)</p>
        <input
          ref={backgroundVideoInputRef}
          type="file"
          accept=".mp4,video/mp4,.jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={async (e) => {
            const inputEl = e.currentTarget
            const file = e.target.files?.[0]
            if (!file) return
            try {
              await handleBackgroundVideoUpload(file)
            } catch (err) {
              setBackgroundVideoError(err instanceof Error ? err.message : "Failed to upload background media.")
            } finally {
              inputEl.value = ""
            }
          }}
        />
        <div className={cn(
          "flex items-center gap-2 rounded-lg border p-1.5",
          isLight ? "bg-white border-[#d5dce8]" : "bg-black/25 border-white/10"
        )}>
          <div className="min-w-55 flex-[1.2]">
            <FluidSelect
              value={activeBackgroundVideo?.id ?? NONE_OPTION}
              isLight={isLight}
              options={backgroundVideoOptions}
              onChange={(v) => {
                playClickSound()
                selectBackgroundVideoAsset(v === NONE_OPTION ? null : v)
              }}
            />
          </div>
          <div className={cn(
            "flex-1 px-3 py-2 rounded-md text-sm border whitespace-nowrap overflow-hidden text-ellipsis",
            isLight ? "bg-white text-s-50 border-[#d5dce8]" : "bg-black/20 text-slate-400 border-white/10"
          )}>
            {activeBackgroundVideo
              ? `${activeBackgroundVideo.fileName}${isBackgroundAssetImage(activeBackgroundVideo.mimeType, activeBackgroundVideo.fileName) ? " (Image)" : " (Video)"}`
              : "No background selected"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { playClickSound(); backgroundVideoInputRef.current?.click() }}
              className={cn(
                "fx-spotlight-card fx-border-glow group relative h-8 w-8 flex items-center justify-center text-2xl leading-none transition-all duration-150 hover:rotate-12",
                isLight ? "text-s-50" : "text-s-40",
              )}
              aria-label={activeBackgroundVideo ? "Add background" : "Upload background"}
              title={activeBackgroundVideo ? "Add background" : "Upload background"}
            >
              <span className={cn(
                "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
              )}>
                Upload Background
              </span>
              +
            </button>
            {activeBackgroundVideo && (
              <button
                onClick={() => { playClickSound(); void removeBackgroundVideo() }}
                className={cn(
                  "fx-spotlight-card fx-border-glow h-8 px-3 rounded-md border text-xs font-medium transition-all duration-150 hover:-translate-y-px active:translate-y-0",
                  isLight
                    ? "border-red-300/70 bg-red-100 text-red-700 hover:bg-red-200 hover:border-red-400"
                    : "border-red-400/50 bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:border-red-300/70",
                )}
              >
                Remove Selected
              </button>
            )}
          </div>
        </div>
        {backgroundVideoError && <p className="text-xs text-red-400 mt-2">{backgroundVideoError}</p>}
      </div>

      {/* Spotlight Effects */}
      <SettingToggle
        label="Spotlight Effects"
        description="Enable cursor spotlight and glow hover effects"
        checked={settings.app.spotlightEnabled}
        onChange={(v) => updateApp("spotlightEnabled", v)}
        isLight={isLight}
      />

      {/* Spotlight Color */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Spotlight Color</p>
        <p className={cn("text-xs mb-4", isLight ? "text-s-30" : "text-slate-500")}>Choose the cursor spotlight color</p>
        <div className="flex gap-3 flex-wrap">
          {(Object.keys(ORB_COLORS) as OrbColor[]).map((color) => {
            const pal = ORB_COLORS[color]
            const isSelected = settings.app.spotlightColor === color
            return (
              <button
                key={`spotlight-${color}`}
                onClick={() => { playClickSound(); updateApp("spotlightColor", color) }}
                className={cn(
                  "fx-spotlight-card fx-border-glow w-10 h-10 rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  isSelected ? "border-accent-30" : isLight ? "border-[#d5dce8] hover:border-white/30" : "border-white/10 hover:border-white/20"
                )}
                style={{ background: `linear-gradient(135deg, ${pal.circle1}, ${pal.circle2})` }}
                title={pal.name}
              >
                {isSelected && (
                  <span className="mx-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20">
                    <Check className="w-3.5 h-3.5 text-accent" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Compact Mode */}
      <SettingToggle
        label="Compact Mode"
        description="Reduce spacing for denser layout"
        checked={settings.app.compactMode}
        onChange={(v) => updateApp("compactMode", v)}
        isLight={isLight}
      />

      {/* Font Size */}
      <SettingSelect
        label="Font Size"
        description="Adjust text size"
        isLight={isLight}
        value={settings.app.fontSize}
        options={[
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ]}
        onChange={(v) => updateApp("fontSize", v)}
      />
    </div>
  )
}
