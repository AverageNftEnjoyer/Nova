"use client"

import { useSyncExternalStore } from "react"
import { HomeMainScreen } from "./home-main-screen"

const subscribe = () => () => {}

export function HomeMainScreenClient() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)

  if (!mounted) return null
  return <HomeMainScreen />
}
