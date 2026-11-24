"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/** The runtime's HUD gateway (same endpoint useNovaState talks to). */
const RUNTIME_WS_URL = "ws://localhost:8765"
/** After this many failed attempts in a row the runtime is reported offline (retries continue). */
const OFFLINE_AFTER_FAILURES = 3
const MIN_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000

export type RuntimeConnection = "connecting" | "connected" | "reconnecting" | "offline"

/**
 * Passive probe of the runtime WebSocket for the top bar status.
 *
 * It opens its own socket and ignores every message. It deliberately does not call useNovaState: that hook
 * re-dispatches runtime events (agent-task budgets, YouTube updates) as window events, so a second, always-mounted
 * instance in the shell would deliver each of them twice.
 */
export function useRuntimeConnection(): { status: RuntimeConnection; retry: () => void } {
  const [status, setStatus] = useState<RuntimeConnection>("connecting")
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    let delay = MIN_DELAY_MS
    let everConnected = false

    const schedule = () => {
      if (disposed) return
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, MAX_DELAY_MS)
    }

    function connect() {
      timer = null
      if (disposed) return
      let opened = false
      try {
        socket = new WebSocket(RUNTIME_WS_URL)
      } catch {
        failures += 1
        setStatus(failures >= OFFLINE_AFTER_FAILURES ? "offline" : everConnected ? "reconnecting" : "connecting")
        schedule()
        return
      }
      socket.onopen = () => {
        opened = true
        everConnected = true
        failures = 0
        delay = MIN_DELAY_MS
        setStatus("connected")
      }
      socket.onclose = () => {
        if (disposed) return
        if (!opened) failures += 1
        setStatus(failures >= OFFLINE_AFTER_FAILURES ? "offline" : everConnected ? "reconnecting" : "connecting")
        schedule()
      }
    }

    retryRef.current = () => {
      if (disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
      if (timer) clearTimeout(timer)
      delay = MIN_DELAY_MS
      setStatus(everConnected ? "reconnecting" : "connecting")
      connect()
    }

    connect()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (socket) {
        socket.onopen = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [])

  const retry = useCallback(() => retryRef.current(), [])
  return { status, retry }
}
