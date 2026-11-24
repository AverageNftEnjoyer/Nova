import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { buildPolymarketMarketUrl, type PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

interface MarketDetailProps {
  market: PolymarketMarket
  selectedOutcomeLabel: string
  selectedOutcomePriceLabel: string
  isLight: boolean
  subPanelClass: string
}

export function MarketDetail({
  market,
  selectedOutcomeLabel,
  selectedOutcomePriceLabel,
  isLight,
  subPanelClass,
}: MarketDetailProps) {
  return (
    <div className={cn("rounded-xl border p-3", subPanelClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-base font-semibold leading-snug", isLight ? "text-s-90" : "text-slate-100")}>{market.question}</p>
          <p className={cn("mt-1 text-[11px] leading-5", isLight ? "text-s-50" : "text-slate-400")}>
            {market.description || "Select an outcome, size the order, and route execution through Phantom approval."}
          </p>
        </div>
        <Link
          href={buildPolymarketMarketUrl(market.slug)}
          target="_blank"
          className={cn(
            "home-spotlight-card home-border-glow home-spotlight-card--hover inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] transition-colors",
            subPanelClass,
          )}
        >
          Open<ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className={cn("mt-3 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>
        <span>Outcome {selectedOutcomeLabel || "--"}</span>
        <span>Price {selectedOutcomePriceLabel || "--"}</span>
        <span>24h {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(market.volume24hr || 0)}</span>
      </div>
    </div>
  )
}
