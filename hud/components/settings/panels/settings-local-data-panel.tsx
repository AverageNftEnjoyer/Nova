"use client"

import { useState } from "react"
import { Lock } from "lucide-react"
import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
} from "@/components/ui"
import { SettingRow, SettingsGroup } from "@/components/settings/settings-primitives"
import { discardPendingUiStorageEdits } from "@/lib/settings/ui-storage/client"
import { LOCAL_DATA_DELETE_CONFIRMATION, type LocalDataDeleteRequest } from "@/lib/shared/local-data-delete"
import { useTheme } from "@/lib/context/theme-context"
import { useAccent } from "@/lib/context/accent-context"
import type { UserSettings } from "@/lib/settings/userSettings"

interface Props {
  /** Puts every user setting back to its default (use-settings-state). */
  onReset: () => UserSettings
}

/** Where the data directory is (src/db/paths.js resolveDataDir), in resolution order. */
const DATA_DIR_RULES = [
  { label: "Override", path: "NOVA_DATA_DIR", hint: "When this environment variable is set, it wins." },
  { label: "Installed app", path: "%APPDATA%\\Nova", hint: "Never inside the install folder, so updates keep your data." },
  { label: "Development", path: "<repo>\\.user", hint: "When Nova runs from a source checkout." },
] as const

const DATA_DIR_CONTENTS = [
  { path: "nova.db", text: "Chats, tasks, missions, integrations, usage and settings" },
  { path: "keys\\master.key.dpapi", text: "The key that encrypts your API keys, locked to your Windows account" },
  { path: "user-context\\", text: "SOUL, USER, AGENTS and MEMORY.md, skills and logs" },
  { path: "memory.db", text: "The agent memory index" },
] as const

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
    throw new Error(typeof data?.error === "string" && data.error.trim() ? data.error : "Local data was not deleted.")
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

export function SettingsLocalDataPanel({ onReset }: Props) {
  const { setThemeSetting } = useTheme()
  const { setAccentColor } = useAccent()
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const confirmed = confirmText.trim() === LOCAL_DATA_DELETE_CONFIRMATION

  const resetSettings = () => {
    const fresh = onReset()
    setThemeSetting(fresh.app.theme)
    setAccentColor(fresh.app.accentColor)
    setResetOpen(false)
    toast.success("Settings reset to defaults")
  }

  const openDelete = () => {
    setConfirmText("")
    setError("")
    setDeleteOpen(true)
  }

  const handleDelete = async () => {
    if (!confirmed || busy) return
    setBusy(true)
    setError("")
    try {
      await deleteAllLocalData()
      window.location.replace("/home")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Local data was not deleted.")
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup
        title="Data folder"
        description="Nova has no account and no cloud sync. Everything stays in one folder on this PC, chosen in this order."
      >
        {DATA_DIR_RULES.map((rule) => (
          <div key={rule.label} className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-4 py-2.5">
            <span className="text-sm text-muted">{rule.label}</span>
            <span className="min-w-0">
              <code className="block truncate font-mono text-xs text-fg">{rule.path}</code>
              <span className="text-xs text-faint">{rule.hint}</span>
            </span>
          </div>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Inside the folder">
        {DATA_DIR_CONTENTS.map((item) => (
          <div key={item.path} className="grid grid-cols-[12rem_minmax(0,1fr)] items-baseline gap-4 py-2.5">
            <code className="truncate font-mono text-xs text-fg">{item.path}</code>
            <span className="text-xs text-muted">{item.text}</span>
          </div>
        ))}
        <div className="flex items-start gap-2 py-2.5 text-xs text-muted">
          <Lock aria-hidden className="mt-px size-3.5 shrink-0 text-faint" />
          <span>
            API keys and tokens are encrypted with Windows DPAPI. A copied database or backup cannot be read on another Windows
            account; back up <code className="font-mono">nova.db</code> and <code className="font-mono">keys</code> together.
          </span>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Reset and delete">
        <SettingRow
          label="Reset settings"
          hint="Profile, personalization, appearance, audio and notification settings go back to their defaults. Chats, tasks and keys are kept."
        >
          <Button variant="secondary" size="sm" onClick={() => setResetOpen(true)}>
            Reset settings
          </Button>
        </SettingRow>
        <SettingRow label="Delete all local data" hint="Wipes your profile from the data folder and starts fresh. This cannot be undone.">
          <Button variant="danger" size="sm" onClick={openDelete}>
            Delete all data
          </Button>
        </SettingRow>
      </SettingsGroup>

      <Dialog open={resetOpen} onOpenChange={setResetOpen} size="sm">
        <DialogHeader>
          <DialogTitle>Reset settings?</DialogTitle>
          <DialogDescription>
            Your name, photo, personalization, theme, accent, sounds and hints go back to their defaults. Chats, tasks, integrations
            and MEMORY.md are not touched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={resetSettings}>
            Reset settings
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => (busy ? undefined : setDeleteOpen(open))} size="md" dismissible={!busy}>
        <DialogHeader hideClose={busy}>
          <DialogTitle>Delete all local data?</DialogTitle>
          <DialogDescription>Running agent tasks are stopped first. This permanently deletes:</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-fg marker:text-faint">
            {DELETED_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Field
            className="mt-5"
            label={
              <>
                Type <code className="font-mono text-danger">{LOCAL_DATA_DELETE_CONFIRMATION}</code> to confirm
              </>
            }
            error={error || undefined}
          >
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleDelete()
              }}
              data-autofocus
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              mono
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={() => void handleDelete()} disabled={!confirmed} loading={busy}>
            Delete everything
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
