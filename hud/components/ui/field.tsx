"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"

interface FieldContextValue {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

/** Input, Textarea, Select and SearchInput read this so a Field wires up id / aria-describedby / aria-invalid. */
export function useFieldControl(): FieldContextValue | null {
  return React.useContext(FieldContext)
}

export interface FieldProps {
  label: React.ReactNode
  /** One line under the control. Replaced by the error while one shows. */
  hint?: React.ReactNode
  error?: React.ReactNode
  /** Override the generated control id. */
  id?: string
  /** Label and hint on the left, control on the right (settings rows with a Switch or Select). */
  inline?: boolean
  /** Optional element on the right of the label row (a character count, a link). */
  aside?: React.ReactNode
  required?: boolean
  className?: string
  children: React.ReactNode
}

/** Label + control + hint/error, with the accessibility wiring done once. */
export function Field({ label, hint, error, id, inline = false, aside, required, className, children }: FieldProps) {
  const generated = React.useId()
  const controlId = id ?? `field-${generated}`
  const hintId = `${controlId}-hint`
  const message = error ?? hint
  const hasMessage = Boolean(message)
  const invalid = Boolean(error)
  const value = React.useMemo<FieldContextValue>(
    () => ({ id: controlId, describedBy: hasMessage ? hintId : undefined, invalid }),
    [controlId, hasMessage, hintId, invalid],
  )

  const labelEl = (
    <label htmlFor={controlId} className="text-sm font-medium text-fg">
      {label}
      {required ? (
        <span className="ml-0.5 text-faint" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  )
  const messageEl = message ? (
    <p id={hintId} className={cn("text-xs", error ? "text-danger" : "text-muted")} role={error ? "alert" : undefined}>
      {message}
    </p>
  ) : null

  return (
    <FieldContext.Provider value={value}>
      {inline ? (
        <div className={cn("flex items-center justify-between gap-6", className)}>
          <div className="flex min-w-0 flex-col gap-0.5">
            {labelEl}
            {messageEl}
          </div>
          <div className="shrink-0">{children}</div>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-1.5", className)}>
          <div className="flex items-baseline justify-between gap-3">
            {labelEl}
            {aside ? <div className="text-xs text-faint">{aside}</div> : null}
          </div>
          {children}
          {messageEl}
        </div>
      )}
    </FieldContext.Provider>
  )
}
