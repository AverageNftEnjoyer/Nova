"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"

export type PixelWindowSize = "sm" | "md" | "lg"

const SIZE_CLASS: Record<PixelWindowSize, string> = {
  sm: "w-[min(420px,calc(100vw-32px))] h-[min(460px,calc(100dvh-160px))]",
  md: "w-[min(560px,calc(100vw-32px))] h-[min(560px,calc(100dvh-160px))]",
  lg: "w-[min(860px,calc(100vw-32px))] h-[min(640px,calc(100dvh-160px))]",
}

interface PixelWindowProps {
  /** The place in the city, shown in the title bar (e.g. "Nova Tower"). */
  place: string
  /** What the place does (e.g. "Agent tasks"). */
  role: string
  size?: PixelWindowSize
  onClose: () => void
  /** Title-bar buttons such as "open full page". */
  actions?: ReactNode
  children: ReactNode
}

/**
 * A popup window over the city. Holds an existing Home module unchanged; the `pixel-ui` scope gives it the
 * pixel skin. Escape and the scrim close it, focus moves in on open and back out on close.
 */
export function PixelWindow({ place, role, size = "sm", onClose, actions, children }: PixelWindowProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

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
    <div className="pixel-ui fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} className="pixel-scrim absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("pixel-window pixel-notch relative", SIZE_CLASS[size])}>
        <div className="pixel-window-titlebar">
          <span className="h-3 w-3 shrink-0 bg-(--px-accent)" aria-hidden="true" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate">
            <span className="pixel-label text-(--px-accent)">{place}</span>
            <span className="ml-2 font-pixel text-[14px] text-(--px-muted)">{role}</span>
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
