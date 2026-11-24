import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode
  /** Already formatted (e.g. "$1.24", "48.2k"). Rendered in Geist Mono with tabular numerals. */
  value: React.ReactNode
  /** Change vs the previous period, already formatted ("+12%"). */
  delta?: React.ReactNode
  /** Whether the delta is good, bad or neutral; for costs, "up" is usually bad, so pass it explicitly. */
  deltaTone?: "positive" | "negative" | "neutral"
  /** Small line under the value ("last 7 days", "of $2.00 budget"). */
  hint?: React.ReactNode
  size?: "sm" | "md"
}

/** Label + value metric. Quiet by design: a row of Stats separated by hairlines, not a hero number. */
export function Stat({ label, value, delta, deltaTone = "neutral", hint, size = "md", className, ...props }: StatProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
      <span className="truncate text-xs text-muted">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono tabular-nums tracking-[-0.01em] text-fg", size === "md" ? "text-xl leading-7" : "text-md")}>
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              deltaTone === "positive" ? "text-success" : deltaTone === "negative" ? "text-danger" : "text-muted",
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? <span className="truncate text-xs text-faint">{hint}</span> : null}
    </div>
  )
}

/** Lays Stats out in a single bordered strip with hairline dividers. */
export function StatGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-flow-col auto-cols-fr divide-x divide-border-subtle rounded-lg border border-border bg-surface [&>*]:px-4 [&>*]:py-3",
        className,
      )}
      {...props}
    />
  )
}
