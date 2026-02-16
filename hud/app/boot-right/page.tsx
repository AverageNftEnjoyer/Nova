"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { NovaBootup } from "@/components/Nova-Bootup"
import { loadUserSettings } from "@/lib/userSettings"

export default function BootRightPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [booting, setBooting] = useState(true)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const nextParam = String(searchParams.get("next") || "").trim()
    const nextPath = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/home"
    // Check if boot animation is enabled in settings
    const settings = loadUserSettings()
    if (!settings.app.bootAnimationEnabled) {
      sessionStorage.removeItem("nova-home-intro-pending")
      // Skip boot animation, go directly to home
      router.replace(nextPath)
      return
    }
    setChecked(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [router, searchParams])

  useEffect(() => {
    if (!booting && checked) {
      const nextParam = String(searchParams.get("next") || "").trim()
      const nextPath = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/home"
      router.replace(nextPath)
    }
  }, [booting, checked, router, searchParams])

  if (!checked) return null

  return booting ? <NovaBootup onComplete={() => {
    sessionStorage.setItem("nova-home-intro-pending", "true")
    setBooting(false)
  }} /> : null
}
