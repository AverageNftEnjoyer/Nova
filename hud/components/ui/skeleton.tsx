import * as React from "react"
import { cn } from "@/lib/shared/utils"

/** Loading placeholder. Size it like the content it replaces (h-4 w-32 for a line, h-9 rows for a table). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-sm bg-surface-3 animate-live-pulse", className)} {...props} />
}

/** A few skeleton rows sized like Table rows, for list/table loading states. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  const widths = ["w-2/5", "w-3/5", "w-1/3", "w-1/2", "w-2/3"]
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-4 border-b border-border-subtle px-3 last:border-b-0">
          <Skeleton className={cn("h-3", widths[i % widths.length])} />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}
