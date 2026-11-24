"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { IconButton } from "@/components/ui/icon-button"
import { Portal, useModalBehavior } from "@/components/ui/overlay"

const DIALOG_SIZE = {
  sm: "max-w-[25rem]",
  md: "max-w-[32rem]",
  lg: "max-w-[42rem]",
  xl: "max-w-[56rem]",
} as const

interface DialogContextValue {
  titleId: string
  descriptionId: string
  onClose: () => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialog(component: string): DialogContextValue {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error(`${component} must be used inside <Dialog>`)
  return ctx
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  size?: keyof typeof DIALOG_SIZE
  /** Close when the backdrop is clicked (default true). Turn off for forms with unsaved input. */
  dismissible?: boolean
  /** Element focused on open; otherwise the first [data-autofocus] or focusable element. */
  initialFocus?: React.RefObject<HTMLElement | null>
  className?: string
  children: React.ReactNode
}

/**
 * Modal dialog: portal, scrim, focus trap, Esc to close, focus returns to the opener.
 * Compose with DialogHeader (DialogTitle + DialogDescription), DialogBody, DialogFooter.
 */
export function Dialog({ open, onOpenChange, size = "md", dismissible = true, initialFocus, className, children }: DialogProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const id = React.useId()
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  useModalBehavior(open, ref, close, initialFocus)
  const ctx = React.useMemo(() => ({ titleId: `${id}-title`, descriptionId: `${id}-desc`, onClose: close }), [id, close])
  if (!open) return null
  return (
    <Portal>
      <DialogContext.Provider value={ctx}>
        <div className="fixed inset-0 z-200 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
          <div
            aria-hidden
            className="fixed inset-0 bg-scrim animate-overlay-in"
            onPointerDown={dismissible ? close : undefined}
          />
          <div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={ctx.titleId}
            aria-describedby={ctx.descriptionId}
            tabIndex={-1}
            className={cn(
              "relative flex max-h-[76vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay",
              "animate-pop-in focus-visible:outline-none",
              DIALOG_SIZE[size],
              className,
            )}
          >
            {children}
          </div>
        </div>
      </DialogContext.Provider>
    </Portal>
  )
}

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Hide the close button (e.g. a blocking confirmation). */
  hideClose?: boolean
}

export function DialogHeader({ className, children, hideClose = false, ...props }: DialogHeaderProps) {
  const { onClose } = useDialog("DialogHeader")
  return (
    <div className={cn("flex shrink-0 items-start gap-3 px-5 pt-4 pb-3", className)} {...props}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {hideClose ? null : (
        <IconButton aria-label="Close" size="sm" onClick={onClose} className="-mt-0.5 -mr-1.5">
          <X />
        </IconButton>
      )}
    </div>
  )
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialog("DialogTitle")
  return <h2 id={titleId} className={cn("text-md font-semibold tracking-[-0.01em] text-fg", className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialog("DialogDescription")
  return <p id={descriptionId} className={cn("text-sm text-muted", className)} {...props} />
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-4", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3", className)}
      {...props}
    />
  )
}
