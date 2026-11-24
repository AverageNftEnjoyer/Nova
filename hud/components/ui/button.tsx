import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/shared/utils"
import { Spinner } from "@/components/ui/spinner"

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none",
    "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary: "border border-border bg-surface-3 text-fg hover:border-border-strong hover:bg-active",
        outline: "border border-border bg-transparent text-fg hover:border-border-strong hover:bg-hover",
        ghost: "text-muted hover:bg-hover hover:text-fg",
        danger: "bg-danger-solid text-danger-fg hover:bg-danger-solid-hover",
        link: "h-auto px-0 text-accent-text underline-offset-4 hover:underline",
        /** Legacy aliases (pre-design-system callers). */
        default: "bg-accent text-accent-fg hover:bg-accent-hover",
        destructive: "bg-danger-solid text-danger-fg hover:bg-danger-solid-hover",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-4 text-md",
        icon: "size-8 text-sm",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        /** Legacy aliases. */
        default: "h-8 px-3 text-sm",
        xs: "h-6 px-2 text-2xs [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-9",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Next <Link>) with button styling. */
  asChild?: boolean
  /** Shows a spinner, keeps the width, and disables the button. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, type, ...props },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size }), loading && "disabled:opacity-100", className)
  if (asChild) {
    return (
      <Slot ref={ref} data-slot="button" className={classes} {...props}>
        {children}
      </Slot>
    )
  }
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      data-slot="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <Spinner size="sm" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  )
})

export { Button, buttonVariants }
