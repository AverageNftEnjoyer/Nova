"use client"

import { Fragment, useMemo, useState } from "react"
import { ChevronRight, Copy, RefreshCw, ScrollText } from "lucide-react"

import { PageContainer } from "@/components/shell"
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  SearchInput,
  Select,
  SkeletonRows,
  Stat,
  StatGroup,
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
  Tooltip,
  toast,
  type BadgeProps,
} from "@/components/ui"
import { cn } from "@/lib/shared/utils"

import { useDevLogsData } from "../hooks/use-dev-logs-data"
import type { DevLogTurn } from "../types"

type Level = "ok" | "warn" | "error"
type LevelFilter = "all" | Level

const LEVEL_META: Record<Level, { label: string; tone: NonNullable<BadgeProps["tone"]> }> = {
  ok: { label: "OK", tone: "success" },
  warn: { label: "Warn", tone: "warning" },
  error: { label: "Error", tone: "danger" },
}

const SLOW_MS = 4000

function deriveLevel(turn: DevLogTurn): Level {
  if (turn.status?.ok === false) return "error"
  const latency = Number(turn.timing?.latencyMs || 0)
  const quality = Number(turn.quality?.score || 0)
  const hasOutput = String(turn.output?.assistant?.text || "").trim().length > 0
  if (!hasOutput || latency >= SLOW_MS || (quality > 0 && quality < 85)) return "warn"
  return "ok"
}

function formatTimestamp(value: string): string {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return "unknown"
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.toLocaleDateString(undefined, { month: "short", day: "2-digit" })} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatNumber(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString() : "0"
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success({ title: `Copied ${what}` })
  } catch {
    toast.error({ title: "Copy failed", description: "The clipboard is not available here." })
  }
}

function CopyButton({ text, what }: { text: string; what: string }) {
  return (
    <Tooltip content={`Copy ${what}`}>
      <IconButton aria-label={`Copy ${what}`} size="sm" onClick={() => void copyText(text, what)}>
        <Copy />
      </IconButton>
    </Tooltip>
  )
}

function DetailBlock({ title, text, mono = false }: { title: string; text: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border-subtle bg-surface">
      <div className="flex h-8 items-center justify-between border-b border-border-subtle pl-3 pr-1">
        <span className="text-xs font-medium text-muted">{title}</span>
        <CopyButton text={text} what={title.toLowerCase()} />
      </div>
      <pre
        className={cn(
          "max-h-72 overflow-auto px-3 py-2 whitespace-pre-wrap break-words text-fg",
          mono ? "font-mono text-2xs leading-5" : "font-sans text-sm leading-6",
        )}
      >
        {text || "(empty)"}
      </pre>
    </div>
  )
}

function TurnDetail({ turn }: { turn: DevLogTurn }) {
  const facts: Array<[string, string]> = [
    ["Turn", turn.turnId],
    ["Conversation", turn.conversationId || "unknown"],
    ["Provider", turn.routing?.provider || "unknown"],
    ["Model", turn.routing?.model || "unknown"],
    ["Route", turn.route || "unknown"],
    ["Hot path", turn.timing?.hotPath || "none"],
    ["Tools", (turn.tools?.calls || []).join(", ") || "none"],
    ["Tags", (turn.quality?.tags || []).join(", ") || "none"],
  ]
  return (
    <div className="flex flex-col gap-3 bg-surface-2 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs xl:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted">{label}</dt>
            <dd className="truncate font-mono text-fg" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {turn.status?.error ? <p className="rounded-md bg-danger-muted px-3 py-2 font-mono text-xs text-danger">{turn.status.error}</p> : null}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DetailBlock title="User input" text={turn.input?.user?.text || ""} />
        <DetailBlock title="Assistant output" text={turn.output?.assistant?.text || ""} />
      </div>
      <DetailBlock title="Raw JSON" text={JSON.stringify(turn, null, 2)} mono />
    </div>
  )
}

export function DevLogsScreen() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const { data, loading, refreshing, error, refresh } = useDevLogsData(autoRefresh)
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState<LevelFilter>("all")
  const [source, setSource] = useState("all")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const turns = useMemo(() => data?.turns ?? [], [data?.turns])

  const counts = useMemo(() => {
    const result = { ok: 0, warn: 0, error: 0 }
    for (const turn of turns) result[deriveLevel(turn)] += 1
    return result
  }, [turns])

  const sourceOptions = useMemo(() => {
    const values = [...new Set(turns.map((turn) => turn.source).filter(Boolean))].sort()
    return [{ value: "all", label: "All sources" }, ...values.map((value) => ({ value, label: value }))]
  }, [turns])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return turns.filter((turn) => {
      if (level !== "all" && deriveLevel(turn) !== level) return false
      if (source !== "all" && turn.source !== source) return false
      if (!query) return true
      return [
        turn.turnId,
        turn.conversationId,
        turn.routing?.provider,
        turn.routing?.model,
        turn.input?.user?.text,
        turn.output?.assistant?.text,
        turn.status?.error,
        ...(turn.quality?.tags || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [level, search, source, turns])

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const summary = data?.summary

  return (
    <PageContainer width="full" fill>
      <PageHeader
        title="Dev logs"
        description="Every chat turn Nova logged: routing, latency, tokens and quality. Newest first."
        actions={
          <>
            <label className="inline-flex items-center gap-2 text-xs text-muted">
              <Switch size="sm" checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Auto refresh every 15 seconds" />
              Auto refresh
            </label>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      />

      <StatGroup className="mb-4 shrink-0">
        <Stat size="sm" label="Turns" value={formatNumber(summary?.totalTurns ?? 0)} />
        <Stat size="sm" label="Errors" value={<span className={cn(counts.error > 0 && "text-danger")}>{formatNumber(counts.error)}</span>} />
        <Stat size="sm" label="Warnings" value={<span className={cn(counts.warn > 0 && "text-warning")}>{formatNumber(counts.warn)}</span>} />
        <Stat size="sm" label="Latency p50 / p95" value={`${formatNumber(summary?.latencyMs.p50 ?? 0)} / ${formatNumber(summary?.latencyMs.p95 ?? 0)} ms`} />
        <Stat size="sm" label="Avg quality" value={Number(summary?.quality.average ?? 0).toFixed(1)} />
        <Stat size="sm" label="Tokens" value={formatNumber(summary?.totalTokens ?? 0)} />
      </StatGroup>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search turns, prompts, models, tags"
          size="sm"
          containerClassName="w-full max-w-sm"
        />
        <Tabs value={level} onValueChange={(value) => setLevel(value as LevelFilter)} variant="segmented">
          <TabsList aria-label="Level">
            <TabsTrigger value="all" count={turns.length}>All</TabsTrigger>
            <TabsTrigger value="ok" count={counts.ok}>OK</TabsTrigger>
            <TabsTrigger value="warn" count={counts.warn}>Warn</TabsTrigger>
            <TabsTrigger value="error" count={counts.error}>Error</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={source} options={sourceOptions} onValueChange={setSource} size="sm" aria-label="Source" className="w-40" />
        {error && data ? <span className="text-xs text-danger">{error}</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface">
        {loading && !data ? (
          <div className="p-4">
            <SkeletonRows rows={10} />
          </div>
        ) : error && !data ? (
          <EmptyState
            tone="danger"
            title="Dev logs did not load"
            description={error}
            action={
              <Button variant="outline" onClick={() => void refresh()}>
                Try again
              </Button>
            }
          />
        ) : !data?.file.exists ? (
          <EmptyState
            icon={<ScrollText />}
            title="No log file yet"
            description="Nova writes a line here for every chat turn. Send a message in Chat and it shows up within 15 seconds."
          />
        ) : filtered.length === 0 ? (
          <EmptyState size="compact" title="No turns match" description="Clear the search or pick another level or source." />
        ) : (
          <Table density="compact" stickyHeader containerClassName="overflow-visible">
            <THead>
              <tr>
                <Th className="w-8">
                  <span className="sr-only">Expand</span>
                </Th>
                <Th className="w-16">Level</Th>
                <Th className="w-32">Time</Th>
                <Th className="w-16">Source</Th>
                <Th className="w-32 xl:w-48">Model</Th>
                <Th>Input</Th>
                <Th numeric className="w-24">Latency</Th>
                <Th numeric className="w-20">Tokens</Th>
                <Th numeric className="w-16">Quality</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.map((turn) => {
                const turnLevel = deriveLevel(turn)
                const open = expanded.has(turn.turnId)
                const latency = Number(turn.timing?.latencyMs || 0)
                const quality = Number(turn.quality?.score || 0)
                return (
                  <Fragment key={turn.turnId}>
                    <Tr interactive selected={open} onClick={() => toggle(turn.turnId)}>
                      <Td className="px-1.5">
                        <IconButton
                          aria-label={open ? "Collapse turn" : "Expand turn"}
                          aria-expanded={open}
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggle(turn.turnId)
                          }}
                        >
                          <ChevronRight className={cn("transition-transform duration-150", open && "rotate-90")} />
                        </IconButton>
                      </Td>
                      <Td>
                        <Badge tone={LEVEL_META[turnLevel].tone}>{LEVEL_META[turnLevel].label}</Badge>
                      </Td>
                      <Td mono muted className="whitespace-nowrap">
                        <time dateTime={turn.ts}>{formatTimestamp(turn.ts)}</time>
                      </Td>
                      <Td muted className="text-xs">{turn.source || "unknown"}</Td>
                      <Td mono className="max-w-[12rem]">
                        <span className="block truncate" title={turn.routing?.model}>
                          {turn.routing?.model || "unknown"}
                        </span>
                      </Td>
                      <Td className="max-w-0">
                        <span className="block truncate" title={turn.input?.user?.text}>
                          {turn.input?.user?.text || <span className="text-faint">(no user input)</span>}
                        </span>
                      </Td>
                      <Td numeric mono className={cn(latency >= SLOW_MS && "text-warning")}>
                        {formatNumber(latency)} ms
                      </Td>
                      <Td numeric mono>{formatNumber(turn.usage?.totalTokens || 0)}</Td>
                      <Td numeric mono className={cn(quality > 0 && quality < 85 && "text-warning")}>
                        {quality > 0 ? formatNumber(quality) : "None"}
                      </Td>
                    </Tr>
                    {open ? (
                      <tr>
                        <td colSpan={9} className="border-b border-border-subtle p-0">
                          <TurnDetail turn={turn} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>

      <p className="mt-2 flex shrink-0 flex-wrap gap-x-4 text-xs text-faint">
        <span>
          {filtered.length} of {turns.length} turns shown
        </span>
        {data?.file.exists ? <span className="font-mono">{formatBytes(data.file.bytes)}</span> : null}
        {data?.file.updatedAt ? <span>Log updated {formatTimestamp(data.file.updatedAt)}</span> : null}
        {data?.logPath ? (
          <span className="min-w-0 truncate font-mono" title={data.logPath}>
            {data.logPath}
          </span>
        ) : null}
      </p>
    </PageContainer>
  )
}
