import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/shared/utils"

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-muted",
        accent: "bg-accent-muted text-accent-text",
        success: "bg-success-muted text-success",
        warning: "bg-warning-muted text-warning",
        danger: "bg-danger-muted text-danger",
        info: "bg-info-muted text-info",
      },
      variant: {
        soft: "",
        outline: "border border-border bg-transparent",
      },
    },
    compoundVariants: [{ variant: "outline", tone: "neutral", class: "text-muted" }],
    defaultVariants: { tone: "neutral", variant: "soft" },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading status dot in the badge's tone. Pass "pulse" for a live state. */
  dot?: boolean | "pulse"
  /** Monospace text (model IDs, versions). */
  mono?: boolean
}

/** Compact label for status, counts and metadata. Tones are semantic; use neutral for plain metadata. */
export function Badge({ tone, variant, dot, mono, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, variant }), mono && "font-mono text-2xs", className)} {...props}>
      {dot ? (
        <span aria-hidden className="relative inline-flex size-1.5 shrink-0">
          <span className={cn("size-full rounded-full bg-current", dot === "pulse" && "animate-live-pulse")} />
        </span>
      ) : null}
      {children}
    </span>
  )
}

export { badgeVariants }
