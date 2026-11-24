"use client"

import Link from "next/link"
import { Plus, Rocket } from "lucide-react"

import { Badge, Button, EmptyState, Panel, SkeletonRows, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import { NEW_DEPLOYMENT_HREF } from "@/components/shell"
import { runNeedsReview, type DeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import type { Deployment, DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"
import { formatRelative, formatUpcoming } from "../format"

interface HomeDeploymentsProps {
  deployments: DeploymentsData
  /** missionId -> next scheduled start (ISO), from the calendar. */
  nextMissionRun: ReadonlyMap<string, string>
  now: number
}

const LIMIT = 5

const KIND_LABEL: Record<Deployment["kind"], string> = { task: "Task", automation: "Automation" }

type Tone = "neutral" | "accent" | "success" | "warning" | "danger"

const RUN_BADGE: Record<DeploymentRunStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "accent" },
  paused: { label: "Paused", tone: "warning" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  dead: { label: "Dead", tone: "danger" },
}

function latestRunBadge(run: DeploymentRun): { label: string; tone: Tone } {
  return runNeedsReview(run) ? { label: "Review", tone: "warning" } : RUN_BADGE[run.status]
}

/** The five most recently updated deployments with their latest run and, for automations, the next scheduled run. */
export function HomeDeployments({ deployments, nextMissionRun, now }: HomeDeploymentsProps) {
  const { runs, loading, error, refresh } = deployments
  const latestRun = new Map<string, DeploymentRun>()
  for (const run of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) latestRun.set(run.deploymentId, run)
  const recent = deployments.deployments
    .filter((deployment) => deployment.status !== "archived")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, LIMIT)

  return (
    <Panel
      title="Recent deployments"
      icon={<Rocket />}
      flush
      actions={
        <>
          <Button asChild size="sm" variant="ghost">
            <Link href="/deployments">All deployments</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={NEW_DEPLOYMENT_HREF}>
              <Plus />
              New deployment
            </Link>
          </Button>
        </>
      }
    >
      {error && recent.length === 0 ? (
        <EmptyState
          size="compact"
          tone="danger"
          title="Could not load deployments"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : loading && recent.length === 0 ? (
        <SkeletonRows rows={3} className="px-1 py-1" />
      ) : recent.length === 0 ? (
        <EmptyState
          size="compact"
          title="No deployments yet"
          description="A deployment is a task or a scheduled automation Nova runs for you. Describe one above and choose Deploy as task."
        />
      ) : (
        <Table density="compact" aria-label="Recent deployments">
          <THead>
            <tr>
              <Th>Name</Th>
              <Th className="w-28">Kind</Th>
              <Th className="w-44">Latest run</Th>
              <Th className="w-36">Next run</Th>
            </tr>
          </THead>
          <TBody>
            {recent.map((deployment) => {
              const latest = latestRun.get(deployment.id)
              const badge = latest ? latestRunBadge(latest) : null
              const next = deployment.kind === "automation" && deployment.missionId ? nextMissionRun.get(deployment.missionId) : undefined
              return (
                <Tr key={deployment.id}>
                  <Td className="max-w-0 truncate">
                    <Link
                      href={latest ? `/runs?run=${encodeURIComponent(latest.id)}` : "/deployments"}
                      className="text-fg hover:underline"
                      title={deployment.title}
                    >
                      {deployment.title}
                    </Link>
                  </Td>
                  <Td muted>{deployment.status === "draft" ? `${KIND_LABEL[deployment.kind]} draft` : KIND_LABEL[deployment.kind]}</Td>
                  <Td>
                    {latest && badge ? (
                      <span className="flex items-center gap-2">
                        <Badge tone={badge.tone} dot={latest.status === "running" ? "pulse" : undefined}>
                          {badge.label}
                        </Badge>
                        <span className="font-mono text-xs tabular-nums text-faint">
                          {formatRelative(latest.finishedAt ?? latest.startedAt ?? latest.createdAt, now)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-faint">Not run yet</span>
                    )}
                  </Td>
                  <Td mono muted>
                    {next ? formatUpcoming(next, now) : <span className="font-sans text-faint">{deployment.kind === "automation" ? "None this week" : ""}</span>}
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
      )}
    </Panel>
  )
}
