"use client"

import type { ReactNode } from "react"
import { CircleAlert, Info, TriangleAlert } from "lucide-react"

import { Field, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui"
import { cn } from "@/lib/shared/utils"
import { SetupPanelHeader, type SetupPanelHeaderProps } from "./SetupPanelHeader"

/** A titled group of fields inside a tab. Sections are separated by hairlines, not boxed. */
export function SetupSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-4 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-md font-medium text-fg">{title}</h3>
          {description ? <p className="max-w-[40rem] text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A setting with a switch on the right. */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <Field inline label={label} hint={description} className="py-1">
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
    </Field>
  )
}

export interface DetailRow {
  label: string
  value: ReactNode
  mono?: boolean
}

/** Read-only facts (account, scopes, timestamps) as a two-column definition list. */
export function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted">{row.label}</dt>
          <dd className={cn("min-w-0 break-words text-fg", row.mono && "font-mono text-xs leading-5")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const NOTICE_TONE = {
  info: { icon: Info, className: "bg-info-muted", iconClass: "text-info" },
  warning: { icon: TriangleAlert, className: "bg-warning-muted", iconClass: "text-warning" },
  danger: { icon: CircleAlert, className: "bg-danger-muted", iconClass: "text-danger" },
} as const

/** An inline note that says what is missing and what to do. */
export function Notice({ tone = "info", children }: { tone?: keyof typeof NOTICE_TONE; children: ReactNode }) {
  const config = NOTICE_TONE[tone]
  const Icon = config.icon
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm text-fg", config.className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", config.iconClass)} aria-hidden="true" />
      <div className="min-w-0 leading-5">{children}</div>
    </div>
  )
}

/** Form buttons under a group of fields. */
export function FormActions({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">{children}</div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export type DetailTabId = "setup" | "settings" | "live" | "instructions"

export const DETAIL_TAB_LABEL: Readonly<Record<DetailTabId, string>> = {
  setup: "Setup",
  settings: "Settings",
  live: "Live",
  instructions: "Instructions",
}

export interface DetailTab {
  id: DetailTabId
  content: ReactNode
}

export interface DetailTabState {
  tab: DetailTabId
  onTabChange: (tab: DetailTabId) => void
}

export interface IntegrationDetailProps extends SetupPanelHeaderProps, DetailTabState {
  tabs: DetailTab[]
}

/** The right-hand side of /integrations: the compact header, then the integration's tabs. */
export function IntegrationDetail({ tabs, tab, onTabChange, ...header }: IntegrationDetailProps) {
  const current = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id ?? "setup"
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SetupPanelHeader {...header} />
      <Tabs value={current} onValueChange={(value) => onTabChange(value as DetailTabId)}>
        <TabsList aria-label={`${header.title} sections`}>
          {tabs.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {DETAIL_TAB_LABEL[item.id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((item) => (
          <TabsContent key={item.id} value={item.id} className="flex flex-col gap-6 pt-5">
            {item.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
