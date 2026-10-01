"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { PIXEL_WINDOW_THEMES, vignetteStyle, windowThemeStyle, type PixelWindowTheme, type PixelWindowThemeId } from "./window-themes"

export type PixelWindowSize = "sm" | "md" | "lg"

const SIZE_CLASS: Record<PixelWindowSize, string> = {
  sm: "w-[min(440px,calc(100vw-32px))] h-[min(480px,calc(100dvh-140px))]",
  md: "w-[min(580px,calc(100vw-32px))] h-[min(580px,calc(100dvh-140px))]",
  lg: "w-[min(880px,calc(100vw-32px))] h-[min(660px,calc(100dvh-140px))]",
}

interface PixelWindowProps {
  /** The place in the city, shown on the title bar's sign (e.g. "Nova HQ"). */
  place: string
  /** What the place does (e.g. "Agent tasks"). */
  role: string
  /** Which building the window belongs to: frame material, sign colour, emblem and crop (window-themes.ts). */
  theme?: PixelWindowThemeId
  size?: PixelWindowSize
  onClose: () => void
  /** Title-bar buttons such as "open full page". */
  actions?: ReactNode
  children: ReactNode
}

/**
 * A popup window over the city, dressed as the building it belongs to. Holds an existing Home module unchanged; the
 * `pixel-ui` scope gives it the pixel skin and the theme's tokens tint it. Escape and the scrim close it, focus moves
 * in on open and back out on close.
 */
export function PixelWindow({ place, role, theme = "default", size = "sm", onClose, actions, children }: PixelWindowProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const look = PIXEL_WINDOW_THEMES[theme]

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div className="pixel-ui fixed inset-0 z-120 flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} className="pixel-scrim absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-theme={look.id}
        data-material={look.material}
        style={windowThemeStyle(look.id)}
        className={cn("pixel-window pixel-window--themed pixel-notch relative", SIZE_CLASS[size])}
      >
        <div className="pixel-window-titlebar">
          <span className="pixel-window-vignette" style={vignetteStyle(look.vignette)} aria-hidden="true" />
          <h2 id={titleId} className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="pixel-window-sign">
              <PixelEmblem theme={look} />
              <span className="pixel-window-name">{place}</span>
            </span>
            <span className="pixel-window-role">{role}</span>
          </h2>
          {actions}
          <button ref={closeRef} type="button" onClick={onClose} className="pixel-chip pixel-chip--icon h-7! w-7!" aria-label={`Close ${place}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="pixel-window-body relative min-h-0 flex-1 overflow-hidden p-2">{children}</div>
      </div>
    </div>
  )
}

const EMBLEM_FILL: Readonly<Record<string, string>> = {
  a: "var(--pw-accent)",
  b: "var(--pw-accent-2)",
  w: "var(--px-text)",
  d: "var(--pw-line)",
}

/** The building's 9x9 pixel emblem, drawn as crisp SVG squares in the theme's colours. */
function PixelEmblem({ theme }: { theme: PixelWindowTheme }) {
  const rows = theme.emblem
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return (
    <svg className="pixel-window-emblem" viewBox={`0 0 ${width} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) => {
          const fill = EMBLEM_FILL[cell]
          return fill ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} style={{ fill }} /> : null
        }),
      )}
    </svg>
  )
}
