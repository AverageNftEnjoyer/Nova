"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Eye, EyeOff } from "lucide-react"
import { setActiveUserId } from "@/lib/auth/active-user"
import { loginDebugBump, loginDebugEvent, loginDebugSnapshot } from "@/lib/auth/login-debug"
import { hasSupabaseClientConfig, supabaseBrowser } from "@/lib/supabase/browser"
import { loadUserSettings, saveUserSettings } from "@/lib/settings/userSettings"

function sanitizeNextPath(raw: string | null): string {
  const value = String(raw || "").trim()
  if (!value.startsWith("/")) return "/boot-right"
  if (value.startsWith("//")) return "/boot-right"
  return value
}

function navigatePostAuth(nextPath: string): void {
  const target = `/boot-right?next=${encodeURIComponent(nextPath || "/home")}`
  window.location.assign(target)
}

async function ensureSupabaseSessionPersisted() {
  if (!hasSupabaseClientConfig || !supabaseBrowser) return
  await supabaseBrowser.auth.getSession()
}

export default function LoginPage() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement | null>(null)
  const debugMountIdRef = useRef(Math.random().toString(36).slice(2, 8))
  const googlePopupRef = useRef<Window | null>(null)
  const googlePopupPollRef = useRef<number | null>(null)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [debugPanel, setDebugPanel] = useState(() => loginDebugSnapshot())
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin")
  const [nextPath, setNextPath] = useState("/boot-right")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  function switchMode(nextMode: "signin" | "signup" | "forgot" | "reset") {
    setMode(nextMode)
    setEmail("")
    setName("")
    setPassword("")
    setConfirmPassword("")
    setShowPassword(false)
    setShowConfirmPassword(false)
    setError("")
    setNotice("")
  }

  if (debugEnabled) loginDebugBump("page.render")

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get("debug") === "1"
    setDebugEnabled(enabled)
  }, [])

  useEffect(() => {
    if (!debugEnabled) return
    const mountId = debugMountIdRef.current
    loginDebugBump("page.mount")
    loginDebugEvent("login-page", "mount", `id=${mountId}`)
    const timer = window.setInterval(() => setDebugPanel(loginDebugSnapshot()), 250)
    return () => {
      window.clearInterval(timer)
      loginDebugBump("page.unmount")
      loginDebugEvent("login-page", "unmount", `id=${mountId}`)
    }
  }, [debugEnabled])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const next = sanitizeNextPath(params.get("next"))
    const requestedMode = String(params.get("mode") || "").trim()
    const allowLoginWhileAuthed = requestedMode === "signup" || params.get("switch") === "1"
    const isGoogleOauthPopup = params.get("oauth") === "1" && Boolean(window.opener && window.opener !== window)
    if (requestedMode === "reset") switchMode("reset")
    else if (requestedMode === "signup") switchMode("signup")
    setNextPath(next)

    if (!hasSupabaseClientConfig || !supabaseBrowser) {
      if (debugEnabled) loginDebugEvent("login-page", "supabase:missing")
      setError("Supabase public client env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart.")
      return
    }
    void supabaseBrowser.auth.getSession().then(({ data }) => {
      if (debugEnabled) loginDebugEvent("login-page", "getSession", `authed=${data.session?.user ? "1" : "0"}`)
      setActiveUserId(data.session?.user?.id || null)
      if (data.session?.user && isGoogleOauthPopup) {
        try {
          window.opener?.postMessage(
            {
              type: "nova:google-oauth",
              status: "success",
              nextPath: next,
              userId: data.session.user.id,
            },
            window.location.origin,
          )
        } catch {
          // no-op
        }
        try {
          window.close()
        } catch {
          // no-op
        }
        return
      }
      if (data.session?.user && !allowLoginWhileAuthed) router.replace(next)
    })
  }, [debugEnabled, router])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const payload = event.data as
        | { type?: string; status?: "success" | "error"; nextPath?: string; userId?: string; message?: string }
        | null
      if (!payload || payload.type !== "nova:google-oauth") return

      if (googlePopupPollRef.current !== null) {
        window.clearInterval(googlePopupPollRef.current)
        googlePopupPollRef.current = null
      }
      if (googlePopupRef.current && !googlePopupRef.current.closed) {
        try {
          googlePopupRef.current.close()
        } catch {
          // no-op
        }
      }
      googlePopupRef.current = null

      if (payload.status === "success") {
        if (payload.userId) setActiveUserId(payload.userId)
        void ensureSupabaseSessionPersisted().then(() => {
          navigatePostAuth(payload.nextPath || nextPath)
        })
      } else {
        setBusy(false)
        setError(payload.message || "Google sign-in failed.")
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [nextPath])

  useEffect(() => {
    return () => {
      if (googlePopupPollRef.current !== null) {
        window.clearInterval(googlePopupPollRef.current)
      }
      googlePopupPollRef.current = null
      googlePopupRef.current = null
    }
  }, [])

  useEffect(() => {
    const section = formRef.current
    if (!section) return
    const spotlight = document.createElement("div")
    spotlight.className = "home-global-spotlight"
    section.appendChild(spotlight)
    let activeCard: HTMLElement | null = null

    const cards = () => section.querySelectorAll<HTMLElement>(".home-spotlight-card")
    const clearCardGlows = () => {
      cards().forEach((card) => card.style.setProperty("--glow-intensity", "0"))
      activeCard = null
    }
    const setCardGlow = (card: HTMLElement, e?: MouseEvent) => {
      if (activeCard && activeCard !== card) activeCard.style.setProperty("--glow-intensity", "0")
      const rect = card.getBoundingClientRect()
      const relativeX = e ? ((e.clientX - rect.left) / rect.width) * 100 : 50
      const relativeY = e ? ((e.clientY - rect.top) / rect.height) * 100 : 50
      card.style.setProperty("--glow-x", `${relativeX}%`)
      card.style.setProperty("--glow-y", `${relativeY}%`)
      card.style.setProperty("--glow-intensity", "1")
      card.style.setProperty("--glow-radius", "120px")
      activeCard = card
    }
    const getCardFromTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return null
      return target.closest(".home-spotlight-card") as HTMLElement | null
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect()
      spotlight.style.left = `${e.clientX - rect.left}px`
      spotlight.style.top = `${e.clientY - rect.top}px`
      spotlight.style.opacity = "1"
      const targetCard = getCardFromTarget(e.target)
      if (!targetCard) {
        clearCardGlows()
        return
      }
      setCardGlow(targetCard, e)
    }
    const handleMouseLeave = () => {
      spotlight.style.opacity = "0"
      clearCardGlows()
    }
    const handleFocusIn = (e: FocusEvent) => {
      const targetCard = getCardFromTarget(e.target)
      if (!targetCard) return
      spotlight.style.opacity = "0"
      setCardGlow(targetCard)
    }
    const handleFocusOut = () => {
      const focused = document.activeElement
      const activeFocusedCard = focused instanceof HTMLElement ? (focused.closest(".home-spotlight-card") as HTMLElement | null) : null
      if (activeFocusedCard) {
        setCardGlow(activeFocusedCard)
        return
      }
      clearCardGlows()
    }

    section.addEventListener("mousemove", handleMouseMove)
    section.addEventListener("mouseleave", handleMouseLeave)
    section.addEventListener("focusin", handleFocusIn)
    section.addEventListener("focusout", handleFocusOut)
    return () => {
      section.removeEventListener("mousemove", handleMouseMove)
      section.removeEventListener("mouseleave", handleMouseLeave)
      section.removeEventListener("focusin", handleFocusIn)
      section.removeEventListener("focusout", handleFocusOut)
      clearCardGlows()
      spotlight.remove()
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setNotice("")
    const trimmedEmail = email.trim()
    const trimmedName = name.trim()

    if (mode === "signin") {
      if (trimmedEmail && !password) {
        setError("Missing Password")
        return
      }
      if (!trimmedEmail && password) {
        setError("Missing Email")
        return
      }
      if (!trimmedEmail || !password) {
        setError("Incorrect Information Please Try Again")
        return
      }
    }
    if (mode === "signup") {
      if (!trimmedName || !trimmedEmail || !password || !confirmPassword) {
        setError("Incorrect Information Please Try Again")
        return
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.")
        return
      }
    }
    if (mode === "forgot" && !trimmedEmail) {
      setError("Missing Email")
      return
    }
    if (mode === "reset" && !password) {
      setError("Missing Password")
      return
    }

    setBusy(true)
    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase public client env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart.")
      }
      if (mode === "forgot") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:forgot")
        const redirectTo = `${window.location.origin}/login?mode=reset&next=${encodeURIComponent(nextPath)}`
        const { error: resetError } = await supabaseBrowser.auth.resetPasswordForEmail(trimmedEmail, { redirectTo })
        if (resetError) throw resetError
        setNotice("Password reset link sent. Check your email.")
        return
      }
      if (mode === "reset") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:reset")
        const { data } = await supabaseBrowser.auth.getSession()
        if (!data.session?.user) throw new Error("Open the password reset link from your email, then set your new password.")
        const { error: updateError } = await supabaseBrowser.auth.updateUser({ password })
        if (updateError) throw updateError
        setNotice("Password updated. Sign in with your new password.")
        switchMode("signin")
        return
      }
      if (mode === "signup") {
        if (debugEnabled) loginDebugEvent("login-page", "submit:signup")
        await supabaseBrowser.auth.signOut({ scope: "local" })
        setActiveUserId(null)
        const { data: signUpData, error: signUpError } = await supabaseBrowser.auth.signUp({
          email: trimmedEmail,
          password,
        })
        if (signUpError) throw signUpError
        let authedUserId = signUpData.session?.user?.id || null
        if (!signUpData.session) {
          const { data: autoSignIn, error: autoSignInError } = await supabaseBrowser.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          })
          if (!autoSignInError && autoSignIn.session?.user?.id) {
            authedUserId = autoSignIn.session.user.id
          }
        }
        setActiveUserId(authedUserId || signUpData.user?.id || null)
        if (trimmedName) {
          const current = loadUserSettings()
          saveUserSettings({
            ...current,
            profile: {
              ...current.profile,
              name: trimmedName,
              accessTier: "Model Unset",
            },
          })
        }
        if (authedUserId) {
          await ensureSupabaseSessionPersisted()
          navigatePostAuth(nextPath)
          return
        }
        setNotice("Account created. If email confirmation is enabled, verify your email first.")
      } else {
        if (debugEnabled) loginDebugEvent("login-page", "submit:signin")
        await supabaseBrowser.auth.signOut({ scope: "local" })
        setActiveUserId(null)
        const { data: signInData, error: signInError } = await supabaseBrowser.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        })
        if (signInError) throw signInError
        setActiveUserId(signInData.user?.id || null)
        await ensureSupabaseSessionPersisted()
        navigatePostAuth(nextPath)
      }
    } catch (err) {
      if (debugEnabled) loginDebugEvent("login-page", "submit:error", err instanceof Error ? err.message : "unknown")
      const message = err instanceof Error ? err.message : ""
      const normalized = message.toLowerCase()
      if (mode === "signin" && normalized.includes("invalid login credentials")) {
        setError("No Account Found with Email")
      } else if (!message && mode === "signin") {
        setError("Incorrect Information Please Try Again")
      } else {
        setError(message || "Authentication failed.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function onGoogleAuth() {
    setError("")
    setNotice("")
    setBusy(true)
    try {
      if (!hasSupabaseClientConfig || !supabaseBrowser) {
        throw new Error("Supabase public client env is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart.")
      }
      const supabase = supabaseBrowser
      const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}&oauth=1`
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (oauthError) throw oauthError
      const authUrl = String(data?.url || "").trim()
      if (!authUrl) throw new Error("Google sign-in did not return an authorization URL.")

      const width = 420
      const height = 620
      const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2))
      const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2))
      const popup = window.open(
        authUrl,
        "nova-google-oauth",
        `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no`,
      )
      if (!popup) {
        const tab = window.open(authUrl, "_blank")
        if (!tab) throw new Error("Popup was blocked. Allow popups for Nova to continue with Google.")
        setBusy(false)
        setNotice("Google sign-in opened in a new tab. Complete auth there, then return.")
      } else {
        googlePopupRef.current = popup
        if (googlePopupPollRef.current !== null) {
          window.clearInterval(googlePopupPollRef.current)
        }
        googlePopupPollRef.current = window.setInterval(() => {
          const handle = googlePopupRef.current
          if (!handle || !handle.closed) return
          if (googlePopupPollRef.current !== null) {
            window.clearInterval(googlePopupPollRef.current)
            googlePopupPollRef.current = null
          }
          googlePopupRef.current = null
          setBusy(false)
        }, 400)
      }
      if (debugEnabled) loginDebugEvent("login-page", "oauth:google:start")
    } catch (err) {
      if (debugEnabled) loginDebugEvent("login-page", "oauth:google:error", err instanceof Error ? err.message : "unknown")
      setError(err instanceof Error ? err.message : "Google sign-in failed.")
      setBusy(false)
    }
  }

  const cardTitle = mode === "signup" ? "Create Account" : mode === "forgot" ? "Reset Password" : mode === "reset" ? "Set New Password" : "Welcome Back"
  const cardSubtitle =
    mode === "signup"
      ? "Create your Nova account."
      : mode === "forgot"
        ? "Enter your email and we will send a reset link."
        : mode === "reset"
          ? "Set a new password for your account."
          : "Sign in to continue"
  const signInReady = email.trim().length > 0 && password.length > 0
  const signUpReady = name.trim().length > 0 && email.trim().length > 0 && password.length > 0 && confirmPassword.length > 0 && password === confirmPassword
  const forgotReady = email.trim().length > 0
  const resetReady = password.length > 0
  const submitReady = mode === "signup" ? signUpReady : mode === "forgot" ? forgotReady : mode === "reset" ? resetReady : signInReady
  const submitDisabled = busy || !submitReady

  return (
    <main className="relative z-10 min-h-dvh overflow-hidden bg-transparent text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        autoComplete="off"
        className="home-spotlight-shell relative z-10 w-full max-w-md min-h-170 rounded-[28px] border border-white/20 bg-black/65 p-6 sm:p-7 backdrop-blur-xl shadow-[0_24px_70px_-34px_rgba(0,0,0,0.8)]"
      >
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/28 bg-white/12 text-xl font-semibold text-white/90">N</div>
        <h1 className="text-center text-4xl font-semibold tracking-tight text-white">{cardTitle}</h1>
        <p className="mt-2 text-center text-lg text-slate-300">{cardSubtitle}</p>

        {mode === "signup" && (
          <label className="mt-6 block">
            <span className="mb-2 block text-sm text-slate-300">Name</span>
            <div className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover relative rounded-full">
              <input
                name="name"
                type="text"
                value={name}
                onChange={(e) => {
                  if (debugEnabled) loginDebugEvent("login-page", "input:name", `len=${e.target.value.length}`)
                  setName(e.target.value)
                }}
                placeholder="Enter your name"
                autoComplete="name"
                className="h-12 w-full rounded-full border border-white/14 bg-black/55 px-4 text-base text-white placeholder:text-slate-500 outline-none transition-colors focus:border-accent/60"
              />
            </div>
          </label>
        )}

        {mode !== "reset" && (
          <label className={mode === "signup" ? "mt-4 block" : "mt-6 block"}>
            <span className="mb-2 block text-sm text-slate-300">Email</span>
            <div className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover relative rounded-full">
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  if (debugEnabled) loginDebugEvent("login-page", "input:email", `len=${e.target.value.length}`)
                  setEmail(e.target.value)
                }}
                placeholder="you@example.com"
                autoComplete={mode === "signup" ? "email" : "username"}
                autoFocus
                className="h-12 w-full rounded-full border border-white/14 bg-black/55 px-4 text-base text-white placeholder:text-slate-500 outline-none transition-colors focus:border-accent/60"
              />
            </div>
          </label>
        )}

        {mode !== "forgot" && (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm text-slate-300">{mode === "reset" ? "New Password" : "Password"}</span>
            <div className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover relative rounded-full">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  if (debugEnabled) loginDebugEvent("login-page", "input:password", `len=${e.target.value.length}`)
                  setPassword(e.target.value)
                }}
                placeholder={mode === "reset" ? "Enter a new password" : "Enter your password"}
                autoComplete={mode === "signup" || mode === "reset" ? "new-password" : "current-password"}
                className="h-12 w-full rounded-full border border-white/14 bg-black/55 pr-12 pl-4 text-base text-white placeholder:text-slate-500 outline-none transition-colors focus:border-accent/60"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-white"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        )}

        {mode === "signup" && (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm text-slate-300">Re-enter Password</span>
            <div className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover relative rounded-full">
              <input
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  if (debugEnabled) loginDebugEvent("login-page", "input:confirm", `len=${e.target.value.length}`)
                  setConfirmPassword(e.target.value)
                }}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="h-12 w-full rounded-full border border-white/14 bg-black/55 pr-12 pl-4 text-base text-white placeholder:text-slate-500 outline-none transition-colors focus:border-accent/60"
              />
              <button
                type="button"
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-white"
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        )}

        {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-emerald-100">{notice}</p> : null}

        {mode === "signin" ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                switchMode("forgot")
              }}
              className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover h-12 w-full rounded-full border border-white/16 bg-black/30 px-4 text-sm font-medium text-slate-200 transition-colors hover:text-white"
            >
              Forgot Password
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className={`home-spotlight-card home-border-glow home-spotlight-dynamic h-12 w-full rounded-full border border-white/18 bg-black/25 text-base font-semibold text-white transition-colors ${submitDisabled ? "cursor-not-allowed opacity-45" : "home-spotlight-card--hover hover:text-white"}`}
            >
              {busy ? "Please wait..." : "Sign In"}
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={submitDisabled}
            className={`home-spotlight-card home-border-glow home-spotlight-dynamic mt-4 h-12 w-full rounded-full border border-white/18 bg-black/25 text-base font-semibold text-white transition-colors ${submitDisabled ? "cursor-not-allowed opacity-45" : "home-spotlight-card--hover hover:text-white"}`}
          >
            {busy ? "Please wait..." : mode === "signup" ? "Create Account" : mode === "forgot" ? "Send Reset Link" : "Update Password"}
          </button>
        )}

        {(mode === "signin" || mode === "signup") && (
          <>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/35" />
              <span className="text-xs font-medium tracking-[0.2em] text-white/65">OR</span>
              <div className="h-px flex-1 bg-white/35" />
            </div>
            <button
              type="button"
              onClick={() => void onGoogleAuth()}
              disabled={busy}
              className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover flex h-12 w-full items-center justify-center gap-3 rounded-full border border-white/18 bg-black/30 text-base font-medium text-white transition-colors disabled:opacity-55"
            >
              <Image src="/images/google.svg" alt="" width={20} height={20} className="h-5 w-5" />
              Continue with Google
            </button>
          </>
        )}

        <button
          type="button"
          className="home-spotlight-card home-border-glow home-spotlight-dynamic home-spotlight-card--hover mt-5 h-10 w-full rounded-full border border-white/14 bg-black/30 px-4 text-sm text-slate-300 transition-colors hover:text-white"
          onClick={() => {
            if (mode === "signin") switchMode("signup")
            else if (mode === "signup") switchMode("signin")
            else switchMode("signin")
          }}
        >
          {mode === "signin" ? "Don't have an account? Sign up" : mode === "signup" ? "Already have an account? Sign in" : "Back to sign in"}
        </button>
      </form>
      {debugEnabled && (
        <div className="fixed bottom-2 right-2 z-50 w-105 max-h-[48vh] overflow-auto rounded-md border border-white/20 bg-black/75 p-2 text-[11px] text-white/90">
          <div className="mb-1 font-mono text-white/95">Login Debug id={debugMountIdRef.current}</div>
          <pre className="whitespace-pre-wrap wrap-break-word font-mono">
            {JSON.stringify(
              {
                counters: debugPanel.counters,
                events: debugPanel.events.slice(-16),
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </main>
  )
}
