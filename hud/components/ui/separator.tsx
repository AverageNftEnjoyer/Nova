import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
  /** Purely visual (default) or a semantic separator announced to assistive tech. */
  decorative?: boolean
  subtle?: boolean
}

/** 1px hairline. */
export function Separator({ orientation = "horizontal", decorative = true, subtle = false, className, ...props }: SeparatorProps) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        "shrink-0",
        subtle ? "bg-border-subtle" : "bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  )
}
