"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  Button,
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  SkeletonRows,
  StatusDot,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@/components/ui"
import { NEW_DEPLOYMENT_HREF, PageContainer } from "@/components/shell"
import { useDeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { useAgentTasks } from "@/app/home/hooks/use-agent-tasks"
import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import type { DeploymentKind } from "@/lib/deployments/types"
import { useRunActions, type RunActionKind } from "../hooks/use-run-actions"
import { RUN_TABS, buildRunRows, findRow, isRowActive, needsAttention, rowInTab, type RunRow, type RunTab } from "../lib/run-rows"
import { RunDetailSheet } from "./run-detail-sheet"
import { RunsTable } from "./runs-table"
import { WaitingForYou } from "./waiting-for-you"

type KindFilter = "all" | DeploymentKind

const KIND_OPTIONS = [
  { value: "all", label: "All kinds" },
  { value: "task", label: "Tasks" },
  { value: "automation", label: "Automations" },
]

/** Steps the elapsed-time readouts while something is running. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}

function matchesSearch(row: RunRow, query: string): boolean {
  if (!query) return true
  const haystack = [row.name, row.deployment?.title, row.model, row.id, row.task?.id, row.task?.prompt]
  return haystack.some((value) => value?.toLowerCase().includes(query))
}

interface PendingConfirm {
  row: RunRow
  action: Extract<RunActionKind, "approve-tool" | "delete">
}

/** /runs: every agent task and automation run, what waits for the user, and one run's detail in a sheet. */
export function RunsScreen() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("run") ?? ""
  const data = useDeploymentsData()
  const agentTasks = useAgentTasks()
  const actions = useRunActions(data, agentTasks)
  const [tab, setTab] = useState<RunTab>("all")
  const [kind, setKind] = useState<KindFilter>("all")
  const [query, setQuery] = useState("")
  const [raiseOpen, setRaiseOpen] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)

  const rows = useMemo(() => buildRunRows(data.runs, agentTasks.tasks, data.deployments), [data.runs, agentTasks.tasks, data.deployments])
  const now = useNow(rows.some(isRowActive))
  const loading = (data.loading || agentTasks.loading) && rows.length === 0
  const loadError = data.error || agentTasks.error || ""
  const live = data.live && agentTasks.connection === "live"

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => (kind === "all" || row.kind === kind) && matchesSearch(row, needle))
  }, [kind, query, rows])
  const counts = useMemo(() => {
    const result: Record<RunTab, number> = { all: 0, attention: 0, running: 0, completed: 0, failed: 0 }
    for (const row of filtered) for (const entry of RUN_TABS) if (rowInTab(row, entry.id)) result[entry.id] += 1
    return result
  }, [filtered])
  const visible = useMemo(() => filtered.filter((row) => rowInTab(row, tab)), [filtered, tab])
  const waiting = useMemo(() => rows.filter(needsAttention), [rows])
  const selected = selectedId ? findRow(rows, selectedId) ?? null : null

  const openRow = (row: RunRow, withRaise = false) => {
    setRaiseOpen(withRaise)
    router.replace(`${pathname}?run=${encodeURIComponent(row.id)}`, { scroll: false })
  }
  const closeRow = () => {
    setRaiseOpen(false)
    router.replace(pathname, { scroll: false })
  }

  const execute = async (row: RunRow, action: RunActionKind) => {
    const result = await actions.perform(row, action)
    if (!result.ok) {
      toast.error({ title: "That did not work", description: result.error })
      return
    }
    toast.success({
      title: result.message ?? "Done",
      action: result.runId ? { label: "View run", onClick: () => router.replace(`${pathname}?run=${encodeURIComponent(result.runId as string)}`) } : undefined,
    })
    if (action === "delete" && selected?.id === row.id) closeRow()
  }

  const requestAction = (row: RunRow, action: RunActionKind) => {
    if (action === "approve-tool" || action === "delete") setConfirm({ row, action })
    else void execute(row, action)
  }

  const raiseBudget = async (row: RunRow, input: RaiseAgentTaskBudgetInput) => {
    const result = await actions.raiseBudget(row, input)
    if (result.ok) toast.success(row.phase === "budget" ? "Budget raised. The run resumes." : "Budget raised")
    return result
  }

  const clearFilters = () => {
    setQuery("")
    setKind("all")
    setTab("all")
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Runs"
        description="Agent tasks and automation runs. Approve what waits for you, watch spend against budgets, stop what should not run."
        meta={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <StatusDot tone={live ? "running" : "idle"} size="sm" />
            {live ? "Live" : "Reconnecting, refreshing every few seconds"}
          </span>
        }
        actions={
          <Button asChild>
            <Link href={NEW_DEPLOYMENT_HREF}>
              <Plus />
              New deployment
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        {waiting.length > 0 ? (
          <WaitingForYou rows={waiting} now={now} busyId={actions.busyId} onOpen={openRow} onAction={requestAction} />
        ) : null}

        <Panel flush>
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2.5">
            <Tabs value={tab} onValueChange={(value) => setTab(value as RunTab)} variant="segmented">
              <TabsList aria-label="Filter runs by status">
                {RUN_TABS.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id} count={counts[entry.id]}>
                    {entry.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="ml-auto flex items-center gap-2">
              <Select
                value={kind}
                options={KIND_OPTIONS}
                onValueChange={(value) => setKind(value as KindFilter)}
                size="sm"
                className="w-36"
                aria-label="Filter by kind"
              />
              <SearchInput value={query} onValueChange={setQuery} placeholder="Search runs" size="sm" containerClassName="w-56" />
            </div>
          </div>

          {loadError && rows.length === 0 ? (
            <EmptyState
              tone="danger"
              title="Runs could not be loaded"
              description={loadError}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void data.refresh()
                    void agentTasks.refresh()
                  }}
                >
                  Retry
                </Button>
              }
            />
          ) : loading ? (
            <SkeletonRows rows={8} className="p-3" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No runs yet"
              description="Launch a deployment, a one-off task or an automation, and its runs show up here."
              action={
                <Button asChild size="sm">
                  <Link href={NEW_DEPLOYMENT_HREF}>New deployment</Link>
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              size="compact"
              title="No runs match"
              description="Nothing in this view matches the filters."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <>
              {loadError ? (
                <p role="status" className="border-b border-border-subtle bg-danger-muted px-3 py-2 text-xs text-danger">
                  Showing the last loaded list. {loadError}
                </p>
              ) : null}
              <RunsTable
                rows={visible}
                now={now}
                selectedId={selected?.id ?? ""}
                busyId={actions.busyId}
                onOpen={(row) => openRow(row)}
                onAction={requestAction}
                onRaiseBudget={(row) => openRow(row, true)}
              />
            </>
          )}
        </Panel>
      </div>

      <RunDetailSheet
        row={selected}
        missingId={selected ? "" : selectedId}
        loading={data.loading || agentTasks.loading}
        events={data.events}
        now={now}
        busy={Boolean(selected) && actions.busyId === selected?.id}
        raiseOpen={raiseOpen}
        onRaiseOpenChange={setRaiseOpen}
        onClose={closeRow}
        onAction={requestAction}
        onRaiseBudget={raiseBudget}
      />

      <Dialog open={Boolean(confirm)} onOpenChange={(next) => !next && setConfirm(null)} size="sm">
        {confirm ? (
          <>
            <DialogHeader>
              <DialogTitle>{confirm.action === "delete" ? "Delete this task?" : `Allow ${confirm.row.task?.pendingApproval?.toolName ?? "this tool"}?`}</DialogTitle>
              <DialogDescription>
                {confirm.action === "delete"
                  ? "The task and its output are removed. This cannot be undone."
                  : "The run continues and makes this tool call."}
              </DialogDescription>
            </DialogHeader>
            {confirm.action === "approve-tool" && confirm.row.task?.pendingApproval ? (
              <DialogBody>
                <p className="text-sm text-muted">{confirm.row.task.pendingApproval.reason}</p>
              </DialogBody>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm.action === "delete" ? "danger" : "primary"}
                data-autofocus
                onClick={() => {
                  const pending = confirm
                  setConfirm(null)
                  void execute(pending.row, pending.action)
                }}
              >
                {confirm.action === "delete" ? "Delete task" : "Allow tool call"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </Dialog>
    </PageContainer>
  )
}
