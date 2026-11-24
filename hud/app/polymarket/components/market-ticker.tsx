"use client"

import { useMemo } from "react"

import type { PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatCents, formatCompactUsd, marketYesPrice } from "../lib/format"

interface MarketTickerProps {
  markets: PolymarketMarket[]
  selectedSlug: string
  onSelect: (market: PolymarketMarket) => void
}

/** Quiet strip of the ten busiest loaded markets by 24h volume. Static; scrolls sideways when it overflows. */
export function MarketTicker({ markets, selectedSlug, onSelect }: MarketTickerProps) {
  const rows = useMemo(
    () => [...markets].sort((a, b) => Number(b.volume24hr || 0) - Number(a.volume24hr || 0)).slice(0, 10),
    [markets],
  )
  if (rows.length === 0) return null
  return (
    <nav aria-label="Busiest markets" className="no-scrollbar overflow-x-auto rounded-lg">
      <ul className="flex min-w-max items-stretch divide-x divide-border-subtle rounded-lg border border-border bg-surface">
        {rows.map((market) => (
          <li key={market.slug}>
            <button
              type="button"
              onClick={() => onSelect(market)}
              aria-pressed={market.slug === selectedSlug}
              className={cn(
                "flex h-9 max-w-64 items-center gap-2 px-3 text-xs transition-colors duration-150 hover:bg-hover",
                market.slug === selectedSlug && "bg-accent-muted",
              )}
              title={market.question}
            >
              <span className="truncate text-muted">{market.question}</span>
              <span className="font-mono tabular-nums text-fg">{formatCents(marketYesPrice(market))}</span>
              <span className="font-mono tabular-nums text-faint">{formatCompactUsd(market.volume24hr)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
