"use client"

import { EmptyState, SkeletonRows } from "@/components/ui"
import type { PolymarketOrderBook, PolymarketOrderBookLevel } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatCents, formatSize } from "../lib/format"

const DEPTH_ROWS = 8

interface OrderBookVisualProps {
  outcomeLabel: string
  orderBook: PolymarketOrderBook | null
  loading: boolean
  error: string
}

function withCumulative(levels: PolymarketOrderBookLevel[]) {
  let running = 0
  return levels.slice(0, DEPTH_ROWS).map((level) => {
    running += Number(level.size || 0)
    return { ...level, cumulative: running }
  })
}

function Side({ title, rows, max, side }: { title: string; rows: ReturnType<typeof withCumulative>; max: number; side: "bid" | "ask" }) {
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-border-subtle px-2 pb-1 text-xs text-muted">
        <span>{title}</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-3 text-xs text-faint">No {side === "bid" ? "bids" : "asks"}</p>
      ) : (
        <ul>
          {rows.map((row, index) => (
            <li key={`${side}-${index}`} className="relative grid h-7 grid-cols-[1fr_1fr_1fr] items-center gap-2 px-2 font-mono text-xs tabular-nums">
              <span
                aria-hidden
                className={cn("absolute inset-y-0.5 right-0 rounded-[2px]", side === "bid" ? "bg-success-muted" : "bg-danger-muted")}
                style={{ width: `${max > 0 ? (row.cumulative / max) * 100 : 0}%` }}
              />
              <span className={cn("relative", side === "bid" ? "text-success" : "text-danger")}>{formatCents(row.price)}</span>
              <span className="relative text-right text-fg">{formatSize(row.size)}</span>
              <span className="relative text-right text-muted">{formatSize(row.cumulative)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Depth table: best bids and asks side by side, bars show cumulative size against the deeper side. */
export function OrderBookVisual({ outcomeLabel, orderBook, loading, error }: OrderBookVisualProps) {
  if (loading) return <SkeletonRows rows={5} />
  if (error) return <EmptyState size="compact" tone="danger" title="Order book did not load" description={error} />
  if (!orderBook) return <EmptyState size="compact" title="No order book" description="This outcome has no tradable token." />

  const bids = withCumulative(orderBook.bids)
  const asks = withCumulative(orderBook.asks)
  const max = Math.max(bids[bids.length - 1]?.cumulative ?? 0, asks[asks.length - 1]?.cumulative ?? 0)
  const bestBid = bids[0]?.price ?? 0
  const bestAsk = asks[0]?.price ?? 0
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        {outcomeLabel} order book. Spread <span className="font-mono tabular-nums text-fg">{spread > 0 ? `${(spread * 100).toFixed(1)}c` : "None"}</span>
        {orderBook.lastTradePrice > 0 ? (
          <>
            , last trade <span className="font-mono tabular-nums text-fg">{formatCents(orderBook.lastTradePrice)}</span>
          </>
        ) : null}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Side title="Bid" rows={bids} max={max} side="bid" />
        <Side title="Ask" rows={asks} max={max} side="ask" />
      </div>
    </div>
  )
}
