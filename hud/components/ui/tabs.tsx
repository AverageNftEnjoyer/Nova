"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"

type TabsVariant = "underline" | "segmented"

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
  variant: TabsVariant
  baseId: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabs(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error(`${component} must be used inside <Tabs>`)
  return ctx
}

const slug = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-")

export interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  /** underline: page/section navigation. segmented: switching a view inside a panel. */
  variant?: TabsVariant
  className?: string
  children: React.ReactNode
}

/** Controlled tabs. Arrow keys / Home / End move between triggers (automatic activation). */
export function Tabs({ value, onValueChange, variant = "underline", className, children }: TabsProps) {
  const baseId = React.useId()
  const ctx = React.useMemo(() => ({ value, setValue: onValueChange, variant, baseId }), [value, onValueChange, variant, baseId])
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  "aria-label"?: string
}

export function TabsList({ className, children, onKeyDown, ...props }: TabsListProps) {
  const { variant } = useTabs("TabsList")
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={(event) => {
        onKeyDown?.(event)
        const keys = ["ArrowLeft", "ArrowRight", "Home", "End"]
        if (!keys.includes(event.key)) return
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'))
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
        if (current < 0) return
        event.preventDefault()
        const next =
          event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
        tabs[next]?.focus()
        tabs[next]?.click()
      }}
      className={cn(
        variant === "underline"
          ? "flex items-stretch gap-5 border-b border-border"
          : "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface TabsTriggerProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string
  /** Small count after the label (e.g. pending approvals). */
  count?: number
}

export function TabsTrigger({ value, count, className, children, disabled, ...props }: TabsTriggerProps) {
  const { value: current, setValue, variant, baseId } = useTabs("TabsTrigger")
  const selected = current === value
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${slug(value)}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${slug(value)}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      data-state={selected ? "active" : "inactive"}
      onClick={() => setValue(value)}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-150 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        variant === "underline"
          ? cn(
              "relative -mb-px h-9 border-b-2 text-sm",
              selected ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )
          : cn(
              "h-6 rounded-sm px-2.5 text-xs",
              selected ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--border-strong)]" : "text-muted hover:text-fg",
            ),
        className,
      )}
      {...props}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={cn(
            "min-w-4 rounded-sm px-1 text-center font-mono text-2xs tabular-nums leading-4",
            selected ? "bg-accent-muted text-accent-text" : "bg-surface-3 text-muted",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const { value: current, baseId } = useTabs("TabsContent")
  if (current !== value) return null
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${slug(value)}`}
      aria-labelledby={`${baseId}-tab-${slug(value)}`}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  )
}
