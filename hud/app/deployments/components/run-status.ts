import { PHASE_META, type PhaseTone, type RunPhase } from "@/app/runs/lib/run-rows"
import { runNeedsReview } from "@/app/deployments/hooks/use-deployments-data"
import type { DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"

export type RunStatusTone = PhaseTone

const RUN_PHASE: Record<DeploymentRunStatus, RunPhase> = {
  pending: "queued",
  queued: "queued",
  running: "running",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  dead: "failed",
}

/** The label and tone of a deployment run's status (same words as /runs); a run waiting for review reads "Needs review". */
export function runStatusBadge(run: DeploymentRun): { label: string; tone: RunStatusTone; live: boolean } {
  const meta = PHASE_META[runNeedsReview(run) ? "review" : RUN_PHASE[run.status]]
  return { label: meta.label, tone: meta.tone, live: Boolean(meta.live) }
}
