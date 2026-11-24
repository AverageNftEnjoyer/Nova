"use client"

import { useState } from "react"
import NextImage from "next/image"
import { HardDrive, ChevronRight, Trash2, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"
import { getSettingsCardClass, getSettingsFieldClass, playClickSound } from "@/components/settings/settings-primitives"
import { discardPendingUiStorageEdits } from "@/lib/settings/ui-storage/client"
import { LOCAL_DATA_DELETE_CONFIRMATION, type LocalDataDeleteRequest } from "@/lib/shared/local-data-delete"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  isLight: boolean
  settings: UserSettings
  onNavigateToProfile: () => void
}

// What POST /api/account/delete removes (purgeLocalUserData + user-context/ and agent-task-files/ folders).
const DELETED_ITEMS = [
  "Chats, sessions and notes",
  "Missions, deployments, agent tasks and all their run history and files",
  "Integration connections and saved API keys",
  "LLM usage and cost history",
  "Settings, profile and background media",
  "Workspace files: SOUL, USER, AGENTS and MEMORY.md, skills and agent memory",
] as const

async function deleteAllLocalData(): Promise<void> {
  const body: LocalDataDeleteRequest = { confirm: LOCAL_DATA_DELETE_CONFIRMATION }
  const res = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown } | null
  if (!res.ok || data?.ok !== true) {
    throw new Error(typeof data?.error === "string" && data.error.trim() ? data.error : "Failed to delete local data.")
  }
  // The server copy is gone: drop this window's cached settings and queued edits so they are not uploaded again.
  discardPendingUiStorageEdits()
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Storage blocked: nothing cached to clear.
  }
}

export function SettingsLocalDataPanel({ isLight, settings, onNavigateToProfile }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const confirmed = confirmText.trim() === LOCAL_DATA_DELETE_CONFIRMATION
  const mutedText = isLight ? "text-s-40" : "text-slate-500"
  const bodyText = isLight ? "text-s-60" : "text-slate-300"
  const titleText = isLight ? "text-s-70" : "text-slate-200"

  const openModal = () => {
    playClickSound()
    setConfirmText("")
    setError("")
    setModalOpen(true)
  }

  const closeModal = () => {
    if (busy) return
    setModalOpen(false)
  }

  const handleDelete = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError("")
    try {
      await deleteAllLocalData()
      window.location.replace("/home")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to delete local data.")
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Profile */}
      <button
        type="button"
        onClick={() => { playClickSound(); onNavigateToProfile() }}
        className={cn(getSettingsCardClass(isLight), "w-full flex items-center gap-3 p-4 text-left")}
      >
        <div
          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center overflow-hidden"
          style={{ background: "linear-gradient(to bottom right, var(--accent-primary), var(--accent-secondary))" }}
        >
          {settings.profile.avatar ? (
            <NextImage src={settings.profile.avatar} alt="Avatar" width={40} height={40} unoptimized className="w-full h-full object-cover" />
          ) : (
            <User className="w-5 h-5 text-white" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", titleText)}>{settings.profile.name || "User"}</p>
          <p className={cn("text-xs", mutedText)}>Local profile. Edit your name and photo in Profile.</p>
        </div>
        <ChevronRight className={cn("w-4 h-4 shrink-0", mutedText)} />
      </button>

      {/* Where data lives */}
      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <div className="flex items-center gap-3 mb-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            isLight ? "bg-accent-15 border border-accent-20" : "bg-accent-20 border border-accent-30",
          )}>
            <HardDrive className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className={cn("text-sm", titleText)}>Runs on this PC</p>
            <p className={cn("text-xs", mutedText)}>No account, no sign-in, no cloud sync</p>
          </div>
        </div>
        <p className={cn("text-xs leading-5", bodyText)}>
          Everything Nova stores stays in its data folder on this computer:{" "}
          <span className="font-mono">%APPDATA%\Nova</span> for the installed app (a <span className="font-mono">.user</span> folder
          in the repository during development, or <span className="font-mono">NOVA_DATA_DIR</span> when set).
          API keys and tokens are encrypted with Windows DPAPI for your Windows account.
        </p>
      </div>

      {/* Danger zone */}
      <div className={cn(getSettingsCardClass(isLight), "p-4")}>
        <p className={cn("text-sm mb-1", titleText)}>Delete all local data</p>
        <p className={cn("text-xs mb-3", mutedText)}>
          Wipes this profile from Nova&apos;s data folder and starts over with a fresh one. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={openModal}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors duration-150 fx-spotlight-card fx-border-glow border text-sm",
            isLight ? "bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700" : "bg-rose-500/10 border-rose-400/30 hover:bg-rose-500/15 text-rose-300",
          )}
        >
          <Trash2 className="w-4 h-4" />
          Delete all local data
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="local-data-delete-title"
        >
          <div className={cn(
            "w-105 max-w-[calc(100vw-2rem)] rounded-2xl border p-4",
            isLight ? "border-rose-200 bg-white/95" : "border-rose-400/35 bg-[#1a0f14]/90 backdrop-blur-xl",
          )}>
            <h4 id="local-data-delete-title" className={cn("text-sm font-medium", isLight ? "text-rose-700" : "text-rose-200")}>
              Delete all local data?
            </h4>
            <p className={cn("mt-1 text-xs", isLight ? "text-rose-600" : "text-rose-300")}>
              Running agent tasks are stopped first. This permanently deletes:
            </p>
            <ul className={cn("mt-2 space-y-1 text-xs list-disc pl-4", isLight ? "text-s-60" : "text-slate-300")}>
              {DELETED_ITEMS.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <label className="mt-4 block">
              <span className={cn("mb-1.5 block text-xs", isLight ? "text-rose-600" : "text-rose-300")}>
                Type <span className="font-mono font-semibold">{LOCAL_DATA_DELETE_CONFIRMATION}</span> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleDelete() }}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                className={getSettingsFieldClass(isLight)}
              />
            </label>
            {error && <p className={cn("mt-2 text-xs", isLight ? "text-rose-700" : "text-rose-300")}>{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={closeModal}
                disabled={busy}
                className={cn(isLight ? "text-s-50" : "text-slate-300")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleDelete()}
                disabled={!confirmed || busy}
                className={cn(
                  "border",
                  isLight ? "bg-rose-600 hover:bg-rose-700 text-white border-rose-700" : "bg-rose-600/85 hover:bg-rose-600 text-white border-rose-400/50",
                )}
              >
                {busy ? "Deleting..." : "Delete everything"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
