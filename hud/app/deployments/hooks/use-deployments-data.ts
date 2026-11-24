"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import type { Deployment, DeploymentEvent, DeploymentRun, DeploymentStatus } from "@/lib/deployments/types"

/** Coalesces a burst of stream events (the stream replays history on connect) into one refetch. */
const REFRESH_DEBOUNCE_MS = 350
/** Newest deployment events kept in memory for run timelines. */
const EVENT_LIMIT = 2_000

export type RunDecision = "approve" | "deny"
/** `/api/deployment-runs/:id/action`; pause/resume only apply to runs backed by an agent task. */
export type RunAction = "cancel" | "pause" | "resume"

export type ActionResult = { ok: true } | { ok: false; error: string }
export type LaunchResult = { ok: true; run: DeploymentRun; reviewRequired: boolean } | { ok: false; error: string }

export interface DeploymentsData {
  deployments: Deployment[]
  runs: DeploymentRun[]
  /** Replayed + live `deployment_events`, oldest first (bounded). */
  events: DeploymentEvent[]
  loading: boolean
  /** Load error only; actions resolve to their own result. */
  error: string
  live: boolean
  busyRunId: string
  refresh: () => Promise<void>
  decide: (runId: string, decision: RunDecision) => Promise<ActionResult>
  act: (runId: string, action: RunAction) => Promise<ActionResult>
  raiseBudget: (runId: string, input: RaiseAgentTaskBudgetInput) => Promise<ActionResult>
  /** Starts a new run of a deployment (one that needs review comes back paused, waiting for approval). */
  runDeployment: (deploymentId: string) => Promise<LaunchResult>
  setDeploymentStatus: (deployment: Deployment, status: DeploymentStatus) => Promise<ActionResult>
}

/** A run paused before launch because its plan requires review (no task or job exists yet). */
export function runNeedsReview(run: DeploymentRun): boolean {
  return run.status === "paused" && !run.agentTaskId && !run.jobRunId
}

export function isRunActive(run: DeploymentRun): boolean {
  return run.status === "pending" || run.status === "queued" || run.status === "running" || run.status === "paused"
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error && error.message ? error.message : fallback }
}

export function useDeploymentsData(): DeploymentsData {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [runs, setRuns] = useState<DeploymentRun[]>([])
  const [events, setEvents] = useState<DeploymentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [live, setLive] = useState(false)
  const [busyRunId, setBusyRunId] = useState("")
  const debounceRef = useRef<number | null>(null)
  const pendingEventsRef = useRef<DeploymentEvent[]>([])

  const refresh = useCallback(async () => {
    try {
      // Both lists are independent: fetch them in parallel, never one after the other.
      const [deploymentsResponse, runsResponse] = await Promise.all([
        fetch("/api/deployments", { cache: "no-store" }),
        fetch("/api/deployment-runs", { cache: "no-store" }),
      ])
      const [deploymentsData, runsData] = await Promise.all([
        readJson<{ deployments?: Deployment[]; error?: string }>(deploymentsResponse),
        readJson<{ runs?: DeploymentRun[]; error?: string }>(runsResponse),
      ])
      if (!deploymentsResponse.ok || !runsResponse.ok) {
        throw new Error(deploymentsData.error || runsData.error || "Could not load deployments.")
      }
      setDeployments(Array.isArray(deploymentsData.deployments) ? deploymentsData.deployments : [])
      setRuns(Array.isArray(runsData.runs) ? runsData.runs : [])
      setError("")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load deployments.")
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      const batch = pendingEventsRef.current
      pendingEventsRef.current = []
      if (batch.length > 0) {
        setEvents((current) => {
          const lastSeq = current.length > 0 ? current[current.length - 1].seq : 0
          const fresh = batch.filter((event) => event.seq > lastSeq)
          if (fresh.length === 0) return current
          const next = [...current, ...fresh]
          return next.length > EVENT_LIMIT ? next.slice(next.length - EVENT_LIMIT) : next
        })
      }
      void refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    // The stream replays every stored event on connect, then follows new ones; EventSource reconnects with
    // Last-Event-ID when the server closes it (every ~25s), so nothing is delivered twice.
    const source = new EventSource("/api/deployment-runs/stream")
    source.onopen = () => setLive(true)
    source.onerror = () => setLive(false)
    // Every event (a new run, a status change, an approval) means the lists changed; keep-alives are comments
    // and never reach onmessage.
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as DeploymentEvent
        if (typeof event?.seq === "number") pendingEventsRef.current.push(event)
      } catch {
        // A malformed frame still means something changed; the refetch below corrects the lists.
      }
      scheduleRefresh()
    }
    return () => {
      window.clearTimeout(initial)
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      source.close()
    }
  }, [refresh, scheduleRefresh])

  const post = useCallback(
    async (runId: string, url: string, body: Record<string, unknown>, fallback: string): Promise<ActionResult> => {
      setBusyRunId(runId)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await readJson<{ ok?: boolean; error?: string }>(response)
        if (!response.ok || !data.ok) throw new Error(data.error || fallback)
        await refresh()
        return { ok: true }
      } catch (actionError) {
        return failure(actionError, fallback)
      } finally {
        setBusyRunId("")
      }
    },
    [refresh],
  )

  const decide = useCallback(
    (runId: string, decision: RunDecision) =>
      post(runId, `/api/deployment-runs/${encodeURIComponent(runId)}/approval`, { decision }, "The run could not be updated."),
    [post],
  )
  const act = useCallback(
    (runId: string, action: RunAction) =>
      post(runId, `/api/deployment-runs/${encodeURIComponent(runId)}/action`, { action }, "The run could not be updated."),
    [post],
  )
  const raiseBudget = useCallback(
    (runId: string, input: RaiseAgentTaskBudgetInput) =>
      post(runId, `/api/deployment-runs/${encodeURIComponent(runId)}/budget`, { ...input }, "The budget could not be raised."),
    [post],
  )

  const runDeployment = useCallback(
    async (deploymentId: string): Promise<LaunchResult> => {
      try {
        const response = await fetch("/api/deployment-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deploymentId, idempotencyKey: crypto.randomUUID() }),
        })
        const data = await readJson<{ ok?: boolean; run?: DeploymentRun; outcome?: string; error?: string }>(response)
        if (!response.ok || !data.ok || !data.run) throw new Error(data.error || "The deployment could not be started.")
        await refresh()
        return { ok: true, run: data.run, reviewRequired: data.outcome === "review_required" }
      } catch (launchError) {
        return failure(launchError, "The deployment could not be started.")
      }
    },
    [refresh],
  )

  const setDeploymentStatus = useCallback(
    async (deployment: Deployment, status: DeploymentStatus): Promise<ActionResult> => {
      try {
        const response = await fetch("/api/deployments", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: deployment.id, expectedRevision: deployment.revision, status }),
        })
        const data = await readJson<{ ok?: boolean; error?: string }>(response)
        if (!response.ok || !data.ok) throw new Error(data.error || "The deployment could not be updated.")
        await refresh()
        return { ok: true }
      } catch (updateError) {
        return failure(updateError, "The deployment could not be updated.")
      }
    },
    [refresh],
  )

  return useMemo(
    () => ({
      deployments,
      runs,
      events,
      loading,
      error,
      live,
      busyRunId,
      refresh,
      decide,
      act,
      raiseBudget,
      runDeployment,
      setDeploymentStatus,
    }),
    [deployments, runs, events, loading, error, live, busyRunId, refresh, decide, act, raiseBudget, runDeployment, setDeploymentStatus],
  )
}
