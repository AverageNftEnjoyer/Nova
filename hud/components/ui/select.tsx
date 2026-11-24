"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { useFieldControl } from "@/components/ui/field"
import { CONTROL_SIZE, controlClasses, type ControlSize } from "@/components/ui/input"
import { useAnchoredPosition } from "@/components/ui/overlay"

export interface SelectOption {
  value: string
  label: string
  /** Secondary line under the label in the menu. */
  description?: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  size?: ControlSize
  disabled?: boolean
  invalid?: boolean
  /** Monospace labels (model IDs, keys). */
  mono?: boolean
  id?: string
  "aria-label"?: string
  className?: string
  triggerClassName?: string
  menuClassName?: string
  optionClassName?: string
  optionActiveClassName?: string
}

/** Custom listbox select: keyboard (arrows, Home/End, type-ahead, Enter, Esc), portal menu that flips to fit. */
export function Select({
  value,
  options,
  onValueChange,
  placeholder = "Select",
  size = "md",
  disabled = false,
  invalid,
  mono = false,
  id,
  "aria-label": ariaLabel,
  className,
  triggerClassName,
  menuClassName,
  optionClassName,
  optionActiveClassName,
}: SelectProps) {
  const field = useFieldControl()
  const generated = React.useId()
  const triggerId = id ?? field?.id ?? `select-${generated}`
  const listId = `${triggerId}-list`
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(-1)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const typeahead = React.useRef({ text: "", at: 0 })
  const position = useAnchoredPosition(open, triggerRef, listRef, { matchWidth: true, offset: 4 })

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const firstEnabled = React.useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i
      return -1
    },
    [options],
  )

  const openMenu = () => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1))
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }
  const commit = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onValueChange(option.value)
    close()
  }

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  React.useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" })
  }, [open, activeIndex])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return
    const key = event.key
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (key === "Escape" || key === "Tab") {
      if (key === "Escape") event.preventDefault()
      close(key === "Escape")
      return
    }
    if (key === "ArrowDown") {
      event.preventDefault()
      const next = firstEnabled(activeIndex + 1, 1)
      if (next >= 0) setActiveIndex(next)
    } else if (key === "ArrowUp") {
      event.preventDefault()
      const prev = firstEnabled(activeIndex - 1, -1)
      if (prev >= 0) setActiveIndex(prev)
    } else if (key === "Home") {
      event.preventDefault()
      setActiveIndex(firstEnabled(0, 1))
    } else if (key === "End") {
      event.preventDefault()
      setActiveIndex(firstEnabled(options.length - 1, -1))
    } else if (key === "Enter" || key === " ") {
      event.preventDefault()
      commit(activeIndex)
    } else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now()
      const buffer = now - typeahead.current.at < 600 ? typeahead.current.text + key.toLowerCase() : key.toLowerCase()
      typeahead.current = { text: buffer, at: now }
      const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buffer))
      if (match >= 0) setActiveIndex(match)
    }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={invalid ?? (field?.invalid || undefined)}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          controlClasses,
          CONTROL_SIZE[size],
          "inline-flex items-center justify-between gap-2 text-left",
          open && "border-accent-border ring-3 ring-accent-muted",
          triggerClassName,
        )}
      >
        <span className={cn("truncate", !selected && "text-faint", mono && "font-mono text-xs")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-faint" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={triggerId}
              tabIndex={-1}
              onKeyDown={onKeyDown}
              style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                maxHeight: position ? Math.min(position.maxHeight, 320) : 320,
              }}
              className={cn(
                "fixed z-170 overflow-y-auto rounded-lg border border-border bg-surface-2 p-1 shadow-overlay",
                position ? "animate-pop-in" : "invisible",
                menuClassName,
              )}
            >
              {options.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-faint">No options</p>
              ) : (
                options.map((option, index) => {
                  const isSelected = option.value === value
                  const isActive = index === activeIndex
                  return (
                    <div
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onPointerMove={() => !option.disabled && setActiveIndex(index)}
                      onClick={() => commit(index)}
                      className={cn(
                        "flex min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-sm text-fg select-none",
                        isActive && !option.disabled && "bg-hover",
                        option.disabled && "text-faint",
                        !option.disabled && optionClassName,
                        isActive && !option.disabled && optionActiveClassName,
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", mono && "font-mono text-xs")}>{option.label}</span>
                        {option.description ? <span className="block truncate text-xs text-muted">{option.description}</span> : null}
                      </span>
                      <Check aria-hidden className={cn("size-3.5 shrink-0 text-fg", !isSelected && "invisible")} />
                    </div>
                  )
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
