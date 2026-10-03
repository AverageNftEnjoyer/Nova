"use client"

import { useEffect, useState } from "react"

/** Pictures already probed this session: the first candidate that loaded, or null when none did. */
const resolved = new Map<string, string | null>()

export type RoomPictureState = { status: "loading" } | { status: "ready"; src: string } | { status: "none" }

function probe(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = src
  })
}

/** Finds (and remembers) the first candidate that loads; shared by the hook and the idle preloader. */
async function resolveFirst(sources: readonly string[]): Promise<string | null> {
  const key = sources.join("|")
  if (resolved.has(key)) return resolved.get(key) ?? null
  let found: string | null = null
  for (const candidate of sources) {
    if (await probe(candidate)) {
      found = candidate
      break
    }
  }
  resolved.set(key, found)
  return found
}

/** Resolves once a room's picture is loaded (or none loads, or `timeoutMs` passes), so a room can open already drawn. */
export function whenRoomPictureReady(sources: readonly string[], timeoutMs = 4000): Promise<void> {
  if (sources.length === 0) return Promise.resolve()
  return Promise.race([resolveFirst(sources).then(() => undefined), new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))])
}

/** Warms the browser cache with a room's picture before the player opens the room (Home does this once it is idle). */
export function preloadRoomPicture(sources: readonly string[]): void {
  if (sources.length > 0) void resolveFirst(sources)
}

/**
 * Finds the first candidate picture that loads, for rooms whose layout depends on it (immersive stages).
 * An empty candidate list resolves to "none" at once.
 */
export function useRoomPicture(sources: readonly string[]): RoomPictureState {
  const key = sources.join("|")
  const [state, setState] = useState<RoomPictureState>(() => {
    if (sources.length === 0) return { status: "none" }
    const known = resolved.get(key)
    if (known === undefined) return { status: "loading" }
    return known ? { status: "ready", src: known } : { status: "none" }
  })

  useEffect(() => {
    if (sources.length === 0 || resolved.has(key)) return
    let cancelled = false
    void (async () => {
      const found = await resolveFirst(sources)
      if (!cancelled) setState(found ? { status: "ready", src: found } : { status: "none" })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
