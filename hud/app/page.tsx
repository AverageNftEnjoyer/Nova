"use client"

import { useEffect } from "react"

export default function RootPage() {
  useEffect(() => {
    // Clear active conversation so we always start fresh
    localStorage.removeItem("nova-active-conversation")
    // Redirect to boot sequence
    window.location.replace("/boot-right")
  }, [])

  return null
}
