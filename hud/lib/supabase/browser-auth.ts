"use client"

import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"

export async function getSupabaseAccessToken(): Promise<string> {
  if (!hasSupabaseClientConfig || !supabaseBrowser) return ""
  try {
    const { data } = await supabaseBrowser.auth.getSession()
    return String(data.session?.access_token || "").trim()
  } catch {
    return ""
  }
}

export async function buildSupabaseAuthHeaders(headers?: HeadersInit): Promise<Headers> {
  const next = new Headers(headers || {})
  if (!next.has("authorization")) {
    const accessToken = await getSupabaseAccessToken()
    if (accessToken) {
      next.set("authorization", `Bearer ${accessToken}`)
    }
  }
  return next
}

export async function fetchWithSupabaseAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = await buildSupabaseAuthHeaders(init.headers)
  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  })
}
