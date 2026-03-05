"use client"

import { useEffect, useState } from "react"
import { HomeMainScreen } from "./home-main-screen"

export function HomeMainScreenClient() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null
  return <HomeMainScreen />
}
