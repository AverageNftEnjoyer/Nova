"use client"

import type { CSSProperties } from "react"

import { cn } from "@/lib/shared/utils"

interface EqualizerBarsProps {
  isPlaying: boolean
  className?: string
  barStyle?: CSSProperties
}

export function EqualizerBars({ isPlaying, className, barStyle }: EqualizerBarsProps) {
  return (
    <div className={cn("flex items-end gap-[3px]", className)} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((bar) => (
        <span
          key={bar}
          className={cn("w-[3px] rounded-full transition-all", isPlaying ? "animate-equalizer" : "h-1")}
          style={{
            animationDelay: isPlaying ? `${bar * 0.12}s` : undefined,
            height: isPlaying ? undefined : "4px",
            backgroundColor: "var(--eq-bar-color, var(--accent-primary))",
            ...barStyle,
          }}
        />
      ))}
    </div>
  )
}
