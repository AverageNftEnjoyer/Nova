"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"
import { useFieldControl } from "@/components/ui/field"
import { controlClasses } from "@/components/ui/input"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow with the content up to maxRows, then scroll. */
  autoGrow?: boolean
  minRows?: number
  maxRows?: number
  mono?: boolean
  invalid?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoGrow = false, minRows = 3, maxRows = 12, mono = false, invalid, id, onInput, rows, ...props },
  forwardedRef,
) {
  const field = useFieldControl()
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  const resize = React.useCallback(() => {
    const el = innerRef.current
    if (!el || !autoGrow) return
    const style = window.getComputedStyle(el)
    const line = Number.parseFloat(style.lineHeight) || 20
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const borders = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
    const min = line * minRows + padding + borders
    const max = line * maxRows + padding + borders
    el.style.height = "auto"
    const content = el.scrollHeight + borders
    el.style.height = `${Math.min(Math.max(content, min), max)}px`
    el.style.overflowY = content > max ? "auto" : "hidden"
  }, [autoGrow, minRows, maxRows])

  React.useLayoutEffect(() => {
    resize()
  }, [resize, props.value])

  return (
    <textarea
      ref={setRefs}
      id={id ?? field?.id}
      rows={rows ?? minRows}
      aria-describedby={props["aria-describedby"] ?? field?.describedBy}
      aria-invalid={invalid ?? (field?.invalid || undefined)}
      onInput={(event) => {
        resize()
        onInput?.(event)
      }}
      className={cn(
        controlClasses,
        "px-2.5 py-1.5 leading-5",
        autoGrow ? "resize-none" : "resize-y",
        mono && "font-mono text-xs",
        className,
      )}
      {...props}
    />
  )
})
