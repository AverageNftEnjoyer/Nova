"use client"

import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const SESSION_STORAGE_KEY = "nova_session_fallback"

function sanitizeNextPath(raw: string | null): string {
  const value = String(raw || "").trim()
  if (!value.startsWith("/")) return "/boot-right"
  if (value.startsWith("//")) return "/boot-right"
  return value
}

export default function LoginPage() {
  const router = useRouter()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [nextPath, setNextPath] = useState("/boot-right")

  useEffect(() => {
    let cancelled = false
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const isConfigured = Boolean(data?.configured)
        const isAuthed = Boolean(data?.authenticated)
        if (typeof data?.sessionToken === "string" && data.sessionToken.trim().length > 0) {
          localStorage.setItem(SESSION_STORAGE_KEY, data.sessionToken.trim())
        }
        const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"))
        setNextPath(next)
        if (isConfigured && isAuthed) {
          router.replace(next)
          return
        }
        setConfigured(isConfigured)
      })
      .catch(() => {
        if (cancelled) return
        setConfigured(false)
      })

    return () => {
      cancelled = true
    }
  }, [router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const endpoint = configured ? "/api/auth/login" : "/api/auth/setup"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Authentication failed.")
      }
      if (typeof data?.sessionToken === "string" && data.sessionToken.trim().length > 0) {
        localStorage.setItem(SESSION_STORAGE_KEY, data.sessionToken.trim())
      }
      router.replace(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.")
    } finally {
      setBusy(false)
    }
  }

  if (configured === null) {
    return <div className="min-h-dvh bg-[#05070a]" />
  }

  return (
    <main className="min-h-dvh bg-[#05070a] text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-white/10 bg-white/3 p-6">
        <h1 className="text-xl font-semibold">{configured ? "Sign In" : "Setup Admin Password"}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {configured ? "Enter your admin password to unlock Nova." : "Create the local admin password (min 12 chars)."}
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="mt-4 h-10 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm outline-none"
        />
        {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-4 h-10 w-full rounded-md border border-emerald-300/40 bg-emerald-500/15 text-emerald-200 disabled:opacity-60"
        >
          {busy ? "Please wait..." : configured ? "Sign In" : "Create Password"}
        </button>
      </form>
    </main>
  )
}
