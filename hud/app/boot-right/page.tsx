"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { BootScreenSecondary } from "@/components/boot-screen-secondary"
import { loadUserSettings } from "@/lib/userSettings"

export default function BootRightPage() {
  const router = useRouter()
  const [booting, setBooting] = useState(true)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Check if boot animation is enabled in settings
    const settings = loadUserSettings()
    if (!settings.app.bootAnimationEnabled) {
      // Skip boot animation, go directly to home
      router.replace("/home")
      return
    }
    setChecked(true)
  }, [router])

  useEffect(() => {
    if (!booting && checked) {
      router.replace("/home")
    }
  }, [booting, checked, router])

  if (!checked) return null

  return booting ? <BootScreenSecondary onComplete={() => setBooting(false)} /> : null
}
