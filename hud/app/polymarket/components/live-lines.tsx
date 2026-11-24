"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

import { EmptyState, IconButton, Panel, SkeletonRows, Tooltip } from "@/components/ui"
import { normalizePolymarketMarket, type PolymarketMarket } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { clamp01, formatCents, formatCompactUsd, outcomePrice } from "../lib/format"

const LIVE_LINES_LIMIT = 8

interface LiveLinesProps {
  selectedSlug: string
  onSelect: (market: PolymarketMarket) => void
}

/** The busiest crypto markets as a compact probability list; picking one opens it in the market panel. */
export function LiveLines({ selectedSlug, onSelect }: LiveLinesProps) {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/polymarket/markets?tag=crypto&limit=${LIVE_LINES_LIMIT}`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || !Array.isArray(data?.markets)) throw new Error(String(data?.error || "Could not load crypto markets."))
        const next = (data.markets as unknown[])
          .map((entry) => normalizePolymarketMarket(entry))
          .filter((entry): entry is PolymarketMarket => Boolean(entry))
          .slice(0, LIVE_LINES_LIMIT)
        setMarkets(next)
        setError("")
      })
      .catch((reason) => {
        if (cancelled) return
        setMarkets([])
        setError(reason instanceof Error ? reason.message : "Could not load crypto markets.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  return (
    <Panel
      title="Crypto live lines"
      description="Current odds on the busiest crypto markets."
      flush
      actions={
        <Tooltip content="Refresh">
          <IconButton aria-label="Refresh crypto lines" size="sm" onClick={() => {
              setLoading(true)
              setReloadToken((value) => value + 1)
            }} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </IconButton>
        </Tooltip>
      }
    >
      {loading && markets.length === 0 ? (
        <div className="p-4">
          <SkeletonRows rows={6} />
        </div>
      ) : error ? (
        <EmptyState size="compact" tone="danger" title="Crypto lines did not load" description={error} />
      ) : markets.length === 0 ? (
        <EmptyState size="compact" title="No crypto markets open" description="Polymarket has no active crypto markets right now." />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {markets.map((market) => {
            const [first, second] = market.outcomes
            const p = clamp01(outcomePrice(first))
            const selected = market.slug === selectedSlug
            return (
              <li key={market.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(market)}
                  aria-pressed={selected}
                  className={cn(
                    "flex w-full flex-col gap-1.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-hover",
                    selected && "bg-accent-muted hover:bg-accent-muted",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-fg" title={market.question}>
                      {market.question}
                    </span>
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">{formatCompactUsd(market.volume24hr)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-24 truncate text-xs text-muted">
                      {first?.label ?? "Yes"} <span className="font-mono tabular-nums text-fg">{formatCents(outcomePrice(first))}</span>
                    </span>
                    <span
                      className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-surface-3"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(p * 100)}
                      aria-label={`${first?.label ?? "Yes"} probability`}
                    >
                      <span className="block h-full rounded-[2px] bg-accent" style={{ width: `${p * 100}%` }} />
                    </span>
                    <span className="w-24 truncate text-right text-xs text-muted">
                      {second?.label ?? "No"} <span className="font-mono tabular-nums text-fg">{formatCents(outcomePrice(second))}</span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
