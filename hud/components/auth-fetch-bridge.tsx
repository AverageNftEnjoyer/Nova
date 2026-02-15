"use client"

import { useEffect } from "react"

const SESSION_STORAGE_KEY = "nova_session_fallback"
const SESSION_HEADER_NAME = "x-nova-session"

export function AuthFetchBridge() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const reqUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        const isApiCall = reqUrl.startsWith("/api/") || reqUrl.includes("/api/")
        if (!isApiCall) return originalFetch(input, init)

        const token = localStorage.getItem(SESSION_STORAGE_KEY) || ""
        if (!token) return originalFetch(input, init)

        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
        if (!headers.has(SESSION_HEADER_NAME)) {
          headers.set(SESSION_HEADER_NAME, token)
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
