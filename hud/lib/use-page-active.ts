"use client"

import { useEffect, useState } from "react"

export function usePageActive(): boolean {
  const [active, setActive] = useState<boolean>(() => {
    if (typeof document === "undefined") return true
    return !document.hidden
  })

  useEffect(() => {
    const update = () => setActive(!document.hidden && document.hasFocus())
    update()
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    return () => {
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
    }
  }, [])

  return active
}

