import * as React from "react"
import { cn } from "@/lib/shared/utils"

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: "xs" | "sm" | "md" | "lg"
  /** Accessible label; omit when a parent already announces the busy state. */
  label?: string
}

const SPINNER_SIZE = { xs: "size-3", sm: "size-3.5", md: "size-4", lg: "size-6" } as const

/** Indeterminate progress ring. Uses currentColor, so it inherits text colour. */
export function Spinner({ size = "md", label, className, ...props }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 animate-spin motion-reduce:animate-[spin_1.6s_linear_infinite]", SPINNER_SIZE[size], className)}
      {...props}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
