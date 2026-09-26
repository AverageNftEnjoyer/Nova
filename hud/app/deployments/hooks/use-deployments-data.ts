"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { Deployment, DeploymentRun } from "@/lib/deployments/types"

/** Coalesces a burst of stream events (the stream replays history on connect) into one refetch. */
const REFRESH_DEBOUNCE_MS = 350

export type RunDecision = "approve" | "deny"
export type RunAction = "cancel"

export interface DeploymentsData {
  deployments: Deployment[]
  runs: DeploymentRun[]
  loading: boolean
  error: string
  live: boolean
  busyRunId: string
  refresh: () => Promise<void>
  decide: (runId: string, decision: RunDecision) => Promise<void>
  act: (runId: string, action: RunAction) => Promise<void>
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

export function useDeploymentsData(): DeploymentsData {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [runs, setRuns] = useState<DeploymentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [live, setLive] = useState(false)
  const [busyRunId, setBusyRunId] = useState("")
  const debounceRef = useRef<number | null>(null)

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
      void refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const source = new EventSource("/api/deployment-runs/stream")
    source.onopen = () => setLive(true)
    source.onerror = () => setLive(false)
    // Every event (a new run, a status change, an approval) means the lists changed; keep-alives are comments
    // and never reach onmessage.
    source.onmessage = () => scheduleRefresh()
    return () => {
      window.clearTimeout(initial)
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      source.close()
    }
  }, [refresh, scheduleRefresh])

  const post = useCallback(
    async (runId: string, url: string, body: Record<string, string>) => {
      setBusyRunId(runId)
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await readJson<{ ok?: boolean; error?: string }>(response)
        if (!response.ok || !data.ok) throw new Error(data.error || "The run could not be updated.")
        setError("")
        await refresh()
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "The run could not be updated.")
      } finally {
        setBusyRunId("")
      }
    },
    [refresh],
  )

  const decide = useCallback(
    (runId: string, decision: RunDecision) =>
      post(runId, `/api/deployment-runs/${encodeURIComponent(runId)}/approval`, { decision }),
    [post],
  )
  const act = useCallback(
    (runId: string, action: RunAction) =>
      post(runId, `/api/deployment-runs/${encodeURIComponent(runId)}/action`, { action }),
    [post],
  )

  return useMemo(
    () => ({
      deployments,
      runs,
      loading,
      error,
      live,
      busyRunId,
      refresh,
      decide,
      act,
    }),
    [deployments, runs, loading, error, live, busyRunId, refresh, decide, act],
  )
}
