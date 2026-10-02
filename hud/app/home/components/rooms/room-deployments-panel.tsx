"use client"

import { isRunActive, runNeedsReview, type DeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import type { DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"

const STATUS_LABEL: Record<DeploymentRunStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  dead: "Dead",
}

const STATUS_TONE: Record<DeploymentRunStatus, string> = {
  pending: "pixel-label--common",
  queued: "pixel-label--common",
  running: "pixel-label--ok",
  paused: "pixel-label--rare",
  succeeded: "pixel-label--ok",
  failed: "pixel-label--rare",
  cancelled: "pixel-label--off",
  dead: "pixel-label--off",
}

const RECENT_RUNS = 8

function runTime(run: DeploymentRun): string {
  const iso = run.finishedAt ?? run.startedAt ?? run.createdAt
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

interface RoomDeploymentsPanelProps {
  deployments: DeploymentsData
  onNewDeployment: () => void
  onPrefetchDeployment?: () => void
  onOpenDeployments: () => void
}

/** The Depot: deployments on the road (the boats in the harbour), recent runs, and the way to launch a new one. */
export function RoomDeploymentsPanel({ deployments, onNewDeployment, onPrefetchDeployment, onOpenDeployments }: RoomDeploymentsPanelProps) {
  const { runs, loading, error } = deployments
  const active = runs.filter(isRunActive).length
  const review = runs.filter(runNeedsReview).length
  const titleOf = new Map(deployments.deployments.map((deployment) => [deployment.id, deployment.title]))
  const recent = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT_RUNS)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="room-card room-stat">
          <span className="room-card-value tabular-nums">{active}</span>
          <span className="pixel-label pixel-label--off">On the road</span>
        </span>
        <span className="room-card room-stat">
          <span className="room-card-value tabular-nums">{review}</span>
          <span className="pixel-label pixel-label--off">Need review</span>
        </span>
        <span className="room-card room-stat">
          <span className="room-card-value tabular-nums">{deployments.deployments.length}</span>
          <span className="pixel-label pixel-label--off">Deployments</span>
        </span>
        <span className="ml-auto flex gap-2">
          <button type="button" className="pixel-btn pixel-btn--teal" onClick={onNewDeployment} onPointerEnter={onPrefetchDeployment} onFocus={onPrefetchDeployment}>
            New deployment
          </button>
          <button type="button" className="pixel-btn pixel-btn--ghost" onClick={onOpenDeployments}>
            All runs
          </button>
        </span>
      </div>

      {error ? <p className="game-error font-pixel text-[14px]">{error}</p> : null}

      <ul className="room-list min-h-0 flex-1 overflow-y-auto" aria-label="Recent runs">
        {loading && runs.length === 0 ? (
          <li className="font-pixel text-[14px] text-(--px-muted)">Loading runs...</li>
        ) : recent.length === 0 ? (
          <li className="font-pixel text-[14px] text-(--px-muted)">No runs yet. Launch a deployment and its boat sails from this pier.</li>
        ) : (
          recent.map((run) => (
            <li key={run.id} className="pixel-card flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-pixel text-[14px] text-(--px-text)">{titleOf.get(run.deploymentId) ?? "Deployment"}</span>
              <span className="shrink-0 font-pixel text-[12px] tabular-nums text-(--px-muted)">{runTime(run)}</span>
              <span className={`pixel-label shrink-0 ${runNeedsReview(run) ? "pixel-label--rare" : STATUS_TONE[run.status]}`}>
                {runNeedsReview(run) ? "Review" : STATUS_LABEL[run.status]}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
