"use client"

import { useRef } from "react"
import NextImage from "next/image"
import { Camera } from "lucide-react"
import { Button, Input, Textarea, toast } from "@/components/ui"
import { SettingRow, SettingsGroup, SettingsLoading } from "@/components/settings/settings-primitives"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
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
  loadMemoryMarkdown: () => Promise<void>
  saveMemoryMarkdown: () => Promise<boolean>
  updateProfile: (key: string, value: string | null) => void
  handleAvatarUpload: (file: File) => Promise<void>
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts.length === 1 ? parts[0][0].toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function SettingsProfilePanel({
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
  loadMemoryMarkdown,
  saveMemoryMarkdown,
  updateProfile,
  handleAvatarUpload,
}: Props) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const { avatar, name } = settings.profile

  const saveMemory = async () => {
    if (await saveMemoryMarkdown()) toast.success("MEMORY.md saved")
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup>
        <div className="flex items-center gap-4 py-4">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-3 text-md font-medium text-muted">
            {avatar ? (
              <NextImage src={avatar} alt="Profile photo" width={56} height={56} unoptimized className="size-full object-cover" />
            ) : (
              <span aria-hidden>{initialsOf(name)}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">Profile photo</p>
            <p className={avatarError ? "text-xs text-danger" : "text-xs text-muted"} role={avatarError ? "alert" : undefined}>
              {avatarError ?? "JPG, PNG or WEBP up to 8 MB."}
            </p>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const inputEl = e.currentTarget
              const file = e.target.files?.[0]
              if (!file) return
              try {
                await handleAvatarUpload(file)
              } catch (err) {
                setAvatarError(err instanceof Error ? err.message : "Could not read that image.")
              } finally {
                inputEl.value = ""
              }
            }}
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {avatar ? (
              <Button variant="ghost" size="sm" onClick={() => updateProfile("avatar", null)}>
                Remove
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => avatarInputRef.current?.click()}>
              <Camera />
              {avatar ? "Change photo" : "Upload photo"}
            </Button>
          </div>
        </div>
        <SettingRow label="Display name" hint="How Nova shows you in the app.">
          <Input
            value={name}
            onChange={(e) => updateProfile("name", e.target.value)}
            placeholder="Your name"
            maxLength={60}
            className="w-64"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Memory"
        description={
          <>
            Your <code className="font-mono">MEMORY.md</code>. Nova reads it on every turn, so keep it to facts worth remembering.
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void loadMemoryMarkdown()} disabled={memoryLoading || memorySaving}>
              Reload
            </Button>
            <Button size="sm" onClick={() => void saveMemory()} loading={memorySaving} disabled={memoryLoading || !memoryDirty}>
              Save
            </Button>
          </>
        }
      >
        <div className="py-3">
          {memoryLoading && !memoryMarkdown ? (
            <SettingsLoading label="Loading MEMORY.md" />
          ) : (
            <Textarea
              aria-label="MEMORY.md"
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
              mono
              rows={14}
              className="min-h-64 resize-y leading-5"
              placeholder="# Persistent memory"
            />
          )}
          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-mono tabular-nums text-faint">{memoryMarkdown.length.toLocaleString("en-US")} characters</span>
            {memoryError ? (
              <span className="text-danger" role="alert">
                {memoryError}
              </span>
            ) : memoryDirty ? (
              <span className="text-warning">Unsaved changes</span>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}
