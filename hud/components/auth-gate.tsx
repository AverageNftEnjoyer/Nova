"use client"

import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

type SessionStatus = {
  configured: boolean
  authenticated: boolean
  sessionToken?: string | null
}

const SESSION_STORAGE_KEY = "nova_session_fallback"
const SESSION_HEADER_NAME = "x-nova-session"

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const isLoginRoute = pathname === "/login"

  useEffect(() => {
    if (isLoginRoute) return

    let cancelled = false
    const token = typeof window !== "undefined" ? String(localStorage.getItem(SESSION_STORAGE_KEY) || "").trim() : ""
    const headers = token ? { [SESSION_HEADER_NAME]: token } : undefined
    void fetch("/api/auth/session", { cache: "no-store", headers })
      .then((res) => res.json())
      .then((data: SessionStatus) => {
        if (cancelled) return
        if (typeof data?.sessionToken === "string" && data.sessionToken.trim().length > 0) {
          localStorage.setItem(SESSION_STORAGE_KEY, data.sessionToken.trim())
        }
        if (data?.configured && data?.authenticated) {
          setReady(true)
          return
        }
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
      })
      .catch(() => {
        if (cancelled) return
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
      })

    return () => {
      cancelled = true
    }
  }, [isLoginRoute, pathname, router])

  if (!ready && !isLoginRoute) {
    return null
  }

  return <>{children}</>
}
