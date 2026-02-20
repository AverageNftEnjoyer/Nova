"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { FluidSelect } from "@/components/ui/fluid-select"
import { cn } from "@/lib/shared/utils"
import { SettingToggle, getSettingsCardClass, playClickSound } from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"
import type { BootMusicAssetMeta } from "@/lib/media/bootMusicStorage"

interface Props {
  isLight: boolean
  settings: UserSettings
  updateApp: (key: string, value: boolean | string | null) => void
  bootMusicAssets: BootMusicAssetMeta[]
  activeBootMusicAssetId: string | null
  bootMusicError: string | null
  setBootMusicError: (e: string | null) => void
  handleBootMusicUpload: (file: File) => Promise<void>
  removeBootMusic: () => Promise<void>
  selectBootMusicAsset: (id: string | null) => void
}

const NONE_OPTION = "__none__"

export function SettingsBootupPanel({
  isLight,
  settings,
  updateApp,
  bootMusicAssets,
  activeBootMusicAssetId,
  bootMusicError,
  setBootMusicError,
  handleBootMusicUpload,
  removeBootMusic,
  selectBootMusicAsset,
}: Props) {
  const bootMusicInputRef = useRef<HTMLInputElement | null>(null)

  const activeBootMusic = bootMusicAssets.find((a) => a.id === (activeBootMusicAssetId || settings.app.bootMusicAssetId)) ?? null
  const bootMusicOptions = [
    { value: NONE_OPTION, label: "None" },
    ...bootMusicAssets.map((a) => ({ value: a.id, label: a.fileName })),
  ]

  return (
    <div className="space-y-5">
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150 mb-4",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>
          Configure Nova startup behavior. This section is dedicated to boot experience settings.
        </p>
      </div>

      <SettingToggle
        label="Boot Animation"
        description="Show startup sequence on launch"
        checked={settings.app.bootAnimationEnabled}
        onChange={(v) => updateApp("bootAnimationEnabled", v)}
        isLight={isLight}
      />

      <SettingToggle
        label="Bootup Music"
        description="Enable custom boot music on launch"
        checked={settings.app.bootMusicEnabled}
        onChange={(v) => updateApp("bootMusicEnabled", v)}
        isLight={isLight}
      />

      <SettingToggle
        label="Extended Bootup Music"
        description="Play full track once on launch (otherwise capped to 30 seconds)"
        checked={settings.app.extendedBootMusicEnabled}
        onChange={(v) => updateApp("extendedBootMusicEnabled", v)}
        isLight={isLight}
      />

      {/* Boot music library */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>Bootup Music</p>
        <p className={cn("text-xs mb-3", isLight ? "text-s-30" : "text-slate-500")}>
          {settings.app.extendedBootMusicEnabled
            ? "Plays the full selected track once on launch."
            : "Plays the first 30 seconds on launch."} Upload once, switch anytime.
        </p>
        <input
          ref={bootMusicInputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={async (e) => {
            const inputEl = e.currentTarget
            const file = e.target.files?.[0]
            if (!file) return
            try {
              await handleBootMusicUpload(file)
            } catch (err) {
              setBootMusicError(err instanceof Error ? err.message : "Failed to upload boot music.")
            } finally {
              inputEl.value = ""
            }
          }}
        />
        <div className="mb-3">
          <FluidSelect
            value={activeBootMusic?.id ?? NONE_OPTION}
            isLight={isLight}
            options={bootMusicOptions}
            onChange={(v) => {
              playClickSound()
              selectBootMusicAsset(v === NONE_OPTION ? null : v)
            }}
          />
        </div>
        <div className={cn(
          "flex items-center gap-2 rounded-lg border p-1.5 max-w-140 mx-auto",
          isLight ? "bg-white border-[#d5dce8]" : "bg-black/25 border-white/10"
        )}>
          <div className={cn(
            "flex-1 px-3 py-2 rounded-md text-sm border",
            isLight ? "bg-white text-s-50 border-[#d5dce8]" : "bg-black/20 text-slate-400 border-white/10"
          )}>
            {activeBootMusic?.fileName || "No MP3 selected"}
          </div>
          <button
            onClick={() => { playClickSound(); bootMusicInputRef.current?.click() }}
            className={cn(
              "fx-spotlight-card fx-border-glow group relative h-8 w-8 flex items-center justify-center text-2xl leading-none transition-all duration-150 hover:rotate-12",
              isLight ? "text-s-50" : "text-s-40",
            )}
            aria-label={activeBootMusic ? "Add MP3" : "Upload MP3"}
            title={activeBootMusic ? "Add MP3" : "Upload MP3"}
          >
            <span className={cn(
              "pointer-events-none absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100",
              isLight ? "border border-[#d9e0ea] bg-white text-s-60" : "border border-white/10 bg-[#0e1320] text-slate-300",
            )}>
              Upload MP3
            </span>
            +
          </button>
        </div>
        {activeBootMusic && (
          <div className="mt-2">
            <Button
              onClick={() => { playClickSound(); void removeBootMusic() }}
              variant="outline"
              size="sm"
              className={cn(
                "fx-spotlight-card fx-border-glow transition-colors duration-150",
                isLight
                  ? "text-s-50 border-[#d5dce8] hover:border-red-400 hover:text-red-600 hover:bg-red-50"
                  : "text-slate-400 border-white/15 hover:border-red-500/40 hover:text-red-300 hover:bg-red-500/10"
              )}
            >
              Remove Selected
            </Button>
          </div>
        )}
        {bootMusicError && <p className="text-xs text-red-400 mt-2">{bootMusicError}</p>}
      </div>

      <div className={cn(
        "fx-spotlight-card fx-border-glow p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <p className={cn("text-sm mb-1", isLight ? "text-s-70" : "text-slate-200")}>More Boot Settings</p>
        <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>
          Additional bootup options will appear here as they are added.
        </p>
      </div>
    </div>
  )
}
