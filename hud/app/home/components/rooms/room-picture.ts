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
      let found: string | null = null
      for (const candidate of sources) {
        if (await probe(candidate)) {
          found = candidate
          break
        }
      }
      resolved.set(key, found)
      if (!cancelled) setState(found ? { status: "ready", src: found } : { status: "none" })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
