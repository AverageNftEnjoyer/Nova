"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { NovaBootup } from "@/components/Nova-Bootup"
import { loadUserSettings } from "@/lib/userSettings"

export default function BootRightPage() {
  const router = useRouter()
  const [booting, setBooting] = useState(true)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Check if boot animation is enabled in settings
    const settings = loadUserSettings()
    if (!settings.app.bootAnimationEnabled) {
      sessionStorage.removeItem("nova-home-intro-pending")
      // Skip boot animation, go directly to home
      router.replace("/home")
      return
    }
    setChecked(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [router])

  useEffect(() => {
    if (!booting && checked) {
      router.replace("/home")
    }
  }, [booting, checked, router])

  if (!checked) return null

  return booting ? <NovaBootup onComplete={() => {
    sessionStorage.setItem("nova-home-intro-pending", "true")
    setBooting(false)
  }} /> : null
}
