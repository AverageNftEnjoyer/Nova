"use client"

import { useEffect, useState, type ReactNode } from "react"

/**
 * Resolved theme colours for SVG chart marks. Recharts writes colours into SVG attributes, where CSS custom
 * properties are not reliable, so read the tokens from <html> and re-read whenever the theme or accent changes.
 */
export interface ChartTokens {
  series: [string, string, string, string, string]
  surface: string
  grid: string
  axis: string
  fg: string
  muted: string
  faint: string
  accent: string
  success: string
  danger: string
}

const FALLBACK: ChartTokens = {
  series: ["#3d7fe6", "#2f9a6a", "#c2831a", "#8a6ce0", "#d0604c"],
  surface: "#111216",
  grid: "#1b1d22",
  axis: "#23252b",
  fg: "#ecedef",
  muted: "#9a9ea8",
  faint: "#747882",
  accent: "#e6e7ea",
  success: "#3fb27f",
  danger: "#e5534b",
}

function readTokens(): ChartTokens {
  if (typeof window === "undefined") return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    series: [
      read("--chart-1", FALLBACK.series[0]),
      read("--chart-2", FALLBACK.series[1]),
      read("--chart-3", FALLBACK.series[2]),
      read("--chart-4", FALLBACK.series[3]),
      read("--chart-5", FALLBACK.series[4]),
    ],
    surface: read("--surface", FALLBACK.surface),
    grid: read("--border-subtle", FALLBACK.grid),
    axis: read("--border", FALLBACK.axis),
    fg: read("--fg", FALLBACK.fg),
    muted: read("--fg-muted", FALLBACK.muted),
    faint: read("--fg-faint", FALLBACK.faint),
    accent: read("--accent", FALLBACK.accent),
    success: read("--success", FALLBACK.success),
    danger: read("--danger", FALLBACK.danger),
  }
}

export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(FALLBACK)
  useEffect(() => {
    const sync = () => setTokens(readTokens())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-accent", "style"] })
    return () => observer.disconnect()
  }, [])
  return tokens
}

/** Axis tick text: recessive, tabular, 11px. */
export function axisTick(tokens: ChartTokens) {
  return { fontSize: 11, fill: tokens.faint, fontFamily: "var(--font-mono, ui-monospace)" }
}

interface TooltipEntry {
  name?: string | number
  value?: unknown
  color?: string
  dataKey?: unknown
}

interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipEntry>
  label?: unknown
  formatLabel?: (label: unknown) => ReactNode
  formatValue: (value: number) => ReactNode
  /** Show a total row (stacked charts). */
  total?: boolean
}

/** Tooltip as an overlay surface: label, one row per series (swatch, name, value), optional total. */
export function ChartTooltip({ active, payload, label, formatLabel, formatValue, total = false }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.filter((entry) => typeof entry.value === "number")
  const keyOf = (entry: TooltipEntry) => String(entry.dataKey ?? entry.name ?? "")
  const sum = rows.reduce((acc, entry) => acc + Number(entry.value || 0), 0)
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-overlay">
      <p className="mb-1.5 font-medium text-fg">{formatLabel ? formatLabel(label) : String(label ?? "")}</p>
      <ul className="flex flex-col gap-1">
        {[...rows].reverse().map((entry) => (
          <li key={keyOf(entry)} className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: String(entry.color ?? "") }} />
            <span className="min-w-0 flex-1 truncate text-muted">{entry.name}</span>
            <span className="font-mono tabular-nums text-fg">{formatValue(Number(entry.value || 0))}</span>
          </li>
        ))}
      </ul>
      {total && rows.length > 1 ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border-subtle pt-1.5">
          <span className="text-muted">Total</span>
          <span className="font-mono tabular-nums text-fg">{formatValue(sum)}</span>
        </div>
      ) : null}
    </div>
  )
}

export interface LegendItem {
  key: string
  label: string
  color: string
}

/** Legend in series (stack) order, above the plot. Text stays in text tokens; the swatch carries identity. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Thin horizontal share bar for tables (share of the column total). */
export function ShareBar({ fraction, color, label }: { fraction: number; color?: string; label: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-[2px] bg-surface-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
      >
        <div className={color ? "h-full rounded-[2px]" : "h-full rounded-[2px] bg-accent"} style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 text-right font-mono text-2xs tabular-nums text-muted">{pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%</span>
    </div>
  )
}
