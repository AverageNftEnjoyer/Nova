"use client"

import { useEffect, useMemo, useState } from "react"

import type { PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

interface MarketTickerProps {
  isLight: boolean
  subPanelClass: string
  markets: PolymarketMarket[]
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--"
  return `${Math.round(value * 100)}c`
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

export function MarketTicker({ isLight, subPanelClass, markets }: MarketTickerProps) {
  const [cursor, setCursor] = useState(0)
  const [paused, setPaused] = useState(false)

  const rows = useMemo(() => (
    [...markets]
      .sort((a, b) => Number(b.volume24hr || 0) - Number(a.volume24hr || 0))
      .slice(0, 10)
  ), [markets])

  useEffect(() => {
    if (paused || rows.length <= 1) return
    const timer = setInterval(() => {
      setCursor((prev) => (prev + 1) % rows.length)
    }, 2_400)
    return () => clearInterval(timer)
  }, [paused, rows])

  const visible = rows.length <= 4
    ? rows
    : Array.from({ length: 4 }, (_, offset) => rows[(cursor + offset) % rows.length])

  return (
    <div
      className={cn("home-spotlight-card home-border-glow mt-3 rounded-lg border px-2 py-2", subPanelClass)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>Market Ticker</p>
        <p className={cn("text-[10px] uppercase tracking-[0.14em]", isLight ? "text-s-50" : "text-slate-500")}>{paused ? "Paused" : "Live"}</p>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {visible.length === 0 ? <p className="text-sm text-slate-400">No markets in ticker.</p> : visible.map((market) => {
          const outcome = market.outcomes[0] || market.outcomes[1]
          const price = outcome?.price || outcome?.lastTradePrice || 0
          return (
            <div key={market.slug} className={cn("rounded-md border px-2 py-1.5", isLight ? "border-[#d5dce8] bg-white" : "border-white/10 bg-black/20")}>
              <p className={cn("truncate text-[11px]", isLight ? "text-s-70" : "text-slate-300")}>{market.question}</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className={cn("text-xs font-semibold", isLight ? "text-s-90" : "text-slate-100")}>{formatPrice(price)}</span>
                <span className={cn("text-[10px]", isLight ? "text-s-50" : "text-slate-500")}>{formatUsd(market.volume24hr)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
