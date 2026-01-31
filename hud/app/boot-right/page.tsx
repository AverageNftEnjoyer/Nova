"use client"

import { useState, useEffect } from "react"
import { BootScreenSecondary } from "@/components/boot-screen-secondary"

export default function BootRightPage() {
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    if (!booting) {
      window.location.replace("/home")
    }
  }, [booting])

  return booting ? <BootScreenSecondary onComplete={() => setBooting(false)} /> : null
}
