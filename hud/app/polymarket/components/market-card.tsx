import type { PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

interface MarketCardProps {
  market: PolymarketMarket
  isSelected: boolean
  isLight: boolean
  subPanelClass: string
  onSelect: () => void
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value * 100)}c`
}

export function MarketCard({
  market,
  isSelected,
  isLight,
  subPanelClass,
  onSelect,
}: MarketCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "home-spotlight-card home-border-glow w-full rounded-xl border p-3 text-left transition-colors",
        isSelected
          ? (isLight ? "border-accent-30 bg-[#eef3fb]" : "border-accent-30 bg-accent-10")
          : subPanelClass,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px] font-semibold leading-5", isLight ? "text-s-90" : "text-slate-100")}>
            {market.question}
          </p>
          <p className={cn("mt-1 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
            {market.tags.slice(0, 3).map((tag) => tag.label).join(" / ") || "Polymarket"}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.16em]",
            isLight ? "border-[#d5dce8] text-s-50" : "border-white/10 text-slate-400",
          )}
        >
          {market.acceptingOrders ? "Live" : "Watch"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {market.outcomes.slice(0, 2).map((outcome) => (
          <div
            key={`${market.slug}-${outcome.index}`}
            className={cn("rounded-lg border px-3 py-2", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={cn("text-sm", isLight ? "text-s-70" : "text-slate-300")}>{outcome.label}</span>
              <span className={cn("text-sm font-semibold", isLight ? "text-s-90" : "text-slate-100")}>
                {formatPrice(outcome.price || outcome.lastTradePrice)}
              </span>
            </div>
            <div className={cn("mt-2 flex items-center justify-between text-[10px]", isLight ? "text-s-50" : "text-slate-500")}>
              <span>Bid {formatPrice(outcome.bestBid)}</span>
              <span>Ask {formatPrice(outcome.bestAsk)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={cn("mt-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.12em]", isLight ? "text-s-50" : "text-slate-500")}>
        <span>24h {formatUsd(market.volume24hr)}</span>
        <span>Liquidity {formatUsd(market.liquidity)}</span>
        <span>Min {market.orderMinSize || 5}</span>
      </div>
    </button>
  )
}
