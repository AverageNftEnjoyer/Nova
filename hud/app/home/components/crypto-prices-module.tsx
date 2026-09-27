"use client"

import { cn } from "@/lib/shared/utils"
import type { HomeCryptoAsset, HomeCryptoRange } from "../hooks/use-home-crypto-market"

export const CRYPTO_SYMBOL_ORDER = ["BTC", "ETH", "SOL", "SUI", "XRP", "DOGE"] as const

const CRYPTO_RANGE_OPTIONS: ReadonlyArray<{ id: HomeCryptoRange; label: string }> = [
  { id: "1h", label: "1H" },
  { id: "1d", label: "1D" },
  { id: "7d", label: "7D" },
]

// Coin identity marks on the tiles. XRP's brand black is lightened so it reads on dark panels.
const CRYPTO_BRAND_COLORS: Readonly<Record<string, string>> = {
  BTC: "#f7931a",
  ETH: "#627eea",
  SOL: "#9945ff",
  SUI: "#4da2ff",
  XRP: "#9aa9b9",
  DOGE: "#c2a633",
}

const SPARK_WIDTH = 100
const SPARK_HEIGHT = 32

/** Compact USD ($86.4K) for narrow spaces such as the city's ticker billboard. */
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
    .map((point, idx) => `${((idx / (points.length - 1)) * SPARK_WIDTH).toFixed(2)},${(SPARK_HEIGHT - ((point - min) / span) * SPARK_HEIGHT).toFixed(2)}`)
    .join(" ")
}

/** Rows in display order; a coin the market feed has not returned yet shows as a flat placeholder. */
export function orderCryptoAssets(assets: readonly HomeCryptoAsset[]): HomeCryptoAsset[] {
  const bySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]))
  return CRYPTO_SYMBOL_ORDER.map(
    (symbol) => bySymbol.get(symbol) ?? { ticker: symbol, symbol, price: 0, changePct: 0, chart: [1, 1, 1, 1, 1, 1] },
  )
}

interface CryptoPricesModuleProps {
  isLight: boolean
  subPanelClass: string
  assets: readonly HomeCryptoAsset[]
  range: HomeCryptoRange
  onRangeChange: (range: HomeCryptoRange) => void
}

export function CryptoPricesModule({ isLight, subPanelClass, assets, range, onRangeChange }: CryptoPricesModuleProps) {
  const rows = orderCryptoAssets(assets)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-end gap-1" role="group" aria-label="Chart range">
        {CRYPTO_RANGE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onRangeChange(option.id)}
            aria-pressed={range === option.id}
            className={cn(
              "h-7 min-w-10 border px-2 text-[12px] uppercase tracking-[0.12em] transition-colors",
              subPanelClass,
              range === option.id ? "text-accent" : isLight ? "text-s-60" : "text-slate-300",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-3 gap-2">
        {rows.map((asset) => {
          const up = asset.changePct >= 0
          const trendColor = up ? "#34d399" : "#fb7185"
          const line = sparklinePoints(asset.chart)
          return (
            <div key={asset.symbol} className={cn("relative flex min-h-0 min-w-0 flex-col justify-between overflow-hidden border px-3 py-2", subPanelClass)}>
              <svg
                viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
                className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 w-full"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon points={`0,${SPARK_HEIGHT} ${line} ${SPARK_WIDTH},${SPARK_HEIGHT}`} fill={trendColor} opacity={isLight ? 0.12 : 0.16} />
                <polyline points={line} fill="none" stroke={trendColor} strokeWidth="2" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="relative flex min-w-0 items-center justify-between gap-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: CRYPTO_BRAND_COLORS[asset.symbol] ?? "var(--accent-primary)" }} aria-hidden="true" />
                  <span className={cn("truncate text-[14px] tracking-wide", isLight ? "text-s-70" : "text-slate-300")}>{asset.symbol}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 px-1 text-[12px] tabular-nums",
                    up ? (isLight ? "bg-emerald-500/12 text-emerald-600" : "bg-emerald-400/12 text-emerald-300") : isLight ? "bg-rose-500/12 text-rose-600" : "bg-rose-400/12 text-rose-300",
                  )}
                >
                  {formatPct(asset.changePct)}
                </span>
              </div>
              <p className={cn("relative truncate text-[18px] tabular-nums leading-tight", isLight ? "text-s-90" : "text-slate-50")}>{formatUsdCompact(asset.price)}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
