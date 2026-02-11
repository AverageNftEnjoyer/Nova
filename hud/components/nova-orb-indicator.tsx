"use client"

import type React from "react"

export type OrbPalette = {
  bg: string
  circle1: string
  circle2: string
  circle3: string
  circle4: string
  circle5: string
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface NovaOrbIndicatorProps {
  palette: OrbPalette
  size?: number
  animated?: boolean
  className?: string
}

export function NovaOrbIndicator({ palette, size = 18, animated = false, className }: NovaOrbIndicatorProps) {
  const blurAmount = Math.max(3, size * 0.15)
  const circle1Size = size * 0.45
  const circle2Size = size * 0.35
  const circle3Size = size * 0.5
  const circle4Size = size * 0.25
  const circle5Size = size * 0.3
  const colors = [palette.circle1, palette.circle2, palette.circle3, palette.circle4, palette.circle5]

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
      }}
      aria-hidden="true"
    >
      <div
        className="relative rounded-full overflow-hidden"
        style={{
          width: size,
          height: size,
          backgroundColor: palette.bg,
          animation: animated ? "orb-thinking-spin 3s linear infinite, orb-custom-color-breathe 1.8s ease-in-out infinite" : "none",
          boxShadow: animated
            ? `${hexToRgba(palette.circle1, 0.5)} 0px 0px 12px 2px, ${hexToRgba(palette.circle2, 0.35)} 0px 0px 24px 4px`
            : `${hexToRgba(palette.circle4, 0.18)} 0px 0px 6px 1px`,
        }}
      >
        {animated && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                `conic-gradient(from 0deg, transparent, ${hexToRgba(palette.circle4, 0.22)}, transparent, ${hexToRgba(palette.circle2, 0.2)}, transparent)`,
              animation: "orb-thinking-conic 2s linear infinite",
            }}
          />
        )}

        <div
          className="absolute inset-0 flex items-center justify-center"
          style={
            {
              "--orb-blur": `${blurAmount}px`,
              filter: `blur(${blurAmount}px)`,
            } as React.CSSProperties
          }
        >
          {[circle1Size, circle2Size, circle3Size, circle4Size, circle5Size].map((s, i) => (
            <div
              key={i}
              className={animated ? `orb-circle-${i + 1} absolute rounded-full` : "absolute rounded-full"}
              style={{
                width: s,
                height: s,
                opacity: 0.88,
                backgroundColor: colors[i],
              }}
            />
          ))}
        </div>

        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, transparent 100%)",
          }}
        />
      </div>
    </div>
  )
}
