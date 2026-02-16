"use client"

import { cn } from "@/lib/utils"

interface NovaSwitchProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}

export function NovaSwitch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className,
}: NovaSwitchProps) {
  const sizes = {
    sm: {
      track: "h-[18px] w-8",
      thumb: "h-3 w-3",
      inset: "2px",
    },
    md: {
      track: "h-[22px] w-10",
      thumb: "h-4 w-4",
      inset: "3px",
    },
    lg: {
      track: "h-7 w-12",
      thumb: "h-5 w-5",
      inset: "3px",
    },
  }

  const s = sizes[size]
  const thumbPositionStyle = checked ? { right: s.inset } : { left: s.inset }

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return
    if (onChange) {
      e.stopPropagation()
      onChange(!checked)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full",
        "transition-colors duration-200 ease-out",
        s.track,
        // Track styles
        checked
          ? "bg-accent shadow-[0_0_10px_-5px_rgba(var(--accent-rgb),0.55)]"
          : "bg-[#2a3140]",
        // Subtle inner border
        "ring-1 ring-inset",
        checked ? "ring-white/25" : "ring-white/8",
        // States
        disabled && "opacity-40 cursor-not-allowed",
        "focus-visible:outline-none",
        className
      )}
    >
      {/* Thumb */}
      <span
        style={thumbPositionStyle}
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ease-out",
          s.thumb,
          // Thumb color and shadow
          "bg-white",
          checked
            ? "shadow-[0_1px_4px_rgba(0,0,0,0.25),0_0_6px_rgba(var(--accent-rgb),0.4)]"
            : "shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
        )}
      />
    </button>
  )
}
