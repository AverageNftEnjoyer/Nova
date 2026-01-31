"use client"

import { useEffect, useState } from "react"
import { BootScreen } from "@/components/boot-screen"

export default function BootOrchestrator() {
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    // Clear active conversation so we always start fresh
    localStorage.removeItem("nova-active-conversation")
  }, [])

  useEffect(() => {
    if (!booting) {
      window.location.replace("/history")
    }
  }, [booting])

  return booting ? <BootScreen onComplete={() => setBooting(false)} /> : null
}
