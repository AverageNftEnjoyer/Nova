"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"

export type HomeNote = {
  id: string
  content: string
  createdAt: string
  updatedAt: string
  createdBy: "manual" | "nova"
  updatedBy: "manual" | "nova"
  conversationId?: string
}

type NotesApiResponse = {
  ok?: boolean
  error?: unknown
  notes?: unknown
  note?: unknown
  id?: unknown
}

// Notes change rarely and local mutations/focus/visibility return already trigger a refresh,
// so the background poll is deliberately slow.
const POLL_INTERVAL_MS = 30_000
// Minimum gap between refreshes triggered by focus/visibility events.
const FOREGROUND_REFRESH_MIN_GAP_MS = 2_000

function notesSignature(notes: HomeNote[]): string {
  return notes.map((note) => `${note.id}${note.updatedAt}${note.content}`).join("")
}

function normalizeSource(value: unknown): "manual" | "nova" {
  return String(value || "").trim().toLowerCase() === "nova" ? "nova" : "manual"
}

function normalizeNote(value: unknown): HomeNote | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null
  if (!raw) return null
  const id = String(raw.id || "").trim()
  const content = String(raw.content || "").trim()
  if (!id || !content) return null

  return {
    id,
    content,
    createdAt: String(raw.createdAt || "").trim(),
    updatedAt: String(raw.updatedAt || "").trim(),
    createdBy: normalizeSource(raw.createdBy),
    updatedBy: normalizeSource(raw.updatedBy),
    ...(String(raw.conversationId || "").trim() ? { conversationId: String(raw.conversationId || "").trim() } : {}),
  }
}

function normalizeNotes(value: unknown): HomeNote[] {
  if (!Array.isArray(value)) return []
  return value
    .map((note) => normalizeNote(note))
    .filter((note): note is HomeNote => Boolean(note))
}

function normalizeError(value: unknown): string {
  const message = String(value || "").trim()
  return message || "Request failed."
}

async function parseResponse(res: Response): Promise<NotesApiResponse> {
  try {
    return (await res.json()) as NotesApiResponse
  } catch {
    return { ok: false, error: `HTTP ${res.status}` }
  }
}

export function useHomeNotes() {
  const [notes, setNotes] = useState<HomeNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshNotes = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/home/notes", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      })
      const data = await parseResponse(res)
      if (!res.ok || !data?.ok) {
        throw new Error(normalizeError(data?.error || "Failed to load notes."))
      }
      const next = normalizeNotes(data.notes)
      // Keep the same array identity when nothing changed to avoid re-rendering consumers.
      setNotes((current) => (notesSignature(current) === notesSignature(next) ? current : next))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notes.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const createNote = useCallback(async (content: string) => {
    const normalized = String(content || "").replace(/\s+/g, " ").trim().slice(0, 400)
    if (!normalized) {
      return { ok: false as const, error: "Note content is required." }
    }

    try {
      const res = await fetch("/api/home/notes", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: normalized, source: "manual" }),
      })
      const data = await parseResponse(res)
      if (!res.ok || !data?.ok) {
        return { ok: false as const, error: normalizeError(data?.error || "Failed to create note.") }
      }
      const note = normalizeNote(data.note)
      if (!note) {
        return { ok: false as const, error: "Invalid note response." }
      }
      setNotes((current) => [note, ...current.filter((entry) => entry.id !== note.id)])
      setError(null)
      void refreshNotes(true)
      return { ok: true as const, note }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Failed to create note." }
    }
  }, [refreshNotes])

  const updateNote = useCallback(async (id: string, content: string) => {
    const normalizedId = String(id || "").trim()
    const normalizedContent = String(content || "").replace(/\s+/g, " ").trim().slice(0, 400)
    if (!normalizedId) {
      return { ok: false as const, error: "Note id is required." }
    }
    if (!normalizedContent) {
      return { ok: false as const, error: "Note content is required." }
    }

    try {
      const res = await fetch("/api/home/notes", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: normalizedId, content: normalizedContent, source: "manual" }),
      })
      const data = await parseResponse(res)
      if (!res.ok || !data?.ok) {
        return { ok: false as const, error: normalizeError(data?.error || "Failed to update note.") }
      }
      const note = normalizeNote(data.note)
      if (!note) {
        return { ok: false as const, error: "Invalid note response." }
      }
      setNotes((current) => [note, ...current.filter((entry) => entry.id !== note.id)])
      setError(null)
      void refreshNotes(true)
      return { ok: true as const, note }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Failed to update note." }
    }
  }, [refreshNotes])

  const deleteNote = useCallback(async (id: string) => {
    const normalizedId = String(id || "").trim()
    if (!normalizedId) {
      return { ok: false as const, error: "Note id is required." }
    }

    try {
      const res = await fetch("/api/home/notes", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: normalizedId }),
      })
      const data = await parseResponse(res)
      if (!res.ok || !data?.ok) {
        return { ok: false as const, error: normalizeError(data?.error || "Failed to delete note.") }
      }
      setNotes((current) => current.filter((entry) => entry.id !== normalizedId))
      setError(null)
      void refreshNotes(true)
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Failed to delete note." }
    }
  }, [refreshNotes])

  useEffect(() => {
    void refreshNotes(false)
  }, [refreshNotes])

  useEffect(() => {
    const handleActiveUserChanged = () => {
      setNotes([])
      setError(null)
      setLoading(true)
      void refreshNotes(false)
    }
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
    return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, handleActiveUserChanged as EventListener)
  }, [refreshNotes])

  const lastRefreshAtRef = useRef(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }

    const runRefresh = async () => {
      lastRefreshAtRef.current = Date.now()
      await refreshNotes(true)
    }

    const schedule = () => {
      clearTimer()
      // Hidden page: park the poll; the visibility/focus handler restarts it.
      if (stopped || document.visibilityState !== "visible") return
      timer = setTimeout(async () => {
        if (stopped) return
        if (document.visibilityState === "visible") {
          await runRefresh()
        }
        schedule()
      }, POLL_INTERVAL_MS)
    }

    // Returning to the page (visibility or window focus): refresh once (deduped), then resume polling.
    const resumeOnForeground = () => {
      if (stopped || document.visibilityState !== "visible") return
      if (Date.now() - lastRefreshAtRef.current >= FOREGROUND_REFRESH_MIN_GAP_MS) {
        void runRefresh()
      }
      schedule()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeOnForeground()
      } else {
        clearTimer()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", resumeOnForeground)
    schedule()
    return () => {
      stopped = true
      clearTimer()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", resumeOnForeground)
    }
  }, [refreshNotes])

  return {
    notes,
    notesLoading: loading,
    notesError: error,
    refreshNotes: () => refreshNotes(false),
    createNote,
    updateNote,
    deleteNote,
  }
}

