"use client"

type LoginDebugEvent = {
  ts: number
  source: string
  event: string
  detail?: string
}

type LoginDebugState = {
  counters: Record<string, number>
  events: LoginDebugEvent[]
}

declare global {
  interface Window {
    __novaLoginDebug?: LoginDebugState
  }
}

function ensureState(): LoginDebugState {
  if (typeof window === "undefined") {
    return { counters: {}, events: [] }
  }
  if (!window.__novaLoginDebug) {
    window.__novaLoginDebug = { counters: {}, events: [] }
  }
  return window.__novaLoginDebug
}

export function loginDebugBump(counter: string): number {
  const state = ensureState()
  const key = String(counter || "").trim()
  if (!key) return 0
  state.counters[key] = (state.counters[key] || 0) + 1
  return state.counters[key]
}

export function loginDebugEvent(source: string, event: string, detail?: string): void {
  const state = ensureState()
  state.events.push({
    ts: Date.now(),
    source: String(source || "").trim() || "unknown",
    event: String(event || "").trim() || "event",
    detail: typeof detail === "string" ? detail : undefined,
  })
  if (state.events.length > 120) {
    state.events.splice(0, state.events.length - 120)
  }
}

export function loginDebugSnapshot(): LoginDebugState {
  const state = ensureState()
  return {
    counters: { ...state.counters },
    events: [...state.events],
  }
}

