import type { AgentTaskEvent } from "./types"

type Listener = (event: AgentTaskEvent) => void

// Kept on globalThis so route bundles and the runner share one bus even when Next duplicates modules.
type BusGlobal = typeof globalThis & { __novaAgentTaskBus?: Map<string, Set<Listener>> }

function getBus(): Map<string, Set<Listener>> {
  const g = globalThis as BusGlobal
  if (!g.__novaAgentTaskBus) g.__novaAgentTaskBus = new Map()
  return g.__novaAgentTaskBus
}

export function publishTaskEvent(userId: string, event: AgentTaskEvent): void {
  const listeners = getBus().get(userId)
  if (!listeners) return
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // A failing subscriber must not block the others.
    }
  }
}

export function subscribeTaskEvents(userId: string, listener: Listener): () => void {
  const bus = getBus()
  let listeners = bus.get(userId)
  if (!listeners) {
    listeners = new Set()
    bus.set(userId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = bus.get(userId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) bus.delete(userId)
  }
}
