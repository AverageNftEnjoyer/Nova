"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/shared/utils"
import { useAnchoredPosition, type AnchorAlign, type AnchorSide } from "@/components/ui/overlay"

export interface TooltipProps {
  content: React.ReactNode
  /** Exactly one focusable element (a Button, IconButton, link). */
  children: React.ReactElement
  side?: AnchorSide
  align?: AnchorAlign
  /** Hover delay in ms before showing (focus shows immediately). */
  delay?: number
  /** Optional shortcut shown after the text. */
  shortcut?: string
  disabled?: boolean
}

/** Short label shown on hover and keyboard focus. Not for essential information. */
export function Tooltip({ content, children, side = "top", align = "center", delay = 450, shortcut, disabled = false }: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const tipRef = React.useRef<HTMLDivElement | null>(null)
  const timer = React.useRef<number | null>(null)
  const id = React.useId()
  const position = useAnchoredPosition(open, anchorRef, tipRef, { side, align, offset: 6 })

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const show = (immediate: boolean) => {
    if (disabled) return
    clear()
    if (immediate) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    clear()
    setOpen(false)
  }

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  React.useEffect(() => clear, [])

  return (
    <>
      <Slot
        ref={anchorRef}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => show(false)}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocus={(event: React.FocusEvent<HTMLElement>) => {
          if (event.currentTarget.matches(":focus-visible")) show(true)
        }}
        onBlur={hide}
      >
        {children}
      </Slot>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
              className={cn(
                "pointer-events-none fixed z-220 flex max-w-[18rem] items-center gap-2 rounded-md border border-border-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-overlay",
                position ? "animate-overlay-in" : "invisible",
              )}
            >
              <span>{content}</span>
              {shortcut ? <span className="font-mono text-2xs text-faint">{shortcut}</span> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
