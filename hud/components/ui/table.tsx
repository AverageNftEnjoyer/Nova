"use client"

import * as React from "react"
import { cn } from "@/lib/shared/utils"

interface TableContextValue {
  density: "compact" | "default"
  stickyHeader: boolean
}

const TableContext = React.createContext<TableContextValue>({ density: "default", stickyHeader: false })

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** compact = 32px rows, default = 36px rows. */
  density?: "compact" | "default"
  /** Header stays visible while the container scrolls (the container needs a height and overflow). */
  stickyHeader?: boolean
  containerClassName?: string
}

/** Dense data table. Numbers right-aligned with `numeric`, IDs/models/costs in `mono` cells. */
export function Table({ density = "default", stickyHeader = false, className, containerClassName, ...props }: TableProps) {
  const ctx = React.useMemo(() => ({ density, stickyHeader }), [density, stickyHeader])
  return (
    <TableContext.Provider value={ctx}>
      <div className={cn("relative w-full overflow-x-auto", containerClassName)}>
        <table className={cn("w-full border-separate border-spacing-0 text-sm", className)} {...props} />
      </div>
    </TableContext.Provider>
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  const { stickyHeader } = React.useContext(TableContext)
  return <thead className={cn(stickyHeader && "sticky top-0 z-10", className)} {...props} />
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />
}

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Row is clickable: pointer cursor and hover. Give it an onClick and a keyboard path (a link/button in a cell). */
  interactive?: boolean
  selected?: boolean
}

export function Tr({ interactive = false, selected = false, className, ...props }: TrProps) {
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      className={cn(
        "group/row transition-colors duration-100",
        "hover:bg-hover",
        interactive && "cursor-pointer",
        selected && "bg-accent-muted hover:bg-accent-muted",
        className,
      )}
      {...props}
    />
  )
}

interface CellOptions {
  /** Right-aligned tabular numbers. */
  numeric?: boolean
  /** Geist Mono (IDs, model names, timestamps). */
  mono?: boolean
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align to sit over a numeric column. */
  numeric?: boolean
}

export function Th({ numeric, className, scope = "col", ...props }: ThProps) {
  const { density, stickyHeader } = React.useContext(TableContext)
  return (
    <th
      scope={scope}
      className={cn(
        "border-b border-border px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted",
        density === "compact" ? "h-8" : "h-9",
        stickyHeader && "bg-surface",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  )
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement>, CellOptions {
  /** Secondary-coloured text. */
  muted?: boolean
}

export function Td({ numeric, mono, muted, className, ...props }: TdProps) {
  const { density } = React.useContext(TableContext)
  return (
    <td
      className={cn(
        "border-b border-border-subtle px-3 align-middle text-fg",
        density === "compact" ? "h-8" : "h-9",
        numeric && "text-right tabular-nums",
        mono && "font-mono text-xs",
        muted && "text-muted",
        className,
      )}
      {...props}
    />
  )
}
