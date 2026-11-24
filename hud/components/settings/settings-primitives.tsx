"use client"

import * as React from "react"
import { Field, Spinner, EmptyState, Button } from "@/components/ui"
import { cn } from "@/lib/shared/utils"
import { loadUserSettings } from "@/lib/settings/userSettings"

/** Interface click sound, when Settings -> Audio -> Interface sounds is on. */
export function playClickSound() {
  try {
    const settings = loadUserSettings()
    if (!settings.app.soundEnabled) return
    const audio = new Audio("/sounds/click.mp3")
    audio.volume = 0.9
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {}
}

interface SettingsGroupProps {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/** A titled block of setting rows separated by hairlines. */
export function SettingsGroup({ title, description, actions, className, children }: SettingsGroupProps) {
  return (
    <section className={cn("min-w-0", className)}>
      {title ? (
        <div className="flex items-end justify-between gap-4 pb-1">
          <div className="min-w-0">
            <h3 className="text-md font-medium text-fg">{title}</h3>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("divide-y divide-border-subtle border-b border-border-subtle", title && "border-t")}>{children}</div>
    </section>
  )
}

interface SettingRowProps {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  /** Stack the control under the label (text areas, wide inputs). Default: control on the right. */
  stacked?: boolean
  aside?: React.ReactNode
  children: React.ReactNode
}

/** One setting: label + hint on the left, control on the right (or stacked for wide controls). */
export function SettingRow({ label, hint, error, stacked = false, aside, children }: SettingRowProps) {
  return (
    <Field label={label} hint={hint} error={error} inline={!stacked} aside={aside} className="py-3">
      {children}
    </Field>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onValueChange: (value: T) => void
  "aria-label": string
  id?: string
}

/** Single-choice radio group drawn as a segmented control (arrow keys move the choice). */
export function SegmentedControl<T extends string>({ value, options, onValueChange, id, ...rest }: SegmentedControlProps<T>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length
    onValueChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault()
                move(index, -1)
              }
            }}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors duration-150 ease-out",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              selected ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--border-strong)]" : "text-muted hover:text-fg",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Centered spinner while a panel loads its data. */
export function SettingsLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <Spinner />
      {label}
    </div>
  )
}

/** A panel whose data could not load, with a retry. */
export function SettingsLoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <EmptyState
      tone="danger"
      size="compact"
      title={title}
      description={message}
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  )
}
