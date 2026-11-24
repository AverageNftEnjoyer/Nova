import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Right side of the header row: buttons, a segmented Tabs, a menu. */
  actions?: React.ReactNode
  /** Leading icon in the header. */
  icon?: React.ReactNode
  /** Body without padding, for a Table or a list that runs edge to edge. */
  flush?: boolean
  /** Footer row (pagination, "view all"). */
  footer?: React.ReactNode
  bodyClassName?: string
}

/** A bordered page section with an optional header row (title, description, actions). */
export function Panel({
  title,
  description,
  actions,
  icon,
  flush = false,
  footer,
  className,
  bodyClassName,
  children,
  ...props
}: PanelProps) {
  const hasHeader = Boolean(title || actions)
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface", className)} {...props}>
      {hasHeader ? (
        <header className="flex min-h-11 items-center gap-3 border-b border-border-subtle px-4 py-2">
          {icon ? <span className="flex shrink-0 text-muted [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            {title ? <h2 className="truncate text-md font-medium text-fg">{title}</h2> : null}
            {description ? <p className="truncate text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("min-h-0 flex-1", !flush && "p-4", bodyClassName)}>{children}</div>
      {footer ? <footer className="flex items-center gap-2 border-t border-border-subtle px-4 py-2 text-xs text-muted">{footer}</footer> : null}
    </section>
  )
}
