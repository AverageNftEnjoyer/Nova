"use client"

import type { ReactNode } from "react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter } from "next/navigation"
import { ACTIVE_USER_CHANGED_EVENT, getActiveUserId, setActiveUserId } from "@/lib/auth/active-user"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"

function sanitizeNextPath(raw: string | null): string {
  const value = String(raw || "").trim()
  if (!value.startsWith("/")) return "/home"
  if (value.startsWith("//")) return "/home"
  return value
}

function subscribeToActiveUserChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = () => callback()
  window.addEventListener(ACTIVE_USER_CHANGED_EVENT, listener)
  return () => window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, listener)
}

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isLoginRoute = pathname === "/login"
  const hasCachedUser = useSyncExternalStore(
    subscribeToActiveUserChange,
    () => Boolean(getActiveUserId()),
    () => false,
  )
  const [ready, setReady] = useState(isLoginRoute)

  useEffect(() => {
    const loginParams = isLoginRoute ? new URLSearchParams(window.location.search) : null
    const loginMode = String(loginParams?.get("mode") || "").trim()
    const allowLoginWhileAuthed = isLoginRoute && (loginMode === "signup" || loginParams?.get("switch") === "1")
    let cancelled = false
    if (!hasSupabaseClientConfig || !supabaseBrowser) {
      if (isLoginRoute || hasCachedUser) return
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
      return
    }

    void supabaseBrowser.auth.getSession()
      .then(({ data }) => {
        if (cancelled) return
        const authed = Boolean(data.session?.user)
        setActiveUserId(data.session?.user?.id || null)
        if (isLoginRoute) {
          if (authed && !allowLoginWhileAuthed) {
            const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"))
            router.replace(next)
            return
          }
          setReady(true)
          return
        }
        if (authed) {
          setReady(true)
          return
        }
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
      })
      .catch(() => {
        if (cancelled) return
        if (!isLoginRoute) {
          router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
          return
        }
        setReady(true)
      })

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setActiveUserId(session?.user?.id || null)
      if (isLoginRoute) {
        if (session?.user && !allowLoginWhileAuthed) {
          const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"))
          router.replace(next)
          return
        }
        setReady(true)
        return
      }
      if (session?.user) {
        setReady(true)
        return
      }
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [hasCachedUser, isLoginRoute, pathname, router])

  if (!ready && !hasCachedUser) {
    return null
  }

  return <>{children}</>
}
