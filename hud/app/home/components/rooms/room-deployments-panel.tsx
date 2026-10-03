"use client"

import { isRunActive, runNeedsReview, type DeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import type { Deployment, DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"

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

/** Hologram tag tone per run status (CSS: .holo-tag[data-tone]). */
const HOLO_TONE: Record<DeploymentRunStatus, "ok" | "live" | "review" | "bad" | "off"> = {
  pending: "live",
  queued: "live",
  running: "live",
  paused: "review",
  succeeded: "ok",
  failed: "bad",
  cancelled: "off",
  dead: "bad",
}

function runTime(run: DeploymentRun): string {
  const iso = run.finishedAt ?? run.startedAt ?? run.createdAt
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

interface RoomDeploymentsPanelProps {
  deployments: DeploymentsData
  /** "runs": the recent runs; "deployments": every deployment with its latest run. */
  view: "runs" | "deployments"
  /** "holo" draws on an immersive stage's hologram screen (the New deployment action is the painted portal there). */
  variant: "window" | "holo"
  /** A line about what just happened ("Task queued."), shown above the runs. */
  notice?: string
  onNewDeployment: () => void
  onPrefetchDeployment?: () => void
  onOpenDeployments: () => void
}

const RECENT_RUNS = 8
const RECENT_RUNS_HOLO = 30
const KIND_LABEL: Record<Deployment["kind"], string> = { task: "Task", automation: "Automation" }
const DEPLOYMENT_STATUS_LABEL: Record<Deployment["status"], string> = { draft: "Draft", ready: "Ready", active: "Active", paused: "Paused", archived: "Archived" }

/** The Depot: deployments out on the water (the boats in the harbour), recent runs, and the way to launch a new one. */
export function RoomDeploymentsPanel({ deployments, view, variant, notice, onNewDeployment, onPrefetchDeployment, onOpenDeployments }: RoomDeploymentsPanelProps) {
  const { runs, loading, error, busyRunId, decide, act } = deployments
  const holo = variant === "holo"
  const active = runs.filter(isRunActive).length
  const review = runs.filter(runNeedsReview).length
  const titleOf = new Map(deployments.deployments.map((deployment) => [deployment.id, deployment.title]))
  const recent = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, holo ? RECENT_RUNS_HOLO : RECENT_RUNS)
  const latestRun = new Map<string, DeploymentRun>()
  for (const run of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latestRun.set(run.deploymentId, run)
  const list = [...deployments.deployments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const stats = [
    { value: active, label: "Boats out" },
    { value: review, label: "Need review" },
    { value: deployments.deployments.length, label: "Deployments" },
  ]

  const statusTag = (run: DeploymentRun) => {
    const needs = runNeedsReview(run)
    return (
      <span className={holo ? "holo-tag" : `pixel-label shrink-0 ${needs ? "pixel-label--rare" : STATUS_TONE[run.status]}`} data-tone={needs ? "review" : HOLO_TONE[run.status]}>
        {needs ? "Review" : STATUS_LABEL[run.status]}
      </span>
    )
  }

  /** The same run actions as the Deployments page: approve or deny a run waiting for review, cancel an active one. */
  const runActions = (run: DeploymentRun) => {
    const busy = busyRunId === run.id
    const buttonClass = holo ? "holo-btn holo-btn--small" : "pixel-btn pixel-btn--ghost"
    if (runNeedsReview(run)) {
      return (
        <span className={holo ? "holo-row-actions" : "flex shrink-0 gap-1"}>
          <button type="button" disabled={busy} className={buttonClass} onClick={() => void decide(run.id, "deny")}>
            Deny
          </button>
          <button type="button" disabled={busy} className={buttonClass} data-primary="true" onClick={() => void decide(run.id, "approve")}>
            {busy ? "Working..." : "Approve and run"}
          </button>
        </span>
      )
    }
    if (isRunActive(run)) {
      return (
        <span className={holo ? "holo-row-actions" : "flex shrink-0 gap-1"}>
          <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(run.id, "cancel")}>
            {busy ? "Working..." : "Cancel run"}
          </button>
        </span>
      )
    }
    return null
  }
  const budgetNote = (run: DeploymentRun) => (run.budgetState && run.budgetState !== "ok" ? `Budget ${run.budgetState}` : "")

  const body =
    view === "runs" ? (
      <ul className={holo ? "holo-list" : "room-list min-h-0 flex-1 overflow-y-auto"} aria-label="Recent runs">
        {loading && runs.length === 0 ? (
          <li className={holo ? "holo-empty" : "font-pixel text-[14px] text-(--px-muted)"}>Loading runs...</li>
        ) : recent.length === 0 ? (
          <li className={holo ? "holo-empty" : "font-pixel text-[14px] text-(--px-muted)"}>
            {holo ? (
              <>
                <strong>No runs yet.</strong> Launch a deployment and its boat sails from this pier.
              </>
            ) : (
              "No runs yet. Launch a deployment and its boat sails from this pier."
            )}
          </li>
        ) : (
          recent.map((run) => (
            <li key={run.id} className={holo ? "holo-row" : "pixel-card flex min-w-0 items-center gap-2"} data-tone={holo ? (runNeedsReview(run) ? "review" : HOLO_TONE[run.status]) : undefined}>
              <span className={holo ? "holo-row-title" : "min-w-0 flex-1 truncate font-pixel text-[14px] text-(--px-text)"}>{titleOf.get(run.deploymentId) ?? "Deployment"}</span>
              <span className={holo ? "holo-row-meta" : "shrink-0 font-pixel text-[12px] tabular-nums text-(--px-muted)"}>
                {[budgetNote(run), runTime(run)].filter(Boolean).join(" · ")}
              </span>
              {statusTag(run)}
              {runActions(run)}
            </li>
          ))
        )}
      </ul>
    ) : (
      <ul className={holo ? "holo-list" : "room-list min-h-0 flex-1 overflow-y-auto"} aria-label="Deployments">
        {loading && list.length === 0 ? (
          <li className={holo ? "holo-empty" : "font-pixel text-[14px] text-(--px-muted)"}>Loading deployments...</li>
        ) : list.length === 0 ? (
          <li className={holo ? "holo-empty" : "font-pixel text-[14px] text-(--px-muted)"}>
            {holo ? <strong>No deployments yet.</strong> : "No deployments yet."} Step on the portal to create the first one.
          </li>
        ) : (
          list.map((deployment) => {
            const latest = latestRun.get(deployment.id)
            return (
              <li key={deployment.id} className={holo ? "holo-row" : "pixel-card flex min-w-0 items-center gap-2"} data-tone={holo ? (latest ? (runNeedsReview(latest) ? "review" : HOLO_TONE[latest.status]) : "off") : undefined}>
                <span className={holo ? "holo-row-title" : "min-w-0 flex-1 truncate font-pixel text-[14px] text-(--px-text)"}>{deployment.title}</span>
                <span className={holo ? "holo-row-meta" : "shrink-0 font-pixel text-[12px] text-(--px-muted)"}>
                  {KIND_LABEL[deployment.kind]} · {DEPLOYMENT_STATUS_LABEL[deployment.status]}
                </span>
                {latest ? statusTag(latest) : <span className={holo ? "holo-tag" : "pixel-label pixel-label--off shrink-0"} data-tone="off">No runs</span>}
              </li>
            )
          })
        )}
      </ul>
    )

  const noticeLine = notice ? (
    <p role="status" className={holo ? "holo-notice" : "font-pixel text-[14px] text-(--px-accent)"}>
      {notice} Its status is below.
    </p>
  ) : null
  const errorLine = error ? <p className={holo ? "holo-error" : "game-error font-pixel text-[14px]"}>{error}</p> : null

  if (holo) {
    return (
      <div className="holo-panel-body">
        <div className="holo-stats">
          {stats.map((stat) => (
            <span key={stat.label} className="holo-stat">
              <span className="holo-stat-value tabular-nums">{stat.value}</span>
              <span className="holo-stat-label">{stat.label}</span>
            </span>
          ))}
          <button type="button" className="holo-btn holo-stats-link" onClick={onOpenDeployments}>
            All runs
          </button>
        </div>
        {errorLine}
        {noticeLine}
        {body}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {stats.map((stat) => (
          <span key={stat.label} className="room-card room-stat">
            <span className="room-card-value tabular-nums">{stat.value}</span>
            <span className="pixel-label pixel-label--off">{stat.label}</span>
          </span>
        ))}
        <span className="ml-auto flex gap-2">
          <button type="button" className="pixel-btn pixel-btn--teal" onClick={onNewDeployment} onPointerEnter={onPrefetchDeployment} onFocus={onPrefetchDeployment}>
            New deployment
          </button>
          <button type="button" className="pixel-btn pixel-btn--ghost" onClick={onOpenDeployments}>
            All runs
          </button>
        </span>
      </div>
      {errorLine}
      {noticeLine}
      {body}
    </div>
  )
}
