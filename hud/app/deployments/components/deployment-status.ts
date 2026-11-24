import type { Deployment, DeploymentRun } from "@/lib/deployments/types"

export const DEPLOYMENT_KIND_LABEL: Record<Deployment["kind"], string> = { task: "Task", automation: "Automation" }

export const DEPLOYMENT_STATUS_META: Record<Deployment["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready: { label: "Ready", tone: "info" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Deleted", tone: "neutral" },
}

/** Latest run per deployment id. */
export function latestRunByDeployment(runs: DeploymentRun[]): Map<string, DeploymentRun> {
  const latest = new Map<string, DeploymentRun>()
  for (const run of runs) {
    const current = latest.get(run.deploymentId)
    if (!current || run.createdAt > current.createdAt) latest.set(run.deploymentId, run)
  }
  return latest
}
