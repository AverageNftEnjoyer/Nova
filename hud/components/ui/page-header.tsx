import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  /** One line: what this page is for. */
  description?: React.ReactNode
  /** Right-aligned actions; the primary action goes last. */
  actions?: React.ReactNode
  /** Small element after the title (a Badge with a count or status). */
  meta?: React.ReactNode
  /** Underline TabsList rendered as the header's bottom edge. */
  tabs?: React.ReactNode
}

/** Top of every page: 20px semibold title, one-line description, actions on the right, optional tabs. */
export function PageHeader({ title, description, actions, meta, tabs, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", tabs ? "pb-0" : "pb-6", className)} {...props}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-xl font-semibold tracking-[-0.015em] text-fg">{title}</h1>
            {meta}
          </div>
          {description ? <p className="max-w-[42rem] text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mb-6">{tabs}</div> : null}
    </header>
  )
}
