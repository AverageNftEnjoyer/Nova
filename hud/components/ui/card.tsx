import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hover and focus treatment for cards that are links/buttons (pass asChild-free markup: wrap in <a> yourself). */
  interactive?: boolean
  padding?: "none" | "sm" | "md"
}

const CARD_PADDING = { none: "", sm: "p-3", md: "p-4" } as const

/**
 * A bordered surface for one self-contained object (an integration, a deployment summary).
 * Prefer Panel for page sections and Table for lists; do not tile identical cards when a list would do.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, padding = "md", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-border bg-surface",
        CARD_PADDING[padding],
        interactive && "transition-colors duration-150 ease-out hover:border-border-strong hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  )
})
