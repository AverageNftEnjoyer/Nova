"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"
import { useFieldControl } from "@/components/ui/field"

/** Shared control chrome for Input / Textarea / Select / SearchInput so every field lines up. */
export const controlClasses = cn(
  "w-full min-w-0 rounded-md border border-border bg-surface-2 text-sm text-fg placeholder:text-faint",
  "transition-[border-color,background-color,box-shadow] duration-150 ease-out",
  "hover:border-border-strong",
  "focus-visible:outline-none focus-visible:border-accent-border focus-visible:ring-3 focus-visible:ring-accent-muted",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border",
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger-muted",
)

export const CONTROL_SIZE = { sm: "h-7 px-2 text-xs", md: "h-8 px-2.5", lg: "h-9 px-3 text-md" } as const
export type ControlSize = keyof typeof CONTROL_SIZE

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize
  /** Monospace text: IDs, keys, paths, numbers. */
  mono?: boolean
  invalid?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = "md", mono = false, invalid, id, type = "text", ...props },
  ref,
) {
  const field = useFieldControl()
  return (
    <input
      ref={ref}
      type={type}
      id={id ?? field?.id}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-invalid={invalid ?? (field?.invalid || undefined)}
      className={cn(controlClasses, CONTROL_SIZE[size], mono && "font-mono text-xs", className)}
      {...props}
    />
  )
})
