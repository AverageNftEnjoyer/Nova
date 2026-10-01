"use client"

import { useState, type FormEvent } from "react"
import type { ResidentId } from "@/lib/town/residents"
import type { TownResidentsState } from "../../hooks/use-town-residents"

/** Longest resident name the server accepts (MAX_RESIDENT_NAME_LENGTH in lib/town/residents.ts). */
const MAX_NAME_LENGTH = 24

interface ResidentRenameProps {
  residentId: ResidentId
  /** The name the resident has when none is chosen (task name, "<Integration> worker"). */
  defaultName: string
  residents: Pick<TownResidentsState, "names" | "rename">
}

/** Renames one resident. What is saved goes through POST /api/town/residents and the screen shows the server's answer. */
export function ResidentRename({ residentId, defaultName, residents }: ResidentRenameProps) {
  const { names, rename } = residents
  const savedName = names[residentId] ?? ""
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const name = draft ?? savedName
  const trimmed = name.trim()
  const dirty = trimmed !== savedName.trim()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || busy) return
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Names are 1 to ${MAX_NAME_LENGTH} characters.`)
      return
    }
    setBusy(true)
    setError("")
    try {
      const result = await rename({ residentId, name: trimmed || null })
      if (result.ok) setDraft(null)
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pixel-card" aria-label="Rename this resident" aria-busy={busy}>
      <h3 className="pixel-label text-(--px-text)">Name</h3>
      <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`resident-name-${residentId}`}>
          Resident name
        </label>
        <input
          id={`resident-name-${residentId}`}
          type="text"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder={defaultName}
          onChange={(event) => setDraft(event.target.value)}
          className="game-input h-9 min-w-0 flex-1 px-2 font-pixel text-[15px]"
        />
        <button type="submit" disabled={!dirty || busy} className="pixel-btn pixel-btn--teal game-sm">
          Save name
        </button>
      </form>
      <p className="mt-1.5 font-pixel text-[13px] leading-snug text-(--px-muted)">
        1 to {MAX_NAME_LENGTH} characters. Leave it empty to use &quot;{defaultName}&quot;.
      </p>
      {error ? (
        <p className="game-error mt-2 font-pixel text-[14px]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
