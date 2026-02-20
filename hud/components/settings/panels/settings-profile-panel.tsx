"use client"

import { useRef } from "react"
import NextImage from "next/image"
import { User, Camera } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"
import {
  SettingInput,
  getSettingsCardClass,
  getSettingsFieldClass,
} from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  avatarError: string | null
  setAvatarError: (e: string | null) => void
  memoryMarkdown: string
  setMemoryMarkdown: (v: string) => void
  setMemoryDirty: (v: boolean) => void
  setMemorySavedAt: (v: number | null) => void
  memoryLoading: boolean
  memorySaving: boolean
  memoryDirty: boolean
  memoryError: string | null
  memorySavedAt: number | null
  loadMemoryMarkdown: () => Promise<void>
  saveMemoryMarkdown: () => Promise<void>
  updateProfile: (key: string, value: string | null) => void
  handleAvatarUpload: (file: File) => Promise<void>
}

export function SettingsProfilePanel({
  isLight,
  settings,
  avatarError,
  setAvatarError,
  memoryMarkdown,
  setMemoryMarkdown,
  setMemoryDirty,
  setMemorySavedAt,
  memoryLoading,
  memorySaving,
  memoryDirty,
  memoryError,
  memorySavedAt,
  loadMemoryMarkdown,
  saveMemoryMarkdown,
  updateProfile,
  handleAvatarUpload,
}: Props) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="space-y-5">
      {/* Avatar */}
      <div className={cn(
        "fx-spotlight-card fx-border-glow flex items-center gap-4 p-4 rounded-xl border transition-colors duration-150",
        isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/20 hover:bg-white/6"
      )}>
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden"
          style={{
            background: `linear-gradient(to bottom right, var(--accent-primary), var(--accent-secondary))`,
            boxShadow: `0 10px 15px -3px rgba(var(--accent-rgb), 0.2)`,
          }}
        >
          {settings.profile.avatar ? (
            <NextImage
              src={settings.profile.avatar}
              alt="Avatar"
              width={56}
              height={56}
              unoptimized
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-7 h-7 text-white" />
          )}
        </div>
        <div className="flex-1">
          <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>Profile Picture</p>
          <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>Upload a custom avatar</p>
          {avatarError && <p className="text-xs text-red-400 mt-1">{avatarError}</p>}
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
              setAvatarError(err instanceof Error ? err.message : "Failed to upload image.")
            } finally {
              inputEl.value = ""
            }
          }}
        />
        <Button
          onClick={() => avatarInputRef.current?.click()}
          variant="outline"
          size="sm"
          className={cn(
            "fx-spotlight-card fx-border-glow gap-2 transition-colors duration-150",
            isLight
              ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
              : "text-slate-400 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10"
          )}
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
        isLight={isLight}
      />

      {/* Memory editor */}
      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-sm", isLight ? "text-s-70" : "text-slate-200")}>Memory</p>
            <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>
              Edit your full <code>MEMORY.md</code> directly. Nova reads this every turn.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void loadMemoryMarkdown()}
              variant="outline"
              size="sm"
              disabled={memoryLoading || memorySaving}
              className={cn(
                "fx-spotlight-card fx-border-glow",
                isLight
                  ? "text-s-50 border-[#d5dce8] hover:border-accent-30 hover:text-accent hover:bg-accent-10"
                  : "text-slate-300 border-white/15 hover:border-accent-30 hover:text-accent hover:bg-accent-10"
              )}
            >
              {memoryLoading ? "Loading..." : "Reload"}
            </Button>
            <Button
              onClick={() => void saveMemoryMarkdown()}
              size="sm"
              disabled={memorySaving || memoryLoading || !memoryDirty}
              className={cn(
                "fx-spotlight-card fx-border-glow border text-white disabled:opacity-60",
                isLight
                  ? "bg-emerald-600 border-emerald-700 hover:bg-emerald-700"
                  : "bg-emerald-500/80 border-emerald-300/60 hover:bg-emerald-500",
              )}
            >
              {memorySaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
        <textarea
          value={memoryMarkdown}
          onChange={(e) => {
            setMemoryMarkdown(e.target.value)
            setMemoryDirty(true)
            setMemorySavedAt(null)
          }}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          rows={12}
          className={cn(getSettingsFieldClass(isLight), "mt-3 min-h-65 font-mono text-xs leading-5")}
          placeholder="# Persistent Memory"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className={cn("text-xs", isLight ? "text-s-30" : "text-slate-500")}>{memoryMarkdown.length} chars</p>
          {memoryError ? (
            <p className="text-xs text-red-400">{memoryError}</p>
          ) : memoryDirty ? (
            <p className={cn("text-xs", isLight ? "text-amber-600" : "text-amber-300")}>Unsaved changes</p>
          ) : memorySavedAt ? (
            <p className={cn("text-xs", isLight ? "text-emerald-600" : "text-emerald-300")}>Saved</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
