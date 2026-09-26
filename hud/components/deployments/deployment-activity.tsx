"use client"

import { Activity, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import type { Deployment, DeploymentEvent, DeploymentRun } from "@/lib/deployments/types"
import { cn } from "@/lib/shared/utils"

interface DeploymentActivityProps {
  isLight: boolean
}

export function DeploymentActivity({ isLight }: DeploymentActivityProps) {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [runs, setRuns] = useState<DeploymentRun[]>([])
  const [events, setEvents] = useState<DeploymentEvent[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [deploymentsResponse, runsResponse] = await Promise.all([
      fetch("/api/deployments", { cache: "no-store" }),
      fetch("/api/deployment-runs", { cache: "no-store" }),
    ])
    const deploymentsData = (await deploymentsResponse.json()) as { deployments?: Deployment[] }
    const runsData = (await runsResponse.json()) as { runs?: DeploymentRun[] }
    setDeployments(Array.isArray(deploymentsData.deployments) ? deploymentsData.deployments : [])
    setRuns(Array.isArray(runsData.runs) ? runsData.runs : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refresh().catch(() => setLoading(false))
    }, 0)
    const source = new EventSource("/api/deployment-runs/stream")
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as DeploymentEvent
        setEvents((current) => [event, ...current.filter((item) => item.eventId !== event.eventId)].slice(0, 12))
        void refresh()
      } catch {}
    }
    return () => {
      window.clearTimeout(initialRefresh)
      source.close()
    }
  }, [refresh])

  const titleById = new Map(deployments.map((deployment) => [deployment.id, deployment.title]))
  const recentRuns = runs.slice(0, 6)
  const borderClass = isLight ? "border-[#d9e0ea]" : "border-white/10"
  const mutedClass = isLight ? "text-s-50" : "text-slate-400"

  return (
    <section className={cn("rounded-2xl border p-4", borderClass, isLight ? "bg-white" : "bg-[#090d14]/92")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em]">Activity</h2>
        </div>
        <span className={cn("text-xs", mutedClass)}>{deployments.length} deployments</span>
      </div>
      {loading ? (
        <div className={cn("flex items-center gap-2 py-5 text-sm", mutedClass)}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading deployment activity…
        </div>
      ) : recentRuns.length === 0 ? (
        <p className={cn("py-5 text-sm", mutedClass)}>No deployment runs yet.</p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {recentRuns.map((run) => (
            <div key={run.id} className={cn("rounded-xl border px-3 py-2", borderClass)}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{titleById.get(run.deploymentId) || "Deployment"}</p>
                <span className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  run.status === "succeeded"
                    ? "bg-emerald-500"
                    : run.status === "failed" || run.status === "dead"
                      ? "bg-red-500"
                      : run.status === "running"
                        ? "bg-sky-500"
                        : "bg-amber-500",
                )} />
              </div>
              <p className={cn("mt-1 text-xs capitalize", mutedClass)}>{run.status}</p>
            </div>
          ))}
        </div>
      )}
      {events[0] ? (
        <p className={cn("mt-3 truncate text-[11px]", mutedClass)}>
          Latest: {events[0].type.replaceAll(".", " ")}
        </p>
      ) : null}
    </section>
  )
}
