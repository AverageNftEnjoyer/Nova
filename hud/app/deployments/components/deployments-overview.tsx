"use client"

import { Boxes, History, Layers, Loader2, RefreshCw, Workflow } from "lucide-react"
import { useMemo, type CSSProperties } from "react"

import type { Deployment, DeploymentRun } from "@/lib/deployments/types"
import { cn } from "@/lib/shared/utils"
import { isRunActive, runNeedsReview, type DeploymentsData } from "../hooks/use-deployments-data"
import { DeploymentStatusChip, formatRelativeTime, PanelHeader, RunStatusChip } from "./deployment-ui"

const RUN_LIMIT = 30

interface OverviewProps {
  isLight: boolean
  panelClass: string
  subPanelClass: string
  panelStyle: CSSProperties
  data: DeploymentsData
}

function KindIcon({ kind, className }: { kind: Deployment["kind"]; className?: string }) {
  const Icon = kind === "automation" ? Workflow : Boxes
  return <Icon className={className} aria-hidden="true" />
}

export function DeploymentsOverview({ isLight, panelClass, subPanelClass, panelStyle, data }: OverviewProps) {
  const { deployments, runs, loading, error, live, busyRunId, refresh, decide, act } = data
  const mutedText = isLight ? "text-s-50" : "text-slate-400"
  const strongText = isLight ? "text-s-90" : "text-slate-100"

  const deploymentById = useMemo(() => new Map(deployments.map((deployment) => [deployment.id, deployment])), [deployments])
  const latestRunByDeployment = useMemo(() => {
    const latest = new Map<string, DeploymentRun>()
    // Runs arrive newest first, so the first one seen per deployment is its latest.
    for (const run of runs) if (!latest.has(run.deploymentId)) latest.set(run.deploymentId, run)
    return latest
  }, [runs])
  const recentRuns = runs.slice(0, RUN_LIMIT)

  const iconButtonClass = cn(
    "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
    subPanelClass,
  )
  const actionButtonClass = cn(
    "inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    isLight
      ? "border-[#d5dce8] bg-white text-s-70 hover:text-s-90"
      : "border-white/10 bg-black/25 text-slate-300 hover:text-white",
  )

  const loadingState = (
    <div className={cn("flex flex-1 items-center justify-center gap-2 text-xs", mutedText)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading…
    </div>
  )

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] gap-1.5">
      <section
        style={panelStyle}
        aria-label="Your deployments"
        className={cn(panelClass, "home-spotlight-shell flex min-h-0 flex-col px-3 py-2.5")}
      >
        <PanelHeader
          isLight={isLight}
          icon={<Layers className="h-4 w-4 text-accent" />}
          title="Deployments"
          action={
            <span className={cn("text-[11px] tabular-nums", mutedText)} aria-label={`${deployments.length} deployments`}>
              {loading ? "" : deployments.length}
            </span>
          }
        />
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {loading ? (
            loadingState
          ) : deployments.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
              <Layers className={cn("h-6 w-6", mutedText)} />
              <p className={cn("text-[12px] font-medium", strongText)}>Nothing deployed yet</p>
              <p className={cn("max-w-[16rem] text-[11px] leading-4", mutedText)}>
                Describe an outcome or create a task. Everything you deploy is listed here.
              </p>
            </div>
          ) : (
            <ul className="module-hover-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
              {deployments.map((deployment) => {
                const latest = latestRunByDeployment.get(deployment.id)
                return (
                  <li
                    key={deployment.id}
                    className={cn("flex items-center gap-2.5 rounded-sm px-2.5 py-2 home-spotlight-card home-border-glow", subPanelClass)}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                        isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/25",
                      )}
                      title={deployment.kind === "automation" ? "Automation" : "One-off task"}
                    >
                      <KindIcon kind={deployment.kind} className="h-3.5 w-3.5 text-accent" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-[12px] font-semibold leading-4", strongText)} title={deployment.title}>
                        {deployment.title}
                      </p>
                      <p className={cn("truncate text-[10px] leading-4", mutedText)}>
                        {deployment.kind === "automation" ? "Automation" : "Task"}, updated {formatRelativeTime(deployment.updatedAt)}
                      </p>
                    </div>
                    {latest ? (
                      <RunStatusChip isLight={isLight} status={latest.status} needsReview={runNeedsReview(latest)} />
                    ) : (
                      <DeploymentStatusChip isLight={isLight} status={deployment.status} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        style={panelStyle}
        aria-label="Deployment runs"
        className={cn(panelClass, "home-spotlight-shell flex min-h-0 flex-col px-3 py-2.5")}
      >
        <PanelHeader
          isLight={isLight}
          icon={<History className="h-4 w-4 text-accent" />}
          title={
            <>
              Runs
              <span
                title={live ? "Live updates" : "Reconnecting to live updates"}
                className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500" : "bg-yellow-500")}
              />
            </>
          }
          action={
            <button type="button" onClick={() => void refresh()} className={iconButtonClass} aria-label="Refresh runs" title="Refresh">
              <RefreshCw className={cn("h-3.5 w-3.5", isLight ? "text-s-70" : "text-slate-300")} />
            </button>
          }
        />
        {error ? <p role="alert" className="mt-2 shrink-0 text-[11px] leading-4 text-rose-400">{error}</p> : null}
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {loading ? (
            loadingState
          ) : recentRuns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
              <History className={cn("h-6 w-6", mutedText)} />
              <p className={cn("text-[12px] font-medium", strongText)}>No runs yet</p>
              <p className={cn("max-w-[16rem] text-[11px] leading-4", mutedText)}>
                Each launch appears here with its live status. Runs that need your review wait here too.
              </p>
            </div>
          ) : (
            <ul className="module-hover-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
              {recentRuns.map((run) => {
                const needsReview = runNeedsReview(run)
                const busy = busyRunId === run.id
                const title = deploymentById.get(run.deploymentId)?.title || "Deployment"
                const when = formatRelativeTime(run.finishedAt || run.startedAt || run.createdAt)
                return (
                  <li
                    key={run.id}
                    className={cn(
                      "rounded-sm px-2.5 py-2 home-spotlight-card home-border-glow",
                      subPanelClass,
                      needsReview && (isLight ? "border-amber-300" : "border-amber-400/35"),
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className={cn("min-w-0 flex-1 truncate text-[12px] font-medium leading-4", strongText)} title={title}>
                        {title}
                      </p>
                      <RunStatusChip isLight={isLight} status={run.status} needsReview={needsReview} />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={cn("min-w-0 flex-1 truncate text-[10px] leading-4 tabular-nums", mutedText)}>
                        {when}
                        {run.budgetState && run.budgetState !== "ok" ? `, budget ${run.budgetState}` : ""}
                      </p>
                      {needsReview ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(run.id, "deny")}
                            className={actionButtonClass}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void decide(run.id, "approve")}
                            className={cn(actionButtonClass, "border-accent-30 bg-accent-10", isLight ? "text-s-90" : "text-slate-100")}
                          >
                            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            Approve and run
                          </button>
                        </>
                      ) : isRunActive(run) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(run.id, "cancel")}
                          className={actionButtonClass}
                        >
                          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          Cancel run
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
