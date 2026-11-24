import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Count shown after the title, in mono. */
  count?: number
  /** Heading level for the document outline (default h2). */
  as?: "h2" | "h3"
}

/** 14px medium title for a block inside a page that is not wrapped in a Panel. */
export function SectionHeader({ title, description, actions, count, as: Heading = "h2", className, ...props }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4 pb-3", className)} {...props}>
      <div className="min-w-0">
        <Heading className="flex items-baseline gap-2 text-md font-medium text-fg">
          <span className="truncate">{title}</span>
          {typeof count === "number" ? <span className="font-mono text-xs tabular-nums text-faint">{count}</span> : null}
        </Heading>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}
