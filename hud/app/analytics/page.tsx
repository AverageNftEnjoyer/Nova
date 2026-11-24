"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Settings,
  TrendingUp,
  BarChart2,
  Activity,
  DollarSign,
  Zap,
  Target,
  Calendar,
  Database,
  PiggyBank,
  Gauge,
  AlertTriangle,
  AlertOctagon,
  CircleAlert,
  CheckCircle2,
  RefreshCw,
  History,
  ArrowUpCircle,
  Layers,
} from "lucide-react"
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { SettingsModal } from "@/components/settings/settings-modal"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { AGENT_TASK_TERMINAL, type AgentTaskBudgetState } from "@/lib/agents/types"
import { systemTimeZone } from "@/lib/analytics/time-zone"
import {
  ANALYTICS_TIME_ZONE_PARAM,
  USAGE_SOURCES,
  USAGE_SOURCE_LABELS,
  USAGE_TIER_LABELS,
  type AnalyticsData,
  type AnalyticsResponse,
  type BudgetEventKind,
  type BudgetEventRow,
  type BudgetTaskRow,
  type UsageSource,
  type UsageTier,
} from "@/lib/analytics/types"
import { hexToRgba } from "../home/helpers"

type TimeRange = "today" | "week" | "month" | "all"

/** Days requested from GET /api/analytics per range button ("all" = the API maximum). */
const RANGE_DAYS: Record<TimeRange, number> = { today: 1, week: 7, month: 30, all: 90 }

const PROVIDER_COLORS: Record<string, string> = {
  claude: "#8b5cf6",
  openai: "#10b981",
  gemini: "#3b82f6",
  grok: "#f59e0b",
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  grok: "Grok",
}

const BUDGET_STATE_META: Record<AgentTaskBudgetState, { label: string; color: string; Icon: typeof AlertTriangle }> = {
  ok: { label: "Within budget", color: "#6366f1", Icon: CheckCircle2 },
  warning: { label: "Warning", color: "#f59e0b", Icon: CircleAlert },
  degraded: { label: "Economy model", color: "#f97316", Icon: AlertTriangle },
  exhausted: { label: "Exhausted", color: "#ef4444", Icon: AlertOctagon },
}

/** What each stored budget event means, for the history list. */
const BUDGET_EVENT_META: Record<BudgetEventKind, { label: string; color: string; Icon: typeof AlertTriangle }> = {
  warning: { label: "Warning", color: BUDGET_STATE_META.warning.color, Icon: BUDGET_STATE_META.warning.Icon },
  degraded: { label: "Economy model", color: BUDGET_STATE_META.degraded.color, Icon: BUDGET_STATE_META.degraded.Icon },
  exhausted: { label: "Exhausted", color: BUDGET_STATE_META.exhausted.color, Icon: BUDGET_STATE_META.exhausted.Icon },
  raised: { label: "Budget raised", color: "#6366f1", Icon: ArrowUpCircle },
}

function providerLabel(provider: string): string {
  if (!provider) return "Unknown"
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Parses a YYYY-MM-DD local day key as LOCAL midnight (new Date("YYYY-MM-DD") would be UTC). */
function parseDayKey(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function formatDayShort(value: unknown): string {
  const date = parseDayKey(value)
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(value)
}

function formatDayLong(value: unknown): string {
  const date = parseDayKey(value)
  return date ? date.toLocaleDateString() : String(value)
}

/** Currency with enough precision for tiny LLM costs: under $0.01 → 4 decimals. */
function formatUsd(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs === 0) return "$0.00"
  if (abs < 0.0001) return `${sign}<$0.0001`
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Axis ticks: recharts picks steps like 0.025, which two decimals would show as a repeated "$0.03". */
function formatUsdTick(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0 || abs >= 1) return formatUsd(value)
  const sign = value < 0 ? "-" : ""
  const fixed = abs < 0.01 ? abs.toFixed(4) : abs.toFixed(3)
  return `${sign}$${fixed.replace(/0+$/, "").replace(/\.(\d)$/, ".$10")}`
}

/** Compact token counts: 950, 12.3k, 1.2M, 3.4B. */
function formatTokens(value: number): string {
  const abs = Math.abs(value)
  const compact = (n: number, suffix: string) => `${Number(n.toFixed(1))}${suffix}`
  if (abs >= 1e9) return compact(value / 1e9, "B")
  if (abs >= 1e6) return compact(value / 1e6, "M")
  if (abs >= 1e3) return compact(value / 1e3, "k")
  return String(Math.round(value))
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.1 ? 1 : 0)}%`
}

function formatRelative(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function AnalyticsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const { connected } = useNovaState()
  const isLight = theme === "light"

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>("month")
  const [reloadToken, setReloadToken] = useState(0)
  const hashScrolledRef = useRef(false)

  const days = RANGE_DAYS[timeRange]

  useEffect(() => {
    const controller = new AbortController()
    async function loadAnalytics() {
      setRefreshing(true)
      try {
        const query = new URLSearchParams({ days: String(days), [ANALYTICS_TIME_ZONE_PARAM]: systemTimeZone() })
        const response = await fetch(`/api/analytics?${query.toString()}`, { cache: "no-store", signal: controller.signal })
        const data = (await response.json()) as AnalyticsResponse
        if (data.ok && data.analytics) {
          setAnalytics(data.analytics)
          setLoadError(null)
        } else {
          setLoadError(data.error || "Could not load analytics.")
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Failed to load analytics:", error)
        setLoadError("Could not load analytics. Is Nova running?")
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    void loadAnalytics()
    return () => controller.abort()
  }, [days, reloadToken])

  // /analytics#budgets (linked from the Home Analytics panel): scroll once the section has rendered.
  useEffect(() => {
    if (!analytics || hashScrolledRef.current) return
    if (typeof window === "undefined" || window.location.hash !== "#budgets") return
    const frame = window.requestAnimationFrame(() => {
      hashScrolledRef.current = true
      document.getElementById("budgets")?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [analytics])

  const retry = useCallback(() => {
    setLoading(true)
    setReloadToken((value) => value + 1)
  }, [])

  const accentColor = isLight ? "#6366f1" : "#818cf8"
  const orbPalette = {
    bg: hexToRgba(accentColor, 0.05),
    circle1: hexToRgba(accentColor, 0.15),
    circle2: hexToRgba(accentColor, 0.25),
    circle3: hexToRgba(accentColor, 0.35),
    circle4: hexToRgba(accentColor, 0.45),
    circle5: hexToRgba(accentColor, 0.55),
  }

  const panelStyle = {
    background: isLight
      ? "linear-gradient(145deg, rgba(255, 255, 255, 0.9) 0%, rgba(244, 247, 253, 0.85) 100%)"
      : "linear-gradient(145deg, rgba(10, 10, 15, 0.4) 0%, rgba(15, 15, 25, 0.35) 100%)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
  }

  const panelClass = cn(
    "rounded-xl border transition-all duration-200",
    isLight
      ? "border-[#d5dce8] shadow-[0_4px_20px_-6px_rgba(15,23,42,0.15)]"
      : "border-white/[0.08] shadow-[0_8px_28px_-8px_rgba(0,0,0,0.4)]",
  )

  const chartColors = {
    line1: isLight ? "#6366f1" : "#818cf8",
    line2: isLight ? "#10b981" : "#34d399",
    line3: isLight ? "#f59e0b" : "#fbbf24",
    grid: isLight ? "#e5e7eb" : "#374151",
    text: isLight ? "#1f2937" : "#d1d5db",
    // Stacked-bar series in USAGE_SOURCES order (adjacent pairs validated for CVD separation per theme with the
    // dataviz palette validator) and the gap stroke between segments.
    series1: "#6366f1",
    series2: isLight ? "#10b981" : "#059669",
    series3: isLight ? "#f59e0b" : "#d97706",
    series4: isLight ? "#0ea5e9" : "#0284c7",
    series5: "#db2777",
    surface: isLight ? "#ffffff" : "#0f0f19",
  }

  /** Color follows the source, never its rank. */
  const sourceColors: Record<UsageSource, string> = {
    chat: chartColors.series1,
    "agent-task": chartColors.series2,
    mission: chartColors.series3,
    utility: chartColors.series4,
    embedding: chartColors.series5,
  }

  /** Color follows the routing tier; untagged is neutral. */
  const tierColors: Record<UsageTier, string> = {
    trivial: chartColors.series2,
    standard: chartColors.series1,
    hard: chartColors.series3,
    untagged: isLight ? "#94a3b8" : "#64748b",
  }

  const tooltipStyle: CSSProperties = {
    backgroundColor: isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 15, 25, 0.95)",
    border: isLight ? "1px solid #d5dce8" : "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "8px",
    color: isLight ? "#1f2937" : "#d1d5db",
  }

  const textPrimary = isLight ? "text-s-90" : "text-slate-100"
  const textSecondary = isLight ? "text-s-60" : "text-slate-400"
  const textMuted = isLight ? "text-s-50" : "text-slate-500"
  const insetClass = isLight ? "bg-white/50 border-[#e5e9f0]" : "bg-white/5 border-white/5"

  const formatNumber = (value: number) => value.toLocaleString()

  const header = (
    <div
      style={panelStyle}
      className={cn(
        "sticky top-0 z-50 px-6 py-3.5 mb-4",
        panelClass,
        "flex items-center justify-between border-x-0 border-t-0 rounded-none",
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/")}
          className={cn(
            "text-sm font-medium transition-colors",
            isLight ? "text-s-60 hover:text-accent" : "text-slate-400 hover:text-accent",
          )}
        >
          ← Home
        </button>
        <div className={cn("h-4 w-px", isLight ? "bg-[#d5dce8]" : "bg-white/10")} />
        <div className="flex items-center gap-2.5">
          <BarChart2 className="w-5 h-5 text-accent" />
          <h1 className={cn("text-lg font-semibold", textPrimary)}>Analytics Dashboard</h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-medium",
            isLight ? "bg-[#eef3fb] text-s-70" : "bg-white/5 text-slate-400",
          )}
        >
          {NOVA_VERSION}
        </div>
        <div>
          <NovaOrbIndicator size={28} palette={orbPalette} animated={pageActive && connected} />
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "p-2 rounded-lg transition-all duration-150",
            isLight ? "hover:bg-[#eef3fb] text-s-60 hover:text-accent" : "hover:bg-white/5 text-slate-400 hover:text-accent",
          )}
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </div>
  )

  if (loading && !analytics) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className={cn("text-center", textSecondary)}>
          <Activity className="w-8 h-8 mx-auto mb-2 animate-pulse" />
          <p>Loading analytics...</p>
        </div>
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-page">
        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        {header}
        <div className={cn("px-6 py-16 text-center", textSecondary)}>
          <p>Failed to load analytics</p>
          {loadError && <p className={cn("text-sm mt-1", textMuted)}>{loadError}</p>}
          <button
            onClick={retry}
            className={cn(
              "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border",
              isLight ? "bg-white/50 text-s-70 hover:bg-white/80 border-[#d5dce8]" : "bg-white/5 text-slate-300 hover:bg-white/10 border-white/10",
            )}
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      </div>
    )
  }

  const usage = analytics.usage
  const budgets = analytics.budgets
  const totals = usage.totals
  const hasUsage = totals.calls > 0

  const timelineData = (() => {
    switch (timeRange) {
      case "today":
        return analytics.timeline.slice(-1)
      case "week":
        return analytics.timeline.slice(-7)
      case "month":
        return analytics.timeline.slice(-30)
      default:
        return analytics.timeline
    }
  })()

  const providerData = Object.entries(analytics.byProvider).map(([provider, stats]) => ({
    name: providerLabel(provider),
    value: stats.taskCount,
    cost: stats.totalCost,
    color: PROVIDER_COLORS[provider] || "#6b7280",
  }))

  const costBySourceData = usage.daily.map((day) => {
    const row: Record<string, string | number> = { date: day.date }
    for (const source of USAGE_SOURCES) row[source] = day.bySource[source]?.costUsd ?? 0
    return row
  })

  const tokensData = usage.daily.map((day) => ({
    date: day.date,
    cached: day.cachedInputTokens,
    uncached: Math.max(0, day.inputTokens - day.cachedInputTokens),
    output: day.outputTokens,
  }))

  // Absent from servers older than Stage 6 (tiered model routing).
  const byTier = usage.byTier ?? []
  const tierCostTotal = byTier.reduce((sum, row) => sum + row.costUsd, 0)

  const providerCostMax = Math.max(0, ...usage.byProvider.map((row) => row.costUsd))
  const providerTokenMax = Math.max(0, ...usage.byProvider.map((row) => row.inputTokens + row.outputTokens))

  const rangeLabel = days === 1 ? "today" : `the last ${days} days`

  const sectionTitle = (icon: ReactNode, title: string, hint?: string) => (
    <div className="mb-4">
      <h2 className={cn("text-base font-semibold flex items-center gap-2", textPrimary)}>
        {icon}
        {title}
      </h2>
      {hint && <p className={cn("text-xs mt-1", textMuted)}>{hint}</p>}
    </div>
  )

  const emptyState = (message: string, height = "h-62.5") => (
    <div className={cn("flex items-center justify-center text-sm text-center px-4", height, textMuted)}>{message}</div>
  )

  const statCard = (icon: ReactNode, label: string, value: ReactNode, detail: ReactNode) => (
    <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
      <div className="flex items-center justify-between mb-3 gap-2">
        {icon}
        <span className={cn("text-xs font-medium text-right", textMuted)}>{label}</span>
      </div>
      <p className={cn("text-3xl font-bold truncate", textPrimary)}>{value}</p>
      <div className={cn("text-xs mt-1", textSecondary)}>{detail}</div>
    </div>
  )

  const budgetChip = (state: AgentTaskBudgetState, count?: number) => {
    const meta = BUDGET_STATE_META[state]
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap", textPrimary)}
        style={{ borderColor: hexToRgba(meta.color, 0.45), backgroundColor: hexToRgba(meta.color, isLight ? 0.1 : 0.14) }}
      >
        <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} aria-hidden />
        {meta.label}
        {count !== undefined && <span className="font-semibold">{count}</span>}
      </span>
    )
  }

  const budgetLimitText = (row: BudgetTaskRow) => {
    const parts: string[] = []
    if (row.costBudgetUsd !== null) parts.push(`${formatUsd(row.spentUsd)} of ${formatUsd(row.costBudgetUsd)}`)
    if (row.tokenBudget !== null) parts.push(`${formatTokens(row.spentTokens)} of ${formatTokens(row.tokenBudget)} tokens`)
    if (parts.length === 0) parts.push(`${formatUsd(row.spentUsd)} · ${formatTokens(row.spentTokens)} tokens (no limit)`)
    return parts.join(" · ")
  }

  const budgetRow = (row: BudgetTaskRow, showUpdated: boolean) => {
    const meta = BUDGET_STATE_META[row.budgetState]
    const width = Math.min(1, Math.max(0, row.fraction)) * 100
    const finished = AGENT_TASK_TERMINAL.includes(row.status)
    const statusLabel = row.status.charAt(0).toUpperCase() + row.status.slice(1)
    return (
      <div key={row.id} className={cn("p-3 rounded-lg border min-w-0", insetClass, finished && "opacity-70")}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className={cn("text-sm font-medium truncate", isLight ? "text-s-80" : "text-slate-200")} title={row.name}>
                {row.name || "Untitled task"}
              </p>
              <span
                className={cn(
                  "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                  isLight ? "border-[#d5dce8] text-s-60" : "border-white/10 text-slate-400",
                )}
              >
                {statusLabel}
                {row.pauseReason === "budget" ? " by budget" : ""}
              </span>
            </div>
            <p className={cn("text-xs truncate", textMuted)} title={`${providerLabel(row.provider)} · ${row.model}`}>
              {providerLabel(row.provider)} · {row.model || "default model"}
              {finished ? " · finished, last budget state" : ""}
              {showUpdated ? ` · ${formatRelative(row.updatedAt)}` : ""}
            </p>
          </div>
          {budgetChip(row.budgetState)}
        </div>
        <div
          className={cn("h-1.5 rounded-full overflow-hidden", isLight ? "bg-[#e5e9f0]" : "bg-white/10")}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(row.fraction * 100)}
          aria-label={`${row.name} budget used`}
        >
          <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: meta.color }} />
        </div>
        <div className={cn("flex justify-between gap-3 text-xs mt-1.5", textSecondary)}>
          <span className="truncate">{budgetLimitText(row)}</span>
          <span className="font-medium whitespace-nowrap">{formatPercent(row.fraction)} used</span>
        </div>
      </div>
    )
  }

  const eventSpendText = (event: BudgetEventRow) => {
    const parts: string[] = []
    if (event.costBudgetUsd !== null) parts.push(`${formatUsd(event.spentUsd)} of ${formatUsd(event.costBudgetUsd)}`)
    if (event.tokenBudget !== null) parts.push(`${formatTokens(event.spentTokens)} of ${formatTokens(event.tokenBudget)} tokens`)
    if (parts.length === 0) parts.push(`${formatUsd(event.spentUsd)} · ${formatTokens(event.spentTokens)} tokens, no limit`)
    return parts.join(" · ")
  }

  const historyRow = (event: BudgetEventRow) => {
    const meta = BUDGET_EVENT_META[event.kind]
    const when = new Date(event.ts)
    const deleted = event.taskName === null
    const taskLabel = deleted ? "Deleted task" : event.taskName || "Untitled task"
    const detail =
      event.kind === "degraded" && event.economyModel
        ? `Switched to ${event.economyModel}`
        : event.kind === "raised"
          ? "Raised by you"
          : event.model
    return (
      <li key={event.id} className="relative pl-4 min-w-0">
        <span
          className="absolute -left-1.5 top-1 w-3 h-3 rounded-full border-2"
          style={{ backgroundColor: meta.color, borderColor: chartColors.surface }}
          aria-hidden
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <time
            dateTime={event.ts}
            title={when.toLocaleString()}
            className={cn("text-xs tabular-nums whitespace-nowrap w-28 shrink-0", textMuted)}
          >
            {when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
            {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </time>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap shrink-0",
              textPrimary,
            )}
            style={{ borderColor: hexToRgba(meta.color, 0.45), backgroundColor: hexToRgba(meta.color, isLight ? 0.1 : 0.14) }}
          >
            <meta.Icon className="w-3 h-3" style={{ color: meta.color }} aria-hidden />
            {meta.label}
          </span>
          <span
            className={cn(
              "text-sm font-medium truncate min-w-0 flex-1 basis-40",
              deleted ? cn("italic", textMuted) : isLight ? "text-s-80" : "text-slate-200",
            )}
            title={deleted ? `Deleted task (${event.taskId})` : taskLabel}
          >
            {taskLabel}
          </span>
          <span className={cn("text-xs tabular-nums whitespace-nowrap", textSecondary)}>
            {eventSpendText(event)}
            {event.fraction > 0 ? ` · ${formatPercent(event.fraction)}` : ""}
          </span>
        </div>
        {detail && (
          <p className={cn("text-[11px] truncate mt-0.5 sm:pl-31", textMuted)} title={detail}>
            {detail}
          </p>
        )}
      </li>
    )
  }

  const bySourceTooltip = (value: unknown) => (typeof value === "number" ? formatUsd(value) : String(value))
  const tokenTooltip = (value: unknown) => (typeof value === "number" ? `${formatTokens(value)} tokens` : String(value))

  return (
    <div className="min-h-screen bg-page">
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {header}

      <div className="px-6 pb-8">
        {/* Time Range Selector */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {(["today", "week", "month", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              aria-pressed={timeRange === range}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                timeRange === range
                  ? "bg-accent text-white shadow-lg"
                  : isLight
                  ? "bg-white/50 text-s-70 hover:bg-white/80 border border-[#d5dce8]"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 border border-white/10",
              )}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
          <span className={cn("text-xs ml-2 flex items-center gap-1.5", textMuted)}>
            {refreshing && <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden />}
            LLM usage for {rangeLabel} · history kept {usage.range.retentionDays} days
          </span>
          {loadError && <span className="text-xs text-red-500">{loadError}</span>}
        </div>

        {/* ── LLM usage (chat, agent tasks, missions) ── */}
        <h2 className={cn("text-sm font-semibold uppercase tracking-wide mb-3", textSecondary)}>LLM usage · all sources</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {statCard(
            <DollarSign className="w-5 h-5 text-emerald-500" />,
            "SPEND",
            formatUsd(totals.costUsd),
            <>
              {formatNumber(totals.calls)} calls
              {totals.unpricedCalls > 0 && (
                <span className="block text-amber-500">
                  {formatNumber(totals.unpricedCalls)} call{totals.unpricedCalls === 1 ? "" : "s"} on models with unknown pricing (not in the total)
                </span>
              )}
            </>,
          )}
          {statCard(
            <Zap className="w-5 h-5 text-yellow-500" />,
            "TOKENS",
            formatTokens(totals.inputTokens + totals.outputTokens),
            <>
              {formatTokens(totals.inputTokens)} in · {formatTokens(totals.outputTokens)} out
            </>,
          )}
          {statCard(
            <Database className="w-5 h-5 text-blue-500" />,
            "CACHE HIT RATE",
            hasUsage ? formatPercent(totals.cacheHitRate) : "—",
            <>
              {formatTokens(totals.cachedInputTokens)} cached · {formatTokens(totals.uncachedInputTokens)} uncached
              {totals.cacheWriteInputTokens > 0 && <> · {formatTokens(totals.cacheWriteInputTokens)} cache writes</>}
            </>,
          )}
          {statCard(
            <PiggyBank className="w-5 h-5 text-accent" />,
            "SAVED BY CACHING",
            <span className={usage.savings.savingsUsd < 0 ? "text-amber-500" : undefined}>{formatUsd(usage.savings.savingsUsd)}</span>,
            <>
              Estimated, at list prices
              {usage.savings.savingsUsd < 0 && (
                <span className="block text-amber-500">Negative: cache writes cost more than plain input until they are re-read</span>
              )}
              {usage.savings.unpricedCachedInputTokens > 0 && (
                <span className="block">{formatTokens(usage.savings.unpricedCachedInputTokens)} cached tokens on unpriced models not counted</span>
              )}
            </>,
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Cost over time by source */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<DollarSign className="w-4 h-4 text-emerald-500" />, "Cost by Source", "Per local day; unpriced calls add no cost")}
            {hasUsage ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={costBySourceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} vertical={false} />
                  <XAxis dataKey="date" stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={formatDayShort} />
                  <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={(value: number) => formatUsdTick(value)} width={64} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDayLong} formatter={bySourceTooltip} cursor={{ fill: hexToRgba(chartColors.series1, 0.06) }} />
                  {/* Legend in stack (source) order, not recharts' default alphabetical order. */}
                  <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                  {USAGE_SOURCES.map((source, index) => (
                    <Bar
                      key={source}
                      dataKey={source}
                      stackId="cost"
                      fill={sourceColors[source]}
                      stroke={chartColors.surface}
                      strokeWidth={1}
                      name={USAGE_SOURCE_LABELS[source]}
                      radius={index === USAGE_SOURCES.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              emptyState(`No LLM calls ${days === 1 ? "today" : "in this range"} yet`)
            )}
          </div>

          {/* Tokens over time */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<Zap className="w-4 h-4 text-yellow-500" />, "Tokens", "Input split into cached and uncached (uncached includes cache writes), plus output")}
            {hasUsage ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={tokensData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} vertical={false} />
                  <XAxis dataKey="date" stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={formatDayShort} />
                  <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={(value: number) => formatTokens(value)} width={48} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDayLong} formatter={tokenTooltip} cursor={{ fill: hexToRgba(chartColors.series1, 0.06) }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                  <Bar dataKey="cached" stackId="tokens" fill={chartColors.series2} stroke={chartColors.surface} strokeWidth={1} name="Cached input" />
                  <Bar dataKey="uncached" stackId="tokens" fill={chartColors.series1} stroke={chartColors.surface} strokeWidth={1} name="Uncached input" />
                  <Bar dataKey="output" stackId="tokens" fill={chartColors.series3} stroke={chartColors.surface} strokeWidth={1} name="Output" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              emptyState(`No LLM calls ${days === 1 ? "today" : "in this range"} yet`)
            )}
          </div>

          {/* By provider */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<Activity className="w-4 h-4 text-accent" />, "By Provider")}
            {usage.byProvider.length > 0 ? (
              <div className="space-y-3">
                {usage.byProvider.map((row) => {
                  const color = PROVIDER_COLORS[row.provider] || "#6b7280"
                  const tokens = row.inputTokens + row.outputTokens
                  return (
                    <div key={row.provider || "unknown"} className={cn("p-3 rounded-lg border min-w-0", insetClass)}>
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className={cn("flex items-center gap-2 text-sm font-medium min-w-0", isLight ? "text-s-80" : "text-slate-200")}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
                          <span className="truncate">{providerLabel(row.provider)}</span>
                        </span>
                        <span className={cn("text-sm font-semibold whitespace-nowrap", textPrimary)}>{formatUsd(row.costUsd)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={cn("h-1.5 rounded-full overflow-hidden", isLight ? "bg-[#e5e9f0]" : "bg-white/10")}>
                            <div className="h-full rounded-full" style={{ width: `${providerCostMax > 0 ? (row.costUsd / providerCostMax) * 100 : 0}%`, backgroundColor: color }} />
                          </div>
                          <p className={cn("text-[11px] mt-1", textMuted)}>Cost</p>
                        </div>
                        <div>
                          <div className={cn("h-1.5 rounded-full overflow-hidden", isLight ? "bg-[#e5e9f0]" : "bg-white/10")}>
                            <div className="h-full rounded-full" style={{ width: `${providerTokenMax > 0 ? (tokens / providerTokenMax) * 100 : 0}%`, backgroundColor: hexToRgba(color, 0.6) }} />
                          </div>
                          <p className={cn("text-[11px] mt-1", textMuted)}>
                            {formatTokens(tokens)} tokens · {formatPercent(row.cacheHitRate)} cached · {formatNumber(row.calls)} calls
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              emptyState("No LLM calls in this range yet", "h-40")
            )}
          </div>

          {/* Usage by source totals */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<Gauge className="w-4 h-4 text-accent" />, "By Source")}
            <div className="space-y-2">
              {usage.bySource.map((row) => {
                const color = sourceColors[row.source] ?? "#6b7280"
                const label = USAGE_SOURCE_LABELS[row.source] ?? row.source
                return (
                  <div
                    key={row.source}
                    className={cn("p-3 rounded-lg border flex items-center justify-between gap-3", insetClass, row.calls === 0 && "opacity-60")}
                  >
                    <span className={cn("flex items-center gap-2 text-sm font-medium shrink-0", isLight ? "text-s-80" : "text-slate-200")}>
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} aria-hidden />
                      {label}
                    </span>
                    <span className={cn("text-xs text-right", textSecondary)}>
                      <span className={cn("text-sm font-semibold mr-2", textPrimary)}>{formatUsd(row.costUsd)}</span>
                      {formatNumber(row.calls)} calls · {formatTokens(row.inputTokens + row.outputTokens)} tokens · {formatPercent(row.cacheHitRate)} cached
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* By routing tier */}
        <div style={panelStyle} className={cn(panelClass, "p-5 mb-6 min-w-0")}>
          {sectionTitle(
            <Layers className="w-4 h-4 text-accent" />,
            "By Tier",
            "Routing tier of each call (Settings → Model routing). Calls from before model routing, embeddings and model tests are untagged.",
          )}
          {hasUsage && byTier.length > 0 ? (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {byTier.map((row) => {
                const color = tierColors[row.tier] ?? tierColors.untagged
                const share = tierCostTotal > 0 ? row.costUsd / tierCostTotal : 0
                return (
                  <div key={row.tier} className={cn("p-3 rounded-lg border min-w-0", insetClass, row.calls === 0 && "opacity-60")}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={cn("flex items-center gap-2 text-sm font-medium min-w-0", isLight ? "text-s-80" : "text-slate-200")}>
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} aria-hidden />
                        <span className="truncate">{USAGE_TIER_LABELS[row.tier] ?? row.tier}</span>
                      </span>
                      <span className={cn("text-sm font-semibold whitespace-nowrap tabular-nums", textPrimary)}>{formatUsd(row.costUsd)}</span>
                    </div>
                    <div className={cn("h-1.5 rounded-full overflow-hidden", isLight ? "bg-[#e5e9f0]" : "bg-white/10")}>
                      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: color }} />
                    </div>
                    <p className={cn("text-[11px] mt-1.5 tabular-nums", textMuted)}>
                      {formatNumber(row.calls)} calls · {formatTokens(row.inputTokens + row.outputTokens)} tokens
                      {row.unpricedCalls > 0 ? ` · ${formatNumber(row.unpricedCalls)} unpriced` : ""}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            emptyState(`No LLM calls ${days === 1 ? "today" : "in this range"} yet`, "h-24")
          )}
        </div>

        {/* By model */}
        <div style={panelStyle} className={cn(panelClass, "p-5 mb-8 min-w-0")}>
          {sectionTitle(<BarChart2 className="w-4 h-4 text-accent" />, "By Model", "Savings are estimated at list prices; negative means cache writes cost more than they saved")}
          {usage.byModel.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={cn("text-xs text-left border-b", textMuted, isLight ? "border-[#e5e9f0]" : "border-white/10")}>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium">Provider</th>
                    <th className="py-2 pr-3 font-medium text-right">Calls</th>
                    <th className="py-2 pr-3 font-medium text-right">Tokens</th>
                    <th className="py-2 pr-3 font-medium text-right">Cached</th>
                    <th className="py-2 pr-3 font-medium text-right">Cost</th>
                    <th className="py-2 font-medium text-right">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((row) => (
                    <tr key={`${row.provider}\u0000${row.model}`} className={cn("border-b last:border-b-0", isLight ? "border-[#eef1f6]" : "border-white/5")}>
                      <td className={cn("py-2 pr-3 max-w-65", isLight ? "text-s-80" : "text-slate-200")}>
                        <span className="block truncate font-medium" title={row.model}>{row.model || "unknown model"}</span>
                      </td>
                      <td className={cn("py-2 pr-3 whitespace-nowrap", textSecondary)}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROVIDER_COLORS[row.provider] || "#6b7280" }} aria-hidden />
                          {providerLabel(row.provider)}
                        </span>
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", textSecondary)}>{formatNumber(row.calls)}</td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", textSecondary)} title={`${formatNumber(row.inputTokens)} in · ${formatNumber(row.outputTokens)} out`}>
                        {formatTokens(row.inputTokens + row.outputTokens)}
                      </td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums", textSecondary)}>{formatPercent(row.cacheHitRate)}</td>
                      <td className={cn("py-2 pr-3 text-right tabular-nums whitespace-nowrap", row.priced ? textPrimary : "text-amber-500")}>
                        {row.priced ? formatUsd(row.costUsd) : "Pricing unknown"}
                      </td>
                      <td className={cn("py-2 text-right tabular-nums whitespace-nowrap", row.priced && row.savingsUsd < 0 ? "text-amber-500" : textSecondary)}>
                        {row.priced ? formatUsd(row.savingsUsd) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            emptyState("No LLM calls in this range yet", "h-30")
          )}
        </div>

        {/* ── Agent tasks ── */}
        <h2 className={cn("text-sm font-semibold uppercase tracking-wide mb-3", textSecondary)}>Agent tasks</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {statCard(
            <Target className="w-5 h-5 text-accent" />,
            "TOTAL TASKS",
            formatNumber(analytics.totalTasks),
            <>
              {analytics.todayTasks} today · {analytics.weekTasks} this week
            </>,
          )}
          {statCard(
            <DollarSign className="w-5 h-5 text-emerald-500" />,
            "TOTAL COST",
            formatUsd(analytics.totalCost),
            <>{formatUsd(analytics.averageCostPerTask)} avg per task</>,
          )}
          {statCard(<TrendingUp className="w-5 h-5 text-blue-500" />, "SUCCESS RATE", `${analytics.successRate.toFixed(1)}%`, "Completed successfully")}
          {statCard(
            <Zap className="w-5 h-5 text-yellow-500" />,
            "TOTAL TOKENS",
            formatTokens(analytics.totalTokensIn + analytics.totalTokensOut),
            <>
              {formatTokens(analytics.totalTokensIn)} in · {formatTokens(analytics.totalTokensOut)} out
            </>,
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Tasks Over Time */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<Calendar className="w-4 h-4 text-accent" />, "Tasks Over Time")}
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} />
                <XAxis dataKey="date" stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={formatDayShort} />
                <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDayLong} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="totalTasks" stroke={chartColors.line1} strokeWidth={2} name="Total Tasks" />
                <Line type="monotone" dataKey="successfulTasks" stroke={chartColors.line2} strokeWidth={2} name="Successful" />
                <Line type="monotone" dataKey="failedTasks" stroke="#ef4444" strokeWidth={2} name="Failed" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Cost Over Time */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<DollarSign className="w-4 h-4 text-emerald-500" />, "Task Cost Over Time")}
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} />
                <XAxis dataKey="date" stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={formatDayShort} />
                <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} tickFormatter={(value: number) => formatUsdTick(value)} width={64} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={formatDayLong} formatter={bySourceTooltip} />
                <Bar dataKey="totalCost" fill="#10b981" name="Cost (USD)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tasks by Provider */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<Activity className="w-4 h-4 text-accent" />, "Tasks by Provider")}
            {providerData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={providerData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {providerData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: unknown, name: unknown, props: { payload?: { cost?: number } }) => {
                      const numValue = typeof value === "number" ? value : 0
                      return [`${numValue} tasks (${formatUsd(props.payload?.cost ?? 0)})`, String(name)]
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              emptyState("No agent tasks yet")
            )}
          </div>

          {/* Top Models by Cost */}
          <div style={panelStyle} className={cn(panelClass, "p-5 min-w-0")}>
            {sectionTitle(<BarChart2 className="w-4 h-4 text-accent" />, "Top Task Models by Cost")}
            <div className="space-y-3 max-h-62.5 overflow-y-auto">
              {analytics.byModel.slice(0, 8).map((model, index) => (
                <div key={`${model.provider}-${model.model}-${index}`} className={cn("p-3 rounded-lg border", insetClass)}>
                  <div className="flex justify-between items-start gap-3 mb-1">
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium truncate", isLight ? "text-s-80" : "text-slate-200")} title={model.model}>
                        {model.model}
                      </p>
                      <p className={cn("text-xs", textMuted)}>{providerLabel(model.provider)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold", textPrimary)}>{formatUsd(model.totalCost)}</p>
                      <p className={cn("text-xs", textMuted)}>{model.taskCount} tasks</p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className={textSecondary}>{formatTokens(model.tokensIn)} tokens in</span>
                    <span className={textMuted}>•</span>
                    <span className={textSecondary}>{formatTokens(model.tokensOut)} tokens out</span>
                  </div>
                </div>
              ))}
              {analytics.byModel.length === 0 && (
                <p className={cn("text-sm text-center py-8", textMuted)}>No model data available</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Budgets ── */}
        <section id="budgets" className="scroll-mt-24">
          <h2 className={cn("text-sm font-semibold uppercase tracking-wide mb-3", textSecondary)}>Agent task budgets</h2>
          <div style={panelStyle} className={cn(panelClass, "p-5 mb-6 min-w-0")}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap gap-2">
                {budgetChip("warning", budgets.counts.warning)}
                {budgetChip("degraded", budgets.counts.degraded)}
                {budgetChip("exhausted", budgets.counts.exhausted)}
              </div>
              <p className={cn("text-xs", textMuted)}>
                Default budget:{" "}
                {budgets.defaults.costBudgetUsd === null && budgets.defaults.tokenBudget === null
                  ? "none"
                  : [
                      budgets.defaults.costBudgetUsd !== null ? formatUsd(budgets.defaults.costBudgetUsd) : null,
                      budgets.defaults.tokenBudget !== null ? `${formatTokens(budgets.defaults.tokenBudget)} tokens` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                {" · "}Resume or raise a budget from the{" "}
                <Link href="/" className="text-accent hover:underline">
                  Agent Tasks card on Home
                </Link>
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="min-w-0">
                <h3 className={cn("text-sm font-semibold mb-1", textPrimary)}>Tasks with a budget</h3>
                <p className={cn("text-xs mb-3", textMuted)}>Highest share of budget used first</p>
                {budgets.tasks.length > 0 ? (
                  <div className="space-y-2 max-h-105 overflow-y-auto pr-1">{budgets.tasks.map((row) => budgetRow(row, false))}</div>
                ) : (
                  emptyState("No agent task has a budget. Set a default in Settings or a budget when creating a task.", "h-30")
                )}
              </div>
              <div className="min-w-0">
                <h3 className={cn("text-sm font-semibold mb-1", textPrimary)}>Budget alerts</h3>
                <p className={cn("text-xs mb-3", textMuted)}>Current budget state per task, most recently updated first</p>
                {budgets.alerts.length > 0 ? (
                  <div className="space-y-2 max-h-105 overflow-y-auto pr-1">{budgets.alerts.map((row) => budgetRow(row, true))}</div>
                ) : (
                  emptyState("No task is near or over its budget", "h-30")
                )}
              </div>
            </div>

            <div className={cn("mt-6 pt-5 border-t min-w-0", isLight ? "border-[#e5e9f0]" : "border-white/10")}>
              <h3 className={cn("text-sm font-semibold mb-1 flex items-center gap-2", textPrimary)}>
                <History className="w-4 h-4 text-accent" aria-hidden />
                Budget history
              </h3>
              <p className={cn("text-xs mb-3", textMuted)}>
                Every warning, switch to the economy model, stop and budget raise for {rangeLabel}, newest first
                {budgets.historyTruncated ? ` (latest ${budgets.history.length} shown)` : ""}. Spend is as it was at that moment.
              </p>
              {budgets.history.length > 0 ? (
                <div className="max-h-105 overflow-y-auto pr-1">
                  <ol className={cn("space-y-3 border-l ml-1.5 py-1", isLight ? "border-[#d5dce8]" : "border-white/15")}>
                    {budgets.history.map(historyRow)}
                  </ol>
                </div>
              ) : (
                emptyState(`No budget events ${days === 1 ? "today" : "in this range"}`, "h-20")
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
