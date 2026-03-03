"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    // Clear active conversation so we always start fresh
    localStorage.removeItem("nova-active-conversation")
    // Use client router navigation to avoid full document reload churn.
    router.replace("/boot-right")
  }, [router])

  return null
}
