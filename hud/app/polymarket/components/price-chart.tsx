import type { PolymarketPricePoint } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

export type PriceChartRange = "1h" | "6h" | "1d" | "1w" | "1m" | "all"

interface PriceChartProps {
  points: PolymarketPricePoint[]
  range: PriceChartRange
  onRangeChange: (range: PriceChartRange) => void
  isLight: boolean
  subPanelClass: string
  loading: boolean
  error: string
}

const RANGES: Array<{ id: PriceChartRange; label: string }> = [
  { id: "1h", label: "1H" },
  { id: "6h", label: "6H" },
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "all", label: "ALL" },
]

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function buildPath(points: PolymarketPricePoint[]): string {
  if (points.length === 0) return ""
  const values = points.map((point) => clamp01(point.p))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 0.02)
  return points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100
    const normalized = (clamp01(point.p) - min) / span
    const y = 100 - normalized * 100
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(" ")
}

function formatPrice(value: number): string {
  return `${Math.round(clamp01(value) * 100)}c`
}

export function PriceChart({
  points,
  range,
  onRangeChange,
  isLight,
  subPanelClass,
  loading,
  error,
}: PriceChartProps) {
  const path = buildPath(points)
  const last = points.length > 0 ? points[points.length - 1] : null

  return (
    <div className={cn("rounded-xl border p-3", subPanelClass)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Price History</p>
        <div className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1 py-1">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onRangeChange(item.id)}
              className={cn(
                "rounded px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors",
                range === item.id
                  ? (isLight ? "bg-[#e4ecf8] text-s-90" : "bg-white/14 text-slate-100")
                  : (isLight ? "text-s-50 hover:bg-[#edf2fb]" : "text-slate-500 hover:bg-white/8 hover:text-slate-200"),
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-400">Loading chart data...</p> : null}
      {!loading && error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {!loading && !error && points.length === 0 ? <p className="mt-3 text-sm text-slate-400">No chart points available for this market.</p> : null}

      {!loading && !error && points.length > 0 ? (
        <div className={cn("mt-3 rounded-lg border p-2", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
          <svg viewBox="0 0 100 100" className="h-36 w-full" preserveAspectRatio="none">
            <path d={path} fill="none" stroke={isLight ? "#2563eb" : "#60a5fa"} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className={cn(isLight ? "text-s-50" : "text-slate-500")}>{points.length} points</span>
            <span className={cn("font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{formatPrice(last?.p || 0)}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
