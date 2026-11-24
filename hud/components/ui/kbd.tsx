import * as React from "react"
import { cn } from "@/lib/shared/utils"

/** Keyboard key hint. One key per Kbd; put combos side by side with a small gap. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-sm border border-border bg-surface-3 px-1 font-mono text-2xs leading-none text-muted",
        className,
      )}
      {...props}
    />
  )
}
