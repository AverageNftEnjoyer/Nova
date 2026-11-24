"use client"

import * as React from "react"
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react"
import { Portal } from "@/components/ui/overlay"

export type ToastTone = "neutral" | "success" | "warning" | "danger" | "info"

export interface ToastOptions {
  title: string
  description?: string
  tone?: ToastTone
  /** ms before it closes; 0 keeps it until dismissed. Defaults: 4500, danger 8000. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface ToastRecord extends Required<Pick<ToastOptions, "title" | "tone" | "duration">> {
  id: number
  description?: string
  action?: ToastOptions["action"]
}

type Listener = () => void

let records: ToastRecord[] = []
let nextId = 1
const listeners = new Set<Listener>()
const MAX_VISIBLE = 4

function emit() {
  for (const listener of listeners) listener()
}

function push(options: ToastOptions): number {
  const id = nextId++
  const tone = options.tone ?? "neutral"
  records = [
    ...records,
    { id, title: options.title, description: options.description, tone, duration: options.duration ?? (tone === "danger" ? 8000 : 4500), action: options.action },
  ].slice(-MAX_VISIBLE)
  emit()
  return id
}

function dismiss(id?: number) {
  records = id === undefined ? [] : records.filter((r) => r.id !== id)
  emit()
}

type ToastInput = string | ToastOptions
const normalize = (input: ToastInput, tone?: ToastTone): ToastOptions =>
  typeof input === "string" ? { title: input, tone } : { ...input, tone: tone ?? input.tone }

/**
 * Show a toast from anywhere (no hook needed): toast("Saved"), toast.success("Deployment launched"),
 * toast.error({ title: "Could not reach Gmail", description: "Reconnect it in Integrations." }).
 * Returns the id for toast.dismiss(id).
 */
export const toast = Object.assign((input: ToastInput) => push(normalize(input)), {
  success: (input: ToastInput) => push(normalize(input, "success")),
  error: (input: ToastInput) => push(normalize(input, "danger")),
  warning: (input: ToastInput) => push(normalize(input, "warning")),
  info: (input: ToastInput) => push(normalize(input, "info")),
  dismiss,
})

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const getSnapshot = () => records
const getServerSnapshot = (): ToastRecord[] => []

/** Hook form for components that prefer it; also exposes the current toasts. */
export function useToast() {
  const toasts = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { toast, dismiss, toasts }
}

const TONE_ICON: Record<ToastTone, React.ReactNode> = {
  neutral: null,
  success: <CheckCircle2 className="text-success" />,
  warning: <TriangleAlert className="text-warning" />,
  danger: <CircleAlert className="text-danger" />,
  info: <Info className="text-info" />,
}

function ToastItem({ record }: { record: ToastRecord }) {
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (record.duration <= 0 || paused) return
    const timer = window.setTimeout(() => dismiss(record.id), record.duration)
    return () => window.clearTimeout(timer)
  }, [record.id, record.duration, paused])

  const icon = TONE_ICON[record.tone]
  return (
    <li
      role={record.tone === "danger" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-[22rem] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border border-border-strong bg-surface-2 py-2.5 pr-2 pl-3 shadow-overlay animate-toast-in"
    >
      {icon ? <span className="mt-0.5 flex shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 flex-1 py-px">
        <p className="text-sm font-medium text-fg">{record.title}</p>
        {record.description ? <p className="mt-0.5 text-xs text-muted">{record.description}</p> : null}
      </div>
      {record.action ? (
        <button
          type="button"
          onClick={() => {
            record.action?.onClick()
            dismiss(record.id)
          }}
          className="h-6 shrink-0 rounded-sm px-2 text-xs font-medium text-fg hover:bg-hover"
        >
          {record.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(record.id)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-fg"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  )
}

/** Mounted once in app/layout.tsx. */
export function Toaster() {
  const { toasts } = useToast()
  return (
    <Portal>
      <ol
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-300 flex flex-col items-end gap-2"
      >
        {toasts.map((record) => (
          <ToastItem key={record.id} record={record} />
        ))}
      </ol>
    </Portal>
  )
}
