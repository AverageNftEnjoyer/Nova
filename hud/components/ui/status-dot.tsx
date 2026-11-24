import * as React from "react"
import { cn } from "@/lib/shared/utils"

export type StatusTone = "idle" | "running" | "success" | "warning" | "danger" | "info"

const DOT_TONE: Record<StatusTone, string> = {
  idle: "bg-faint",
  running: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
}

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone
  /** Accessible status text; omit when visible text next to the dot already says it. */
  label?: string
  size?: "sm" | "md"
}

/** Small status indicator. "running" pulses gently; the pulse stops under reduced motion. */
export function StatusDot({ tone = "idle", label, size = "md", className, ...props }: StatusDotProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-flex shrink-0", size === "sm" ? "size-1.5" : "size-2", className)}
      {...props}
    >
      {tone === "running" ? <span className="absolute -inset-[3px] rounded-full bg-accent-muted" /> : null}
      <span className={cn("relative inline-flex size-full rounded-full", DOT_TONE[tone], tone === "running" && "animate-live-pulse")} />
    </span>
  )
}
