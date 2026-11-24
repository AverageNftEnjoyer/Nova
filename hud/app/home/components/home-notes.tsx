"use client"

import { useState, type FormEvent } from "react"
import { Pencil, Plus, StickyNote, Trash2 } from "lucide-react"

import { Badge, Button, EmptyState, IconButton, Input, Panel, SkeletonRows, Textarea, Tooltip } from "@/components/ui"
import type { HomeNote, HomeNotesState } from "../hooks/use-home-notes"
import { formatRelative } from "../format"

interface HomeNotesProps {
  notesState: HomeNotesState
  now: number
}

const MAX_LENGTH = 400
const COLLAPSED_COUNT = 5

/** Quick notes: add, edit and delete. Nova can also write notes from chat ("Nova, note down ..."). */
export function HomeNotes({ notesState, now }: HomeNotesProps) {
  const { notes, notesLoading, notesError, refreshNotes, createNote, updateNote, deleteNote } = notesState
  const [draft, setDraft] = useState("")
  const [editingId, setEditingId] = useState("")
  const [editingDraft, setEditingDraft] = useState("")
  const [busy, setBusy] = useState("")
  const [localError, setLocalError] = useState("")
  const [expanded, setExpanded] = useState(false)

  const shown = expanded ? notes : notes.slice(0, COLLAPSED_COUNT)

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setBusy("create")
    setLocalError("")
    const result = await createNote(text)
    setBusy("")
    if (!result.ok) return setLocalError(result.error)
    setDraft("")
  }

  const beginEdit = (note: HomeNote) => {
    setEditingId(note.id)
    setEditingDraft(note.content)
    setLocalError("")
  }

  const cancelEdit = () => {
    setEditingId("")
    setEditingDraft("")
  }

  const saveEdit = async (id: string) => {
    const text = editingDraft.trim()
    if (!text) return setLocalError("A note cannot be empty. Delete it instead.")
    setBusy(`update:${id}`)
    const result = await updateNote(id, text)
    setBusy("")
    if (!result.ok) return setLocalError(result.error)
    cancelEdit()
  }

  const remove = async (id: string) => {
    setBusy(`delete:${id}`)
    setLocalError("")
    const result = await deleteNote(id)
    setBusy("")
    if (!result.ok) return setLocalError(result.error)
    if (editingId === id) cancelEdit()
  }

  return (
    <Panel
      title="Notes"
      icon={<StickyNote />}
      flush
      footer={
        notes.length > COLLAPSED_COUNT ? (
          <Button size="xs" variant="link" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer" : `Show all ${notes.length}`}
          </Button>
        ) : undefined
      }
    >
      <form onSubmit={create} className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_LENGTH}
          placeholder="Add a note"
          aria-label="New note"
          className="flex-1"
        />
        <IconButton type="submit" aria-label="Add note" variant="secondary" disabled={!draft.trim()} loading={busy === "create"}>
          <Plus />
        </IconButton>
      </form>

      {localError || (notesError && notes.length > 0) ? (
        <p role="alert" className="border-b border-border-subtle px-4 py-2 text-xs text-danger">
          {localError || notesError}
        </p>
      ) : null}

      {notesError && notes.length === 0 ? (
        <EmptyState
          size="compact"
          tone="danger"
          title="Could not load notes"
          description={notesError}
          action={
            <Button size="sm" variant="outline" onClick={() => void refreshNotes()}>
              Retry
            </Button>
          }
        />
      ) : notesLoading && notes.length === 0 ? (
        <SkeletonRows rows={2} className="px-1 py-1" />
      ) : notes.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">No notes yet. Add one above, or ask Nova in chat to note something down.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {shown.map((note) => {
            const editing = editingId === note.id
            return (
              <li key={note.id} className="group px-4 py-2.5">
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelEdit()
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault()
                          void saveEdit(note.id)
                        }
                      }}
                      autoGrow
                      minRows={2}
                      maxRows={8}
                      maxLength={MAX_LENGTH}
                      aria-label="Edit note"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        Cancel
                      </Button>
                      <Button size="sm" loading={busy === `update:${note.id}`} onClick={() => void saveEdit(note.id)}>
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm text-fg">{note.content}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-faint">
                        <span className="font-mono tabular-nums">{formatRelative(note.updatedAt || note.createdAt, now)}</span>
                        {note.createdBy === "nova" ? <Badge>From chat</Badge> : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                      <Tooltip content="Edit">
                        <IconButton size="sm" aria-label="Edit note" onClick={() => beginEdit(note)}>
                          <Pencil />
                        </IconButton>
                      </Tooltip>
                      <Tooltip content="Delete">
                        <IconButton
                          size="sm"
                          aria-label="Delete note"
                          loading={busy === `delete:${note.id}`}
                          onClick={() => void remove(note.id)}
                        >
                          <Trash2 />
                        </IconButton>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
