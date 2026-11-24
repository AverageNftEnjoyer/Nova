"use client"

import * as React from "react"
import { createPortal } from "react-dom"

const noopSubscribe = () => () => {}

/** True on the client (immediately after hydration), false during SSR. */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false)
}

/** Renders children into document.body on the client (SSR-safe, no extra render pass). */
export function Portal({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient()
  return isClient ? createPortal(children, document.body) : null
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0,
  )
}

/** Stack of open modal layers, so Esc and the focus trap only act on the top one. */
const modalStack: Array<React.RefObject<HTMLElement | null>> = []

/**
 * Modal behaviour for Dialog and Sheet: traps Tab inside `ref`, closes on Escape, locks page scroll,
 * moves focus in on open and returns it to the opener on close.
 */
export function useModalBehavior(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: React.RefObject<HTMLElement | null>,
) {
  const onCloseRef = React.useRef(onClose)
  React.useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  React.useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modalStack.push(ref)

    const frame = window.requestAnimationFrame(() => {
      const root = ref.current
      if (!root) return
      const target = initialFocus?.current ?? root.querySelector<HTMLElement>("[data-autofocus]") ?? focusableIn(root)[0] ?? root
      target.focus({ preventScroll: true })
    })

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== ref) return
      const root = ref.current
      if (!root) return
      if (event.key === "Escape") {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return
      const items = focusableIn(root)
      if (items.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown, true)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKeyDown, true)
      const index = modalStack.lastIndexOf(ref)
      if (index >= 0) modalStack.splice(index, 1)
      if (modalStack.length === 0) document.body.style.overflow = previousOverflow
      opener?.focus({ preventScroll: true })
    }
  }, [open, ref, initialFocus])
}

export type AnchorSide = "top" | "bottom" | "left" | "right"
export type AnchorAlign = "start" | "center" | "end"

export interface AnchoredPosition {
  top: number
  left: number
  side: AnchorSide
  maxHeight: number
}

interface AnchorOptions {
  side?: AnchorSide
  align?: AnchorAlign
  offset?: number
  /** Viewport padding kept clear on every edge. */
  padding?: number
  matchWidth?: boolean
}

/**
 * Positions a floating element next to an anchor in fixed coordinates, flipping to the other side when it does not fit.
 * Recomputes on scroll/resize while `open`.
 */
export function useAnchoredPosition(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  floatingRef: React.RefObject<HTMLElement | null>,
  { side = "bottom", align = "start", offset = 6, padding = 8, matchWidth = false }: AnchorOptions = {},
): AnchoredPosition | null {
  const [position, setPosition] = React.useState<AnchoredPosition | null>(null)

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = () => {
      const anchor = anchorRef.current
      const floating = floatingRef.current
      if (!anchor) return
      const a = anchor.getBoundingClientRect()
      if (floating && matchWidth) floating.style.minWidth = `${a.width}px`
      const fw = floating?.offsetWidth ?? 0
      const fh = floating?.scrollHeight ?? 0
      const vw = window.innerWidth
      const vh = window.innerHeight

      let resolved: AnchorSide = side
      if (side === "bottom" && a.bottom + offset + fh > vh - padding && a.top - offset - fh > padding) resolved = "top"
      if (side === "top" && a.top - offset - fh < padding && a.bottom + offset + fh < vh - padding) resolved = "bottom"
      if (side === "right" && a.right + offset + fw > vw - padding) resolved = "left"
      if (side === "left" && a.left - offset - fw < padding) resolved = "right"

      let top: number
      let left: number
      let maxHeight: number
      if (resolved === "bottom" || resolved === "top") {
        const start = a.left
        const center = a.left + a.width / 2 - fw / 2
        const end = a.right - fw
        left = align === "start" ? start : align === "end" ? end : center
        if (resolved === "bottom") {
          top = a.bottom + offset
          maxHeight = vh - top - padding
        } else {
          maxHeight = a.top - offset - padding
          top = a.top - offset - Math.min(fh, maxHeight)
        }
      } else {
        const start = a.top
        const center = a.top + a.height / 2 - fh / 2
        const end = a.bottom - fh
        top = align === "start" ? start : align === "end" ? end : center
        left = resolved === "right" ? a.right + offset : a.left - offset - fw
        maxHeight = vh - padding * 2
      }
      left = Math.max(padding, Math.min(left, vw - padding - fw))
      top = Math.max(padding, top)
      setPosition({ top, left, side: resolved, maxHeight: Math.max(96, maxHeight) })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [open, anchorRef, floatingRef, side, align, offset, padding, matchWidth])

  return position
}
