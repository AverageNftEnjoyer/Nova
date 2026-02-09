"use client"

import { useState, useEffect } from "react"
import { BootScreenSecondary } from "@/components/boot-screen-secondary"
import { loadUserSettings } from "@/lib/userSettings"

export default function BootRightPage() {
  const [booting, setBooting] = useState(true)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Check if boot animation is enabled in settings
    const settings = loadUserSettings()
    if (!settings.app.bootAnimationEnabled) {
      // Skip boot animation, go directly to home
      window.location.replace("/home")
      return
    }
    setChecked(true)
  }, [])

  useEffect(() => {
    if (!booting && checked) {
      window.location.replace("/home")
    }
  }, [booting, checked])

  if (!checked) return null

  return booting ? <BootScreenSecondary onComplete={() => setBooting(false)} /> : null
}
