"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { IconButton } from "@/components/ui/icon-button"
import { Portal, useModalBehavior } from "@/components/ui/overlay"

const SHEET_WIDTH = {
  sm: "w-[24rem]",
  md: "w-[32rem]",
  lg: "w-[44rem]",
} as const

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons/menus next to the close button. */
  actions?: React.ReactNode
  /** Sticky footer (primary actions). */
  footer?: React.ReactNode
  size?: keyof typeof SHEET_WIDTH
  initialFocus?: React.RefObject<HTMLElement | null>
  className?: string
  children: React.ReactNode
}

/** Right-side drawer for detail views (a run, a task, an integration). Modal: focus trap, Esc, scrim click closes. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  footer,
  size = "md",
  initialFocus,
  className,
  children,
}: SheetProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const id = React.useId()
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  useModalBehavior(open, ref, close, initialFocus)
  if (!open) return null
  return (
    <Portal>
      <div className="fixed inset-0 z-190">
        <div aria-hidden className="absolute inset-0 bg-scrim animate-overlay-in" onPointerDown={close} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-desc` : undefined}
          tabIndex={-1}
          className={cn(
            "absolute inset-y-0 right-0 flex max-w-[calc(100vw-3rem)] flex-col border-l border-border bg-surface shadow-overlay",
            "animate-sheet-in focus-visible:outline-none",
            SHEET_WIDTH[size],
            className,
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-title`} className="truncate text-md font-semibold tracking-[-0.01em] text-fg">
                {title}
              </h2>
            </div>
            {actions}
            <IconButton aria-label="Close" size="sm" onClick={close} className="-mr-1.5">
              <X />
            </IconButton>
          </div>
          {description ? (
            <p id={`${id}-desc`} className="border-b border-border-subtle px-4 py-2.5 text-sm text-muted">
              {description}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">{footer}</div>
          ) : null}
        </div>
      </div>
    </Portal>
  )
}
