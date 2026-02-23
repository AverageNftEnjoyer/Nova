"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock3, Copy, Search, TriangleAlert, Zap } from "lucide-react"

import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useTheme } from "@/lib/context/theme-context"
import { ORB_COLORS, USER_SETTINGS_UPDATED_EVENT, loadUserSettings, type OrbColor } from "@/lib/settings/userSettings"
import { cn } from "@/lib/shared/utils"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { readShellUiCache } from "@/lib/settings/shell-ui-cache"
import { useSpotlightEffect } from "@/app/integrations/hooks"
import { NOVA_VERSION } from "@/lib/meta/version"

import { useDevLogsData } from "../hooks/use-dev-logs-data"
import type { DevLogTurn } from "../types"

function formatTime(value: string) {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return "unknown"
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(ts))
}

function formatNumber(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return "0"
  return n.toLocaleString("en-US")
}

function deriveStatus(turn: DevLogTurn): "ok" | "warn" | "error" {
  if (turn.status?.ok === false) return "error"
  const latency = Number(turn.timing?.latencyMs || 0)
  const quality = Number(turn.quality?.score || 0)
  const hasOutput = String(turn.output?.assistant?.text || "").trim().length > 0
  if (!hasOutput || latency >= 4000 || (quality > 0 && quality < 85)) return "warn"
  return "ok"
}

export function DevLogsScreen() {
  const router = useRouter()
  const pageActive = usePageActive()
  const { theme } = useTheme()
  const { state: novaState, connected: agentConnected } = useNovaState()
  const isLight = theme === "light"
  const presence = getNovaPresence({ agentConnected, novaState })
  const [orbColor, setOrbColor] = useState<OrbColor>("violet")
  const [spotlightEnabled, setSpotlightEnabled] = useState(true)
  const palette = ORB_COLORS[orbColor]
  const [showRaw, setShowRaw] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "warn" | "error">("all")
  const [showTraceIds, setShowTraceIds] = useState(true)
  const [expandedTurnId, setExpandedTurnId] = useState("")
  const { data, loading, error, refresh } = useDevLogsData()
  const kpiRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const panelClass = isLight
    ? "rounded-2xl border border-[#d9e0ea] bg-white"
    : "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_20px_60px_-35px_rgba(var(--accent-rgb),0.35)]"
  const subPanelClass = isLight
    ? "rounded-lg border border-[#d5dce8] bg-[#f4f7fd]"
    : "rounded-lg border border-white/10 bg-black/25 backdrop-blur-md"

  useEffect(() => {
    const syncFromSettings = () => {
      const settings = loadUserSettings()
      const cached = readShellUiCache()
      const nextOrb = cached.orbColor ?? settings.app.orbColor
      const nextSpotlight = cached.spotlightEnabled ?? (settings.app.spotlightEnabled ?? true)
      setOrbColor(nextOrb)
      setSpotlightEnabled(nextSpotlight)
    }

    syncFromSettings()
    window.addEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
    return () => window.removeEventListener(USER_SETTINGS_UPDATED_EVENT, syncFromSettings as EventListener)
  }, [])

  useSpotlightEffect(
    spotlightEnabled,
    [
      { ref: kpiRef, showSpotlightCore: false },
      { ref: filterRef, showSpotlightCore: false },
      { ref: tableRef, showSpotlightCore: false },
    ],
    [isLight, spotlightEnabled, data?.turns?.length || 0],
  )

  const turns = useMemo(() => data?.turns || [], [data?.turns])
  const filteredTurns = useMemo(() => {
    const query = search.trim().toLowerCase()
    return turns.filter((turn) => {
      const status = deriveStatus(turn)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (!query) return true
      const haystack = [
        turn.turnId,
        turn.conversationId,
        turn.routing?.provider,
        turn.routing?.model,
        turn.input?.user?.text,
        turn.output?.assistant?.text,
        ...(turn.quality?.tags || []),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [search, statusFilter, turns])

  const expandedTurnIdSafe = useMemo(
    () => (expandedTurnId && filteredTurns.some((turn) => turn.turnId === expandedTurnId) ? expandedTurnId : ""),
    [expandedTurnId, filteredTurns],
  )

  const statusCounts = useMemo(() => {
    let ok = 0
    let warn = 0
    let errorCount = 0
    for (const turn of turns) {
      const status = deriveStatus(turn)
      if (status === "ok") ok += 1
      else if (status === "warn") warn += 1
      else errorCount += 1
    }
    return { ok, warn, error: errorCount }
  }, [turns])
  const totalTokens = useMemo(
    () => turns.reduce((sum, turn) => sum + Number(turn.usage?.totalTokens || 0), 0),
    [turns],
  )

  return (
    <div className={cn("relative flex h-dvh overflow-hidden", isLight ? "bg-[#f6f8fc] text-s-90" : "bg-transparent text-slate-100")}>
      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden px-4 py-4 sm:px-6">
        <header className="mb-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/home")}
                className={cn("h-11 w-11 rounded-full transition-transform duration-150 hover:scale-110")}
                aria-label="Go home"
                title="Home"
              >
                <NovaOrbIndicator palette={palette} size={30} animated={pageActive} className="transition-all duration-200" />
              </button>
              <div>
                <div className="flex items-baseline gap-3">
                  <h1 className={cn("text-[30px] leading-none font-semibold tracking-tight", isLight ? "text-s-90" : "text-white")}>NovaOS</h1>
                  <p className="text-[11px] font-mono text-accent">{NOVA_VERSION}</p>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <Activity className={cn("h-3.5 w-3.5", isLight ? "text-slate-600" : "text-slate-300")} />
                  <span className={cn("text-[12px]", isLight ? "text-s-50" : "text-slate-300")}>Dev Logs Dashboard</span>
                  <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", presence.dotClassName)} />
                  <span className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", presence.textClassName)}>{presence.label}</span>
                  <span className={cn("text-[12px]", isLight ? "text-s-50" : "text-slate-400")}>
                    {data?.file?.exists ? `Last update ${formatTime(String(data.file.updatedAt || ""))}` : "No log file yet"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section ref={kpiRef} className={cn(panelClass, "home-spotlight-shell p-3 mb-4")}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Total Traces</p><p className="mt-1 text-2xl font-semibold">{formatNumber(data?.summary?.totalTurns || 0)}</p></div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Errors</p><p className="mt-1 text-2xl font-semibold text-rose-400">{formatNumber(statusCounts.error)}</p></div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Warnings</p><p className="mt-1 text-2xl font-semibold text-amber-300">{formatNumber(statusCounts.warn)}</p></div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Avg Latency</p><p className="mt-1 text-2xl font-semibold">{formatNumber(data?.summary?.latencyMs?.average || 0)}ms</p></div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Avg Quality</p><p className="mt-1 text-2xl font-semibold">{Number(data?.summary?.quality?.average || 0).toFixed(1)}</p></div>
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow p-3")}><p className="text-[10px] uppercase tracking-[0.12em] opacity-70">Total Tokens</p><p className="mt-1 text-2xl font-semibold">{formatNumber(totalTokens)}</p></div>
          </div>
        </section>

        <section ref={filterRef} className={cn(panelClass, "home-spotlight-shell p-3 mb-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn(subPanelClass, "home-spotlight-card home-border-glow relative h-10 w-full sm:max-w-[460px]")}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-70" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search traces, prompts, models, tags..."
                className="h-full w-full bg-transparent pl-9 pr-3 text-sm outline-none"
              />
            </div>
            <button onClick={() => setStatusFilter("all")} className={cn("h-9 rounded-lg px-3 text-xs border transition-colors home-spotlight-card home-border-glow", statusFilter === "all" ? (isLight ? "border-slate-500 text-slate-800 bg-slate-100" : "border-slate-300/60 text-slate-100 bg-slate-700/30") : subPanelClass)}>All {formatNumber(turns.length)}</button>
            <button onClick={() => setStatusFilter("ok")} className={cn("h-9 rounded-lg px-3 text-xs border transition-colors home-spotlight-card home-border-glow", statusFilter === "ok" ? "border-emerald-400/60 text-emerald-300" : subPanelClass)}>OK {formatNumber(statusCounts.ok)}</button>
            <button onClick={() => setStatusFilter("warn")} className={cn("h-9 rounded-lg px-3 text-xs border transition-colors home-spotlight-card home-border-glow", statusFilter === "warn" ? "border-amber-400/60 text-amber-300" : subPanelClass)}>Warn {formatNumber(statusCounts.warn)}</button>
            <button onClick={() => setStatusFilter("error")} className={cn("h-9 rounded-lg px-3 text-xs border transition-colors home-spotlight-card home-border-glow", statusFilter === "error" ? "border-rose-400/60 text-rose-300" : subPanelClass)}>Error {formatNumber(statusCounts.error)}</button>
            <button onClick={() => setShowTraceIds((prev) => !prev)} className={cn("h-9 rounded-lg px-3 text-xs border transition-colors home-spotlight-card home-border-glow ml-auto", subPanelClass)}>{showTraceIds ? "Hide Trace IDs" : "Show Trace IDs"}</button>
          </div>
        </section>

        <section ref={tableRef} className={cn(panelClass, "home-spotlight-shell min-h-0 flex-1 overflow-hidden p-0")}>
          <div className="relative h-full overflow-auto module-hover-scroll">
            <table className="w-full min-w-full border-collapse">
              <thead
                className={cn(
                  "text-[11px] uppercase tracking-[0.12em] border-b",
                  isLight ? "bg-[#e7eef9] border-[#d2deef]" : "bg-transparent border-white/15",
                )}
              >
                <tr className={cn(isLight ? "text-s-50" : "text-slate-400")}>
                  <th className="w-9 px-2 py-3 text-left" />
                  <th className="px-2 py-3 text-left">Trace</th>
                  <th className="px-2 py-3 text-left">Time</th>
                  <th className="px-2 py-3 text-left">Latency</th>
                  <th className="px-2 py-3 text-left">Quality</th>
                  <th className="px-2 py-3 text-left">Tokens</th>
                  <th className="px-2 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTurns.map((turn) => {
                  const expanded = turn.turnId === expandedTurnIdSafe
                  const status = deriveStatus(turn)
                  const latency = Number(turn.timing?.latencyMs || 0)
                  const quality = Number(turn.quality?.score || 0)
                  const qualityTextClass = quality >= 90
                    ? (isLight ? "text-emerald-700" : "text-emerald-300")
                    : quality >= 75
                      ? (isLight ? "text-amber-700" : "text-amber-300")
                      : (isLight ? "text-rose-700" : "text-rose-300")
                  const qualityBarClass = quality >= 90 ? "bg-emerald-400" : quality >= 75 ? "bg-amber-400" : "bg-rose-400"
                  const statusNode =
                    status === "error" ? <span className="inline-flex items-center gap-1 text-rose-300"><AlertTriangle className="h-3.5 w-3.5" />Error</span>
                      : status === "warn" ? <span className="inline-flex items-center gap-1 text-amber-300"><TriangleAlert className="h-3.5 w-3.5" />Warn</span>
                        : <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />OK</span>

                  return (
                    <Fragment key={turn.turnId}>
                      <tr
                        className={cn(
                          "border-t transition-colors",
                          isLight ? "border-[#dce5f3] hover:bg-[#f3f7ff]" : "border-white/10 hover:bg-white/[0.03]",
                        )}
                      >
                        <td className="px-2 py-3 align-top">
                          <button
                            onClick={() => setExpandedTurnId((prev) => (prev === turn.turnId ? "" : turn.turnId))}
                            className={cn("rounded-md border p-1 home-spotlight-card home-border-glow home-spotlight-card--hover", subPanelClass)}
                            aria-label={expanded ? "Collapse row" : "Expand row"}
                          >
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                        <td className="px-2 py-3 align-top">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {showTraceIds ? <span className={cn("rounded px-2 py-0.5 text-[10px] font-mono", isLight ? "bg-slate-200 text-slate-700" : "bg-slate-700/40 text-slate-200")}>{turn.turnId}</span> : null}
                              <span className="text-sm font-semibold">{turn.input?.user?.text || "(no user input)"}</span>
                            </div>
                            <p className={cn("text-[11px]", isLight ? "text-s-50" : "text-slate-400")}>
                              {turn.conversationId || "unknown-conversation"} • {turn.routing?.model || "unknown-model"}
                            </p>
                          </div>
                        </td>
                        <td className="px-2 py-3 align-top text-sm">{formatTime(turn.ts).split(", ").pop()}</td>
                        <td className={cn("px-2 py-3 align-top text-sm font-semibold", latency >= 4000 ? "text-amber-300" : "")}>{formatNumber(latency)}ms</td>
                        <td className="px-2 py-3 align-top">
                          <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", qualityTextClass)}>
                            <span className={cn("h-1.5 w-6 rounded-full", qualityBarClass)} />
                            {formatNumber(quality)}
                          </span>
                        </td>
                        <td className="px-2 py-3 align-top text-sm">{formatNumber(turn.usage?.totalTokens || 0)}</td>
                        <td className="px-2 py-3 align-top text-sm font-semibold">{statusNode}</td>
                      </tr>
                      {expanded ? (
                        <tr className={cn("border-t", isLight ? "border-[#dce5f3]" : "border-white/10")}>
                          <td />
                          <td colSpan={6} className="px-2 pb-4">
                            <div className={cn(panelClass, "p-3 space-y-3")}>
                              <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
                                <div className={cn(subPanelClass, "p-2 text-xs")}><p className="opacity-70 uppercase tracking-[0.12em]">Provider</p><p className="mt-1 font-semibold">{turn.routing?.provider || "unknown"}</p></div>
                                <div className={cn(subPanelClass, "p-2 text-xs")}><p className="opacity-70 uppercase tracking-[0.12em]">Model</p><p className="mt-1 font-semibold">{turn.routing?.model || "unknown"}</p></div>
                                <div className={cn(subPanelClass, "p-2 text-xs")}><p className="opacity-70 uppercase tracking-[0.12em]">Hot Path</p><p className="mt-1 font-semibold">{turn.timing?.hotPath || "unknown"}</p></div>
                                <div className={cn(subPanelClass, "p-2 text-xs")}><p className="opacity-70 uppercase tracking-[0.12em]">Tools</p><p className="mt-1 font-semibold">{(turn.tools?.calls || []).join(", ") || "none"}</p></div>
                              </div>

                              <div className={cn(subPanelClass, "p-3 text-sm")}>
                                <div className="mb-1 flex items-center justify-between">
                                  <p className="text-[11px] uppercase tracking-[0.14em] opacity-70">User Input</p>
                                  <button onClick={() => navigator.clipboard.writeText(turn.input?.user?.text || "")} className="opacity-70 hover:opacity-100" aria-label="Copy user input"><Copy className="h-3.5 w-3.5" /></button>
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-sans">{turn.input?.user?.text || "(empty)"}</pre>
                              </div>

                              <div className={cn(subPanelClass, "p-3 text-sm")}>
                                <div className="mb-1 flex items-center justify-between">
                                  <p className="text-[11px] uppercase tracking-[0.14em] opacity-70">Assistant Output</p>
                                  <button onClick={() => navigator.clipboard.writeText(turn.output?.assistant?.text || "")} className="opacity-70 hover:opacity-100" aria-label="Copy assistant output"><Copy className="h-3.5 w-3.5" /></button>
                                </div>
                                <pre className="whitespace-pre-wrap break-words font-sans">{turn.output?.assistant?.text || "(empty)"}</pre>
                              </div>

                              <div className={cn(subPanelClass, "p-2 text-xs")}>
                                <p className="opacity-70 uppercase tracking-[0.12em]">Tags</p>
                                <p className="mt-1">{(turn.quality?.tags || []).join(", ") || "none"}</p>
                              </div>

                              {showRaw ? <pre className={cn(subPanelClass, "p-2 text-[11px] whitespace-pre-wrap break-words")}>{JSON.stringify(turn, null, 2)}</pre> : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {error ? <p className="px-4 py-3 text-sm text-rose-400">{error}</p> : null}
            {loading && !data ? <p className="px-4 py-3 text-sm opacity-70">Loading logs...</p> : null}
            {!loading && !error && !data?.file?.exists ? <p className="px-4 py-3 text-sm opacity-70">No dev log file found for this user. If you deleted the file, this is expected.</p> : null}
            {!loading && !error && data?.file?.exists && filteredTurns.length === 0 ? <p className="px-4 py-3 text-sm opacity-70">No traces match the current filters.</p> : null}
          </div>
        </section>

        <div className="mt-2 flex items-center justify-between text-xs opacity-70">
          <div className="flex items-center gap-2">
            <Clock3 className="h-3.5 w-3.5" />
            <span>Generated {formatTime(String(data?.generatedAt || ""))}</span>
            <span>•</span>
            <span>{data?.file?.exists ? `${formatNumber(data?.file?.bytes || 0)} bytes` : "file missing"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            <button
              onClick={() => setShowRaw((prev) => !prev)}
              className={cn("h-8 px-3 rounded-lg border text-xs", subPanelClass)}
            >
              {showRaw ? "Hide Raw JSON" : "Show Raw JSON"}
            </button>
            <button
              onClick={refresh}
              className={cn("h-8 px-3 rounded-lg border text-xs", subPanelClass)}
              disabled={loading}
            >
              Force refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
