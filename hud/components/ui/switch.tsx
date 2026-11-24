"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"
import { useFieldControl } from "@/components/ui/field"

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  size?: "sm" | "md"
}

const SWITCH_SIZE = {
  sm: { track: "h-4 w-7", thumb: "size-3", on: "translate-x-3" },
  md: { track: "h-5 w-9", thumb: "size-4", on: "translate-x-4" },
} as const

/** On/off toggle (role="switch"). Accent track when on. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, size = "md", disabled, className, id, onClick, ...props },
  ref,
) {
  const field = useFieldControl()
  const s = SWITCH_SIZE[size]
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      id={id ?? field?.id}
      aria-checked={checked}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      disabled={disabled}
      data-state={checked ? "on" : "off"}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled || !onCheckedChange) return
        // A parent row that toggles on click would otherwise flip the value back.
        event.stopPropagation()
        onCheckedChange(!checked)
      }}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border p-px transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "border-transparent bg-accent" : "border-border-strong bg-surface-3",
        s.track,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform duration-150 ease-out",
          checked ? cn("bg-switch-thumb", s.on) : "translate-x-0 bg-switch-thumb-off",
          s.thumb,
        )}
      />
    </button>
  )
})
