import { Activity, Gauge, ShieldCheck, Zap } from "lucide-react"

import { useAnimatedNumber } from "../hooks/use-animated-number"
import type { IntegrationMetricRow } from "../types"

interface StatsStripProps {
  rows: IntegrationMetricRow[]
  isLight: boolean
}

function formatCompact(value: number, suffix = ""): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M${suffix}`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K${suffix}`
  return `${value.toFixed(0)}${suffix}`
}

function StatCard({ title, value, hint, isLight, icon }: { title: string; value: string; hint: string; isLight: boolean; icon: React.ReactNode }) {
  return (
    <div className={`home-spotlight-card home-spotlight-card--hover h-[118px] rounded-xl border p-4 transition-colors ${isLight ? "border-[#d5dce8] bg-[#f4f7fd] hover:bg-[#eef3fb]" : "border-white/10 bg-black/25 backdrop-blur-md"}`}>
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-xs uppercase tracking-[0.14em] ${isLight ? "text-s-50" : "text-slate-400"}`}>{title}</p>
        <span className={isLight ? "text-s-60" : "text-slate-400"}>{icon}</span>
      </div>
      <p className={`text-2xl font-semibold font-mono ${isLight ? "text-s-90" : "text-slate-100"}`}>{value}</p>
      <p className={`mt-1 text-xs ${isLight ? "text-s-50" : "text-slate-400"}`}>{hint}</p>
    </div>
  )
}

export function StatsStrip({ rows, isLight }: StatsStripProps) {
  const totalRequests = rows.reduce((sum, row) => sum + row.requests, 0)
  const avgSuccess = rows.length ? rows.reduce((sum, row) => sum + row.successRate, 0) / rows.length : 0
  const activeServices = rows.filter((row) => row.status === "active").length
  const avgLatency = rows.length ? rows.reduce((sum, row) => sum + row.avgLatencyMs, 0) / rows.length : 0

  const requestsDisplay = useAnimatedNumber({ value: totalRequests })
  const successDisplay = useAnimatedNumber({ value: avgSuccess })
  const activeDisplay = useAnimatedNumber({ value: activeServices })
  const latencyDisplay = useAnimatedNumber({ value: avgLatency })

  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Total Requests" value={formatCompact(requestsDisplay)} hint="Across discovered services" isLight={isLight} icon={<Zap className="h-4 w-4" />} />
      <StatCard title="Avg Success" value={`${successDisplay.toFixed(1)}%`} hint="Weighted service reliability" isLight={isLight} icon={<ShieldCheck className="h-4 w-4" />} />
      <StatCard title="Active Services" value={activeDisplay.toFixed(0)} hint={`of ${rows.length} total services`} isLight={isLight} icon={<Activity className="h-4 w-4" />} />
      <StatCard title="Avg Latency" value={`${formatCompact(latencyDisplay, "ms")}`} hint="Estimated response speed" isLight={isLight} icon={<Gauge className="h-4 w-4" />} />
    </section>
  )
}
