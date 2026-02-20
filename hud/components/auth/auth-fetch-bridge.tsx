"use client"

import { useEffect } from "react"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"

export function AuthFetchBridge() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    if (!hasSupabaseClientConfig || !supabaseBrowser) return
    const client = supabaseBrowser

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const reqUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        const isApiCall = reqUrl.startsWith("/api/") || reqUrl.includes("/api/")
        if (!isApiCall) return originalFetch(input, init)

        const { data } = await client.auth.getSession()
        const token = String(data.session?.access_token || "").trim()
        if (!token) return originalFetch(input, init)

        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`)
        }

        return originalFetch(input, {
          ...init,
          credentials: "include",
          headers,
        })
      } catch {
        return originalFetch(input, init)
      }
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}
