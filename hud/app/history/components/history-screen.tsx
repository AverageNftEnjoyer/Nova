"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageSquare, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react"

import { NEW_CHAT_HREF, PageContainer } from "@/components/shell"
import {
  Badge,
  Button,
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
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
  type BadgeProps,
} from "@/components/ui"
import type { Conversation } from "@/lib/chat/conversations"
import type { Deployment, DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"
import { cn } from "@/lib/shared/utils"

type Kind = "chat" | "run"
type KindFilter = "all" | Kind

interface HistoryItem {
  id: string
  kind: Kind
  title: string
  detail: string
  updatedAt: string
  href: string
  archived: boolean
  status?: DeploymentRunStatus
  messageCount?: number
}

const RUN_STATUS: Record<DeploymentRunStatus, { label: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  pending: { label: "Pending", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  dead: { label: "Dead", tone: "danger" },
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Today / Yesterday / Previous 7 days / "October 2026". */
function groupLabel(iso: string, now: Date): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "Undated"
  const day = startOfDay(new Date(ms))
  const today = startOfDay(now)
  const dayMs = 86_400_000
  if (day >= today) return "Today"
  if (day >= today - dayMs) return "Yesterday"
  if (day >= today - 7 * dayMs) return "Previous 7 days"
  return new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

function formatWhen(iso: string, group: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ""
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  if (group === "Today" || group === "Yesterday") return time
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`
}

function previewOf(conversation: Conversation): string {
  const last = conversation.messages[conversation.messages.length - 1]
  const text = String(last?.content || "").replace(/\s+/g, " ").trim()
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const data = (await response.json()) as T & { ok?: boolean; error?: string }
  if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status}).`)
  return data
}

export function HistoryScreen() {
  const router = useRouter()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [runsError, setRunsError] = useState("")
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<KindFilter>("all")
  const [showArchived, setShowArchived] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [threads, runs, deployments] = await Promise.allSettled([
        readJson<{ conversations?: Conversation[] }>("/api/threads"),
        readJson<{ runs?: DeploymentRun[] }>("/api/deployment-runs"),
        readJson<{ deployments?: Deployment[] }>("/api/deployments"),
      ])
      if (cancelled) return
      const next: HistoryItem[] = []
      if (threads.status === "fulfilled") {
        for (const conversation of threads.value.conversations ?? []) {
          if (conversation.messages.length === 0) continue
          next.push({
            id: conversation.id,
            kind: "chat",
            title: conversation.title || "Untitled conversation",
            detail: previewOf(conversation),
            updatedAt: conversation.updatedAt,
            href: `/chat?thread=${encodeURIComponent(conversation.id)}`,
            archived: Boolean(conversation.archived),
            messageCount: conversation.messages.length,
          })
        }
        setError("")
      } else {
        setError(threads.reason instanceof Error ? threads.reason.message : "Could not load conversations.")
      }
      if (runs.status === "fulfilled") {
        const titles = new Map<string, Deployment>()
        if (deployments.status === "fulfilled") for (const entry of deployments.value.deployments ?? []) titles.set(entry.id, entry)
        for (const run of runs.value.runs ?? []) {
          const deployment = titles.get(run.deploymentId)
          next.push({
            id: run.id,
            kind: "run",
            title: deployment?.title || "Deleted deployment",
            detail: deployment ? `${deployment.kind === "automation" ? "Automation" : "Task"} run, revision ${run.deploymentRevision}` : `Run of ${run.deploymentId}`,
            updatedAt: run.finishedAt || run.updatedAt || run.createdAt,
            href: `/runs?run=${encodeURIComponent(run.id)}`,
            archived: false,
            status: run.status,
          })
        }
        setRunsError("")
      } else {
        setRunsError("Runs could not be loaded, so only conversations are listed.")
      }
      next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      setItems(next)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const counts = useMemo(() => {
    const visible = items.filter((item) => showArchived || !item.archived)
    return {
      all: visible.length,
      chat: visible.filter((item) => item.kind === "chat").length,
      run: visible.filter((item) => item.kind === "run").length,
    }
  }, [items, showArchived])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const now = new Date()
    const result: Array<{ label: string; rows: HistoryItem[] }> = []
    for (const item of items) {
      if (!showArchived && item.archived) continue
      if (kind !== "all" && item.kind !== kind) continue
      if (needle && !`${item.title} ${item.detail}`.toLowerCase().includes(needle)) continue
      const label = groupLabel(item.updatedAt, now)
      const last = result[result.length - 1]
      if (last && last.label === label) last.rows.push(item)
      else result.push({ label, rows: [item] })
    }
    return result
  }, [items, kind, query, showArchived])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(pendingDelete.id)}`, { method: "DELETE" })
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!response.ok || data.ok === false) throw new Error(data.error || "The conversation could not be deleted.")
      setItems((current) => current.filter((item) => !(item.kind === "chat" && item.id === pendingDelete.id)))
      toast.success({ title: "Conversation deleted" })
      setPendingDelete(null)
    } catch (reason) {
      toast.error({ title: "Delete failed", description: reason instanceof Error ? reason.message : "Try again in a moment." })
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete])

  const total = groups.reduce((sum, group) => sum + group.rows.length, 0)

  return (
    <PageContainer width="wide">
      <PageHeader
        title="History"
        description="Every conversation and run, newest first."
        actions={
          <Button asChild>
            <Link href={NEW_CHAT_HREF}>
              <Plus />
              New chat
            </Link>
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Search titles and messages" size="sm" containerClassName="w-full max-w-sm" />
        <Tabs value={kind} onValueChange={(value) => setKind(value as KindFilter)} variant="segmented">
          <TabsList aria-label="Show">
            <TabsTrigger value="all" count={counts.all}>All</TabsTrigger>
            <TabsTrigger value="chat" count={counts.chat}>Chats</TabsTrigger>
            <TabsTrigger value="run" count={counts.run}>Runs</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted">
          <Switch size="sm" checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived conversations" />
          Show archived
        </label>
      </div>

      {runsError ? <p className="mb-3 text-xs text-warning">{runsError}</p> : null}

      <Panel flush>
        {loading ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : error && items.length === 0 ? (
          <EmptyState
            tone="danger"
            title="History did not load"
            description={error}
            action={
              <Button variant="outline" onClick={() => setReloadToken((value) => value + 1)}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No conversations or runs yet"
            description="Start a chat or deploy a task; each one is listed here."
          />
        ) : total === 0 ? (
          <EmptyState size="compact" title="Nothing matches" description="Try a different search, or switch the filter to All." />
        ) : (
          <Table density="compact">
            <THead>
              <tr>
                <Th className="w-24">Type</Th>
                <Th>Title</Th>
                <Th className="w-32">Status</Th>
                <Th numeric className="w-32">Updated</Th>
                <Th className="w-10">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            {groups.map((group) => (
              <TBody key={group.label}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={5}
                    className="border-b border-border-subtle bg-surface-2 px-3 py-1.5 text-left text-xs font-medium text-muted"
                  >
                    {group.label}
                    <span className="ml-2 font-mono text-2xs tabular-nums text-faint">{group.rows.length}</span>
                  </th>
                </tr>
                {group.rows.map((item) => (
                  <Tr key={`${item.kind}:${item.id}`} interactive onClick={() => router.push(item.href)}>
                    <Td muted className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        {item.kind === "chat" ? <MessageSquare className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                        {item.kind === "chat" ? "Chat" : "Run"}
                      </span>
                    </Td>
                    <Td className="max-w-0">
                      <Link
                        href={item.href}
                        onClick={(event) => event.stopPropagation()}
                        className="block truncate font-medium text-fg focus-visible:outline-2 focus-visible:outline-ring"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                      {item.detail ? <span className="block truncate text-xs text-muted">{item.detail}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {item.kind === "run" && item.status ? (
                        <Badge tone={RUN_STATUS[item.status].tone} dot={item.status === "running" ? "pulse" : undefined}>
                          {RUN_STATUS[item.status].label}
                        </Badge>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs text-muted">
                          <span className="font-mono tabular-nums">{item.messageCount}</span> messages
                          {item.archived ? <Badge variant="outline">Archived</Badge> : null}
                        </span>
                      )}
                    </Td>
                    <Td numeric mono muted className="whitespace-nowrap">
                      <time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString()}>
                        {formatWhen(item.updatedAt, group.label)}
                      </time>
                    </Td>
                    <Td onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton aria-label={`Actions for ${item.title}`} size="sm" className={cn("opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100")}>
                            <MoreHorizontal />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => router.push(item.href)}>{item.kind === "chat" ? "Open conversation" : "Open run"}</DropdownMenuItem>
                          {item.kind === "chat" ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(item)}>
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            ))}
          </Table>
        )}
      </Panel>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && !deleting && setPendingDelete(null)} size="sm">
        <DialogHeader>
          <DialogTitle>Delete this conversation?</DialogTitle>
          <DialogDescription>
            {pendingDelete ? `"${pendingDelete.title}" and its messages are removed from this computer. This cannot be undone.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
            Delete conversation
          </Button>
        </DialogFooter>
      </Dialog>
    </PageContainer>
  )
}
