import type { PolymarketMarket, PolymarketOrderBook } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

interface OrderBookVisualProps {
  isLight: boolean
  subPanelClass: string
  market: PolymarketMarket | null
  orderBook: PolymarketOrderBook | null
  loading: boolean
  error: string
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value * 100)}c`
}

function formatSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

function toPercent(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) return 0
  return Math.max(0, Math.min(100, (value / maxValue) * 100))
}

export function OrderBookVisual({
  isLight,
  subPanelClass,
  market,
  orderBook,
  loading,
  error,
}: OrderBookVisualProps) {
  const bids = orderBook?.bids?.slice(0, 5) ?? []
  const asks = orderBook?.asks?.slice(0, 5) ?? []
  const depthMax = Math.max(
    1,
    ...bids.map((row) => Number(row.size || 0)),
    ...asks.map((row) => Number(row.size || 0)),
  )

  return (
    <div className={cn("rounded-xl border p-3", subPanelClass)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Orderbook Depth</p>
        <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>
          {market?.outcomes[0]?.label || "Market"}
        </p>
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-400">Loading orderbook...</p> : null}
      {!loading && error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {!loading && !error && !orderBook ? <p className="mt-3 text-sm text-slate-400">Select an outcome with a tradable token.</p> : null}

      {!loading && !error && orderBook ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <p className={cn("mb-2 text-[10px] uppercase tracking-[0.14em]", isLight ? "text-emerald-700" : "text-emerald-300")}>Bids</p>
            <div className="space-y-2">
              {bids.length === 0 ? <p className="text-xs text-slate-400">No bid depth.</p> : bids.map((row, index) => (
                <div key={`bid-${index}`} className={cn("rounded-lg border p-2", isLight ? "border-emerald-200 bg-emerald-50/70" : "border-emerald-500/20 bg-emerald-500/10")}>
                  <div className="relative h-1.5 overflow-hidden rounded bg-black/10">
                    <div className="absolute inset-y-0 left-0 bg-emerald-400/70" style={{ width: `${toPercent(row.size, depthMax)}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>{formatPrice(row.price)}</span>
                    <span className={cn(isLight ? "text-s-90" : "text-slate-100")}>{formatSize(row.size)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className={cn("mb-2 text-[10px] uppercase tracking-[0.14em]", isLight ? "text-rose-700" : "text-rose-300")}>Asks</p>
            <div className="space-y-2">
              {asks.length === 0 ? <p className="text-xs text-slate-400">No ask depth.</p> : asks.map((row, index) => (
                <div key={`ask-${index}`} className={cn("rounded-lg border p-2", isLight ? "border-rose-200 bg-rose-50/70" : "border-rose-500/20 bg-rose-500/10")}>
                  <div className="relative h-1.5 overflow-hidden rounded bg-black/10">
                    <div className="absolute inset-y-0 left-0 bg-rose-400/70" style={{ width: `${toPercent(row.size, depthMax)}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className={cn(isLight ? "text-s-70" : "text-slate-300")}>{formatPrice(row.price)}</span>
                    <span className={cn(isLight ? "text-s-90" : "text-slate-100")}>{formatSize(row.size)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
