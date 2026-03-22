"use client"

import { Loader2, Pencil, Plus, Save, StickyNote, Trash2, X } from "lucide-react"
import { useState, type CSSProperties } from "react"

import { useAccent } from "@/lib/context/accent-context"
import { ACCENT_COLORS } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import { hexToRgba } from "../helpers"
import { useHomeNotes } from "../hooks/use-home-notes"

interface PlaceholderTwoHomeModuleProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties | undefined
  className?: string
}

function formatTimeLabel(value: string): string {
  const ts = Date.parse(String(value || "").trim())
  if (!Number.isFinite(ts)) return "just now"
  const ageMs = Math.max(0, Date.now() - ts)
  if (ageMs < 60_000) return "just now"
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`
  return `${Math.floor(ageMs / 86_400_000)}d ago`
}

type NoteScheme = {
  light: { p1: number; s: number; p2: number; border: number; text: number }
  dark: { p1: number; s: number; p2: number; border: number; text: number }
}

const NOTE_SCHEMES: readonly NoteScheme[] = [
  {
    light: { p1: 0.11, s: 0.06, p2: 0.04, border: 0.34, text: 0.74 },
    dark: { p1: 0.25, s: 0.14, p2: 0.1, border: 0.42, text: 0.76 },
  },
  {
    light: { p1: 0.07, s: 0.12, p2: 0.05, border: 0.33, text: 0.72 },
    dark: { p1: 0.14, s: 0.24, p2: 0.11, border: 0.44, text: 0.78 },
  },
  {
    light: { p1: 0.09, s: 0.09, p2: 0.03, border: 0.31, text: 0.7 },
    dark: { p1: 0.22, s: 0.18, p2: 0.09, border: 0.4, text: 0.74 },
  },
  {
    light: { p1: 0.05, s: 0.1, p2: 0.08, border: 0.32, text: 0.73 },
    dark: { p1: 0.16, s: 0.22, p2: 0.14, border: 0.43, text: 0.77 },
  },
]

function hashNoteId(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function resolveNoteColorScheme(noteId: string, isLight: boolean, primary: string, secondary: string) {
  const index = hashNoteId(noteId) % NOTE_SCHEMES.length
  const scheme = isLight ? NOTE_SCHEMES[index].light : NOTE_SCHEMES[index].dark
  const borderHex = index % 2 === 0 ? primary : secondary
  return {
    cardStyle: {
      background: `linear-gradient(145deg, ${hexToRgba(primary, scheme.p1)} 0%, ${hexToRgba(secondary, scheme.s)} 58%, ${hexToRgba(primary, scheme.p2)} 100%)`,
      borderColor: hexToRgba(borderHex, scheme.border),
    } satisfies CSSProperties,
    timeStyle: {
      color: hexToRgba(borderHex, scheme.text),
    } satisfies CSSProperties,
    textareaStyle: {
      borderColor: hexToRgba(borderHex, Math.min(0.6, scheme.border + 0.18)),
    } satisfies CSSProperties,
  }
}

export function PlaceholderTwoHomeModule({
  isLight,
  panelClass,
  subPanelClass,
  panelStyle,
  className,
}: PlaceholderTwoHomeModuleProps) {
  const { accentColor } = useAccent()
  const accent = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.violet

  const {
    notes,
    notesLoading,
    notesError,
    createNote,
    updateNote,
    deleteNote,
  } = useHomeNotes()

  const [draft, setDraft] = useState("")
  const [editingId, setEditingId] = useState("")
  const [editingDraft, setEditingDraft] = useState("")
  const [actionBusyId, setActionBusyId] = useState("")
  const [localError, setLocalError] = useState("")

  const handleCreate = async () => {
    const text = draft.trim()
    if (!text) return
    setActionBusyId("create")
    setLocalError("")
    const result = await createNote(text)
    setActionBusyId("")
    if (!result.ok) {
      setLocalError(result.error)
      return
    }
    setDraft("")
  }

  const beginEdit = (id: string, content: string) => {
    setEditingId(id)
    setEditingDraft(content)
    setLocalError("")
  }

  const cancelEdit = () => {
    setEditingId("")
    setEditingDraft("")
  }

  const handleSaveEdit = async (id: string) => {
    const text = editingDraft.trim()
    if (!text) {
      setLocalError("Note content is required.")
      return
    }
    setActionBusyId(`update:${id}`)
    const result = await updateNote(id, text)
    setActionBusyId("")
    if (!result.ok) {
      setLocalError(result.error)
      return
    }
    setEditingId("")
    setEditingDraft("")
  }

  const handleDelete = async (id: string) => {
    setActionBusyId(`delete:${id}`)
    const result = await deleteNote(id)
    setActionBusyId("")
    if (!result.ok) {
      setLocalError(result.error)
      return
    }
    if (editingId === id) {
      setEditingId("")
      setEditingDraft("")
    }
  }

  return (
    <section style={panelStyle} className={cn(panelClass, "home-spotlight-shell px-3 py-2.5 flex flex-col min-h-0", className)}>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 text-s-80">
        <div className="flex items-center gap-2 text-s-80">
          <StickyNote className="w-4 h-4 text-accent" />
        </div>
        <h2 className={cn("min-w-0 text-center text-sm uppercase tracking-[0.16em] font-semibold whitespace-nowrap", isLight ? "text-s-90" : "text-slate-200")}>
          Notes
        </h2>
        <div className="h-7 w-7" aria-hidden="true" />
      </div>

      <div className="mt-2 flex flex-col min-h-0 gap-2.5">
        <div
          className={cn(
            "home-spotlight-card home-border-glow flex h-8 items-center rounded-md border px-1.5",
            subPanelClass,
          )}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleCreate()
              }
            }}
            maxLength={400}
            placeholder="Add a note..."
            className={cn(
              "h-full flex-1 bg-transparent px-1 text-[12px] outline-none",
              isLight ? "text-s-90 placeholder:text-s-40" : "text-slate-100 placeholder:text-slate-500",
            )}
          />
          <button
            onClick={handleCreate}
            disabled={actionBusyId === "create" || draft.trim().length === 0}
            className={cn(
              "h-full px-2 inline-flex items-center justify-center transition-colors disabled:opacity-50",
              isLight ? "text-s-70 hover:text-s-90" : "text-slate-300 hover:text-slate-100",
            )}
            aria-label="Add note"
            title="Add note"
          >
            {actionBusyId === "create" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className={cn("w-3.5 h-3.5", isLight ? "text-s-70" : "text-slate-300")} />
            )}
          </button>
        </div>

        {localError || notesError ? (
          <p className={cn("text-[11px] leading-4", isLight ? "text-[#a53b3b]" : "text-rose-300")}>{localError || notesError}</p>
        ) : null}

        <div className="module-hover-scroll no-scrollbar flex-1 min-h-0 overflow-y-auto pr-0.5">
          {notesLoading && notes.length === 0 ? (
            <div className="h-full min-h-20 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-s-50" />
            </div>
          ) : null}

          {!notesLoading && notes.length === 0 ? (
            <p className={cn("text-[11px] leading-5", isLight ? "text-s-50" : "text-slate-400")}>
              No notes yet. Try: "Nova note down I need to see mom this week".
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pb-1">
            {notes.map((note) => {
            const isEditing = editingId === note.id
            const isUpdating = actionBusyId === `update:${note.id}`
            const isDeleting = actionBusyId === `delete:${note.id}`
            const noteScheme = resolveNoteColorScheme(note.id, isLight, accent.primary, accent.secondary)

            return (
              <div
                key={note.id}
                style={noteScheme.cardStyle}
                className={cn(
                  "home-spotlight-card home-border-glow rounded-xl border px-2.5 py-2.5 shadow-sm transition-colors",
                  isLight
                    ? "border-[#cad6e8] bg-[#f5f8fc] text-s-80"
                    : "border-white/10 bg-[#151c2b] text-slate-200",
                )}
              >
                {isEditing ? (
                  <textarea
                    value={editingDraft}
                    onChange={(event) => setEditingDraft(event.target.value)}
                    rows={2}
                    maxLength={400}
                    style={noteScheme.textareaStyle}
                    className={cn(
                      "w-full rounded-md border px-2 py-1 text-[12px] leading-5 bg-transparent resize-none outline-none",
                      isLight ? "text-s-90" : "text-slate-100",
                    )}
                  />
                ) : (
                  <p className="text-[12px] leading-5 whitespace-pre-wrap break-words">{note.content}</p>
                )}

                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p style={noteScheme.timeStyle} className="text-[9px] uppercase tracking-[0.1em]">
                    {formatTimeLabel(note.updatedAt)}
                  </p>

                  <div className="inline-flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => void handleSaveEdit(note.id)}
                          disabled={isUpdating}
                          className={cn(
                            "home-spotlight-card home-border-glow home-spotlight-card--hover h-6 w-6 rounded-md border inline-flex items-center justify-center",
                            subPanelClass,
                          )}
                          title="Save note"
                          aria-label="Save note"
                        >
                          {isUpdating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className={cn(
                            "home-spotlight-card home-border-glow home-spotlight-card--hover h-6 w-6 rounded-md border inline-flex items-center justify-center",
                            subPanelClass,
                          )}
                          title="Cancel edit"
                          aria-label="Cancel edit"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => beginEdit(note.id, note.content)}
                        className={cn(
                          "home-spotlight-card home-border-glow home-spotlight-card--hover h-6 w-6 rounded-md border inline-flex items-center justify-center",
                          subPanelClass,
                        )}
                        title="Edit note"
                        aria-label="Edit note"
                      >
                        <Pencil className={cn("w-3 h-3", isLight ? "text-s-70" : "text-slate-300")} />
                      </button>
                    )}

                    <button
                      onClick={() => void handleDelete(note.id)}
                      disabled={isDeleting}
                      className={cn(
                        "home-spotlight-card home-border-glow home-spotlight-card--hover h-6 w-6 rounded-md border inline-flex items-center justify-center",
                        subPanelClass,
                      )}
                      title="Delete note"
                      aria-label="Delete note"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className={cn("w-3 h-3", isLight ? "text-s-70" : "text-slate-300")} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>
    </section>
  )
}

