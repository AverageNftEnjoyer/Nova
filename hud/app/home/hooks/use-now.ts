"use client"

import { useEffect, useState } from "react"

/** A wall clock for relative and elapsed times: ticks once a second while `fast`, otherwise once a minute. */
export function useNow(fast = false): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), fast ? 1_000 : 60_000)
    return () => window.clearInterval(timer)
  }, [fast])
  return now
}
