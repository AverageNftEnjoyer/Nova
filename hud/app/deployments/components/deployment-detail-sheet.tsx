"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { Badge, Button, Sheet, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import { PERMISSION_MODE_LABELS } from "@/components/agents/permission-modes"
import { formatDateTime, formatRelative, formatUpcoming, formatUsd, formatTokens } from "@/components/agents/run-format"
import type { Deployment, DeploymentRun } from "@/lib/deployments/types"
import { DEPLOYMENT_KIND_LABEL, DEPLOYMENT_STATUS_META } from "./deployment-status"
import { runStatusBadge } from "./run-status"

interface DeploymentDetailSheetProps {
  deployment: Deployment | null
  runs: DeploymentRun[]
  schedule: string
  nextRunAt: string | null
  now: number
  /** Row actions, already wired by the list (Run now, Pause, Edit, Delete). */
  footer: ReactNode
  onClose: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {children}
    </section>
  )
}

/** One deployment: its definition, plan, settings and every run (each links to /runs?run=). */
export function DeploymentDetailSheet({ deployment, runs, schedule, nextRunAt, now, footer, onClose }: DeploymentDetailSheetProps) {
  if (!deployment) return null
  const status = DEPLOYMENT_STATUS_META[deployment.status]
  const { plan, config } = deployment
  const settings: Array<[string, string, boolean?]> = []
  if (config.provider) settings.push(["Provider", config.provider])
  if (config.model) settings.push(["Model", config.model, true])
  if (config.permissionMode) settings.push(["Permission mode", PERMISSION_MODE_LABELS[config.permissionMode]])
  if (config.priority) settings.push(["Priority", config.priority])
  settings.push(["Cost budget", typeof config.costBudgetUsd === "number" ? formatUsd(config.costBudgetUsd) : "Default", true])
  if (typeof config.tokenBudget === "number") settings.push(["Token budget", formatTokens(config.tokenBudget), true])
  if (config.useWorktree) settings.push(["Worktree", "Isolated git worktree"])
  settings.push(["Created", formatDateTime(deployment.createdAt)], ["Updated", formatDateTime(deployment.updatedAt)], ["ID", deployment.id, true])

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()} title={deployment.title} description={deployment.outcome} size="lg" footer={footer}>
      <div className="flex flex-col gap-6 px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Badge variant="outline">{DEPLOYMENT_KIND_LABEL[deployment.kind]}</Badge>
          <Badge variant="outline" mono>{`v${deployment.revision}`}</Badge>
        </div>

        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Schedule</dt>
          <dd className="text-fg">{deployment.kind === "task" ? "Runs once when launched" : schedule}</dd>
          {nextRunAt ? (
            <>
              <dt className="text-muted">Next run</dt>
              <dd className="font-mono text-xs leading-5 text-fg">{formatUpcoming(nextRunAt, now)}</dd>
            </>
          ) : null}
          {settings.map(([label, value, mono]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className={mono ? "min-w-0 break-all font-mono text-xs leading-5 text-fg" : "min-w-0 text-fg"}>{value}</dd>
            </div>
          ))}
        </dl>

        {plan ? (
          <Section title="Plan">
            <p className="text-sm text-muted">
              {plan.risk[0].toUpperCase() + plan.risk.slice(1)} risk, {plan.reviewRequired ? "review required before each run" : "no review needed"}
              {plan.budgetEstimate.costUsd !== null ? `, estimated about ${formatUsd(plan.budgetEstimate.costUsd)}` : ""}.
            </p>
            {plan.acceptanceCriteria.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg">
                {plan.acceptanceCriteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            ) : null}
            {plan.tools.length > 0 || plan.specialists.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {[...plan.specialists, ...plan.tools].map((entry) => (
                  <Badge key={entry} mono variant="outline">
                    {entry}
                  </Badge>
                ))}
              </div>
            ) : null}
            {plan.rationale ? <p className="text-xs text-muted">{plan.rationale}</p> : null}
          </Section>
        ) : null}

        <Section title={`Runs (${runs.length})`}>
          {runs.length === 0 ? (
            <p className="text-sm text-muted">No runs yet. Use Run now to start one.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table density="compact" aria-label="Runs of this deployment">
                <THead>
                  <tr>
                    <Th>Status</Th>
                    <Th>Started</Th>
                    <Th>Revision</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {runs.map((run) => {
                    const badge = runStatusBadge(run)
                    return (
                      <Tr key={run.id}>
                        <Td>
                          <Badge tone={badge.tone} dot={badge.live ? "pulse" : true}>
                            {badge.label}
                          </Badge>
                        </Td>
                        <Td mono muted title={formatDateTime(run.startedAt ?? run.createdAt)}>
                          {formatRelative(run.startedAt ?? run.createdAt, now)}
                        </Td>
                        <Td mono muted>{`v${run.deploymentRevision}`}</Td>
                        <Td className="text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/runs?run=${encodeURIComponent(run.id)}`}>Open run</Link>
                          </Button>
                        </Td>
                      </Tr>
                    )
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </Section>
      </div>
    </Sheet>
  )
}
