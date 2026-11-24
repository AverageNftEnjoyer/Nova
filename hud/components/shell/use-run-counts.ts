"use client"

import { useEffect, useState } from "react"

import { runNeedsReview } from "@/app/deployments/hooks/use-deployments-data"
import type { AgentTask } from "@/lib/agents/types"
import type { DeploymentRun } from "@/lib/deployments/types"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"

/** Light poll: the sidebar only needs rough freshness; the Runs page streams the real thing. */
const POLL_MS = 15_000

export interface RunCounts {
  /** Agent tasks running now, plus automation runs (no agent task) running now. */
  running: number
  /** Deployment runs paused before launch, waiting for the user's approval. */
  awaitingApproval: number
}

async function readList<T>(url: string, key: "tasks" | "runs"): Promise<T[] | null> {
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "include" })
    if (!response.ok) return null
    const data = (await response.json()) as Record<string, unknown>
    const list = data[key]
    return Array.isArray(list) ? (list as T[]) : null
  } catch {
    return null
  }
}

/** Counts for the Runs nav badge. `null` until the first successful load, so nothing is shown before real data. */
export function useRunCounts(): RunCounts | null {
  const [counts, setCounts] = useState<RunCounts | null>(null)

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      if (document.visibilityState !== "visible") return
      const [tasks, runs] = await Promise.all([
        readList<AgentTask>("/api/agent-tasks", "tasks"),
        readList<DeploymentRun>("/api/deployment-runs", "runs"),
      ])
      if (disposed || (!tasks && !runs)) return
      const runningTasks = (tasks ?? []).filter((task) => task.status === "running").length
      const runningAutomations = (runs ?? []).filter((run) => run.status === "running" && !run.agentTaskId).length
      setCounts({
        running: runningTasks + runningAutomations,
        awaitingApproval: (runs ?? []).filter(runNeedsReview).length,
      })
    }

    const onWake = () => void load()
    void load()
    timer = setInterval(() => void load(), POLL_MS)
    window.addEventListener("focus", onWake)
    document.addEventListener("visibilitychange", onWake)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onWake)
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
      window.removeEventListener("focus", onWake)
      document.removeEventListener("visibilitychange", onWake)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onWake)
    }
  }, [])

  return counts
}
