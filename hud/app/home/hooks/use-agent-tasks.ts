"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { computeTaskStats } from "@/lib/agents/task-stats"
import type {
  AgentTask,
  AgentTaskEvent,
  AgentTaskStats,
  AgentTaskStatus,
  AgentTaskUiAction,
  CreateAgentTaskInput,
} from "@/lib/agents/types"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { notifyTaskComplete } from "@/lib/notifications/native-notify"

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

type TasksApiResponse = {
  ok?: boolean
  error?: unknown
  tasks?: unknown
  task?: unknown
}

type StreamMessage = { type: "snapshot"; tasks: unknown } | AgentTaskEvent

const TASKS_URL = "/api/agent-tasks"
const STREAM_URL = "/api/agent-tasks/stream"
const POLL_INTERVAL_MS = 6_000
const STREAM_RETRY_MS = 30_000
const STATUSES: readonly AgentTaskStatus[] = ["queued", "running", "paused", "completed", "failed", "cancelled"]

function normalizeTask(value: unknown): AgentTask | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null
  if (!raw) return null
  const id = String(raw.id || "").trim()
  const status = STATUSES.find((candidate) => candidate === raw.status)
  if (!id || !status || !String(raw.createdAt || "").trim()) return null
  return { ...(raw as unknown as AgentTask), id, status }
}

function normalizeTasks(value: unknown): AgentTask[] {
  if (!Array.isArray(value)) return []
  return sortNewestFirst(value.map(normalizeTask).filter((task): task is AgentTask => Boolean(task)))
}

function sortNewestFirst(tasks: AgentTask[]): AgentTask[] {
  return tasks.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

// Ignores an event older than what is already held (buffered stream events can trail a snapshot).
function upsertTask(current: AgentTask[], incoming: AgentTask): AgentTask[] {
  const existing = current.find((task) => task.id === incoming.id)
  if (existing && Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt)) return current
  return sortNewestFirst([incoming, ...current.filter((task) => task.id !== incoming.id)])
}

function normalizeError(value: unknown, fallback: string): string {
  const message = String(value || "").trim()
  return message || fallback
}

async function parseResponse(res: Response): Promise<TasksApiResponse> {
  try {
    return (await res.json()) as TasksApiResponse
  } catch {
    return { ok: false, error: `HTTP ${res.status}` }
  }
}

export function useAgentTasks(): {
  tasks: AgentTask[]
  stats: AgentTaskStats | null
  loading: boolean
  error: string | null
  connection: "live" | "polling"
  refresh: () => Promise<void>
  createTask: (input: CreateAgentTaskInput) => Promise<Result<{ task: AgentTask }>>
  runAction: (id: string, action: AgentTaskUiAction) => Promise<Result>
} {
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connection, setConnection] = useState<"live" | "polling">("polling")
  const [userEpoch, setUserEpoch] = useState(0)

  // Bumped whenever fresher data lands (stream or local mutation) so a slower in-flight GET cannot overwrite it.
  const freshnessRef = useRef(0)

  const applyUpsert = useCallback((task: AgentTask) => {
    freshnessRef.current += 1
    setTasks((current) => upsertTask(current, task))
  }, [])

  const applyRemove = useCallback((id: string) => {
    freshnessRef.current += 1
    setTasks((current) => current.filter((task) => task.id !== id))
  }, [])

  const refresh = useCallback(async () => {
    const startedAt = freshnessRef.current
    try {
      const res = await fetch(TASKS_URL, { method: "GET", cache: "no-store", credentials: "include" })
      const data = await parseResponse(res)
      if (!res.ok || !data?.ok) throw new Error(normalizeError(data?.error, "Failed to load tasks."))
      if (freshnessRef.current === startedAt) setTasks(normalizeTasks(data.tasks))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const onUserChanged = () => setUserEpoch((value) => value + 1)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onUserChanged)
    return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onUserChanged)
  }, [])

  useEffect(() => {
    let disposed = false
    let source: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    freshnessRef.current += 1
    setTasks([])
    setLoading(true)
    setError(null)

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }

    const startPolling = () => {
      setConnection("polling")
      if (pollTimer) return
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh()
      }, POLL_INTERVAL_MS)
    }

    const handleMessage = (message: StreamMessage) => {
      if (message.type === "snapshot") {
        freshnessRef.current += 1
        setTasks(normalizeTasks(message.tasks))
        setLoading(false)
        setError(null)
        setConnection("live")
        stopPolling()
        return
      }
      if (message.type === "task.upserted") {
        const task = normalizeTask(message.task)
        if (task) applyUpsert(task)
        return
      }
      if (message.type === "task.deleted") applyRemove(String(message.id || ""))
    }

    const connect = () => {
      retryTimer = null
      if (disposed) return
      if (typeof EventSource === "undefined") {
        startPolling()
        return
      }
      const es = new EventSource(STREAM_URL, { withCredentials: true })
      source = es
      es.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data) as StreamMessage)
        } catch {
          // Ignore a malformed frame; the next event or snapshot corrects state.
        }
      }
      es.onerror = () => {
        es.close()
        if (source === es) source = null
        if (disposed) return
        startPolling()
        if (!retryTimer) retryTimer = setTimeout(connect, STREAM_RETRY_MS)
      }
    }

    void refresh()
    connect()

    return () => {
      disposed = true
      source?.close()
      stopPolling()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [applyRemove, applyUpsert, refresh, userEpoch])

  const createTask = useCallback(
    async (input: CreateAgentTaskInput): Promise<Result<{ task: AgentTask }>> => {
      try {
        const res = await fetch(TASKS_URL, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
        const data = await parseResponse(res)
        if (!res.ok || !data?.ok) return { ok: false, error: normalizeError(data?.error, "Failed to create task.") }
        const task = normalizeTask(data.task)
        if (!task) return { ok: false, error: "Invalid task response." }
        applyUpsert(task)
        setError(null)
        return { ok: true, task }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create task." }
      }
    },
    [applyUpsert],
  )

  const runAction = useCallback(
    async (id: string, action: AgentTaskUiAction): Promise<Result> => {
      try {
        const res = await fetch(TASKS_URL, {
          method: action === "delete" ? "DELETE" : "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action === "delete" ? { id } : { id, action }),
        })
        const data = await parseResponse(res)
        if (!res.ok || !data?.ok) return { ok: false, error: normalizeError(data?.error, "Task action failed.") }
        if (action === "delete") {
          applyRemove(id)
        } else {
          const task = normalizeTask(data.task)
          if (task) applyUpsert(task)
        }
        setError(null)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Task action failed." }
      }
    },
    [applyRemove, applyUpsert],
  )

  const stats = useMemo(() => (loading ? null : computeTaskStats(tasks)), [loading, tasks])

  // Track task completion and send native notifications
  const taskStatusRef = useRef<Map<string, AgentTaskStatus>>(new Map())

  useEffect(() => {
    tasks.forEach((task) => {
      const previousStatus = taskStatusRef.current.get(task.id)
      const currentStatus = task.status

      // Only notify on status transitions to completed/failed (not on initial load)
      if (previousStatus && previousStatus !== currentStatus) {
        if (currentStatus === "completed" || currentStatus === "failed") {
          void notifyTaskComplete(task.name || task.prompt.slice(0, 50), currentStatus === "completed")
        }
      }

      taskStatusRef.current.set(task.id, currentStatus)
    })
  }, [tasks])

  return { tasks, stats, loading, error, connection, refresh, createTask, runAction }
}
