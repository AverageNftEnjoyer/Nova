"use client"

import { EmptyState, SkeletonRows, Tabs, TabsList, TabsTrigger, Button } from "@/components/ui"
import { cn } from "@/lib/shared/utils"
import type { CryptoAsset, CryptoRange } from "@/app/integrations/hooks/use-crypto-market"

export const CRYPTO_SYMBOL_ORDER = ["BTC", "ETH", "SOL", "SUI", "XRP", "DOGE"] as const

const CRYPTO_RANGE_OPTIONS: ReadonlyArray<{ id: CryptoRange; label: string }> = [
  { id: "1h", label: "1h" },
  { id: "1d", label: "1d" },
  { id: "7d", label: "7d" },
]

const SPARK_WIDTH = 96
const SPARK_HEIGHT = 24

/** Compact USD ($86.4K) for narrow spaces. */
export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-"
  const abs = Math.abs(value)
  if (abs >= 1000) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value)
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: abs >= 1 ? 2 : 4 }).format(value)
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "-"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function sparklinePoints(values: readonly number[]): string {
  const points = values.filter((v) => Number.isFinite(v))
  if (points.length < 2) return `0,${SPARK_HEIGHT / 2} ${SPARK_WIDTH},${SPARK_HEIGHT / 2}`
  const min = Math.min(...points)
  const span = Math.max(Math.max(...points) - min, 1e-9)
  return points
    .map((point, idx) => `${((idx / (points.length - 1)) * SPARK_WIDTH).toFixed(2)},${(SPARK_HEIGHT - 1 - ((point - min) / span) * (SPARK_HEIGHT - 2)).toFixed(2)}`)
    .join(" ")
}

/** The tracked coins in display order; only coins the market feed returned. */
export function orderCryptoAssets(assets: readonly CryptoAsset[]): CryptoAsset[] {
  const bySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]))
  return CRYPTO_SYMBOL_ORDER.flatMap((symbol) => {
    const asset = bySymbol.get(symbol)
    return asset ? [asset] : []
  })
}

interface CryptoPricesProps {
  assets: readonly CryptoAsset[]
  range: CryptoRange
  onRangeChange: (range: CryptoRange) => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}

/** Coinbase spot prices with the change and a sparkline over the chosen range. */
export function CryptoPrices({ assets, range, onRangeChange, loading = false, error = null, onRetry }: CryptoPricesProps) {
  const rows = orderCryptoAssets(assets)
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Change over the last {range === "1h" ? "hour" : range === "1d" ? "day" : "7 days"}</p>
        <Tabs value={range} onValueChange={(value) => onRangeChange(value as CryptoRange)} variant="segmented">
          <TabsList aria-label="Chart range">
            {CRYPTO_RANGE_OPTIONS.map((option) => (
              <TabsTrigger key={option.id} value={option.id} className="font-mono">
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {rows.length === 0 ? (
        loading ? (
          <SkeletonRows rows={6} />
        ) : (
          <EmptyState
            size="compact"
            tone={error ? "danger" : "neutral"}
            title={error ? "Prices did not load" : "No prices yet"}
            description={error ?? "Coinbase has not returned market data yet."}
            action={onRetry ? <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button> : undefined}
          />
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle" aria-label="Crypto prices">
          {rows.map((asset) => {
            const up = asset.changePct >= 0
            return (
              <li key={asset.symbol} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 py-2">
                <span className="font-mono text-xs font-medium text-fg">{asset.symbol}</span>
                <svg
                  viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                  className={cn("h-6 w-full max-w-24 justify-self-end", up ? "text-success" : "text-danger")}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline points={sparklinePoints(asset.chart)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </svg>
                <span className="text-right font-mono text-sm tabular-nums text-fg">{formatUsdCompact(asset.price)}</span>
                <span className={cn("w-16 text-right font-mono text-xs tabular-nums", up ? "text-success" : "text-danger")}>{formatPct(asset.changePct)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {error && rows.length > 0 ? <p className="text-xs text-danger">Last refresh failed: {error}</p> : null}
    </div>
  )
}
