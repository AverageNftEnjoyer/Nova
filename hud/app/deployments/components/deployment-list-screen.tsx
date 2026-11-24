"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MoreHorizontal, Plus } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageHeader,
  Panel,
  SearchInput,
  SkeletonRows,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  toast,
} from "@/components/ui"
import { NEW_DEPLOYMENT_HREF, PageContainer } from "@/components/shell"
import { formatRelative, formatUpcoming } from "@/components/agents/run-format"
import type { Deployment } from "@/lib/deployments/types"
import { useDeploymentSchedules, missionScheduleLabel } from "../hooks/use-deployment-schedules"
import { useDeploymentsData } from "../hooks/use-deployments-data"
import { DeploymentDetailSheet } from "./deployment-detail-sheet"
import { DEPLOYMENT_KIND_LABEL, DEPLOYMENT_STATUS_META, latestRunByDeployment } from "./deployment-status"
import { runStatusBadge } from "./run-status"

type DeploymentCommand = "run" | "pause" | "resume" | "edit" | "delete"

/** /deployments: every deployment with its schedule, state and latest run; actions per row; detail in a sheet. */
export function DeploymentListScreen() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("deployment") ?? ""
  const data = useDeploymentsData()
  const schedules = useDeploymentSchedules()
  const [query, setQuery] = useState("")
  const [showDeleted, setShowDeleted] = useState(false)
  const [busyId, setBusyId] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<Deployment | null>(null)
  const [now] = useState(() => Date.now())

  const latest = useMemo(() => latestRunByDeployment(data.runs), [data.runs])
  const deletedCount = data.deployments.filter((deployment) => deployment.status === "archived").length
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.deployments
      .filter((deployment) => showDeleted || deployment.status !== "archived")
      .filter((deployment) => !needle || deployment.title.toLowerCase().includes(needle) || deployment.outcome.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [data.deployments, query, showDeleted])
  const selected = selectedId ? data.deployments.find((deployment) => deployment.id === selectedId) ?? null : null

  const scheduleOf = useCallback(
    (deployment: Deployment) =>
      deployment.kind === "task" ? "Once" : missionScheduleLabel(deployment.missionId ? schedules.missions.get(deployment.missionId) : undefined),
    [schedules.missions],
  )
  const nextRunOf = (deployment: Deployment): string | null =>
    deployment.kind === "automation" && deployment.status !== "paused" && deployment.status !== "archived" && deployment.missionId
      ? schedules.nextRunAt.get(deployment.missionId) ?? null
      : null

  const commandsFor = (deployment: Deployment): DeploymentCommand[] => {
    if (deployment.status === "archived") return []
    const commands: DeploymentCommand[] = ["run"]
    if (deployment.kind === "automation") commands.push(deployment.status === "paused" ? "resume" : "pause")
    if (deployment.kind === "automation" && deployment.missionId && schedules.missions.has(deployment.missionId)) commands.push("edit")
    commands.push("delete")
    return commands
  }

  const execute = async (deployment: Deployment, command: DeploymentCommand) => {
    if (command === "edit") {
      router.push(`/missions?editId=${encodeURIComponent(deployment.missionId ?? "")}&returnTo=/deployments`)
      return
    }
    if (command === "delete") {
      setConfirmDelete(deployment)
      return
    }
    setBusyId(deployment.id)
    try {
      if (command === "run") {
        const result = await data.runDeployment(deployment.id)
        if (!result.ok) {
          toast.error({ title: "Run did not start", description: result.error })
          return
        }
        toast.success({
          title: result.reviewRequired ? "Waiting for your approval" : "Run started",
          action: { label: "View run", onClick: () => router.push(`/runs?run=${encodeURIComponent(result.run.id)}`) },
        })
        return
      }
      const mission = deployment.missionId ? schedules.missions.get(deployment.missionId) : undefined
      if (mission) {
        const scheduled = await schedules.setMissionStatus(mission, command === "pause" ? "paused" : "active")
        if (!scheduled.ok) {
          toast.error({ title: command === "pause" ? "Could not pause" : "Could not resume", description: scheduled.error })
          return
        }
      }
      const result = await data.setDeploymentStatus(deployment, command === "pause" ? "paused" : "active")
      if (!result.ok) toast.error({ title: command === "pause" ? "Could not pause" : "Could not resume", description: result.error })
      else toast.success(command === "pause" ? "Deployment paused" : "Deployment resumed")
    } finally {
      setBusyId("")
    }
  }

  const deleteDeployment = async (deployment: Deployment) => {
    setConfirmDelete(null)
    setBusyId(deployment.id)
    try {
      const mission = deployment.missionId ? schedules.missions.get(deployment.missionId) : undefined
      if (deployment.kind === "automation" && mission && mission.status === "active") {
        const stopped = await schedules.setMissionStatus(mission, "paused")
        if (!stopped.ok) {
          toast.error({ title: "Could not stop its schedule", description: stopped.error })
          return
        }
      }
      const result = await data.setDeploymentStatus(deployment, "archived")
      if (!result.ok) toast.error({ title: "Could not delete", description: result.error })
      else {
        toast.success("Deployment deleted")
        if (selectedId === deployment.id) router.replace(pathname, { scroll: false })
      }
    } finally {
      setBusyId("")
    }
  }

  const openDeployment = (deployment: Deployment) =>
    router.replace(`${pathname}?deployment=${encodeURIComponent(deployment.id)}`, { scroll: false })

  const COMMAND_LABEL: Record<DeploymentCommand, string> = {
    run: "Run now",
    pause: "Pause schedule",
    resume: "Resume schedule",
    edit: "Edit in Mission builder",
    delete: "Delete",
  }

  const rowMenu = (deployment: Deployment) => {
    const commands = commandsFor(deployment).filter((command) => command !== "run")
    if (commands.length === 0) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`More actions for ${deployment.title}`} size="sm" onClick={(event) => event.stopPropagation()}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {commands.map((command) => (
            <div key={command} className="contents">
              {command === "delete" ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem variant={command === "delete" ? "destructive" : undefined} onSelect={() => void execute(deployment, command)}>
                {COMMAND_LABEL[command]}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const loading = data.loading && data.deployments.length === 0

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Deployments"
        description="One-off tasks and scheduled automations. Run them, pause their schedules, or open their runs."
        actions={
          <Button asChild>
            <Link href={NEW_DEPLOYMENT_HREF}>
              <Plus />
              New deployment
            </Link>
          </Button>
        }
      />

      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2.5">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search deployments" size="sm" containerClassName="w-64" />
          {deletedCount > 0 ? (
            <Checkbox
              checked={showDeleted}
              onCheckedChange={(checked) => setShowDeleted(checked === true)}
              label={`Show deleted (${deletedCount})`}
            />
          ) : null}
          <span className="ml-auto font-mono text-xs tabular-nums text-muted">{list.length} shown</span>
        </div>

        {data.error && data.deployments.length === 0 ? (
          <EmptyState
            tone="danger"
            title="Deployments could not be loaded"
            description={data.error}
            action={
              <Button variant="outline" size="sm" onClick={() => void data.refresh()}>
                Retry
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonRows rows={6} className="p-3" />
        ) : data.deployments.length === 0 ? (
          <EmptyState
            title="No deployments yet"
            description="Describe an outcome, start a one-off task, or build an automation that runs on a schedule."
            action={
              <Button asChild size="sm">
                <Link href={NEW_DEPLOYMENT_HREF}>New deployment</Link>
              </Button>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState size="compact" title="No deployments match" description="Try another search, or show deleted deployments." />
        ) : (
          <Table aria-label="Deployments" stickyHeader className="table-fixed">
            <THead>
              <tr>
                <Th>Name</Th>
                <Th className="w-28">Kind</Th>
                <Th className="w-44">Schedule</Th>
                <Th className="w-24">State</Th>
                <Th className="w-32">Latest run</Th>
                <Th className="w-28">Last run</Th>
                <Th className="hidden w-32 xl:table-cell">Next run</Th>
                <Th className="hidden w-16 xl:table-cell">Version</Th>
                <Th className="w-32">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {list.map((deployment) => {
                const run = latest.get(deployment.id)
                const badge = run ? runStatusBadge(run) : null
                const status = DEPLOYMENT_STATUS_META[deployment.status]
                const next = nextRunOf(deployment)
                const schedule = scheduleOf(deployment)
                return (
                  <Tr key={deployment.id} interactive selected={deployment.id === selectedId} onClick={() => openDeployment(deployment)}>
                    <Td className="truncate">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          openDeployment(deployment)
                        }}
                        title={deployment.outcome}
                        className="max-w-full truncate rounded-sm text-left font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {deployment.title}
                      </button>
                    </Td>
                    <Td muted>{DEPLOYMENT_KIND_LABEL[deployment.kind]}</Td>
                    <Td muted className="truncate" title={schedule}>
                      {schedule}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td>
                      {badge ? (
                        <Badge tone={badge.tone} dot={badge.live ? "pulse" : true}>
                          {badge.label}
                        </Badge>
                      ) : (
                        <span className="text-xs text-faint">No runs</span>
                      )}
                    </Td>
                    <Td mono muted>
                      {run ? formatRelative(run.startedAt ?? run.createdAt, now) : ""}
                    </Td>
                    <Td mono muted className="hidden xl:table-cell">
                      {next ? formatUpcoming(next, now) : <span className="text-faint">-</span>}
                    </Td>
                    <Td mono muted className="hidden xl:table-cell">{`v${deployment.revision}`}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {deployment.status !== "archived" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busyId === deployment.id}
                            disabled={busyId === deployment.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void execute(deployment, "run")
                            }}
                          >
                            Run now
                          </Button>
                        ) : null}
                        {rowMenu(deployment)}
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      {selected ? (
        <DeploymentDetailSheet
          deployment={selected}
          runs={data.runs.filter((run) => run.deploymentId === selected.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
          schedule={scheduleOf(selected)}
          nextRunAt={nextRunOf(selected)}
          now={now}
          onClose={() => router.replace(pathname, { scroll: false })}
          footer={
            commandsFor(selected).length > 0 ? (
              <>
                {commandsFor(selected).includes("delete") ? (
                  <Button variant="ghost" className="mr-auto" onClick={() => void execute(selected, "delete")}>
                    Delete
                  </Button>
                ) : null}
                {commandsFor(selected)
                  .filter((command) => command !== "delete")
                  .map((command) => (
                    <Button
                      key={command}
                      variant={command === "run" ? "primary" : "secondary"}
                      loading={command === "run" && busyId === selected.id}
                      disabled={busyId === selected.id}
                      onClick={() => void execute(selected, command)}
                    >
                      {COMMAND_LABEL[command]}
                    </Button>
                  ))}
              </>
            ) : undefined
          }
        />
      ) : null}

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(next) => !next && setConfirmDelete(null)} size="sm">
        {confirmDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete {confirmDelete.title}?</DialogTitle>
              <DialogDescription>
                {confirmDelete.kind === "automation"
                  ? "Its schedule stops and it leaves this list. Past runs stay in Runs, and the automation stays in Missions as paused."
                  : "It leaves this list. Past runs stay in Runs."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" data-autofocus onClick={() => void deleteDeployment(confirmDelete)}>
                Delete deployment
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </Dialog>
    </PageContainer>
  )
}
