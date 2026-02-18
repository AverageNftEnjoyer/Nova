import { useEffect, useMemo, useRef, useState } from "react"

interface UseAnimatedNumberInput {
  value: number
  durationMs?: number
}

export function useAnimatedNumber({ value, durationMs = 700 }: UseAnimatedNumberInput): number {
  const [display, setDisplay] = useState(value)
  const rafRef = useRef<number | null>(null)
  const fromRef = useRef(value)

  useEffect(() => {
    const start = performance.now()
    const from = fromRef.current
    const delta = value - from

    const step = (now: number) => {
      const elapsed = now - start
      const t = Math.min(1, elapsed / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + delta * eased
      setDisplay(next)
      if (t < 1) {
        rafRef.current = window.requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }

    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    rafRef.current = window.requestAnimationFrame(step)

    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    }
  }, [durationMs, value])

  return useMemo(() => display, [display])
}
