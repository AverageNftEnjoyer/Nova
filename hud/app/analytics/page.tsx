"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Settings, TrendingUp, BarChart2, Activity, DollarSign, Zap, Target, Calendar } from "lucide-react"
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { useTheme } from "@/lib/context/theme-context"
import { cn } from "@/lib/shared/utils"
import { SettingsModal } from "@/components/settings/settings-modal"
import { NovaOrbIndicator } from "@/components/chat/nova-orb-indicator"
import { useNovaState } from "@/lib/chat/hooks/useNovaState"
import { getNovaPresence } from "@/lib/chat/nova-presence"
import { usePageActive } from "@/lib/hooks/use-page-active"
import { NOVA_VERSION } from "@/lib/meta/version"
import { hexToRgba } from "../home/helpers"

interface ModelStats {
  model: string
  provider: string
  taskCount: number
  tokensIn: number
  tokensOut: number
  totalCost: number
}

interface DailyStats {
  date: string
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  totalCost: number
}

interface AnalyticsData {
  totalTasks: number
  totalCost: number
  successRate: number
  averageCostPerTask: number
  totalTokensIn: number
  totalTokensOut: number
  byModel: ModelStats[]
  byProvider: Record<string, { taskCount: number; totalCost: number; successCount: number }>
  timeline: DailyStats[]
  recentTasks: number
  todayTasks: number
  weekTasks: number
  monthTasks: number
}

type TimeRange = "today" | "week" | "month" | "all"

const PROVIDER_COLORS: Record<string, string> = {
  claude: "#8b5cf6",
  openai: "#10b981",
  gemini: "#3b82f6",
  grok: "#f59e0b",
}

export default function AnalyticsPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const pageActive = usePageActive()
  const { state: novaState, connected } = useNovaState()
  const isLight = theme === "light"

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>("month")
  const [orbHovered, setOrbHovered] = useState(false)

  useEffect(() => {
    async function loadAnalytics() {
      try {
        setLoading(true)
        const response = await fetch("/api/analytics")
        const data = await response.json()
        if (data.ok && data.analytics) {
          setAnalytics(data.analytics)
        }
      } catch (error) {
        console.error("Failed to load analytics:", error)
      } finally {
        setLoading(false)
      }
    }

    loadAnalytics()
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
  }

  const getTimelineData = () => {
    if (!analytics) return []

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
  }

  const getProviderChartData = () => {
    if (!analytics) return []

    return Object.entries(analytics.byProvider).map(([provider, stats]) => ({
      name: provider.charAt(0).toUpperCase() + provider.slice(1),
      value: stats.taskCount,
      cost: stats.totalCost,
      color: PROVIDER_COLORS[provider] || "#6b7280",
    }))
  }

  const formatCurrency = (value: number) => `$${value.toFixed(4)}`
  const formatNumber = (value: number) => value.toLocaleString()

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className={cn("text-center", isLight ? "text-s-60" : "text-slate-400")}>
          <Activity className="w-8 h-8 mx-auto mb-2 animate-pulse" />
          <p>Loading analytics...</p>
        </div>
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className={cn("text-center", isLight ? "text-s-60" : "text-slate-400")}>
          <p>Failed to load analytics</p>
        </div>
      </div>
    )
  }

  const timelineData = getTimelineData()
  const providerData = getProviderChartData()

  return (
    <div className="min-h-screen bg-page">
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Header */}
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
            <h1 className={cn("text-lg font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
              Analytics Dashboard
            </h1>
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
          <div
            onMouseEnter={() => setOrbHovered(true)}
            onMouseLeave={() => setOrbHovered(false)}
          >
            <NovaOrbIndicator size={28} palette={orbPalette} animated={pageActive && connected} />
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className={cn(
              "p-2 rounded-lg transition-all duration-150",
              isLight
                ? "hover:bg-[#eef3fb] text-s-60 hover:text-accent"
                : "hover:bg-white/5 text-slate-400 hover:text-accent",
            )}
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-6 pb-8">
        {/* Time Range Selector */}
        <div className="mb-6 flex gap-2">
          {(["today", "week", "month", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
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
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <div className="flex items-center justify-between mb-3">
              <Target className="w-5 h-5 text-accent" />
              <span className={cn("text-xs font-medium", isLight ? "text-s-50" : "text-slate-500")}>
                TOTAL TASKS
              </span>
            </div>
            <p className={cn("text-3xl font-bold", isLight ? "text-s-90" : "text-slate-100")}>
              {formatNumber(analytics.totalTasks)}
            </p>
            <p className={cn("text-xs mt-1", isLight ? "text-s-60" : "text-slate-400")}>
              {analytics.todayTasks} today · {analytics.weekTasks} this week
            </p>
          </div>

          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <div className="flex items-center justify-between mb-3">
              <DollarSign className="w-5 h-5 text-emerald-500" />
              <span className={cn("text-xs font-medium", isLight ? "text-s-50" : "text-slate-500")}>
                TOTAL COST
              </span>
            </div>
            <p className={cn("text-3xl font-bold", isLight ? "text-s-90" : "text-slate-100")}>
              {formatCurrency(analytics.totalCost)}
            </p>
            <p className={cn("text-xs mt-1", isLight ? "text-s-60" : "text-slate-400")}>
              {formatCurrency(analytics.averageCostPerTask)} avg per task
            </p>
          </div>

          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              <span className={cn("text-xs font-medium", isLight ? "text-s-50" : "text-slate-500")}>
                SUCCESS RATE
              </span>
            </div>
            <p className={cn("text-3xl font-bold", isLight ? "text-s-90" : "text-slate-100")}>
              {analytics.successRate.toFixed(1)}%
            </p>
            <p className={cn("text-xs mt-1", isLight ? "text-s-60" : "text-slate-400")}>
              Completed successfully
            </p>
          </div>

          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <div className="flex items-center justify-between mb-3">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className={cn("text-xs font-medium", isLight ? "text-s-50" : "text-slate-500")}>
                TOTAL TOKENS
              </span>
            </div>
            <p className={cn("text-3xl font-bold", isLight ? "text-s-90" : "text-slate-100")}>
              {formatNumber(Math.round((analytics.totalTokensIn + analytics.totalTokensOut) / 1000))}k
            </p>
            <p className={cn("text-xs mt-1", isLight ? "text-s-60" : "text-slate-400")}>
              {formatNumber(Math.round(analytics.totalTokensIn / 1000))}k in · {formatNumber(Math.round(analytics.totalTokensOut / 1000))}k out
            </p>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tasks Over Time */}
          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <h2 className={cn("text-base font-semibold mb-4 flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
              <Calendar className="w-4 h-4 text-accent" />
              Tasks Over Time
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} />
                <XAxis
                  dataKey="date"
                  stroke={chartColors.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                />
                <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 15, 25, 0.95)",
                    border: isLight ? "1px solid #d5dce8" : "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    color: isLight ? "#1f2937" : "#d1d5db",
                  }}
                  labelFormatter={(label: unknown) => {
                    if (typeof label === 'string') return new Date(label).toLocaleDateString()
                    return String(label)
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="totalTasks" stroke={chartColors.line1} strokeWidth={2} name="Total Tasks" />
                <Line type="monotone" dataKey="successfulTasks" stroke={chartColors.line2} strokeWidth={2} name="Successful" />
                <Line type="monotone" dataKey="failedTasks" stroke="#ef4444" strokeWidth={2} name="Failed" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Cost Over Time */}
          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <h2 className={cn("text-base font-semibold mb-4 flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Cost Over Time
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} opacity={0.1} />
                <XAxis
                  dataKey="date"
                  stroke={chartColors.text}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                />
                <YAxis stroke={chartColors.text} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 15, 25, 0.95)",
                    border: isLight ? "1px solid #d5dce8" : "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    color: isLight ? "#1f2937" : "#d1d5db",
                  }}
                  labelFormatter={(label: unknown) => {
                    if (typeof label === 'string') return new Date(label).toLocaleDateString()
                    return String(label)
                  }}
                  formatter={(value: unknown) => typeof value === 'number' ? formatCurrency(value) : String(value)}
                />
                <Bar dataKey="totalCost" fill="#10b981" name="Cost (USD)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tasks by Provider */}
          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <h2 className={cn("text-base font-semibold mb-4 flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
              <Activity className="w-4 h-4 text-accent" />
              Tasks by Provider
            </h2>
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
                  contentStyle={{
                    backgroundColor: isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 15, 25, 0.95)",
                    border: isLight ? "1px solid #d5dce8" : "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    color: isLight ? "#1f2937" : "#d1d5db",
                  }}
                  formatter={(value: unknown, name: unknown, props: { payload?: { cost?: number } }) => {
                    const numValue = typeof value === 'number' ? value : 0
                    return [
                      `${numValue} tasks (${formatCurrency(props.payload?.cost ?? 0)})`,
                      String(name)
                    ]
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Top Models by Cost */}
          <div style={panelStyle} className={cn(panelClass, "p-5")}>
            <h2 className={cn("text-base font-semibold mb-4 flex items-center gap-2", isLight ? "text-s-90" : "text-slate-100")}>
              <BarChart2 className="w-4 h-4 text-accent" />
              Top Models by Cost
            </h2>
            <div className="space-y-3 max-h-[250px] overflow-y-auto">
              {analytics.byModel.slice(0, 8).map((model, index) => (
                <div
                  key={`${model.provider}-${model.model}-${index}`}
                  className={cn(
                    "p-3 rounded-lg border",
                    isLight ? "bg-white/50 border-[#e5e9f0]" : "bg-white/5 border-white/5",
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <p className={cn("text-sm font-medium", isLight ? "text-s-80" : "text-slate-200")}>
                        {model.model}
                      </p>
                      <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>
                        {model.provider.charAt(0).toUpperCase() + model.provider.slice(1)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                        {formatCurrency(model.totalCost)}
                      </p>
                      <p className={cn("text-xs", isLight ? "text-s-50" : "text-slate-500")}>
                        {model.taskCount} tasks
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                      {formatNumber(model.tokensIn)} tokens in
                    </span>
                    <span className={cn(isLight ? "text-s-50" : "text-slate-500")}>•</span>
                    <span className={cn(isLight ? "text-s-60" : "text-slate-400")}>
                      {formatNumber(model.tokensOut)} tokens out
                    </span>
                  </div>
                </div>
              ))}
              {analytics.byModel.length === 0 && (
                <p className={cn("text-sm text-center py-8", isLight ? "text-s-50" : "text-slate-500")}>
                  No model data available
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
