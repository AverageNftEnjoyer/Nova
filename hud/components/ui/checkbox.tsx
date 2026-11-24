"use client"

import * as React from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { useFieldControl } from "@/components/ui/field"

export interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> {
  checked: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
  /** Optional inline label rendered to the right; clicking it toggles too. */
  label?: React.ReactNode
}

/** Checkbox (role="checkbox"), supports an indeterminate state for "select all" rows. */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, label, disabled, className, id, ...props },
  ref,
) {
  const field = useFieldControl()
  const generated = React.useId()
  const controlId = id ?? field?.id ?? `checkbox-${generated}`
  const on = checked === true || checked === "indeterminate"
  const box = (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      id={controlId}
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      disabled={disabled}
      data-state={checked === "indeterminate" ? "indeterminate" : checked ? "checked" : "unchecked"}
      onClick={(event) => {
        if (!onCheckedChange) return
        // Rows that select on click would otherwise toggle twice.
        event.stopPropagation()
        onCheckedChange(checked !== true)
      }}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-45",
        on ? "border-transparent bg-accent text-accent-fg" : "border-border-strong bg-surface-2 hover:border-muted",
        !label && className,
      )}
      {...props}
    >
      {checked === "indeterminate" ? (
        <Minus aria-hidden className="size-3" strokeWidth={3} />
      ) : checked ? (
        <Check aria-hidden className="size-3" strokeWidth={3} />
      ) : null}
    </button>
  )
  if (!label) return box
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      {box}
      <label htmlFor={controlId} className={cn("text-sm text-fg select-none", disabled ? "text-faint" : "cursor-pointer")}>
        {label}
      </label>
    </div>
  )
})
