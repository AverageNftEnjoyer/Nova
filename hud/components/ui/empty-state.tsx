import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  /** One line that tells the user what to do next. */
  description?: React.ReactNode
  /** Usually one Button. */
  action?: React.ReactNode
  /** compact = inside a panel or table body; default = a whole page region. */
  size?: "compact" | "default"
  /** Danger tone for load errors (pair with a Retry action). */
  tone?: "neutral" | "danger"
}

/** Empty, error or not-configured state. Copy says what is missing and how to fix it. */
export function EmptyState({ icon, title, description, action, size = "default", tone = "neutral", className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-lg border [&_svg]:size-4",
            size === "compact" ? "size-8" : "size-10",
            tone === "danger" ? "border-danger-muted bg-danger-muted text-danger" : "border-border bg-surface-2 text-muted",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-[26rem] flex-col gap-1">
        <p className="text-md font-medium text-fg">{title}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  )
}
