"use client"

import { cn } from "@/lib/shared/utils"
import { useHomeAnalyticsSummary, type HomeAnalyticsSummary } from "../hooks/use-home-analytics-summary"

interface AnalyticsHomeModuleProps {
  isLight: boolean
  subPanelClass: string
  /** Opens the analytics dashboard. */
  onOpenAnalytics: () => void
  /** Opens the analytics dashboard at its budgets section (`/analytics#budgets`). */
  onOpenBudgets: () => void
}

const PLACEHOLDER = "—"
/** Value + secondary text on one baseline row; the secondary text wraps under the value when the tile is too narrow. */
const VALUE_ROW_CLASS = "mt-0.5 flex w-full min-w-0 flex-wrap items-baseline gap-x-1"

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00"
  if (usd < 0.01) return "<$0.01"
  if (usd < 1_000) return `$${usd.toFixed(2)}`
  return `$${formatCompact(usd)}`
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "")
}

/** 950 → "950", 12_300 → "12.3k", 1_230_000 → "1.2M". */
function formatCompact(value: number): string {
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${trimFixed(value / 1_000, value < 100_000 ? 1 : 0)}k`
  if (value < 1_000_000_000) return `${trimFixed(value / 1_000_000, value < 100_000_000 ? 1 : 0)}M`
  return `${trimFixed(value / 1_000_000_000, 1)}B`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

/**
 * Body of the Home "Analytics" panel: today's spend, today's tokens with cache share, and agent tasks at a budget
 * limit. The section and header stay in home-main-screen (they share its local header helpers).
 *
 * Layout: the panel is a 1/5-width, portrait card at every supported size (about 117×192 px at 1024×768 and
 * 253×278 px at 1920×1080), so the three tiles are always stacked rows: label on top, then value + secondary text
 * (which wraps under the value when it does not fit). The panel is an `@container`; from 15rem the text steps up
 * one size. Every text node truncates.
 */
export function AnalyticsHomeModule({ isLight, subPanelClass, onOpenAnalytics, onOpenBudgets }: AnalyticsHomeModuleProps) {
  const { summary, loading, error } = useHomeAnalyticsSummary()
  const pending = !summary

  const labelClass = cn(
    "truncate text-[8px] @[15rem]:text-[9px] uppercase tracking-widest",
    isLight ? "text-s-50" : "text-slate-500",
  )
  const valueClass = cn(
    "max-w-full shrink-0 truncate text-[13px] @[15rem]:text-[15px] font-semibold tabular-nums leading-tight",
    isLight ? "text-s-90" : "text-slate-100",
  )
  const secondaryClass = cn(
    "min-w-0 max-w-full truncate text-[9px] tabular-nums",
    isLight ? "text-s-50" : "text-slate-400",
  )
  const tileClass = cn(
    "min-w-0 min-h-0 overflow-hidden rounded-sm border px-2 py-0.5 text-left flex flex-col justify-center transition-colors home-spotlight-card home-border-glow home-spotlight-card--hover",
    subPanelClass,
  )
  const staleHint = error && summary ? " (last update; refresh failed)" : ""

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col">
      {error && !summary && !loading ? (
        <p className={cn("mb-1 truncate text-[10px]", isLight ? "text-s-50" : "text-slate-500")} role="status">
          Usage unavailable
        </p>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-3 gap-1">
        <SpendTile
          summary={summary}
          pending={pending}
          staleHint={staleHint}
          onOpen={onOpenAnalytics}
          tileClass={tileClass}
          labelClass={labelClass}
          valueClass={valueClass}
          secondaryClass={secondaryClass}
        />
        <TokensTile
          summary={summary}
          pending={pending}
          staleHint={staleHint}
          onOpen={onOpenAnalytics}
          tileClass={tileClass}
          labelClass={labelClass}
          valueClass={valueClass}
          secondaryClass={secondaryClass}
        />
        <BudgetTile
          summary={summary}
          pending={pending}
          isLight={isLight}
          onOpenAnalytics={onOpenAnalytics}
          onOpenBudgets={onOpenBudgets}
          tileClass={tileClass}
          labelClass={labelClass}
          valueClass={valueClass}
          secondaryClass={secondaryClass}
        />
      </div>
    </div>
  )
}

interface TileProps {
  summary: HomeAnalyticsSummary | null
  pending: boolean
  tileClass: string
  labelClass: string
  valueClass: string
  secondaryClass: string
}

function SpendTile({
  summary,
  pending,
  staleHint,
  onOpen,
  tileClass,
  labelClass,
  valueClass,
  secondaryClass,
}: TileProps & { staleHint: string; onOpen: () => void }) {
  const cost = summary ? formatCost(summary.costUsd) : PLACEHOLDER
  const unpriced = summary?.unpricedCalls ?? 0
  const unpricedHint = unpriced > 0 ? `; ${plural(unpriced, "call")} on unpriced models not included` : ""
  const label = summary
    ? `Spend today ${cost}${unpricedHint}${staleHint}. Open analytics`
    : "Spend today. Open analytics"
  return (
    <button type="button" onClick={onOpen} className={tileClass} aria-label={label} title={label}>
      <span className={cn("block w-full", labelClass)}>Spend</span>
      <span className={VALUE_ROW_CLASS}>
        <span className={valueClass}>
          {cost}
          {unpriced > 0 ? <sup className="ml-0.5 text-[9px] font-medium text-amber-400">+?</sup> : null}
        </span>
        <span className={secondaryClass}>{pending ? "\u00a0" : plural(summary?.calls ?? 0, "call")}</span>
      </span>
    </button>
  )
}

function TokensTile({
  summary,
  pending,
  staleHint,
  onOpen,
  tileClass,
  labelClass,
  valueClass,
  secondaryClass,
}: TileProps & { staleHint: string; onOpen: () => void }) {
  const tokens = summary ? formatCompact(summary.tokens) : PLACEHOLDER
  const cachedPct = summary ? Math.round(summary.cacheHitRate * 100) : 0
  const label = summary
    ? `Tokens today ${tokens}, ${cachedPct}% of input cached${staleHint}. Open analytics`
    : "Tokens today. Open analytics"
  return (
    <button type="button" onClick={onOpen} className={tileClass} aria-label={label} title={label}>
      <span className={cn("block w-full", labelClass)}>Tokens</span>
      <span className={VALUE_ROW_CLASS}>
        <span className={valueClass}>{tokens}</span>
        <span className={secondaryClass}>{pending ? "\u00a0" : `${cachedPct}% cached`}</span>
      </span>
    </button>
  )
}

function BudgetTile({
  summary,
  pending,
  isLight,
  onOpenAnalytics,
  onOpenBudgets,
  tileClass,
  labelClass,
  valueClass,
  secondaryClass,
}: TileProps & { isLight: boolean; onOpenAnalytics: () => void; onOpenBudgets: () => void }) {
  const warning = summary?.budgetWarning ?? 0
  const exhausted = summary?.budgetExhausted ?? 0
  const allClear = !pending && warning === 0 && exhausted === 0
  const label = pending
    ? "Agent task budgets. Open analytics"
    : allClear
      ? "Agent task budgets OK. Open analytics"
      : `Agent task budgets: ${warning} near limit, ${exhausted} exhausted. Open budget details`
  return (
    <button
      type="button"
      onClick={allClear || pending ? onOpenAnalytics : onOpenBudgets}
      className={cn(tileClass, allClear && "opacity-60")}
      aria-label={label}
      title={label}
    >
      <span className={cn("block w-full", labelClass)}>Budgets</span>
      <span className={VALUE_ROW_CLASS}>
        {pending ? (
          <span className={valueClass}>{PLACEHOLDER}</span>
        ) : allClear ? (
          <span className={cn(valueClass, isLight ? "text-s-60" : "text-slate-400")}>OK</span>
        ) : (
          <span className={valueClass}>
            <span className={warning > 0 ? "text-amber-400" : undefined}>{warning}</span>
            <span className={cn("mx-0.5 font-normal", isLight ? "text-s-40" : "text-slate-500")}>/</span>
            <span className={exhausted > 0 ? "text-rose-400" : undefined}>{exhausted}</span>
          </span>
        )}
        <span className={secondaryClass}>{pending ? "\u00a0" : allClear ? "In limits" : "warn / out"}</span>
      </span>
    </button>
  )
}
